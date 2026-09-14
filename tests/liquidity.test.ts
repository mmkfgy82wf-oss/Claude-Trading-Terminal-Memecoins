import assert from "node:assert/strict";
import { test } from "node:test";
import { liquidityTrend, MIN_TREND_SAMPLES } from "../src/lib/market/liquidity";
import type { PricePoint } from "../src/lib/types";

/**
 * The distinction this whole check rests on: a pool shrinking *with* the price
 * is an ordinary sell-off, and a pool shrinking *against* it is someone taking
 * the exit away. Confusing the two would either miss every rug or veto every
 * red candle.
 */
const T0 = Date.UTC(2026, 8, 14, 9, 0, 0);
const STEP = 30_000;

function series(points: { p: number; l?: number }[]): PricePoint[] {
  return points.map((point, i) => ({ t: T0 + i * STEP, p: point.p, l: point.l }));
}

test("a pool emptying while the price holds reads as distribution", () => {
  const trend = liquidityTrend(
    series([
      { p: 1.0, l: 100_000 },
      { p: 1.01, l: 92_000 },
      { p: 1.02, l: 85_000 },
      { p: 1.03, l: 78_000 },
      { p: 1.04, l: 71_000 },
      { p: 1.05, l: 66_000 },
      { p: 1.06, l: 61_000 },
    ]),
  );
  assert.ok(trend, "a trend was produced");
  assert.equal(trend.distributing, true);
  assert.ok(trend.liquidityChangePct < -35, `pool fell: ${trend.liquidityChangePct.toFixed(1)}%`);
  assert.ok(trend.priceChangePct > 0);
});

test("a pool shrinking with a falling price is not distribution", () => {
  // Constant-product maths alone shrinks a pool when the token falls. Calling
  // that a rug would have the desk vetoing every ordinary drawdown.
  const trend = liquidityTrend(
    series([
      { p: 1.0, l: 100_000 },
      { p: 0.9, l: 94_000 },
      { p: 0.8, l: 88_000 },
      { p: 0.7, l: 82_000 },
      { p: 0.6, l: 76_000 },
      { p: 0.5, l: 70_000 },
      { p: 0.4, l: 62_000 },
    ]),
  );
  assert.ok(trend);
  assert.equal(trend.distributing, false);
});

test("a growing pool is never distribution, however fast the price runs", () => {
  const trend = liquidityTrend(
    series([
      { p: 1.0, l: 40_000 },
      { p: 1.4, l: 48_000 },
      { p: 1.9, l: 55_000 },
      { p: 2.6, l: 61_000 },
      { p: 3.1, l: 68_000 },
      { p: 3.8, l: 74_000 },
      { p: 4.4, l: 80_000 },
    ]),
  );
  assert.ok(trend);
  assert.equal(trend.distributing, false);
  assert.ok(trend.liquidityChangePct > 0);
});

test("too few samples produces nothing rather than a guess", () => {
  const short = series(
    Array.from({ length: MIN_TREND_SAMPLES - 1 }, (_, i) => ({ p: 1, l: 100_000 - i * 9_000 })),
  );
  assert.equal(liquidityTrend(short), null);
});

test("history without pool depth is ignored, not treated as zero", () => {
  // Restored books and hand-built histories carry prices only. Reading a
  // missing pool as an empty one would liquidate every position on restart.
  const priceOnly = series(Array.from({ length: 10 }, (_, i) => ({ p: 1 + i * 0.01 })));
  assert.equal(liquidityTrend(priceOnly), null);
});

test("only the window counts, so an old crash cannot haunt a recovered pool", () => {
  const points: PricePoint[] = [
    ...series([
      { p: 1, l: 200_000 },
      { p: 1, l: 40_000 },
    ]),
  ];
  // …then twenty minutes of a stable pool, well past the six-minute window.
  for (let i = 0; i < 12; i++) {
    points.push({ t: T0 + (10 + i) * 60_000, p: 1 + i * 0.002, l: 40_000 + i * 200 });
  }
  const trend = liquidityTrend(points);
  assert.ok(trend);
  assert.equal(trend.distributing, false, "the recovered stretch is what is read");
  assert.ok(trend.spanMs <= 6 * 60_000);
});
