import assert from "node:assert/strict";
import { test } from "node:test";
import { memorySource } from "../src/lib/backtest/source";
import { firstCollapse, studyRugs } from "../src/lib/backtest/rugs";
import type { TapeFrame, TapeToken } from "../src/lib/market/recorder";
import type { PricePoint } from "../src/lib/types";

const T0 = Date.UTC(2026, 8, 14, 22, 0, 0);
const STEP = 30_000;

function tok(id: string, priceUsd: number, liquidityUsd: number): TapeToken {
  return {
    id,
    chain: "solana",
    pairAddress: id,
    tokenAddress: `m${id}`,
    symbol: id.toUpperCase().slice(0, 8),
    name: id,
    priceUsd,
    priceNative: priceUsd / 180,
    liquidityUsd,
    fdvUsd: liquidityUsd * 12,
    volume24hUsd: liquidityUsd * 9,
    volume5mUsd: liquidityUsd * 0.1,
    buys5m: 60,
    sells5m: 40,
    change5m: 2,
    change1h: 40,
    change24h: 200,
    ageMinutes: 30,
    dex: "pumpswap",
    simulated: false,
  };
}

/** Build a tape from one {price, liquidity} path per pair. */
function tape(paths: Record<string, { p: number; l: number }[]>): TapeFrame[] {
  const length = Math.max(...Object.values(paths).map((p) => p.length));
  const frames: TapeFrame[] = [];
  for (let i = 0; i < length; i++) {
    const tokens: TapeToken[] = [];
    for (const [id, path] of Object.entries(paths)) {
      const step = path[i];
      if (step) tokens.push(tok(id, step.p, step.l));
    }
    frames.push({ v: 1, t: T0 + i * STEP, tick: i + 1, quotes: { solana: 180, robinhood: 3200 }, tokens });
  }
  return frames;
}

const flat = (n: number, p: number, l: number) => Array.from({ length: n }, () => ({ p, l }));

test("a one-frame collapse is found at the frame before it", () => {
  const points: PricePoint[] = [
    { t: 1, p: 1 }, { t: 2, p: 1.1 }, { t: 3, p: 1.2 }, { t: 4, p: 0.03 },
  ];
  const at = firstCollapse(points);
  assert.ok(at != null);
  assert.ok(at <= 3, `the study must look at data from before the fall, got index ${at}`);
});

test("an ordinary drawdown is not a collapse", () => {
  const points: PricePoint[] = [
    { t: 1, p: 1 }, { t: 2, p: 0.9 }, { t: 3, p: 0.8 }, { t: 4, p: 0.7 },
    { t: 5, p: 0.6 }, { t: 6, p: 0.5 }, { t: 7, p: 0.45 },
  ];
  // −55% in total, but never 70% inside the window. Calling this a rug would
  // fill the study with every losing trade the desk ever made.
  assert.equal(firstCollapse(points), null);
});

test("the study separates a pool that drains beforehand from one that does not", async () => {
  // Two rugs that bleed first, two that do not, and four healthy pairs. A
  // threshold should catch the bleeders and only those.
  const bleeder = () => [
    ...Array.from({ length: 14 }, (_, i) => ({ p: 1 + i * 0.02, l: 100_000 - i * 4_000 })),
    { p: 0.04, l: 900 },
    ...flat(4, 0.03, 700),
  ];
  const suddenRug = () => [...flat(14, 1, 100_000), { p: 0.04, l: 900 }, ...flat(4, 0.03, 700)];
  const healthy = () => Array.from({ length: 19 }, (_, i) => ({ p: 1 + i * 0.01, l: 100_000 + i * 500 }));

  const study = await studyRugs(
    memorySource("t", tape({
      bleed1: bleeder(), bleed2: bleeder(),
      sudden1: suddenRug(), sudden2: suddenRug(),
      ok1: healthy(), ok2: healthy(), ok3: healthy(), ok4: healthy(),
    })),
  );

  assert.equal(study.collapses, 4);
  assert.equal(study.survivors, 4);

  const row = study.rows.find((r) => r.thresholdPct === 20);
  assert.ok(row);
  assert.equal(row.caught, 2, "both bleeders caught");
  assert.equal(row.falsePositives, 0, "no healthy pair thrown away");
});

test("a pool topped up right until the pull produces no catch at any threshold", async () => {
  // The shape the bench encodes and the live log suggests: liquidity goes *in*
  // ahead of a rug. If the study ever reported a signal here it would be
  // inventing one.
  const rug = () => [
    ...Array.from({ length: 14 }, (_, i) => ({ p: 1 + i * 0.03, l: 60_000 + i * 2_000 })),
    { p: 0.05, l: 500 },
    ...flat(4, 0.04, 400),
  ];
  const study = await studyRugs(memorySource("t", tape({ r1: rug(), r2: rug(), r3: rug() })));
  assert.equal(study.collapses, 3);
  for (const row of study.rows) assert.equal(row.caught, 0, `threshold -${row.thresholdPct}% must catch nothing`);
});

test("a tape with no collapse reports none rather than guessing", async () => {
  const healthy = () => Array.from({ length: 20 }, (_, i) => ({ p: 1 + i * 0.01, l: 80_000 }));
  const study = await studyRugs(memorySource("t", tape({ a: healthy(), b: healthy() })));
  assert.equal(study.collapses, 0);
  assert.equal(study.preCollapseLiquidityPct.length, 0);
  for (const row of study.rows) assert.equal(row.catchRatePct, 0);
});

test("pairs too short to judge are excluded, not counted as survivors", async () => {
  const study = await studyRugs(memorySource("t", tape({ blink: flat(3, 1, 50_000) })));
  assert.equal(study.pairsSeen, 1);
  assert.equal(study.pairsWithEnoughHistory, 0);
  assert.equal(study.survivors, 0);
});
