import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TRACKED, STALE_AFTER_MS, pruneUniverse } from "../src/lib/market/feed";
import { ScoutAgent } from "../src/lib/agents/scout";
import { SentinelAgent } from "../src/lib/agents/sentinel";
import { QuantAgent } from "../src/lib/agents/quant";
import { RiskAgent } from "../src/lib/agents/risk";
import { Blackboard } from "../src/lib/agents/blackboard";
import type { AgentContext } from "../src/lib/agents/base";
import { PaperWallet } from "../src/lib/trading/wallet";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { ChainId, Token } from "../src/lib/types";

/**
 * These cover the gap that let the desk stall on live data: the old suite
 * asserted how agents judge a token, but never that the universe they judge
 * contains anything tradable, nor that it ages.
 */

const SOL = 180;
const PRICES = { solana: SOL, robinhood: 3200 };
const ACTIVE: ChainId[] = ["solana"];
const BOOK_USD = 1_800;

function token(over: Partial<Token> = {}): Token {
  const base: Token = {
    id: "solana:P",
    chain: "solana",
    pairAddress: "P",
    tokenAddress: "M",
    symbol: "TEST",
    name: "Test Dog Coin",
    priceUsd: 0.001,
    priceNative: 0.001 / SOL,
    liquidityUsd: 400_000,
    fdvUsd: 3_000_000,
    volume24hUsd: 1_200_000,
    volume5mUsd: 40_000,
    buys5m: 180,
    sells5m: 90,
    change5m: 4,
    change1h: 18,
    change24h: 120,
    ageMinutes: 45,
    dex: "raydium",
    history: Array.from({ length: 30 }, (_, i) => ({ t: i, p: 0.0008 + i * 0.000008 })),
    simulated: false,
    ...over,
  };
  return { ...base, id: `solana:${base.pairAddress}` };
}

function ctxFor(tokens: Token[]): AgentContext & { board: Blackboard } {
  const board = new Blackboard();
  board.setUniverse(tokens);
  return {
    tick: 1,
    board,
    wallet: new PaperWallet(BOOK_USD, ACTIVE, PRICES),
    risk: { ...AGGRESSIVE },
    flags: {
      autonomy: "auto",
      killSwitch: false,
      marketMode: "live",
      chains: ACTIVE,
      narrativeAugmented: false,
      providers: { birdeye: false, helius: false, anthropic: false },
    },
    log: () => {},
  };
}

// ── universe ageing ───────────────────────────────────────────────────────

test("a pair that stops refreshing is aged out of the universe", () => {
  const live = token({ pairAddress: "LIVE" });
  const gone = token({ pairAddress: "GONE" });
  const now = Date.now();
  const lastSeen = new Map([
    [live.id, now - 60_000],
    [gone.id, now - STALE_AFTER_MS - 60_000],
  ]);

  const keep = pruneUniverse([live, gone], lastSeen, new Set(), now);
  assert.ok(keep.has(live.id));
  assert.ok(!keep.has(gone.id), "a pair the upstream stopped returning must not linger forever");
});

test("an open position is never aged out, however stale its quote", () => {
  const held = token({ pairAddress: "HELD" });
  const now = Date.now();
  // Deliberately far past the stale window — a delisted pair we still hold.
  const lastSeen = new Map([[held.id, now - STALE_AFTER_MS * 10]]);

  const keep = pruneUniverse([held], lastSeen, new Set([held.id]), now);
  assert.ok(keep.has(held.id), "dropping a held pair would stop its stop-loss being evaluated");
});

test("the universe is capped, keeping the deepest pools and every held pair", () => {
  const now = Date.now();
  const tokens = Array.from({ length: 30 }, (_, i) =>
    token({ pairAddress: `P${i}`, liquidityUsd: 1_000 * (i + 1) }),
  );
  const lastSeen = new Map(tokens.map((t) => [t.id, now]));
  // The shallowest pair is one we hold, so it must survive the cull anyway.
  const shallowHeld = tokens[0].id;

  const keep = pruneUniverse(tokens, lastSeen, new Set([shallowHeld]), now, 10);
  assert.equal(keep.size, 10);
  assert.ok(keep.has(shallowHeld), "a held pair outranks liquidity");
  assert.ok(keep.has(tokens[29].id), "the deepest pool is kept");
  assert.ok(!keep.has(tokens[1].id), "the shallow tail is dropped");
});

test("MAX_TRACKED keeps the refresh workload bounded", () => {
  // Each refresh batches 30 addresses, so the ceiling caps requests per tick.
  assert.ok(MAX_TRACKED <= 150, `${MAX_TRACKED} pairs is more than a tick can refresh`);
});

// ── can the desk actually trade what discovery returns? ───────────────────

test("a universe of fresh launches produces tickets", async () => {
  // What pump.fun discovery is meant to deliver: young, liquid, moving.
  const fresh = Array.from({ length: 8 }, (_, i) =>
    token({
      pairAddress: `NEW${i}`,
      ageMinutes: 20 + i * 5,
      liquidityUsd: 80_000,
      change5m: 9,
      change1h: 35,
      volume5mUsd: 30_000,
      volume24hUsd: 900_000,
    }),
  );
  const ctx = ctxFor(fresh);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.ok(risk.pending.length > 0, "a fresh, liquid, trending universe must produce at least one ticket");
});

test("a universe of stale large-caps produces nothing — and that is correct", async () => {
  // What the old text-search discovery actually returned: established coins
  // drifting a couple of percent. The desk going quiet here is right; the bug
  // was that this was the ONLY thing it ever saw.
  const stale = Array.from({ length: 8 }, (_, i) =>
    token({
      pairAddress: `OLD${i}`,
      ageMinutes: 60 * 24 * 400,
      liquidityUsd: 20_000_000,
      change5m: 0.3,
      change1h: 1.2,
      change24h: 2,
      volume5mUsd: 4_000,
      volume24hUsd: 5_000_000,
      history: Array.from({ length: 30 }, (_, j) => ({ t: j, p: 0.001 + j * 1e-7 })),
    }),
  );
  const ctx = ctxFor(stale);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.equal(risk.pending.length, 0, "2%-a-day large-caps are not memecoin setups");
  // The age window must be what rejects them, not luck.
  const scout = ctx.board.signalBy("solana:OLD0", "scout");
  assert.ok(
    scout?.reasons.some((r) => r.includes("age window")),
    `SCOUT should reject on age; said: ${scout?.reasons.join(" / ")}`,
  );
});

test("the age window is tight enough to exclude established coins", () => {
  const days = AGGRESSIVE.maxPairAgeMinutes / (60 * 24);
  assert.ok(days <= 7, `${days} days lets in coins that no longer move like memecoins`);
});

// ── the diagnostics funnel ────────────────────────────────────────────────

test("the funnel names the consensus threshold when the board is merely quiet", async () => {
  const stale = Array.from({ length: 6 }, (_, i) =>
    token({
      pairAddress: `Q${i}`,
      ageMinutes: 60 * 10,
      change5m: 0.4,
      change1h: 1,
      change24h: 3,
      volume5mUsd: 3_000,
    }),
  );
  const ctx = ctxFor(stale);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.equal(risk.funnel.sized, 0);
  assert.ok(risk.funnel.considered > 0, "the funnel starts from what was actually looked at");
  assert.ok(risk.blocker, "a quiet tick must still explain itself");
  assert.match(risk.blocker!, /threshold|quiet/i, `unhelpful blocker: ${risk.blocker}`);
});

test("the funnel reports the position cap rather than a vague silence", async () => {
  const ctx = ctxFor([token({ pairAddress: "GOOD" })]);
  ctx.risk.maxOpenPositions = 0;
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.equal(risk.funnel.sized, 0);
  assert.match(risk.blocker ?? "", /slot/i, `expected a slot message, got: ${risk.blocker}`);
});

test("the funnel counts vetoes separately from low scores", async () => {
  const trap = token({ pairAddress: "TRAP", buys5m: 300, sells5m: 1 });
  const good = token({ pairAddress: "GOOD" });
  const ctx = ctxFor([trap, good]);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.equal(risk.funnel.vetoed, 1, "the honeypot is counted as a veto, not a weak score");
  assert.ok(risk.funnel.considered >= 2);
});

test("a tick that trades reports no blocker", async () => {
  const fresh = Array.from({ length: 4 }, (_, i) =>
    token({ pairAddress: `F${i}`, ageMinutes: 30, liquidityUsd: 90_000, change5m: 8, change1h: 30 }),
  );
  const ctx = ctxFor(fresh);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);

  assert.ok(risk.funnel.sized > 0);
  assert.equal(risk.blocker, null, "nothing is blocking when tickets are being sized");
});
