import { Agent, type AgentContext } from "./base";

/**
 * SCOUT — decides what is even worth looking at.
 *
 * The universe is hundreds of pairs; the rest of the desk can only reason about
 * a handful. SCOUT ranks on tradability (is there a pool deep enough to get in
 * and back out of?) and freshness (is anything actually happening?), then hands
 * a short watchlist to the board.
 */
const WATCHLIST_SIZE = 14;

export class ScoutAgent extends Agent {
  constructor() {
    super("scout");
  }

  run(ctx: AgentContext): void {
    const universe = ctx.board.universe();
    this.working(`scanning ${universe.length} pairs`, Math.min(1, universe.length / 60));

    const scored = universe
      .map((token) => {
        const reasons: string[] = [];
        let score = 0;

        // Tradability: liquidity relative to the desk's own floor.
        const liqRatio = token.liquidityUsd / Math.max(1, ctx.risk.minLiquidityUsd);
        if (liqRatio >= 1) {
          score += Math.min(30, 12 + Math.log10(liqRatio + 1) * 24);
          reasons.push(`liquidity $${Math.round(token.liquidityUsd).toLocaleString("en-US")}`);
        } else {
          score -= 35;
          reasons.push(`thin pool ($${Math.round(token.liquidityUsd).toLocaleString("en-US")})`);
        }

        // Turnover: volume against the pool is how fast the thing actually moves.
        const turnover = token.volume24hUsd / Math.max(1, token.liquidityUsd);
        if (turnover > 0.6) {
          score += Math.min(28, turnover * 9);
          reasons.push(`turnover ${turnover.toFixed(1)}x pool`);
        } else {
          score -= 12;
          reasons.push("low turnover");
        }

        // Freshness: young pairs carry the asymmetry memecoins are traded for.
        if (token.ageMinutes < 60) {
          score += 22;
          reasons.push(`${token.ageMinutes}m old launch`);
        } else if (token.ageMinutes < 60 * 24) {
          score += 12;
          reasons.push(`${Math.round(token.ageMinutes / 60)}h old`);
        } else if (token.ageMinutes > ctx.risk.maxPairAgeMinutes) {
          score -= 18;
          reasons.push("outside age window");
        }

        // Attention: a 5m volume burst relative to its own 24h run-rate.
        const burst = token.volume5mUsd / Math.max(1, token.volume24hUsd / 288);
        if (burst > 2.5) {
          score += Math.min(24, burst * 3.5);
          reasons.push(`volume burst ${burst.toFixed(1)}x`);
        }

        if (token.volume24hUsd < ctx.risk.minVolume24hUsd) {
          score -= 25;
          reasons.push("below volume floor");
        }

        return { token, score, reasons };
      })
      .sort((a, b) => b.score - a.score);

    const picked = scored.slice(0, WATCHLIST_SIZE);
    ctx.board.setWatchlist(picked.map((p) => p.token.id));

    for (const { token, score, reasons } of picked) {
      ctx.board.publish(
        this.signal(
          token.id,
          score,
          Math.min(1, 0.45 + Math.log10(token.liquidityUsd + 10) / 12),
          score > 55 ? "prime candidate" : score > 25 ? "worth watching" : "marginal",
          reasons.slice(0, 4),
        ),
      );
    }

    const fresh = picked.filter((p) => p.token.ageMinutes < 60);
    if (fresh.length > 0 && ctx.tick % 5 === 0) {
      ctx.log("signal", `${fresh.length} fresh launch(es) promoted to the watchlist`, {
        tokenSymbol: fresh[0].token.symbol,
      });
    }

    this.acted(`watchlist: ${picked.length} of ${universe.length}`, picked.length ? 1 : 0);
  }
}
