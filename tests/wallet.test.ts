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
    quantity: 1000, priceUsd: 0.001, liquidityUsd: 500_000, valueNative: 4, feeNative: 0.01, quote: "SOL", slippagePct: 0.5,
    reason: "t", at: Date.now(), txRef: "paper-x", mode: "paper",
  };
  w.applyBuy(fill, AGGRESSIVE);
  w.applySell({ ...fill, id: "y", side: "sell", valueNative: 1, realizedPnlNative: -3, realizedPnlUsd: -3 * SOL }, false);
  assert.ok(w.dailyDrawdownPct() > 12, "a 3 SOL loss shows up as a drawdown on the book");
});

// ── the daily loss limit, and getting out of it ───────────────────────────

/** Drive the book into a drawdown past the limit. */
function breachDailyLimit(w: PaperWallet, fractionLost = 0.5): void {
  const size = (BOOK_USD * fractionLost) / SOL;
  const base: Fill = {
    id: "brk-buy", tokenId: "solana:BREACH", symbol: "BREACH", chain: "solana", side: "buy",
    quantity: 1000, priceUsd: 0.001, liquidityUsd: 500_000, valueNative: size, feeNative: 0.001, quote: "SOL",
    slippagePct: 0.5, reason: "t", at: Date.now(), txRef: "paper-a", mode: "paper",
  };
  w.applyBuy(base, AGGRESSIVE);
  w.applySell(
    { ...base, id: "brk-sell", side: "sell", valueNative: 0.0001,
      realizedPnlNative: -size, realizedPnlUsd: -size * SOL },
    false,
  );
}

test("a breached daily limit does not clear itself just because positions closed", () => {
  const w = wallet();
  breachDailyLimit(w);
  const first = w.dailyDrawdownPct();
  assert.ok(first > AGGRESSIVE.dailyLossLimitPct, `expected a breach, got ${first}%`);

  // Nothing else happens — no entries are allowed, so equity cannot recover.
  // Without an operator action this state simply persists, which is exactly
  // why an explicit way out has to exist.
  assert.ok(Math.abs(w.dailyDrawdownPct() - first) < 1e-9, "the drawdown is frozen, not decaying");
});

test("re-arming clears the halt and keeps the book intact", () => {
  const w = wallet();
  // Open a position that should survive the re-arm.
  const entry: Fill = {
    id: "keep", tokenId: "solana:KEEP", symbol: "KEEP", chain: "solana", side: "buy",
    quantity: 500, priceUsd: 0.002, liquidityUsd: 500_000, valueNative: 1, feeNative: 0.001, quote: "SOL",
    slippagePct: 0.4, reason: "t", at: Date.now(), txRef: "paper-k", mode: "paper",
  };
  w.applyBuy(entry, AGGRESSIVE);
  breachDailyLimit(w);
  assert.ok(w.dailyDrawdownPct() > AGGRESSIVE.dailyLossLimitPct);

  const equityBefore = w.snapshot().equityUsd;
  const realizedBefore = w.snapshot().realizedPnlUsd;
  w.rearmDailyLimit();

  assert.ok(w.dailyDrawdownPct() < 1e-6, "the limit now measures from here");
  const after = w.snapshot();
  assert.ok(Math.abs(after.equityUsd - equityBefore) < 1e-9, "equity is untouched");
  assert.equal(after.realizedPnlUsd, realizedBefore, "realised P/L is kept — the run continues");
  assert.ok(w.positionFor("solana:KEEP"), "open positions survive a re-arm");
});

test("re-arming does not forgive the loss, only the halt", () => {
  const w = wallet();
  breachDailyLimit(w);
  const lost = w.snapshot().realizedPnlUsd;
  w.rearmDailyLimit();
  assert.ok(lost < 0);
  assert.equal(w.snapshot().realizedPnlUsd, lost, "the loss stays on the record");
  assert.ok(w.snapshot().equityUsd < BOOK_USD, "equity is still down — only the reference moved");
});

test("resetting the book starts the run over at the configured size", () => {
  const w = wallet();
  breachDailyLimit(w);
  w.applyBuy(
    { id: "x", tokenId: "solana:X", symbol: "X", chain: "solana", side: "buy", quantity: 10,
      priceUsd: 0.01, liquidityUsd: 500_000, valueNative: 0.5, feeNative: 0.001, quote: "SOL", slippagePct: 0.4,
      reason: "t", at: Date.now(), txRef: "paper-x", mode: "paper" },
    AGGRESSIVE,
  );

  w.resetTo(BOOK_USD);
  const snap = w.snapshot();
  assert.equal(snap.openPositions, 0, "positions are cleared");
  assert.equal(snap.realizedPnlUsd, 0, "history is cleared");
  assert.ok(Math.abs(snap.equityUsd - BOOK_USD) < 1e-6, "treasuries are refunded");
  assert.equal(snap.wins + snap.losses, 0);
  assert.ok(w.dailyDrawdownPct() < 1e-6, "a fresh run is not born halted");
  assert.equal(w.cashOn("solana"), 10, "the SOL treasury is funded again");
});

test("the halt reports when it would roll over on its own", () => {
  const w = wallet();
  const rollsAt = w.dailyLimitRollsAt();
  const hours = (rollsAt - Date.now()) / 3_600_000;
  assert.ok(hours > 23 && hours <= 24, `expected ~24h, got ${hours.toFixed(1)}h`);

  w.rearmDailyLimit();
  assert.ok(w.dailyLimitRollsAt() >= rollsAt, "re-arming pushes the automatic roll out too");
});

// ── the display must survive numbers it should never see ──────────────────

test("formatting survives pathological values instead of printing nonsense", async () => {
  const { formatCompactUsd, formatPct, formatUsdPrice } = await import("../src/lib/util/format");

  // The exact string a long-running simulator put on screen.
  assert.ok(!formatCompactUsd(9.06994e16).includes("B"), "past a trillion, B is meaningless");
  assert.equal(formatCompactUsd(1_800), "$1.80K");
  assert.equal(formatCompactUsd(2_500_000), "$2.50M");
  assert.equal(formatCompactUsd(-1_800), "-$1.80K");
  assert.equal(formatCompactUsd(Number.NaN), "—");

  assert.ok(!formatPct(5.0388e24).includes("e"), "a percentage must never render in exponent form");
  assert.equal(formatPct(12.34), "+12.3%");
  assert.equal(formatPct(-12.34), "-12.3%");
  assert.equal(formatPct(Number.POSITIVE_INFINITY), "—");

  assert.ok(!formatUsdPrice(8.3e100).includes("NaN"));
  assert.equal(formatUsdPrice(0), "$0");
});

// ── the benchmark must isolate trading from the quote assets' own market ──

test("an untraded book reads 0%, whatever SOL and ETH do", () => {
  // The bug this exists for: the book was funded at fallback prices, the real
  // ones arrived seconds later, and the desk reported −32.8% having never
  // opened a position.
  const w = new PaperWallet(BOOK_USD, CHAINS_ACTIVE, PRICES);
  assert.ok(Math.abs(w.snapshot().totalPnlPct) < 1e-9, "a fresh book is flat");

  // SOL almost halves, ETH slides too — a real market move, not a desk result.
  w.setPrices({ solana: 101, robinhood: 2507 });
  const snap = w.snapshot();
  assert.ok(
    Math.abs(snap.totalPnlPct) < 1e-9,
    `holding through a price move is not a trading loss, got ${snap.totalPnlPct}%`,
  );
  assert.ok(snap.equityUsd < BOOK_USD, "the dollar value of the book really did fall");
  assert.ok(
    Math.abs(snap.equityUsd - snap.startingEquityUsd) < 1e-9,
    "the benchmark falls with it, because it is the same holdings",
  );
});

test("a quote-price slide cannot trip the daily loss limit", () => {
  const w = new PaperWallet(BOOK_USD, CHAINS_ACTIVE, PRICES);
  w.setPrices({ solana: 60, robinhood: 1500 });
  assert.ok(
    w.dailyDrawdownPct() < 1e-9,
    `a two-thirds fall in SOL must not halt the desk, got ${w.dailyDrawdownPct()}%`,
  );
});

test("real trading gains still show through a price move", async () => {
  const w = new PaperWallet(BOOK_USD, CHAINS_ACTIVE, PRICES);
  const executor = new PaperExecutor();
  const entry = (await executor.buy(intent(1), token(), SOL, AGGRESSIVE)).fill as Fill;
  const position = w.applyBuy(entry, AGGRESSIVE);

  const doubled = token({ priceUsd: 0.002 });
  w.markToMarket(new Map([[doubled.id, doubled]]));
  const exit = (await executor.sell(w.positionFor(doubled.id)!, doubled, 1, "tp", SOL, AGGRESSIVE)).fill as Fill;
  w.applySell(exit, false);
  void position;

  const before = w.snapshot().totalPnlPct;
  assert.ok(before > 0, "doubling a position is a gain");

  // Now SOL halves. The gain was made in SOL and is still there in SOL terms.
  w.setPrices({ solana: SOL / 2, robinhood: ETH });
  const after = w.snapshot().totalPnlPct;
  assert.ok(after > 0, `the trading gain must survive the repricing, got ${after}%`);
});

test("re-funding is refused once the desk has traded", async () => {
  const w = new PaperWallet(BOOK_USD, CHAINS_ACTIVE, PRICES);
  assert.equal(w.refundAtPrices({ solana: 101, robinhood: 2507 }), true, "an untouched book may be re-funded");

  const entry = (await new PaperExecutor().buy(intent(1), token(), 101, AGGRESSIVE)).fill as Fill;
  w.applyBuy(entry, AGGRESSIVE);
  assert.equal(
    w.refundAtPrices({ solana: 200, robinhood: 4000 }),
    false,
    "re-funding must never be a way to erase a real result",
  );
});
