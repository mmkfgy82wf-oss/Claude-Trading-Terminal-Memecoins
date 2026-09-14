import assert from "node:assert/strict";
import { test } from "node:test";
import { ExecutorAgent } from "../src/lib/agents/executor";
import { Blackboard } from "../src/lib/agents/blackboard";
import type { AgentContext } from "../src/lib/agents/base";
import { PaperWallet } from "../src/lib/trading/wallet";
import { PaperExecutor } from "../src/lib/trading/executor";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { ChainId, Fill, Token } from "../src/lib/types";

/**
 * The two failure modes an overnight run on live data made visible:
 * winners that gave everything back, and losses far past the stop.
 */

const SOL = 180;
const PRICES = { solana: SOL, robinhood: 3200 };
const ACTIVE: ChainId[] = ["solana"];
const BOOK = 1_800;

function token(over: Partial<Token> = {}): Token {
  return {
    id: "solana:P",
    chain: "solana",
    pairAddress: "P",
    tokenAddress: "M",
    symbol: "RHAWK",
    name: "Red Hawk",
    priceUsd: 0.00005901,
    priceNative: 0.00005901 / SOL,
    liquidityUsd: 103_000,
    fdvUsd: 800_000,
    volume24hUsd: 600_000,
    volume5mUsd: 20_000,
    buys5m: 90,
    sells5m: 60,
    change5m: 4,
    change1h: 30,
    change24h: 120,
    ageMinutes: 30,
    dex: "pumpswap",
    history: [],
    simulated: false,
    ...over,
  };
}

function ctxFor(t: Token, wallet: PaperWallet): AgentContext & { board: Blackboard } {
  const board = new Blackboard();
  board.setUniverse([t]);
  return {
    tick: 1,
    board,
    wallet,
    risk: { ...AGGRESSIVE },
    flags: {
      autonomy: "auto", killSwitch: false, marketMode: "live", chains: ACTIVE,
      narrativeAugmented: false, providers: { birdeye: false, helius: false, anthropic: false },
    },
    log: () => {},
  };
}

/** Open a position, then walk the price (and optionally the pool) and let the desk react. */
async function run(path: { price: number; liquidity?: number }[]): Promise<{ exits: Fill[]; wallet: PaperWallet }> {
  const wallet = new PaperWallet(BOOK, ACTIVE, PRICES);
  const executor = new ExecutorAgent(new PaperExecutor());
  const entry = token();

  let ctx = ctxFor(entry, wallet);
  await executor.enter(
    { id: "i1", tokenId: entry.id, symbol: entry.symbol, chain: "solana", side: "buy",
      sizeNative: 1, quote: "SOL", reason: "test", consensusScore: 80, confidence: 0.9,
      createdAt: Date.now() },
    ctx,
  );

  for (const step of path) {
    const now = token({ priceUsd: step.price, liquidityUsd: step.liquidity ?? entry.liquidityUsd });
    ctx = ctxFor(now, wallet);
    wallet.markToMarket(new Map([[now.id, now]]));
    await executor.run(ctx);
    if (!wallet.positionFor(entry.id)) break;
  }
  return { exits: wallet.recentFills().filter((f) => f.side === "sell"), wallet };
}

test("a winner that gives it all back now closes near breakeven, not at the stop", async () => {
  const entry = 0.00005901;
  // Peaks at +45% — short of the first take-profit rung, so the trailing stop
  // never armed and the old desk rode it to −25%.
  const { exits } = await run([
    { price: entry * 1.2 },
    { price: entry * 1.45 },
    { price: entry * 1.1 },
    { price: entry * 1.0 },
    { price: entry * 0.95 },
    { price: entry * 0.8 },
  ]);

  assert.equal(exits.length, 1, "the position closed");
  const pnlPct = ((exits[0].priceUsd - entry) / entry) * 100;
  assert.ok(pnlPct > -12, `expected an exit near entry, got ${pnlPct.toFixed(1)}%`);
  assert.match(exits[0].reason, /breakeven/, `wrong rule fired: ${exits[0].reason}`);
});

test("a position that never worked still exits on the ordinary stop-loss", async () => {
  const entry = 0.00005901;
  // Never gets near the breakeven trigger, so that rule must not interfere.
  const { exits } = await run([
    { price: entry * 0.95 },
    { price: entry * 0.85 },
    { price: entry * 0.7 },
  ]);

  assert.equal(exits.length, 1);
  assert.match(exits[0].reason, /stop-loss/, `wrong rule fired: ${exits[0].reason}`);
});

test("a draining pool triggers an exit before the price stop does", async () => {
  const entry = 0.00005901;
  // Liquidity leaves first — the pattern behind the −95% closes. The price is
  // still only down 8%, well inside the stop.
  const { exits } = await run([
    { price: entry * 0.99, liquidity: 100_000 },
    { price: entry * 0.92, liquidity: 55_000 },
  ]);

  assert.equal(exits.length, 1, "the desk got out");
  assert.match(exits[0].reason, /drained/, `wrong rule fired: ${exits[0].reason}`);
  const pnlPct = ((exits[0].priceUsd - entry) / entry) * 100;
  assert.ok(pnlPct > -25, `exited at ${pnlPct.toFixed(1)}% — should beat the hard stop`);
});

test("the drain check measures from the deepest pool seen, not from entry", async () => {
  const entry = 0.00005901;
  // Pool grows after entry, then collapses back past entry level. Measuring
  // from entry alone would miss the collapse from the peak.
  const { exits } = await run([
    { price: entry * 1.05, liquidity: 240_000 },
    { price: entry * 1.02, liquidity: 130_000 },
  ]);

  assert.equal(exits.length, 1);
  assert.match(exits[0].reason, /drained/);
  assert.match(exits[0].reason, /240,000/, `should name the peak pool: ${exits[0].reason}`);
});

test("a healthy pool that merely wobbles is left alone", async () => {
  const entry = 0.00005901;
  const { wallet } = await run([
    { price: entry * 1.05, liquidity: 103_000 },
    { price: entry * 1.08, liquidity: 88_000 },
    { price: entry * 1.1, liquidity: 95_000 },
  ]);
  assert.ok(wallet.positionFor("solana:P"), "a 15% dip in the pool is noise, not a rug");
});

test("the take-profit ladder still runs above the breakeven trigger", async () => {
  const entry = 0.00005901;
  const { exits, wallet } = await run([
    { price: entry * 1.25 },
    { price: entry * 1.55 },
  ]);
  assert.equal(exits.length, 1, "the first rung fired");
  assert.match(exits[0].reason, /take-profit/, `wrong rule fired: ${exits[0].reason}`);
  assert.ok(wallet.positionFor("solana:P"), "a rung is partial — the rest stays open");
});
