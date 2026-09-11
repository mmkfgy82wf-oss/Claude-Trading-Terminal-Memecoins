import { PaperExecutor, type TradeExecutor } from "@/lib/trading/executor";
import type { Position, Token, TradeIntent } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

/**
 * EXECUTOR — the only agent that touches the wallet.
 *
 * Entries arrive as approved intents. Exits are its own responsibility and run
 * every tick regardless of what the rest of the desk thinks: stop-loss, the
 * take-profit ladder, the trailing stop, a late SENTINEL veto, and the kill
 * switch. Exits are never gated on approval — getting out is always allowed.
 */

/** How much of a position each take-profit rung sells. */
const RUNG_FRACTIONS = [0.4, 0.35, 1];

export class ExecutorAgent extends Agent {
  constructor(private readonly executor: TradeExecutor = new PaperExecutor()) {
    super("executor");
  }

  get mode(): "paper" | "live" {
    return this.executor.mode;
  }

  async run(ctx: AgentContext): Promise<void> {
    const positions = ctx.wallet.openPositions();
    this.working(`managing ${positions.length} position(s)`, Math.min(1, positions.length / 6));

    let actions = 0;
    for (const position of positions) {
      const decision = this.exitDecision(position, ctx);
      if (!decision) continue;
      const done = await this.exit(position, decision.fraction, decision.reason, decision.rung, ctx);
      if (done) actions += 1;
    }

    if (actions > 0) this.acted(`${actions} exit(s) executed`, actions);
    else if (positions.length === 0) this.settle("flat — waiting for tickets");
    else this.settle(`holding ${positions.length} position(s)`);
  }

  /** Book an approved entry. Returns true when a fill happened. */
  async enter(intent: TradeIntent, ctx: AgentContext): Promise<boolean> {
    const token = ctx.board.token(intent.tokenId);
    if (!token) {
      ctx.log("warn", `${intent.symbol} left the universe before the fill — ticket dropped`, {
        tokenSymbol: intent.symbol,
      });
      return false;
    }
    if (ctx.flags.killSwitch) return false;

    const result = await this.executor.buy(intent, token, ctx.solPriceUsd, ctx.risk);
    if (!result.ok || !result.fill) {
      ctx.log("warn", `entry rejected for ${intent.symbol}: ${result.error ?? "unknown"}`, {
        tokenSymbol: intent.symbol,
      });
      return false;
    }

    const position = ctx.wallet.applyBuy(result.fill, ctx.risk);
    this.acted(`bought ${intent.symbol}`);
    ctx.log("trade", `BUY ${intent.symbol} · ${result.fill.valueSol.toFixed(3)} SOL @ $${result.fill.priceUsd.toPrecision(4)} · slip ${result.fill.slippagePct.toFixed(2)}%`, {
      tokenSymbol: intent.symbol,
      meta: { sizeSol: result.fill.valueSol, score: intent.consensusScore, positionId: position.id },
    });
    return true;
  }

  /** Close one position on operator command. */
  async liquidateOne(position: Position, ctx: AgentContext, reason: string): Promise<boolean> {
    const done = await this.exit(position, 1, reason, false, ctx);
    if (done) this.acted(`closed ${position.symbol} (${reason})`);
    return done;
  }

  /** Liquidate everything — used by the kill switch and manual panic. */
  async liquidateAll(ctx: AgentContext, reason: string): Promise<number> {
    let closed = 0;
    for (const position of ctx.wallet.openPositions()) {
      if (await this.exit(position, 1, reason, false, ctx)) closed += 1;
    }
    if (closed) this.acted(`liquidated ${closed} position(s)`, closed);
    return closed;
  }

  private exitDecision(
    position: Position,
    ctx: AgentContext,
  ): { fraction: number; reason: string; rung: boolean } | null {
    if (ctx.flags.killSwitch) return { fraction: 1, reason: "kill switch", rung: false };

    const sentinel = ctx.board.signalBy(position.tokenId, "sentinel");
    if (sentinel?.veto) {
      return { fraction: 1, reason: `sentinel veto: ${sentinel.reasons[0] ?? "rug markers"}`, rung: false };
    }

    const pnlPct = position.unrealizedPnlPct;

    if (pnlPct <= -position.stopLossPct) {
      return { fraction: 1, reason: `stop-loss ${pnlPct.toFixed(1)}%`, rung: false };
    }

    // Trailing stop only arms once the position has cleared the first rung —
    // otherwise normal memecoin noise would shake every entry out immediately.
    const peakGainPct = ((position.peakPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    const firstRung = position.takeProfitLadder[0] ?? 50;
    if (peakGainPct >= firstRung) {
      const dropFromPeak = ((position.peakPriceUsd - position.currentPriceUsd) / position.peakPriceUsd) * 100;
      if (dropFromPeak >= position.trailingStopPct) {
        return {
          fraction: 1,
          reason: `trailing stop -${dropFromPeak.toFixed(1)}% from peak (+${peakGainPct.toFixed(0)}%)`,
          rung: false,
        };
      }
    }

    const nextRung = position.takeProfitLadder[position.filledRungs];
    if (nextRung != null && pnlPct >= nextRung) {
      const fraction = RUNG_FRACTIONS[Math.min(position.filledRungs, RUNG_FRACTIONS.length - 1)];
      return { fraction, reason: `take-profit +${nextRung}% (rung ${position.filledRungs + 1})`, rung: true };
    }

    // A position whose pool has drained is worth exiting even at a loss.
    const token = ctx.board.token(position.tokenId);
    if (token && token.liquidityUsd < ctx.risk.minLiquidityUsd * 0.35) {
      return { fraction: 1, reason: "liquidity drained below exit threshold", rung: false };
    }

    return null;
  }

  private async exit(
    position: Position,
    fraction: number,
    reason: string,
    rung: boolean,
    ctx: AgentContext,
  ): Promise<boolean> {
    // Without a live quote, mark against the last known price so a delisted
    // pair cannot strand the position forever.
    const token: Token = ctx.board.token(position.tokenId) ?? {
      id: position.tokenId,
      chain: position.chain,
      pairAddress: position.tokenId.split(":")[1] ?? "",
      tokenAddress: "",
      symbol: position.symbol,
      name: position.symbol,
      priceUsd: position.currentPriceUsd,
      priceNative: 0,
      liquidityUsd: ctx.risk.minLiquidityUsd,
      fdvUsd: 0,
      volume24hUsd: 0,
      volume5mUsd: 0,
      buys5m: 0,
      sells5m: 0,
      change5m: 0,
      change1h: 0,
      change24h: 0,
      ageMinutes: 0,
      dex: "unknown",
      history: [],
      simulated: true,
    };

    const result = await this.executor.sell(
      position,
      token,
      fraction,
      reason,
      ctx.solPriceUsd,
      ctx.risk,
    );
    if (!result.ok || !result.fill) {
      ctx.log("warn", `exit failed for ${position.symbol}: ${result.error ?? "unknown"}`, {
        tokenSymbol: position.symbol,
      });
      return false;
    }

    ctx.wallet.applySell(result.fill, rung);
    const pnl = result.fill.realizedPnlSol ?? 0;
    ctx.log(pnl >= 0 ? "trade" : "warn", `SELL ${position.symbol} · ${(fraction * 100).toFixed(0)}% · ${pnl >= 0 ? "▲ +" : "▼ "}${pnl.toFixed(3)} SOL · ${reason}`, {
      tokenSymbol: position.symbol,
      meta: { pnlSol: pnl, fraction },
    });
    return true;
  }
}
