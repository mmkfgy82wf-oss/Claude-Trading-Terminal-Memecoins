import type { PricePoint, Token } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

/**
 * QUANT — the numbers desk, and the heaviest vote in the consensus.
 *
 * It reads four things off each candidate: trend across timeframes, order-flow
 * imbalance, volume acceleration, and whether the move is already extended.
 * The last one matters most — buying the top of a vertical candle is how paper
 * gains evaporate.
 */

/** Realised volatility of the in-memory price history, in percent per tick. */
function realizedVolPct(history: PricePoint[]): number {
  if (history.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].p;
    if (prev > 0) rets.push(Math.log(history[i].p / prev));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}

/** Slope of the recent history, normalised to percent per tick. */
function trendSlopePct(history: PricePoint[], lookback = 20): number {
  const pts = history.slice(-lookback);
  if (pts.length < 4) return 0;
  const n = pts.length;
  const xs = pts.map((_, i) => i);
  const ys = pts.map((p) => Math.log(Math.max(1e-12, p.p)));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : (num / den) * 100;
}

export class QuantAgent extends Agent {
  constructor() {
    super("quant");
  }

  run(ctx: AgentContext): void {
    const watchlist = ctx.board.watchlistTokens();
    this.working(`modelling ${watchlist.length} candidates`, Math.min(1, watchlist.length / 14));

    let hot = 0;
    for (const token of watchlist) {
      const { score, confidence, reasons, label } = this.evaluate(token, ctx);
      if (score >= 60) hot += 1;
      ctx.board.publish(this.signal(token.id, score, confidence, label, reasons));
    }

    ctx.board.note("quant:hot", String(hot));
    this.acted(hot ? `${hot} setup(s) above threshold` : "no setups above threshold", watchlist.length ? 1 : 0);
  }

  private evaluate(
    token: Token,
    ctx: AgentContext,
  ): { score: number; confidence: number; reasons: string[]; label: string } {
    const reasons: string[] = [];
    let score = 0;

    // 1. Multi-timeframe trend agreement — the 1h move sets the regime.
    const trend = token.change1h * 0.6 + token.change5m * 0.8 + token.change24h * 0.08;
    if (trend > 0) {
      // Note: this curve saturates at a combined move of about +24%, so a pair
      // up 50% in an hour and one up 1187% score identically here. That looks
      // like destroyed information, and replacing it with a logarithmic curve
      // was the obvious fix — but on the bench it cost a quarter of all
      // entries and a fifth of the profit factor while removing not one
      // blow-up (docs/BACKTEST.md). How far a pair has already run turns out
      // to carry no usable information about whether its pool is about to be
      // pulled, so the saturation stays until a recorded tape says otherwise.
      score += Math.min(34, Math.sqrt(trend) * 7);
      reasons.push(`trend +${token.change1h.toFixed(1)}% 1h / ${token.change5m >= 0 ? "+" : ""}${token.change5m.toFixed(1)}% 5m`);
    } else {
      score -= Math.min(40, Math.sqrt(-trend) * 8);
      reasons.push(`downtrend ${token.change1h.toFixed(1)}% 1h`);
    }

    // 2. Order-flow imbalance.
    //
    // Weighted to zero would mean not reading it at all, which the tape says is
    // the right answer: the buy share flipped sign between the 30- and
    // 90-minute horizons and again between the two halves of the recording.
    // Kept as a knob rather than deleted, because "three checks on one night"
    // is grounds for switching something off, not for forgetting it existed.
    const trades = token.buys5m + token.sells5m;
    if (trades > 12) {
      const imbalance = (token.buys5m - token.sells5m) / trades;
      score += imbalance * ctx.risk.quantFlowWeight;
      reasons.push(`flow ${imbalance >= 0 ? "+" : ""}${(imbalance * 100).toFixed(0)}% (${token.buys5m}B/${token.sells5m}S)`);
    } else {
      score -= 8;
      reasons.push("too few trades to read flow");
    }

    // 3. Volume acceleration versus its own baseline.
    //
    // Holds up as a predictor at every horizon — of return *and* of collapse,
    // in the same proportion. It is the risk dial the desk has been turning
    // all along while reading it as conviction.
    const baseline = token.volume24hUsd / 288;
    const accel = token.volume5mUsd / Math.max(1, baseline);
    if (accel > 1.5) {
      score += Math.min(ctx.risk.quantVolumeWeight, accel * (ctx.risk.quantVolumeWeight / 5.8));
      reasons.push(`volume ${accel.toFixed(1)}x baseline`);
    } else if (accel < 0.5) {
      score -= 12;
      reasons.push("volume fading");
    }

    // 3b. Turnover against pool depth — the one reading that separated.
    //
    // In both halves of the recording it bought forward return at close to no
    // extra collapse risk: +32.8 points for +0.33pp in the first half, +5.71
    // for +0.96pp in the second. Every other feature moved return and rug rate
    // together. SCOUT already reads it, but SCOUT carries a fifth of the
    // consensus and QUANT carries half, so the desk has been hearing it
    // quietly. Off by default until a backtest over the tape says otherwise.
    if (ctx.risk.quantTurnoverWeight > 0) {
      const turnover = token.volume24hUsd / Math.max(1, token.liquidityUsd);
      const w = ctx.risk.quantTurnoverWeight;
      // Full weight around 3x turnover, where SCOUT's own curve also flattens.
      score += Math.min(w, (Math.log1p(turnover) / Math.log1p(3)) * w);
      reasons.push(`turnover ${turnover.toFixed(1)}x pool`);
    }

    // 4. Extension penalty — do not pay for a move that already happened.
    //
    // Scaled rather than switched: at twice the threshold it costs ~18 points,
    // at eight times ~38. A pair that has done 10x in an hour is not a stronger
    // version of one that has done 50% — it is a later entry into the same
    // move, and late is where the desk was standing on most of its losses.
    const run = Math.max(token.change1h, token.change5m * 4);
    if (run > ctx.risk.maxEntryRunPct) {
      const over = run / Math.max(1, ctx.risk.maxEntryRunPct);
      score -= Math.min(45, 8 + 10 * Math.log2(over));
      reasons.push(`+${run.toFixed(0)}% already run — late entry`);
    }

    if (token.change5m > 45) {
      score -= Math.min(35, (token.change5m - 45) * 0.7);
      reasons.push(`extended +${token.change5m.toFixed(0)}% in 5m`);
    }
    if (token.change24h > 900) {
      score -= 15;
      reasons.push("parabolic on the day");
    }

    // 5. Volatility: some is the point, too much is unmanageable risk.
    const vol = realizedVolPct(token.history);
    if (vol > 12) {
      score -= Math.min(20, (vol - 12) * 1.4);
      reasons.push(`realised vol ${vol.toFixed(1)}%/tick`);
    }

    const slope = trendSlopePct(token.history);
    if (Math.abs(slope) > 0.01) {
      score += Math.max(-12, Math.min(12, slope * 2.5));
      reasons.push(`slope ${slope >= 0 ? "+" : ""}${slope.toFixed(2)}%/tick`);
    }

    // Confidence scales with how much history we actually have.
    const confidence = Math.min(1, 0.3 + token.history.length / 60 + (trades > 40 ? 0.2 : 0));
    const label = score >= 72 ? "high conviction" : score >= 55 ? "constructive" : score >= 25 ? "neutral" : "bearish";
    return { score, confidence, reasons: reasons.slice(0, 5), label };
  }
}
