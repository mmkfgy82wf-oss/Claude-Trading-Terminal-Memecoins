import assert from "node:assert/strict";
import { test } from "node:test";
import { PaperWallet } from "../src/lib/trading/wallet";
import { PaperExecutor, estimateSlippagePct } from "../src/lib/trading/executor";
import { AGGRESSIVE, sanitizeRisk } from "../src/lib/trading/risk";
import { CHAINS } from "../src/lib/market/chains";
import type { ChainId, Fill, Token, TradeIntent } from "../src/lib/types";

const SOL = 180;
const ETH = 3200;
const PRICES = { solana: SOL, robinhood: ETH };
const CHAINS_ACTIVE: ChainId[] = ["solana", "robinhood"];
/** Book sized so the Solana treasury starts at 10 SOL. */
const BOOK_USD = 10 * SOL * CHAINS_ACTIVE.length;

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

const intent = (sizeNative: number, chain: ChainId = "solana"): TradeIntent => ({
  id: "i1",
  tokenId: `${chain}:TESTPAIR`,
  symbol: "TEST",
  chain,
  side: "buy",
  sizeNative,
  quote: CHAINS[chain].native,
  reason: "test",
  consensusScore: 80,
  confidence: 0.9,
  createdAt: Date.now(),
});

const wallet = () => new PaperWallet(BOOK_USD, CHAINS_ACTIVE, PRICES);

test("slippage grows with order size relative to the pool", () => {
  const small = estimateSlippagePct(100, 500_000);
  const large = estimateSlippagePct(50_000, 500_000);
  assert.ok(large > small, "a larger ticket must cost more slippage");
  assert.ok(estimateSlippagePct(100, 0) === 100, "an empty pool is unfillable");
});

test("a buy debits the right chain's cash and opens a position with the exit plan attached", async () => {
  const w = wallet();
  const fill = (await new PaperExecutor().buy(intent(1), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = w.applyBuy(fill, AGGRESSIVE);

  assert.equal(w.cashOn("solana"), 9, "1 SOL left the Solana treasury");
  assert.equal(w.cashOn("robinhood"), BOOK_USD / 2 / ETH, "the ETH treasury is untouched");
  assert.equal(fill.quote, "SOL");
  assert.equal(position.stopLossPct, AGGRESSIVE.stopLossPct);
  assert.deepEqual(position.takeProfitLadder, AGGRESSIVE.takeProfitLadder);
  assert.ok(position.quantity > 0);
  // The fill price is worse than mid: that is the slippage being charged.
  assert.ok(fill.priceUsd > 0.001);
});

test("a Robinhood Chain trade is denominated and paid for in ETH, never SOL", async () => {
  const w = wallet();
  const rhc = token({ id: "robinhood:TESTPAIR", chain: "robinhood", symbol: "RHCTEST" });
  const ethBefore = w.cashOn("robinhood");
  const solBefore = w.cashOn("solana");

  // 0.05 ETH ≈ $160 — a comparable ticket, expressed in the chain's own asset.
  const fill = (await new PaperExecutor().buy(intent(0.05, "robinhood"), rhc, ETH, AGGRESSIVE)).fill as Fill;
  assert.equal(fill.quote, "ETH", "the ticket must be quoted in the chain's own asset");

  const position = w.applyBuy(fill, AGGRESSIVE);
  assert.equal(position.quote, "ETH");
  assert.equal(w.cashOn("solana"), solBefore, "a Robinhood trade must not touch the SOL treasury");
  assert.ok(Math.abs(w.cashOn("robinhood") - (ethBefore - 0.05)) < 1e-12, "it is paid out of the ETH treasury");

  // The position is worth what it is worth in ETH terms, not SOL terms.
  w.markToMarket(new Map([[rhc.id, { ...rhc, priceUsd: 0.002 }]]));
  const marked = w.positionFor(rhc.id)!;
  assert.ok(marked.unrealizedPnlPct > 80, "a doubling shows as ~+100% regardless of chain");
  assert.ok(
    Math.abs(marked.unrealizedPnlUsd - marked.unrealizedPnlNative * ETH) < 1e-6,
    "USD P/L converts through ETH, not SOL",
  );
});

test("the book reports each chain's treasury in its own quote asset", () => {
  const w = wallet();
  const treasuries = w.snapshot().treasuries;
  assert.deepEqual(
    treasuries.map((t) => t.quote),
    ["SOL", "ETH"],
  );
  assert.equal(treasuries[0].cashNative, 10, "half the book is 10 SOL");
  assert.equal(treasuries[1].cashNative, BOOK_USD / 2 / ETH, "the other half is the ETH equivalent");
  // Equity in USD is the only figure that is comparable across the two.
  assert.ok(Math.abs(w.snapshot().equityUsd - BOOK_USD) < 1e-6);
});

test("a profitable round trip books realised P/L and counts as a win", async () => {
  const w = wallet();
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(1), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = w.applyBuy(entry, AGGRESSIVE);

  // Price doubles.
  const exitToken = token({ priceUsd: 0.002 });
  w.markToMarket(new Map([[exitToken.id, exitToken]]));
  const marked = w.positionFor(exitToken.id)!;
  assert.ok(marked.unrealizedPnlPct > 80, `expected ~+100%, got ${marked.unrealizedPnlPct}`);

  const exit = (await executor.sell(marked, exitToken, 1, "tp", SOL, AGGRESSIVE)).fill as Fill;
  w.applySell(exit, false);

  const snap = w.snapshot();
  assert.equal(snap.openPositions, 0, "the position is closed");
  assert.ok(snap.realizedPnlUsd > 0, "a doubling must realise a gain");
  assert.equal(snap.wins, 1);
  assert.equal(snap.losses, 0);
  assert.ok(snap.equityUsd > BOOK_USD, "equity grew past the starting book");
  void position;
});

test("a partial take-profit leaves the rest of the position open", async () => {
  const w = wallet();
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(2), token(), SOL, AGGRESSIVE)).fill as Fill;
  w.applyBuy(entry, AGGRESSIVE);

  const up = token({ priceUsd: 0.0016 });
  w.markToMarket(new Map([[up.id, up]]));
  const marked = w.positionFor(up.id)!;
  const partial = (await executor.sell(marked, up, 0.4, "rung 1", SOL, AGGRESSIVE)).fill as Fill;
  w.applySell(partial, true);

  const remaining = w.positionFor(up.id);
  assert.ok(remaining, "60% of the position is still open");
  assert.equal(remaining!.filledRungs, 1, "the rung is recorded so it is not taken twice");
  assert.ok(Math.abs(remaining!.quantity - marked.quantity * 0.6) < 1e-6);
  // Cost basis must shrink with the sold share, or the next P/L is wrong.
  assert.ok(Math.abs(remaining!.costNative - marked.costNative * 0.6) < 1e-9);
});

test("entries are refused when projected slippage exceeds the budget", async () => {
  const thin = token({ liquidityUsd: 4_000 });
  const result = await new PaperExecutor().buy(intent(5), thin, SOL, AGGRESSIVE);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /slippage/);
});

test("exits are never blocked by slippage", async () => {
  const w = wallet();
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(0.5), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = w.applyBuy(entry, AGGRESSIVE);

  const drained = token({ liquidityUsd: 2_000, priceUsd: 0.0002 });
  const exit = await executor.sell(position, drained, 1, "rug", SOL, AGGRESSIVE);
  assert.equal(exit.ok, true, "getting out must always be allowed");
  assert.ok((exit.fill!.realizedPnlNative ?? 0) < 0, "the loss is booked honestly");
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
  const w = wallet();
  assert.equal(w.dailyDrawdownPct(), 0);
  // Book a loss by selling a position bought at a higher price.
  const fill: Fill = {
    id: "x", tokenId: "solana:TESTPAIR", symbol: "TEST", chain: "solana", side: "buy",
    quantity: 1000, priceUsd: 0.001, valueNative: 4, feeNative: 0.01, quote: "SOL", slippagePct: 0.5,
    reason: "t", at: Date.now(), txRef: "paper-x", mode: "paper",
  };
  w.applyBuy(fill, AGGRESSIVE);
  w.applySell({ ...fill, id: "y", side: "sell", valueNative: 1, realizedPnlNative: -3, realizedPnlUsd: -3 * SOL }, false);
  assert.ok(w.dailyDrawdownPct() > 12, "a 3 SOL loss shows up as a drawdown on the book");
});
