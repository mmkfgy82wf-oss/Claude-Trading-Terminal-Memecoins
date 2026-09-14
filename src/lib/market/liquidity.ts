import type { PricePoint } from "@/lib/types";

/**
 * Reading the pool over time instead of at a point.
 *
 * Every rug check the desk had was a single snapshot: how deep is this pool
 * right now, how big is the FDV against it, how one-sided is the flow. None of
 * them can see the shape that actually cost the most money — a pool being
 * emptied while the price still climbs. The chart says winner; the exit is
 * getting narrower every minute; and when the last of it leaves, the position
 * closes at whatever is left, which was -95% or worse on five trades in one
 * overnight run.
 *
 * Two snapshots and a subtraction are all it takes to see it. The desk simply
 * never kept the earlier one.
 */
export interface LiquidityTrend {
  samples: number;
  spanMs: number;
  /** Negative means the pool is emptying. */
  liquidityChangePct: number;
  priceChangePct: number;
  /**
   * Pool shrinking while the price holds or rises.
   *
   * The qualifier matters: on an ordinary sell-off liquidity falls *with* the
   * price, because a constant-product pool is worth less when the token is.
   * That is a losing trade, not a rug, and vetoing it would have the desk
   * flinching at every red candle.
   */
  distributing: boolean;
}

/** Minimum samples before the trend is worth acting on. */
export const MIN_TREND_SAMPLES = 6;

/**
 * @param windowMs how far back to look. The default is a few minutes: long
 *                 enough that one bad quote cannot fake it, short enough to
 *                 still be a warning rather than a post-mortem.
 */
export function liquidityTrend(history: PricePoint[], windowMs = 6 * 60_000): LiquidityTrend | null {
  if (history.length < MIN_TREND_SAMPLES) return null;

  const latest = history[history.length - 1];
  if (latest.l == null || !(latest.l >= 0)) return null;

  const cutoff = latest.t - windowMs;
  const window = history.filter((p) => p.t >= cutoff && p.l != null && p.l > 0 && p.p > 0);
  if (window.length < MIN_TREND_SAMPLES) return null;

  const first = window[0];
  const last = window[window.length - 1];
  if (first === last || !(first.l! > 0) || !(first.p > 0)) return null;

  const liquidityChangePct = ((last.l! - first.l!) / first.l!) * 100;
  const priceChangePct = ((last.p - first.p) / first.p) * 100;

  return {
    samples: window.length,
    spanMs: last.t - first.t,
    liquidityChangePct,
    priceChangePct,
    // A pool shrinking faster than a third of the price move is leaving for
    // reasons the price does not explain.
    distributing: liquidityChangePct < 0 && priceChangePct > liquidityChangePct / 3,
  };
}
