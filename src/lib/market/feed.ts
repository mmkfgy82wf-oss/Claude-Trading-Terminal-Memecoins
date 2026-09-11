import type { ChainId, ChainStatus, MarketMode, Token } from "@/lib/types";
import { CHAINS } from "./chains";
import { fetchChainPairs, knownSlug, refreshPairs } from "./dexscreener";
import { MarketSimulator } from "./simulator";

/**
 * One feed per chain. It owns the price history, hides whether the numbers came
 * from DexScreener or the simulator, and degrades without ever throwing: a dead
 * upstream flips the chain to `simulated` and the terminal keeps trading.
 */
export class ChainFeed {
  private readonly tokens = new Map<string, Token>();
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
  async poll(): Promise<Token[]> {
    if (this.preference === "simulated") return this.runSim("Simulator forced via MARKET_MODE.");

    try {
      const now = Date.now();
      const needsDiscovery = this.tokens.size === 0 || now - this.lastDiscoveryAt > 60_000;

      if (needsDiscovery) {
        const found = await fetchChainPairs(this.chain);
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

      this.mode = "live";
      const slug = knownSlug(this.chain);
      this.note = `Live via DexScreener${slug ? ` (${slug})` : ""} · ${this.tokens.size} pairs indexed.`;
      this.lastFetchAt = Date.now();
      return [...this.tokens.values()];
    } catch {
      return this.runSim("Feed error — simulator engaged.");
    }
  }

  private runSim(note: string): Token[] {
    this.mode = "simulated";
    this.note = note;
    this.lastFetchAt = Date.now();
    const tokens = this.sim.step();
    this.tokens.clear();
    for (const t of tokens) this.tokens.set(t.id, t);
    return tokens;
  }

  /** Keep the rolling history across refreshes so charts stay continuous. */
  private merge(next: Token): void {
    const prev = this.tokens.get(next.id);
    const history = [...(prev?.history ?? []), { t: Date.now(), p: next.priceUsd }].slice(-120);
    this.tokens.set(next.id, { ...next, history });
  }
}

export class MarketFeed {
  private readonly feeds: ChainFeed[];

  constructor(chains: ChainId[], preference: "live" | "simulated" | "auto" = "auto") {
    this.feeds = chains.map((c) => new ChainFeed(c, preference));
  }

  async poll(): Promise<Token[]> {
    const results = await Promise.all(this.feeds.map((f) => f.poll()));
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
