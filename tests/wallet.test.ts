import assert from "node:assert/strict";
import { test } from "node:test";
import { PaperWallet } from "../src/lib/trading/wallet";
import { PaperExecutor, estimateSlippagePct } from "../src/lib/trading/executor";
import { AGGRESSIVE, sanitizeRisk } from "../src/lib/trading/risk";
import type { Fill, Token, TradeIntent } from "../src/lib/types";

const SOL = 180;

function token(overrides: Partial<Token> = {}): Token {
  return {
    id: "solana:TESTPAIR",
    chain: "solana",
    pairAddress: "TESTPAIR",
    tokenAddress: "TESTMINT",
    symbol: "TEST",
    name: "Test Coin",
    priceUsd: 0.001,
    priceNative: 0.001 / SOL,
    liquidityUsd: 500_000,
    fdvUsd: 2_000_000,
    volume24hUsd: 900_000,
    volume5mUsd: 9_000,
    buys5m: 80,
    sells5m: 60,
    change5m: 3,
    change1h: 12,
    change24h: 60,
    ageMinutes: 120,
    dex: "raydium",
    history: [],
    simulated: true,
    ...overrides,
  };
}

const intent = (sizeSol: number): TradeIntent => ({
  id: "i1",
  tokenId: "solana:TESTPAIR",
  symbol: "TEST",
  chain: "solana",
  side: "buy",
  sizeSol,
  reason: "test",
  consensusScore: 80,
  confidence: 0.9,
  createdAt: Date.now(),
});

test("slippage grows with order size relative to the pool", () => {
  const small = estimateSlippagePct(100, 500_000);
  const large = estimateSlippagePct(50_000, 500_000);
  assert.ok(large > small, "a larger ticket must cost more slippage");
  assert.ok(estimateSlippagePct(100, 0) === 100, "an empty pool is unfillable");
});

test("a buy debits cash and opens a position with the exit plan attached", async () => {
  const wallet = new PaperWallet(10);
  const fill = (await new PaperExecutor().buy(intent(1), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = wallet.applyBuy(fill, AGGRESSIVE);

  assert.equal(wallet.cash, 9, "1 SOL left the cash balance");
  assert.equal(position.stopLossPct, AGGRESSIVE.stopLossPct);
  assert.deepEqual(position.takeProfitLadder, AGGRESSIVE.takeProfitLadder);
  assert.ok(position.quantity > 0);
  // The fill price is worse than mid: that is the slippage being charged.
  assert.ok(fill.priceUsd > 0.001);
});

test("a profitable round trip books realised P/L and counts as a win", async () => {
  const wallet = new PaperWallet(10);
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(1), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = wallet.applyBuy(entry, AGGRESSIVE);

  // Price doubles.
  const exitToken = token({ priceUsd: 0.002 });
  wallet.markToMarket(new Map([[exitToken.id, exitToken]]), SOL);
  const marked = wallet.positionFor(exitToken.id)!;
  assert.ok(marked.unrealizedPnlPct > 80, `expected ~+100%, got ${marked.unrealizedPnlPct}`);

  const exit = (await executor.sell(marked, exitToken, 1, "tp", SOL, AGGRESSIVE)).fill as Fill;
  wallet.applySell(exit, false);

  const snap = wallet.snapshot(SOL);
  assert.equal(snap.openPositions, 0, "the position is closed");
  assert.ok(snap.realizedPnlSol > 0, "a doubling must realise a gain");
  assert.equal(snap.wins, 1);
  assert.equal(snap.losses, 0);
  assert.ok(snap.equitySol > 10, "equity grew past the starting balance");
  void position;
});

test("a partial take-profit leaves the rest of the position open", async () => {
  const wallet = new PaperWallet(10);
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(2), token(), SOL, AGGRESSIVE)).fill as Fill;
  wallet.applyBuy(entry, AGGRESSIVE);

  const up = token({ priceUsd: 0.0016 });
  wallet.markToMarket(new Map([[up.id, up]]), SOL);
  const marked = wallet.positionFor(up.id)!;
  const partial = (await executor.sell(marked, up, 0.4, "rung 1", SOL, AGGRESSIVE)).fill as Fill;
  wallet.applySell(partial, true);

  const remaining = wallet.positionFor(up.id);
  assert.ok(remaining, "60% of the position is still open");
  assert.equal(remaining!.filledRungs, 1, "the rung is recorded so it is not taken twice");
  assert.ok(Math.abs(remaining!.quantity - marked.quantity * 0.6) < 1e-6);
  // Cost basis must shrink with the sold share, or the next P/L is wrong.
  assert.ok(Math.abs(remaining!.costSol - marked.costSol * 0.6) < 1e-9);
});

test("entries are refused when projected slippage exceeds the budget", async () => {
  const thin = token({ liquidityUsd: 4_000 });
  const result = await new PaperExecutor().buy(intent(5), thin, SOL, AGGRESSIVE);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /slippage/);
});

test("exits are never blocked by slippage", async () => {
  const wallet = new PaperWallet(10);
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(0.5), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = wallet.applyBuy(entry, AGGRESSIVE);

  const drained = token({ liquidityUsd: 2_000, priceUsd: 0.0002 });
  const exit = await executor.sell(position, drained, 1, "rug", SOL, AGGRESSIVE);
  assert.equal(exit.ok, true, "getting out must always be allowed");
  assert.ok((exit.fill!.realizedPnlSol ?? 0) < 0, "the loss is booked honestly");
});

test("risk config patches are clamped rather than trusted", () => {
  const patched = sanitizeRisk(AGGRESSIVE, {
    maxPositionPct: 9_000,
    stopLossPct: -5,
    maxOpenPositions: 999,
    takeProfitLadder: [300, 50, -2, 120],
  });
  assert.equal(patched.maxPositionPct, 100);
  assert.equal(patched.stopLossPct, 1);
  assert.equal(patched.maxOpenPositions, 25);
  assert.deepEqual(patched.takeProfitLadder, [50, 120, 300], "rungs are sorted and negatives dropped");
});

test("the daily drawdown is measured against the session anchor", () => {
  const wallet = new PaperWallet(10);
  assert.equal(wallet.dailyDrawdownPct(SOL), 0);
  // Book a loss by selling a position bought at a higher price.
  const fill: Fill = {
    id: "x", tokenId: "solana:TESTPAIR", symbol: "TEST", chain: "solana", side: "buy",
    quantity: 1000, priceUsd: 0.001, valueSol: 4, feeSol: 0.01, slippagePct: 0.5,
    reason: "t", at: Date.now(), txRef: "paper-x", mode: "paper",
  };
  wallet.applyBuy(fill, AGGRESSIVE);
  wallet.applySell({ ...fill, id: "y", side: "sell", valueSol: 1, realizedPnlSol: -3 }, false);
  assert.ok(wallet.dailyDrawdownPct(SOL) > 25, "a 3 SOL loss on 10 is a >25% drawdown");
});
