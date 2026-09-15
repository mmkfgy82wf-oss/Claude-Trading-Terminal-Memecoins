import assert from "node:assert/strict";
import { test } from "node:test";
import { QuantAgent } from "../src/lib/agents/quant";
import { Blackboard } from "../src/lib/agents/blackboard";
import type { AgentContext } from "../src/lib/agents/base";
import { PaperWallet } from "../src/lib/trading/wallet";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { RiskConfig, Token } from "../src/lib/types";

function token(over: Partial<Token> = {}): Token {
  return {
    id: "solana:Q", chain: "solana", pairAddress: "Q", tokenAddress: "M", symbol: "QT", name: "QT",
    priceUsd: 0.00004, priceNative: 2.2e-7,
    liquidityUsd: 60_000, fdvUsd: 700_000,
    volume24hUsd: 300_000, volume5mUsd: 3_000,
    buys5m: 60, sells5m: 40,
    change5m: 5, change1h: 40, change24h: 160,
    ageMinutes: 30, dex: "pumpswap", history: [], simulated: false,
    ...over,
  };
}

/** QUANT's published score for one token under one config. */
function score(t: Token, over: Partial<RiskConfig> = {}): number {
  const board = new Blackboard();
  board.setUniverse([t]);
  board.setWatchlist([t.id]);
  const ctx: AgentContext = {
    tick: 1,
    board,
    wallet: new PaperWallet(1800, ["solana"], { solana: 180, robinhood: 3200 }),
    risk: { ...AGGRESSIVE, ...over },
    flags: {
      autonomy: "auto", killSwitch: false, marketMode: "live", chains: ["solana"],
      narrativeAugmented: false, providers: { birdeye: false, helius: false, anthropic: false },
    },
    log: () => {},
  };
  new QuantAgent().run(ctx);
  return board.signalBy(t.id, "quant")?.score ?? NaN;
}

test("the shipped defaults leave QUANT exactly as it was", () => {
  // The knobs exist so a tape can decide, not so the desk quietly changes
  // under them. Turnover is off and the other two sit at their old constants.
  assert.equal(AGGRESSIVE.quantFlowWeight, 26);
  assert.equal(AGGRESSIVE.quantVolumeWeight, 26);
  assert.equal(AGGRESSIVE.quantTurnoverWeight, 0);

  const t = token();
  assert.equal(score(t), score(t, { quantTurnoverWeight: 0 }), "turnover off changes nothing");
});

test("zeroing the flow weight removes the flow term and nothing else", () => {
  const buyHeavy = token({ buys5m: 110, sells5m: 10 });
  const sellHeavy = token({ buys5m: 10, sells5m: 110 });

  const gapOn = score(buyHeavy) - score(sellHeavy);
  const gapOff = score(buyHeavy, { quantFlowWeight: 0 }) - score(sellHeavy, { quantFlowWeight: 0 });

  assert.ok(gapOn > 30, `flow separates them by default, got ${gapOn.toFixed(1)}`);
  assert.ok(Math.abs(gapOff) < 1e-9, `with the weight at zero it must not, got ${gapOff.toFixed(3)}`);
});

test("turnover lifts a churning pair only once it is switched on", () => {
  // Isolating turnover takes care, because volume24hUsd feeds two terms: the
  // turnover ratio *and* the baseline that volume acceleration is measured
  // against. Holding the 5m volume at a fixed multiple of that baseline keeps
  // acceleration identical, so the only thing that differs is turnover.
  const atAccel = (volume24hUsd: number, accel: number) =>
    token({ volume24hUsd, volume5mUsd: (volume24hUsd / 288) * accel });
  const quiet = atAccel(30_000, 3);
  const busy = atAccel(300_000, 3);

  assert.ok(
    Math.abs(score(busy) - score(quiet)) < 8,
    "off by default, so turnover barely moves the score",
  );
  const lifted = score(busy, { quantTurnoverWeight: 30 }) - score(quiet, { quantTurnoverWeight: 30 });
  assert.ok(lifted > 5, `switched on it must reward the churning pair, got ${lifted.toFixed(1)}`);
});

test("the turnover term is capped, so one absurd pair cannot dominate", () => {
  const atAccel = (volume24hUsd: number, accel: number) =>
    token({ volume24hUsd, volume5mUsd: (volume24hUsd / 288) * accel });
  const sane = atAccel(180_000, 3);
  const absurd = atAccel(60_000_000, 3);
  const w = 30;
  const gap = score(absurd, { quantTurnoverWeight: w }) - score(sane, { quantTurnoverWeight: w });
  assert.ok(gap <= w, `the cap holds: ${gap.toFixed(1)} must not exceed ${w}`);
});

test("the volume weight scales the term rather than switching it", () => {
  const surging = token({ volume5mUsd: 12_000 });
  const base = score(surging, { quantVolumeWeight: 0 });
  const half = score(surging, { quantVolumeWeight: 13 });
  const full = score(surging, { quantVolumeWeight: 26 });
  assert.ok(full > half && half > base, `monotone in the weight: ${base} < ${half} < ${full}`);
});
