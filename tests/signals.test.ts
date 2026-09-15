import assert from "node:assert/strict";
import { test } from "node:test";
import { memorySource } from "../src/lib/backtest/source";
import { indexAt, studySignals } from "../src/lib/backtest/signals";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { TapeFrame, TapeToken } from "../src/lib/market/recorder";

const T0 = Date.UTC(2026, 8, 15, 1, 0, 0);
const STEP = 60_000;

function tok(id: string, over: Partial<TapeToken> = {}): TapeToken {
  return {
    id, chain: "solana", pairAddress: id, tokenAddress: `m${id}`,
    symbol: id.toUpperCase(), name: id,
    priceUsd: 1, priceNative: 1 / 180,
    liquidityUsd: 60_000, fdvUsd: 700_000,
    volume24hUsd: 500_000, volume5mUsd: 4_000,
    buys5m: 60, sells5m: 40,
    change5m: 3, change1h: 40, change24h: 150,
    ageMinutes: 30, dex: "pumpswap", simulated: false,
    ...over,
  };
}

/** Frames from per-pair overrides, one entry per frame. */
function tape(paths: Record<string, Partial<TapeToken>[]>): TapeFrame[] {
  const length = Math.max(...Object.values(paths).map((p) => p.length));
  const frames: TapeFrame[] = [];
  for (let i = 0; i < length; i++) {
    const tokens: TapeToken[] = [];
    for (const [id, path] of Object.entries(paths)) {
      const step = path[i];
      if (step) tokens.push(tok(id, { ...step, ageMinutes: 30 + i }));
    }
    frames.push({ v: 1, t: T0 + i * STEP, tick: i + 1, quotes: { solana: 180, robinhood: 3200 }, tokens });
  }
  return frames;
}

test("indexAt finds the last sample at or before a time", () => {
  const times = [10, 20, 30, 40];
  assert.equal(indexAt(times, 5), -1);
  assert.equal(indexAt(times, 10), 0);
  assert.equal(indexAt(times, 25), 1);
  assert.equal(indexAt(times, 40), 3);
  assert.equal(indexAt(times, 999), 3);
  assert.equal(indexAt([], 1), -1);
});

test("a feature that really predicts the next half hour is found", async () => {
  // High buy share climbs, low buy share collapses. Nothing subtle.
  const rising = Array.from({ length: 60 }, (_, i) => ({
    priceUsd: 1 + i * 0.05, buys5m: 90, sells5m: 10,
  }));
  const falling = Array.from({ length: 60 }, (_, i) => ({
    priceUsd: Math.max(0.01, 1 - i * 0.016), buys5m: 10, sells5m: 90,
  }));

  const study = await studySignals(
    memorySource("t", tape({ up1: rising, up2: rising, down1: falling, down2: falling })),
    { horizonMs: 20 * 60_000, everyNthFrame: 1 },
  );

  const flow = study.splits.find((s) => s.name === "kaufanteil");
  assert.ok(flow, "the feature was evaluated");
  assert.ok(flow.spread > 50, `buy share must separate, spread was ${flow.spread}`);
  assert.ok(flow.highMeanPct > flow.lowMeanPct);
  assert.ok(flow.lowCollapsePct > flow.highCollapsePct, "the collapses sit on the low side");
});

test("pairs the desk would never look at are excluded, not measured", async () => {
  // Below the liquidity floor from the first frame to the last.
  const dust = Array.from({ length: 40 }, (_, i) => ({
    priceUsd: 1 + i * 0.1, liquidityUsd: AGGRESSIVE.minLiquidityUsd - 1,
  }));
  const study = await studySignals(memorySource("t", tape({ dust })), {
    horizonMs: 10 * 60_000,
    everyNthFrame: 1,
  });
  assert.equal(study.observations, 0);
  assert.ok(study.ineligible >= 40);
});

test("a horizon the tape never reaches is unresolved, not a return of zero", async () => {
  const short = Array.from({ length: 6 }, (_, i) => ({ priceUsd: 1 + i * 0.1 }));
  const study = await studySignals(memorySource("t", tape({ short })), {
    horizonMs: 60 * 60_000,
    everyNthFrame: 1,
  });
  assert.equal(study.observations, 0);
  assert.equal(study.unresolved, 6);
});

test("a constant feature cannot borrow a separation from the clock", async () => {
  // Prices drift up over the tape, so a feature that never varies would score
  // a spread if halves were cut by position instead of by value.
  const path = Array.from({ length: 60 }, (_, i) => ({ priceUsd: 1 + i * 0.05, fdvUsd: 700_000 }));
  const study = await studySignals(memorySource("t", tape({ a: path, b: path })), {
    horizonMs: 15 * 60_000,
    everyNthFrame: 1,
  });
  // liquidityUsd is untouched by the path, so fdvZuPool is the same every row.
  assert.equal(study.splits.find((s) => s.name === "fdvZuPool"), undefined);
});

test("the study reports its own baseline, so a spread can be read against it", async () => {
  const path = Array.from({ length: 60 }, (_, i) => ({ priceUsd: 1 + i * 0.02 }));
  const study = await studySignals(memorySource("t", tape({ a: path, b: path })), {
    horizonMs: 10 * 60_000,
    everyNthFrame: 1,
  });
  assert.ok(study.observations > 0);
  assert.ok(study.baselineMeanPct > 0, "a rising tape has a positive baseline");
  assert.equal(study.baselineCollapsePct, 0);
});

test("a feature that flips sign between horizons is flagged, not ranked", async () => {
  const { formatHorizonComparison } = await import("../src/lib/backtest/signals");
  const split = (name: string, spread: number, low: number, high: number) => ({
    name, n: 100, lowMeanPct: 0, highMeanPct: spread, lowMedianPct: 0, highMedianPct: 0,
    lowCollapsePct: low, highCollapsePct: high, spread,
  });
  const base = { horizonMs: 30 * 60_000, pairs: 10, observations: 100, unresolved: 0, ineligible: 0, baselineMeanPct: 5, baselineCollapsePct: 4 };

  const out = formatHorizonComparison(
    { ...base, splits: [split("dreht", 20, 1, 5), split("haelt", 20, 1, 5)] },
    { ...base, horizonMs: 90 * 60_000, splits: [split("dreht", -20, 1, 5), split("haelt", 18, 1, 4)] },
  );
  assert.match(out, /dreht.*✗ Rendite/, "a sign flip in the return must be called out");
  assert.match(out, /haelt.*✓/, "a feature that holds must not be");
});

test("a time window reads only the frames inside it", async () => {
  // Appending to a tape does not make it independent evidence, so the split
  // check has to be able to cut one recording into two genuine samples.
  const path = Array.from({ length: 80 }, (_, i) => ({ priceUsd: 1 + i * 0.02 }));
  const frames = tape({ a: path, b: path });
  const midpoint = frames[0].t + (frames[frames.length - 1].t - frames[0].t) / 2;

  const whole = await studySignals(memorySource("t", frames), { horizonMs: 10 * 60_000, everyNthFrame: 1 });
  const first = await studySignals(memorySource("t", frames), { horizonMs: 10 * 60_000, everyNthFrame: 1, to: midpoint });
  const second = await studySignals(memorySource("t", frames), { horizonMs: 10 * 60_000, everyNthFrame: 1, from: midpoint });

  assert.ok(first.observations > 0 && second.observations > 0, "both halves carry data");
  assert.ok(first.observations < whole.observations, "a half is smaller than the whole");
  assert.ok(second.observations < whole.observations);
});

test("a window with nothing in it is empty rather than the whole tape", async () => {
  const path = Array.from({ length: 40 }, (_, i) => ({ priceUsd: 1 + i * 0.02 }));
  const study = await studySignals(memorySource("t", tape({ a: path })), {
    horizonMs: 10 * 60_000,
    everyNthFrame: 1,
    from: T0 + 10 * 365 * 24 * 3_600_000,
  });
  assert.equal(study.observations, 0);
  assert.equal(study.pairs, 0);
});
