import assert from "node:assert/strict";
import { test } from "node:test";
import { studyEntries } from "../src/lib/backtest/entries";
import type { EntryObservation } from "../src/lib/backtest/replay";
import type { ClosedTrade } from "../src/lib/types";

const T0 = Date.UTC(2026, 8, 15, 3, 0, 0);

function entry(i: number, features: Record<string, number>): EntryObservation {
  return {
    key: `solana:p${i}@${T0 + i}`,
    tokenId: `solana:p${i}`,
    symbol: `T${i}`,
    at: T0 + i,
    features,
  };
}

function trade(i: number, pnlPct: number): ClosedTrade {
  const pnlUsd = pnlPct;
  return {
    id: `t${i}`,
    tokenId: `solana:p${i}`,
    symbol: `T${i}`,
    chain: "solana",
    quote: "SOL",
    openedAt: T0 + i,
    closedAt: T0 + i + 60_000,
    holdMs: 60_000,
    entryPriceUsd: 1,
    exitPriceUsd: 1 + pnlPct / 100,
    quantity: 1,
    costNative: 1,
    proceedsNative: 1 + pnlPct / 100,
    feesNative: 0,
    pnlNative: pnlPct / 100,
    pnlUsd,
    pnlPct,
    peakGainPct: Math.max(0, pnlPct),
    peakLiquidityUsd: 50_000,
    exitLiquidityUsd: 40_000,
    exits: 1,
    rungsTaken: 0,
    exitReason: "test",
    outcome: pnlPct > 0 ? "win" : "loss",
  };
}

/** Young pairs win, old pairs lose — a separation the study must find. */
function cohort(): { entries: EntryObservation[]; trades: ClosedTrade[] } {
  const entries: EntryObservation[] = [];
  const trades: ClosedTrade[] = [];
  for (let i = 0; i < 20; i++) {
    const young = i < 10;
    entries.push(entry(i, { alterMin: young ? 10 + i : 300 + i, poolUsd: 50_000 }));
    trades.push(trade(i, young ? 40 : -30));
  }
  return { entries, trades };
}

test("a real separation is found, with the right sign", () => {
  const { entries, trades } = cohort();
  const study = studyEntries(entries, trades);
  assert.equal(study.matched, 20);

  const age = study.splits.find((s) => s.name === "alterMin");
  assert.ok(age, "the feature was evaluated");
  assert.ok(age.spread < -50, `older half must do worse, spread was ${age.spread}`);
  assert.ok(age.medianWin < age.medianLoss, "winners were the younger pairs");
  assert.equal(age.highHalfHitPct, 0);
  assert.equal(age.lowHalfHitPct, 100);
});

test("a constant feature cannot borrow a separation from the chronology", () => {
  // Found by this test: splitting a sorted array in half puts tied values in
  // input order, so on a cohort whose early trades won, a flat feature scored
  // a 70-point "separation" that was purely the order of the run.
  const { entries, trades } = cohort();
  const study = studyEntries(entries, trades);
  assert.equal(
    study.splits.find((s) => s.name === "poolUsd"),
    undefined,
    "a feature with no spread has no halves to compare and must be dropped",
  );
});

test("trades without a matching entry are left out, not matched by token alone", () => {
  // The same pair traded twice must not borrow the other entry's features.
  const entries = [entry(1, { alterMin: 10 })];
  const trades = [trade(1, 50), { ...trade(1, -80), openedAt: T0 + 999 }];
  const study = studyEntries(entries, trades);
  assert.equal(study.trades, 2);
  assert.equal(study.matched, 1, "only the trade whose entry we saw");
});

test("an unreadable feature is dropped for that trade, never defaulted to zero", () => {
  const entries: EntryObservation[] = [];
  const trades: ClosedTrade[] = [];
  for (let i = 0; i < 20; i++) {
    // Half the entries could not read the flow at all.
    entries.push(entry(i, { kaufanteil: i < 10 ? NaN : 90, alterMin: 20 }));
    trades.push(trade(i, i < 10 ? -90 : 10));
  }
  const study = studyEntries(entries, trades);
  // Ten usable rows, all with the same value. It must not turn up as the
  // feature that "explains" the -90% trades it has no reading for at all.
  assert.equal(study.splits.find((s) => s.name === "kaufanteil"), undefined);
  assert.ok(study.splits.length >= 0);
});

test("a feature with too few readings is not reported at all", () => {
  const entries: EntryObservation[] = [];
  const trades: ClosedTrade[] = [];
  for (let i = 0; i < 20; i++) {
    entries.push(entry(i, { selten: i < 5 ? i : NaN, alterMin: 20 }));
    trades.push(trade(i, i % 2 ? 10 : -10));
  }
  const study = studyEntries(entries, trades);
  assert.equal(study.splits.find((s) => s.name === "selten"), undefined);
});

test("no entries at all is an empty study, not a crash", () => {
  const study = studyEntries([], [trade(1, 10)]);
  assert.equal(study.matched, 0);
  assert.equal(study.splits.length, 0);
});
