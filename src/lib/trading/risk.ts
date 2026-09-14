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
  breakevenTriggerPct: 20,
  breakevenBufferPct: 2,
  earlyTrailPct: 18,
  takeProfitLadder: [50, 150, 400],
  trailingStopPct: 30,
  liquidityDropExitPct: 40,
  maxSlippagePct: 3,
  minLiquidityUsd: 15_000,
  minVolume24hUsd: 40_000,
  // 3 days. The old 14-day window let established large-caps dominate the
  // watchlist, where a 2%/hour move never clears the consensus threshold.
  maxPairAgeMinutes: 60 * 72,
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
  takeProfitLadder: [30, 80],
  trailingStopPct: 15,
  liquidityDropExitPct: 25,
  minLiquidityUsd: 60_000,
  minVolume24hUsd: 250_000,
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
