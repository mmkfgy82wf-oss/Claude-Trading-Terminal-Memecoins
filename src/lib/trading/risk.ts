import type { RiskConfig } from "@/lib/types";

/**
 * Aggressive memecoin profile — the default the terminal boots with.
 * Every field is editable at runtime through the settings panel.
 */
export const AGGRESSIVE: RiskConfig = {
  // ~10 SOL of book at boot, split across the active chain treasuries.
  startingCapitalUsd: 1_800,
  maxPositionPct: 15,
  maxOpenPositions: 6,
  maxPortfolioExposurePct: 70,
  stopLossPct: 25,
  // These two only govern positions that peak below the first rung, so moving
  // the rung to +25% shrank their window to almost nothing — and an 18% trail
  // on a +22% peak exits at breakeven by arithmetic, which is the rule failing
  // silently rather than protecting anything. Widened and tightened to match.
  breakevenTriggerPct: 14,
  breakevenBufferPct: 2,
  earlyTrailPct: 12,
  // The first rung is early on purpose. A one-block liquidity pull cannot be
  // stopped out of — the next quote the desk sees is already the bottom — so
  // the only defence available to a position that is already open is to be
  // smaller by the time it happens. Selling 40% at +25% turned the bench's
  // worst trade from -97% into -49% and removed both blow-ups.
  takeProfitLadder: [25, 90, 300],
  // Worth knowing: a trail of X% cannot close above entry until the peak has
  // cleared X/(1-X), so this one needs +43% before it protects any profit at
  // all. Below that the early rung and the breakeven floor are what stand in.
  trailingStopPct: 30,
  liquidityDropExitPct: 40,
  maxSlippagePct: 3,
  minLiquidityUsd: 15_000,
  minVolume24hUsd: 40_000,
  // 3 days. The old 14-day window let established large-caps dominate the
  // watchlist, where a 2%/hour move never clears the consensus threshold.
  maxPairAgeMinutes: 60 * 72,
  // Measured on the bench and left off: see docs/BACKTEST.md. Penalising a
  // pair for how far it has already run removed winners without removing a
  // single rug, because how far something has run says nothing about whether
  // its pool is about to be pulled. The knob stays so a real tape can retry
  // the question with evidence instead of intuition.
  maxEntryRunPct: 100_000,
  // 40% of the pool leaving in six minutes while the price holds. On the
  // bench that threshold never fires and costs exactly nothing; lower ones
  // fire often and cost a little. It is a catastrophe net, not an edge.
  liquidityTrendExitPct: 40,
  minConsensusScore: 55,
  dailyLossLimitPct: 35,
};

export const CONSERVATIVE: RiskConfig = {
  ...AGGRESSIVE,
  maxPositionPct: 5,
  maxOpenPositions: 4,
  maxPortfolioExposurePct: 40,
  stopLossPct: 12,
  breakevenTriggerPct: 10,
  breakevenBufferPct: 2,
  earlyTrailPct: 10,
  takeProfitLadder: [20, 60],
  trailingStopPct: 15,
  liquidityDropExitPct: 25,
  minLiquidityUsd: 60_000,
  minVolume24hUsd: 250_000,
  maxEntryRunPct: 300,
  liquidityTrendExitPct: 12,
  minConsensusScore: 70,
  dailyLossLimitPct: 20,
};

const NUMERIC_BOUNDS: Record<keyof RiskConfig, [number, number]> = {
  startingCapitalUsd: [10, 10_000_000],
  maxPositionPct: [0.5, 100],
  maxOpenPositions: [1, 25],
  maxPortfolioExposurePct: [1, 100],
  stopLossPct: [1, 95],
  breakevenTriggerPct: [1, 500],
  breakevenBufferPct: [0, 50],
  earlyTrailPct: [1, 90],
  liquidityDropExitPct: [5, 95],
  takeProfitLadder: [0, 0], // handled separately
  trailingStopPct: [1, 95],
  maxSlippagePct: [0.1, 50],
  minLiquidityUsd: [0, 100_000_000],
  minVolume24hUsd: [0, 1_000_000_000],
  maxPairAgeMinutes: [1, 60 * 24 * 365],
  maxEntryRunPct: [5, 1_000_000],
  liquidityTrendExitPct: [0, 95],
  minConsensusScore: [0, 100],
  dailyLossLimitPct: [1, 100],
};

/** Clamp a partial update from the UI into a usable config. */
export function sanitizeRisk(base: RiskConfig, patch: Partial<RiskConfig>): RiskConfig {
  const next: RiskConfig = { ...base };
  for (const [key, value] of Object.entries(patch) as [keyof RiskConfig, unknown][]) {
    if (key === "takeProfitLadder") {
      if (Array.isArray(value)) {
        const rungs = value
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 10_000)
          .sort((a, b) => a - b)
          .slice(0, 5);
        if (rungs.length) next.takeProfitLadder = rungs;
      }
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const [lo, hi] = NUMERIC_BOUNDS[key];
    next[key] = Math.min(hi, Math.max(lo, n)) as never;
  }
  return next;
}
