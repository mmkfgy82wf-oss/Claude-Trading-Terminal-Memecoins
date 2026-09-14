import { now } from "@/lib/util/clock";
import { CHAINS } from "@/lib/market/chains";
import { estimateSlippagePct } from "@/lib/trading/executor";
import type { ChainId, TickDiagnostics, TradeIntent } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

let intentSeq = 0;
const intentId = () => `i${now().toString(36)}${(++intentSeq).toString(36)}`;

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

  /**
   * Where each candidate stopped this tick.
   *
   * Sizing is the last gate before money moves, so this is the one place that
   * can say why nothing happened. Without it, "the desk is quiet" and "the desk
   * is stuck" look identical from the outside.
   */
  funnel: TickDiagnostics["funnel"] = RiskAgent.emptyFunnel();
  /** One sentence naming what is holding everything up, or null while trading. */
  blocker: string | null = null;

  private static emptyFunnel(): TickDiagnostics["funnel"] {
    return {
      considered: 0,
      vetoed: 0,
      belowScore: 0,
      alreadyHeld: 0,
      noCash: 0,
      tooSmall: 0,
      slippage: 0,
      noSlot: 0,
      sized: 0,
    };
  }

  run(ctx: AgentContext): void {
    this.pending.length = 0;
    this.funnel = RiskAgent.emptyFunnel();
    this.blocker = null;
    const { risk, wallet, flags } = ctx;
    const snapshot = wallet.snapshot();

    // Count the full board before any gate, so the funnel starts from what the
    // desk actually looked at rather than what survived.
    const board = ctx.board.consensus();
    this.funnel.considered = board.length;
    this.funnel.vetoed = board.filter((c) => c.verdict === "vetoed").length;
    this.funnel.belowScore = board.filter(
      (c) => c.verdict !== "vetoed" && c.score < risk.minConsensusScore,
    ).length;
    this.funnel.alreadyHeld = board.filter(
      (c) => c.verdict !== "vetoed" && c.score >= risk.minConsensusScore && wallet.positionFor(c.tokenId),
    ).length;

    if (flags.killSwitch) {
      this.blocked("KILL SWITCH — no new risk");
      this.blocker = "Kill switch engaged — no new risk until you release it.";
      return;
    }

    const drawdown = wallet.dailyDrawdownPct();
    if (drawdown >= risk.dailyLossLimitPct) {
      this.blocked(`daily loss limit hit (-${drawdown.toFixed(1)}%)`);
      this.blocker = `Daily loss limit reached (-${drawdown.toFixed(1)}% of ${risk.dailyLossLimitPct}%) — entries halted for the day.`;
      if (!ctx.board.readNote("risk:dailyLimit")) {
        ctx.board.note("risk:dailyLimit", "1");
        ctx.log("error", `Daily loss limit reached (-${drawdown.toFixed(1)}%) — new entries halted`);
      }
      return;
    }
    ctx.board.note("risk:dailyLimit", "");

    const exposurePct = (snapshot.positionsValueUsd / Math.max(1e-9, snapshot.equityUsd)) * 100;
    this.working(`exposure ${exposurePct.toFixed(0)}% / ${risk.maxPortfolioExposurePct}%`, exposurePct / 100);

    if (snapshot.openPositions >= risk.maxOpenPositions) {
      this.blocked(`at position cap (${snapshot.openPositions}/${risk.maxOpenPositions})`);
      this.funnel.noSlot = Math.max(0, this.funnel.considered - this.funnel.vetoed - this.funnel.belowScore);
      this.blocker = `All ${risk.maxOpenPositions} position slots are full — nothing new until one exits.`;
      return;
    }
    if (exposurePct >= risk.maxPortfolioExposurePct) {
      this.blocked(`at exposure cap (${exposurePct.toFixed(0)}%)`);
      this.blocker = `Exposure at ${exposurePct.toFixed(0)}% of the ${risk.maxPortfolioExposurePct}% cap — no room for another position.`;
      return;
    }

    // Headroom and cash are tracked per chain and consumed as tickets are
    // issued. A candidate on one chain can only ever be paid for out of that
    // chain's own treasury — its quote asset does not exist on the other.
    const headroomUsd = new Map<ChainId, number>();
    const cashNative = new Map<ChainId, number>();
    for (const treasury of snapshot.treasuries) {
      headroomUsd.set(
        treasury.chain,
        Math.max(
          0,
          (treasury.equityUsd * risk.maxPortfolioExposurePct) / 100 -
            treasury.positionsValueNative * treasury.quotePriceUsd,
        ),
      );
      cashNative.set(treasury.chain, treasury.cashNative);
    }
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

      const chain = token.chain;
      const quote = CHAINS[chain].native;
      const quotePriceUsd = wallet.quotePrice(chain);
      const chainHeadroomUsd = headroomUsd.get(chain) ?? 0;
      const chainCash = cashNative.get(chain) ?? 0;

      if (chainCash <= 0) {
        this.funnel.noCash += 1;
        ctx.board.publish(
          this.signal(token.id, -10, 0.7, `no ${quote} on ${CHAINS[chain].label}`, [
            `treasury for this chain is empty — a ${quote} pair cannot be paid for from another chain`,
          ]),
        );
        continue;
      }

      // Size scales with conviction, then gets clamped by every hard cap.
      const convictionFactor = 0.45 + 0.55 * Math.min(1, (candidate.score - risk.minConsensusScore) / 35);
      let sizeUsd =
        snapshot.equityUsd * (risk.maxPositionPct / 100) * convictionFactor * candidate.confidence;
      sizeUsd = Math.min(sizeUsd, chainHeadroomUsd, chainCash * quotePriceUsd * 0.9);

      // Never take a ticket the pool cannot absorb inside the slippage budget.
      sizeUsd = Math.min(sizeUsd, token.liquidityUsd * 0.01);

      let sizeNative = sizeUsd / Math.max(1e-9, quotePriceUsd);
      sizeNative = Math.floor(sizeNative * 1e6) / 1e6;

      if (sizeNative <= 0 || sizeNative * quotePriceUsd < 1) {
        this.funnel.tooSmall += 1;
        ctx.board.publish(
          this.signal(token.id, -20, 0.6, "too small to take", [
            `max ticket $${sizeUsd.toFixed(2)} against a $${Math.round(token.liquidityUsd).toLocaleString("en-US")} pool`,
          ]),
        );
        continue;
      }

      const projected = estimateSlippagePct(sizeNative * quotePriceUsd, token.liquidityUsd);
      if (projected > risk.maxSlippagePct) {
        this.funnel.slippage += 1;
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
        chain,
        side: "buy",
        sizeNative,
        quote,
        reason: `consensus ${candidate.score.toFixed(0)} · conf ${(candidate.confidence * 100).toFixed(0)}%`,
        consensusScore: candidate.score,
        confidence: candidate.confidence,
        createdAt: now(),
      });

      headroomUsd.set(chain, chainHeadroomUsd - sizeNative * quotePriceUsd);
      cashNative.set(chain, chainCash - sizeNative);

      ctx.board.publish(
        this.signal(token.id, 60, candidate.confidence, "sized", [
          `${sizeNative.toFixed(4)} ${quote} (${((sizeNative * quotePriceUsd) / snapshot.equityUsd * 100).toFixed(1)}% of book)`,
          `projected slippage ${projected.toFixed(2)}%`,
        ]),
      );
      taken += 1;
    }

    this.funnel.sized = taken;
    if (taken === 0 && !this.blocker) {
      // Nothing was blocked outright — say which gate actually emptied the board.
      this.blocker = this.explainEmptyTick(risk.minConsensusScore);
    }

    if (taken > 0) this.acted(`${taken} ticket(s) sized`, taken);
    else this.settle(`exposure ${exposurePct.toFixed(0)}% · ${snapshot.openPositions}/${risk.maxOpenPositions} slots`);
  }

  /**
   * Name the gate that emptied the board. Ordered by how far a candidate got,
   * so the message points at the last thing that stopped it rather than the
   * first thing that could have.
   */
  private explainEmptyTick(minScore: number): string {
    const f = this.funnel;
    if (f.considered === 0) return "No candidates on the board — SCOUT has nothing to rank yet.";
    if (f.slippage > 0) return `${f.slippage} candidate(s) rejected on slippage — the pools are too thin for this ticket size.`;
    if (f.tooSmall > 0) return `${f.tooSmall} candidate(s) would size below the minimum ticket.`;
    if (f.noCash > 0) return `${f.noCash} candidate(s) are on a chain whose treasury is empty.`;
    if (f.alreadyHeld > 0 && f.alreadyHeld + f.vetoed + f.belowScore >= f.considered) {
      return "Everything that qualifies is already held.";
    }
    if (f.vetoed >= f.considered) return `SENTINEL vetoed all ${f.considered} candidates — rug markers across the board.`;
    if (f.belowScore >= f.considered - f.vetoed) {
      return `No candidate reached the consensus threshold of ${minScore} — the board is quiet, not stuck.`;
    }
    return "No candidate cleared every gate this tick.";
  }
}
