import { estimateSlippagePct } from "@/lib/trading/executor";
import type { TradeIntent } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

let intentSeq = 0;
const intentId = () => `i${Date.now().toString(36)}${(++intentSeq).toString(36)}`;

/**
 * RISK — turns "we like it" into "we can actually take it, this big".
 *
 * Everything the desk is not allowed to do lives here: exposure caps, position
 * count, per-name sizing, the daily loss limit and the kill switch. It emits
 * `TradeIntent`s; nothing downstream re-checks these limits, so this is the
 * single place that decides how much risk is on.
 */
export class RiskAgent extends Agent {
  constructor() {
    super("risk");
  }

  /** Intents produced this tick, consumed by the orchestrator. */
  readonly pending: TradeIntent[] = [];

  run(ctx: AgentContext): void {
    this.pending.length = 0;
    const { risk, wallet, flags } = ctx;
    const snapshot = wallet.snapshot(ctx.solPriceUsd);

    if (flags.killSwitch) {
      this.blocked("KILL SWITCH — no new risk");
      return;
    }

    const drawdown = wallet.dailyDrawdownPct(ctx.solPriceUsd);
    if (drawdown >= risk.dailyLossLimitPct) {
      this.blocked(`daily loss limit hit (-${drawdown.toFixed(1)}%)`);
      if (!ctx.board.readNote("risk:dailyLimit")) {
        ctx.board.note("risk:dailyLimit", "1");
        ctx.log("error", `Daily loss limit reached (-${drawdown.toFixed(1)}%) — new entries halted`);
      }
      return;
    }
    ctx.board.note("risk:dailyLimit", "");

    const exposurePct = (snapshot.positionsValueSol / Math.max(1e-9, snapshot.equitySol)) * 100;
    this.working(`exposure ${exposurePct.toFixed(0)}% / ${risk.maxPortfolioExposurePct}%`, exposurePct / 100);

    if (snapshot.openPositions >= risk.maxOpenPositions) {
      this.blocked(`at position cap (${snapshot.openPositions}/${risk.maxOpenPositions})`);
      return;
    }
    if (exposurePct >= risk.maxPortfolioExposurePct) {
      this.blocked(`at exposure cap (${exposurePct.toFixed(0)}%)`);
      return;
    }

    // Headroom and cash are consumed as tickets are issued: sizing every
    // candidate against the same starting headroom would let one tick's batch
    // blow through the exposure cap in aggregate.
    let headroomSol = Math.max(
      0,
      (snapshot.equitySol * risk.maxPortfolioExposurePct) / 100 - snapshot.positionsValueSol,
    );
    let cashSol = wallet.cash;
    const slots = risk.maxOpenPositions - snapshot.openPositions;

    const candidates = ctx.board
      .consensus()
      .filter((c) => c.verdict !== "vetoed" && c.score >= risk.minConsensusScore)
      .filter((c) => !wallet.positionFor(c.tokenId));

    let taken = 0;
    for (const candidate of candidates) {
      if (taken >= slots) break;
      const token = ctx.board.token(candidate.tokenId);
      if (!token) continue;

      // Size scales with conviction, then gets clamped by every hard cap.
      const convictionFactor = 0.45 + 0.55 * Math.min(1, (candidate.score - risk.minConsensusScore) / 35);
      let sizeSol = snapshot.equitySol * (risk.maxPositionPct / 100) * convictionFactor * candidate.confidence;
      sizeSol = Math.min(sizeSol, headroomSol, cashSol * 0.9);

      // Never take a ticket the pool cannot absorb inside the slippage budget.
      const maxByLiquidity = (token.liquidityUsd * 0.01) / ctx.solPriceUsd;
      sizeSol = Math.min(sizeSol, maxByLiquidity);
      sizeSol = Math.floor(sizeSol * 1000) / 1000;

      if (sizeSol < 0.01) {
        ctx.board.publish(
          this.signal(token.id, -20, 0.6, "too small to take", [
            `max ticket ${(maxByLiquidity).toFixed(3)} SOL vs pool $${Math.round(token.liquidityUsd).toLocaleString("en-US")}`,
          ]),
        );
        continue;
      }

      const projected = estimateSlippagePct(sizeSol * ctx.solPriceUsd, token.liquidityUsd);
      if (projected > risk.maxSlippagePct) {
        ctx.board.publish(
          this.signal(token.id, -15, 0.65, "slippage over budget", [
            `${projected.toFixed(2)}% projected vs ${risk.maxSlippagePct}% budget`,
          ]),
        );
        continue;
      }

      this.pending.push({
        id: intentId(),
        tokenId: token.id,
        symbol: token.symbol,
        chain: token.chain,
        side: "buy",
        sizeSol,
        reason: `consensus ${candidate.score.toFixed(0)} · conf ${(candidate.confidence * 100).toFixed(0)}%`,
        consensusScore: candidate.score,
        confidence: candidate.confidence,
        createdAt: Date.now(),
      });

      headroomSol -= sizeSol;
      cashSol -= sizeSol;

      ctx.board.publish(
        this.signal(token.id, 60, candidate.confidence, "sized", [
          `${sizeSol.toFixed(3)} SOL (${((sizeSol / snapshot.equitySol) * 100).toFixed(1)}% of equity)`,
          `projected slippage ${projected.toFixed(2)}%`,
        ]),
      );
      taken += 1;
    }

    if (taken > 0) this.acted(`${taken} ticket(s) sized`, taken);
    else this.settle(`exposure ${exposurePct.toFixed(0)}% · ${snapshot.openPositions}/${risk.maxOpenPositions} slots`);
  }
}
