import type { AgentId, ConsensusView, Signal, Token } from "@/lib/types";
import { CONSENSUS_WEIGHTS } from "./roster";

/**
 * The shared workspace the agents collaborate through.
 *
 * Agents never call each other. They read what is on the board and write their
 * own verdicts back, which keeps the pipeline order-independent, makes every
 * decision auditable ("who said what, when, why") and lets an agent be added or
 * removed without touching the others.
 */
export class Blackboard {
  private readonly signals = new Map<string, Map<AgentId, Signal>>();
  private readonly tokens = new Map<string, Token>();
  /** Tokens SCOUT promoted to the active watchlist this tick. */
  private watchlist: string[] = [];
  private readonly notes = new Map<string, string>();

  setUniverse(tokens: Token[]): void {
    this.tokens.clear();
    for (const t of tokens) this.tokens.set(t.id, t);
    // Drop verdicts about tokens that left the universe.
    for (const id of [...this.signals.keys()]) {
      if (!this.tokens.has(id)) this.signals.delete(id);
    }
  }

  universe(): Token[] {
    return [...this.tokens.values()];
  }

  token(id: string): Token | undefined {
    return this.tokens.get(id);
  }

  setWatchlist(ids: string[]): void {
    this.watchlist = ids;
  }

  watchlistTokens(): Token[] {
    return this.watchlist.map((id) => this.tokens.get(id)).filter((t): t is Token => Boolean(t));
  }

  publish(signal: Signal): void {
    const perToken = this.signals.get(signal.tokenId) ?? new Map<AgentId, Signal>();
    perToken.set(signal.agent, signal);
    this.signals.set(signal.tokenId, perToken);
  }

  signalsFor(tokenId: string): Signal[] {
    return [...(this.signals.get(tokenId)?.values() ?? [])];
  }

  signalBy(tokenId: string, agent: AgentId): Signal | undefined {
    return this.signals.get(tokenId)?.get(agent);
  }

  note(key: string, value: string): void {
    this.notes.set(key, value);
  }

  readNote(key: string): string | undefined {
    return this.notes.get(key);
  }

  /**
   * Blend the voting agents' scores into one view per watchlist token.
   * A veto short-circuits the blend — no amount of momentum outvotes a rug.
   */
  consensus(): ConsensusView[] {
    const out: ConsensusView[] = [];
    for (const token of this.watchlistTokens()) {
      const signals = this.signalsFor(token.id);
      if (signals.length === 0) continue;

      const vetoed = signals.some((s) => s.veto);
      let weighted = 0;
      let weightSum = 0;
      let confidence = 0;
      for (const s of signals) {
        const w = CONSENSUS_WEIGHTS[s.agent];
        if (!w) continue;
        weighted += s.score * w * (0.55 + 0.45 * s.confidence);
        weightSum += w * (0.55 + 0.45 * s.confidence);
        confidence += s.confidence * w;
      }
      const score = weightSum > 0 ? weighted / weightSum : 0;
      const conf = weightSum > 0 ? Math.min(1, confidence / weightSum) : 0;

      out.push({
        tokenId: token.id,
        symbol: token.symbol,
        chain: token.chain,
        score: vetoed ? Math.min(score, -60) : score,
        confidence: conf,
        verdict: vetoed
          ? "vetoed"
          : score >= 72
            ? "strong-buy"
            : score >= 55
              ? "buy"
              : score >= 25
                ? "watch"
                : "avoid",
        signals: signals.sort((a, b) => a.agent.localeCompare(b.agent)),
        updatedAt: Date.now(),
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}
