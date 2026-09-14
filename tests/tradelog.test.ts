import assert from "node:assert/strict";
import { test } from "node:test";
import { PaperWallet } from "../src/lib/trading/wallet";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { ChainId, Fill } from "../src/lib/types";

const SOL = 180;
const PRICES = { solana: SOL, robinhood: 3200 };
const ACTIVE: ChainId[] = ["solana", "robinhood"];
const BOOK_USD = 3_600;

const wallet = () => new PaperWallet(BOOK_USD, ACTIVE, PRICES);

const leg = (over: Partial<Fill> = {}): Fill => ({
  id: "f" + Math.random().toString(36).slice(2),
  tokenId: "solana:P",
  symbol: "TEST",
  chain: "solana",
  side: "buy",
  quantity: 1000,
  priceUsd: 0.001,
  liquidityUsd: 500_000,
  valueNative: 1,
  feeNative: 0.003,
  quote: "SOL",
  slippagePct: 0.5,
  reason: "entry",
  at: Date.now(),
  txRef: "paper",
  mode: "paper",
  ...over,
});

test("a simple round trip is logged with its own P/L and outcome", () => {
  const w = wallet();
  w.applyBuy(leg(), AGGRESSIVE);
  w.applySell(
    leg({ side: "sell", valueNative: 1.6, realizedPnlNative: 0.597, realizedPnlUsd: 0.597 * SOL,
          priceUsd: 0.0016, reason: "take-profit +50% (rung 1)" }),
    false,
  );

  const [trade] = w.closedTrades();
  assert.ok(trade, "the closed position produced a log entry");
  assert.equal(trade.outcome, "win");
  assert.equal(trade.symbol, "TEST");
  assert.equal(trade.quote, "SOL");
  assert.ok(trade.pnlNative > 0.5, `expected ~0.6 SOL, got ${trade.pnlNative}`);
  assert.ok(trade.pnlPct > 50, `expected a >50% return, got ${trade.pnlPct}`);
  assert.equal(trade.exits, 1);
  assert.match(trade.exitReason, /take-profit/);
});

test("a laddered exit is one trade, not several", () => {
  const w = wallet();
  w.applyBuy(leg({ quantity: 1000, valueNative: 1 }), AGGRESSIVE);
  // Rung 1 takes 40% at +50%.
  w.applySell(
    leg({ side: "sell", quantity: 400, valueNative: 0.6, priceUsd: 0.0015,
          realizedPnlNative: 0.2, realizedPnlUsd: 0.2 * SOL, reason: "take-profit +50% (rung 1)" }),
    true,
  );
  // The rest stops out.
  w.applySell(
    leg({ side: "sell", quantity: 600, valueNative: 0.45, priceUsd: 0.00075,
          realizedPnlNative: -0.15, realizedPnlUsd: -0.15 * SOL, reason: "stop-loss -25.0%" }),
    false,
  );

  const log = w.closedTrades();
  assert.equal(log.length, 1, "two exits, one trade");
  assert.equal(log[0].exits, 2);
  assert.equal(log[0].rungsTaken, 1, "the ladder rung is counted");
  assert.match(log[0].exitReason, /stop-loss/, "the final leg names the exit");
});

test("the outcome follows the whole trade, not the last leg", () => {
  const w = wallet();
  w.applyBuy(leg({ quantity: 1000, valueNative: 1 }), AGGRESSIVE);
  // A big win on the way up…
  w.applySell(
    leg({ side: "sell", quantity: 700, valueNative: 2.1, priceUsd: 0.003,
          realizedPnlNative: 1.4, realizedPnlUsd: 1.4 * SOL, reason: "take-profit +150% (rung 2)" }),
    true,
  );
  // …then the remainder stops out at a loss. Scoring only this leg would file
  // the whole trade as a loser, which is the bug this test exists for.
  w.applySell(
    leg({ side: "sell", quantity: 300, valueNative: 0.15, priceUsd: 0.0005,
          realizedPnlNative: -0.15, realizedPnlUsd: -0.15 * SOL, reason: "stop-loss -50.0%" }),
    false,
  );

  const [trade] = w.closedTrades();
  assert.equal(trade.outcome, "win", "overall the desk made money on this name");
  assert.ok(trade.pnlNative > 1, `expected ~+1.25 SOL, got ${trade.pnlNative}`);

  const snap = w.snapshot();
  assert.equal(snap.wins, 1, "the scoreboard agrees with the log");
  assert.equal(snap.losses, 0);
});

test("a losing round trip is logged as a loss", () => {
  const w = wallet();
  w.applyBuy(leg(), AGGRESSIVE);
  w.applySell(
    leg({ side: "sell", valueNative: 0.7, priceUsd: 0.0007,
          realizedPnlNative: -0.3, realizedPnlUsd: -0.3 * SOL, reason: "stop-loss -25.0%" }),
    false,
  );

  const [trade] = w.closedTrades();
  assert.equal(trade.outcome, "loss");
  assert.ok(trade.pnlPct < -25, `expected a loss, got ${trade.pnlPct}%`);
  assert.equal(w.snapshot().losses, 1);
});

test("trades on an EVM chain are logged in that chain's asset", () => {
  const w = wallet();
  const rhc = { tokenId: "robinhood:Q", chain: "robinhood" as const, quote: "ETH", symbol: "RHC" };
  w.applyBuy(leg({ ...rhc, valueNative: 0.05 }), AGGRESSIVE);
  w.applySell(
    leg({ ...rhc, side: "sell", valueNative: 0.08, priceUsd: 0.0016,
          realizedPnlNative: 0.03, realizedPnlUsd: 0.03 * 3200, reason: "take-profit +50% (rung 1)" }),
    false,
  );

  const [trade] = w.closedTrades();
  assert.equal(trade.quote, "ETH");
  assert.ok(Math.abs(trade.pnlUsd - trade.pnlNative * 3200) < 1e-6, "USD converts through ETH");
});

test("the log survives a restart", async () => {
  const { saveBook, loadBook } = await import("../src/lib/trading/persistence");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");

  const dir = await mkdtemp(path.join(tmpdir(), "memedesk-log-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const before = wallet();
    before.applyBuy(leg(), AGGRESSIVE);
    before.applySell(
      leg({ side: "sell", valueNative: 1.5, priceUsd: 0.0015,
            realizedPnlNative: 0.497, realizedPnlUsd: 0.497 * SOL, reason: "take-profit +50% (rung 1)" }),
      false,
    );

    await saveBook(before.serialize());
    const after = wallet();
    after.restore((await loadBook())!);

    assert.equal(after.closedTrades().length, 1, "the trade log is part of the book");
    assert.equal(after.closedTrades()[0].outcome, "win");
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a book saved before the trade log existed still loads", async () => {
  const { saveBook, loadBook } = await import("../src/lib/trading/persistence");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");

  const dir = await mkdtemp(path.join(tmpdir(), "memedesk-old-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const w = wallet();
    const state = w.serialize();
    delete (state as { trades?: unknown }).trades;
    await saveBook(state);

    const restored = wallet();
    restored.restore((await loadBook())!);
    assert.deepEqual(restored.closedTrades(), [], "an older book simply has no log yet");
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
