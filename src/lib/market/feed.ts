import type { ChainId, ChainStatus, MarketMode, Token } from "@/lib/types";
import { CHAINS } from "./chains";
import { fetchChainPairs, fetchPairsForTokens, knownSlug, refreshPairs } from "./dexscreener";
import { fetchNewMints, pumpfunReachable } from "./pumpfun";
import { MarketSimulator } from "./simulator";

/**
 * One feed per chain. It owns the price history, hides whether the numbers came
 * from DexScreener or the simulator, and degrades without ever throwing: a dead
 * upstream flips the chain to `simulated` and the terminal keeps trading.
 */
/** A tracked pair that has not refreshed in this long is dropped. */
export const STALE_AFTER_MS = 25 * 60_000;
/** Hard ceiling per chain, so the universe cannot grow without bound. */
export const MAX_TRACKED = 120;

/**
 * Decide which pairs stay in the tracked universe.
 *
 * Without ageing, the tracked set only ever grew: dead and rugged pairs stayed
 * forever, crowded fresh launches out of the watchlist, and made every refresh
 * slower than the one before. Pairs the desk still holds are never dropped —
 * losing sight of an open position would strand it with no stop-loss.
 */
export function pruneUniverse(
  tokens: Token[],
  lastSeen: Map<string, number>,
  protectedIds: Set<string>,
  now = Date.now(),
  maxTracked = MAX_TRACKED,
): Set<string> {
  const fresh = tokens.filter((t) => {
    if (protectedIds.has(t.id)) return true;
    const seenAt = lastSeen.get(t.id) ?? 0;
    return now - seenAt <= STALE_AFTER_MS;
  });

  if (fresh.length <= maxTracked) return new Set(fresh.map((t) => t.id));

  // Over the ceiling: protected pairs always survive, then the deepest pools.
  const held = fresh.filter((t) => protectedIds.has(t.id));
  const rest = fresh
    .filter((t) => !protectedIds.has(t.id))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, Math.max(0, maxTracked - held.length));
  return new Set([...held, ...rest].map((t) => t.id));
}

export class ChainFeed {
  private readonly tokens = new Map<string, Token>();
  /** Last time each pair came back from the upstream, for ageing out. */
  private readonly lastSeen = new Map<string, number>();
  private launchpadHits = 0;
  private readonly sim: MarketSimulator;
  private mode: MarketMode = "simulated";
  private lastDiscoveryAt = 0;
  private lastFetchAt = 0;
  private liveFailures = 0;
  private note: string;

  constructor(
    readonly chain: ChainId,
    private readonly preference: "live" | "simulated" | "auto" = "auto",
  ) {
    this.sim = new MarketSimulator(chain);
    this.note = CHAINS[chain].note;
    this.mode = preference === "simulated" ? "simulated" : "live";
  }

  status(): ChainStatus {
    return {
      chain: this.chain,
      label: CHAINS[this.chain].label,
      mode: this.mode,
      pairsTracked: this.tokens.size,
      lastFetchAt: this.lastFetchAt,
      note: this.note,
    };
  }

  /** Pull the next universe snapshot for this chain. Never rejects. */
  async poll(protectedIds: Set<string> = new Set()): Promise<Token[]> {
    if (this.preference === "simulated") return this.runSim("Simulator forced via MARKET_MODE.");

    try {
      const now = Date.now();
      const needsDiscovery = this.tokens.size === 0 || now - this.lastDiscoveryAt > 60_000;

      if (needsDiscovery) {
        // Two different questions, asked of two different sources:
        //   the launchpad  — what launched in the last few minutes?
        //   the aggregator — what is already moving?
        // A text search can only ever answer the second, because a new token's
        // name is not yet a word anyone would search for.
        const [trending, launched] = await Promise.all([
          fetchChainPairs(this.chain),
          this.discoverFromLaunchpad(),
        ]);
        const found = [...launched, ...trending];
        this.launchpadHits = launched.length;
        this.lastDiscoveryAt = now;
        if (found.length === 0) {
          this.liveFailures += 1;
          if (this.preference === "live") {
            this.mode = "live";
            this.note = `No indexed pairs returned for ${CHAINS[this.chain].label}.`;
            this.lastFetchAt = now;
            return [...this.tokens.values()];
          }
          return this.runSim(
            `No indexed pairs found for ${CHAINS[this.chain].label} — running the simulator.`,
          );
        }
        this.liveFailures = 0;
        for (const t of found) this.merge(t);
      } else {
        const fresh = await refreshPairs(this.chain, [...this.tokens.values()].map((t) => t.pairAddress));
        if (fresh.size === 0 && this.preference === "auto") {
          this.liveFailures += 1;
          if (this.liveFailures >= 3) return this.runSim("Live refresh failing — switched to simulator.");
        } else {
          this.liveFailures = 0;
          for (const t of fresh.values()) this.merge(t);
        }
      }

      this.evictStale(protectedIds);
      this.mode = "live";
      const slug = knownSlug(this.chain);
      const launchpad = this.chain === "solana" && pumpfunReachable() ? " + pump.fun" : "";
      this.note = `Live via DexScreener${slug ? ` (${slug})` : ""}${launchpad} · ${this.tokens.size} pairs${this.launchpadHits ? `, ${this.launchpadHits} fresh launches` : ""}.`;
      this.lastFetchAt = Date.now();
      return [...this.tokens.values()];
    } catch {
      return this.runSim("Feed error — simulator engaged.");
    }
  }

  /**
   * New launches, straight from the launchpad, priced by the aggregator.
   * Solana only for now — pump.fun is the largest launchpad there, and no
   * equivalent single venue dominates the EVM side.
   */
  private async discoverFromLaunchpad(): Promise<Token[]> {
    if (this.chain !== "solana") return [];
    try {
      const mints = await fetchNewMints(50);
      if (mints.length === 0) return [];
      // The launchpad knows what exists; only the aggregator knows whether
      // there is a pool deep enough to get back out of.
      return await fetchPairsForTokens(this.chain, mints.map((m) => m.mint));
    } catch {
      return [];
    }
  }

  private evictStale(protectedIds: Set<string> = new Set()): void {
    const keep = pruneUniverse([...this.tokens.values()], this.lastSeen, protectedIds);
    for (const id of [...this.tokens.keys()]) {
      if (keep.has(id)) continue;
      this.tokens.delete(id);
      this.lastSeen.delete(id);
    }
  }

  private runSim(note: string): Token[] {
    this.mode = "simulated";
    this.note = note;
    this.lastFetchAt = Date.now();
    const tokens = this.sim.step();
    this.tokens.clear();
    this.lastSeen.clear();
    for (const t of tokens) this.tokens.set(t.id, t);
    return tokens;
  }

  /** Keep the rolling history across refreshes so charts stay continuous. */
  private merge(next: Token): void {
    const prev = this.tokens.get(next.id);
    const history = [...(prev?.history ?? []), { t: Date.now(), p: next.priceUsd }].slice(-120);
    this.tokens.set(next.id, { ...next, history });
    this.lastSeen.set(next.id, Date.now());
  }
}

export class MarketFeed {
  private readonly feeds: ChainFeed[];

  constructor(chains: ChainId[], preference: "live" | "simulated" | "auto" = "auto") {
    this.feeds = chains.map((c) => new ChainFeed(c, preference));
  }

  /** `protectedIds` are pairs the desk still holds; they are never aged out. */
  async poll(protectedIds: Set<string> = new Set()): Promise<Token[]> {
    const results = await Promise.all(this.feeds.map((f) => f.poll(protectedIds)));
    return results.flat();
  }

  statuses(): ChainStatus[] {
    return this.feeds.map((f) => f.status());
  }

  /** live when any chain is live — the UI badge reflects the best available. */
  aggregateMode(): MarketMode {
    return this.feeds.some((f) => f.status().mode === "live") ? "live" : "simulated";
  }
}
