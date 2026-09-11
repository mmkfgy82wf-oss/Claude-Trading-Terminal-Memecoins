import assert from "node:assert/strict";
import { test } from "node:test";
import { Blackboard } from "../src/lib/agents/blackboard";
import { ScoutAgent } from "../src/lib/agents/scout";
import { SentinelAgent } from "../src/lib/agents/sentinel";
import { QuantAgent } from "../src/lib/agents/quant";
import { RiskAgent } from "../src/lib/agents/risk";
import type { AgentContext } from "../src/lib/agents/base";
import { PaperWallet } from "../src/lib/trading/wallet";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { Token } from "../src/lib/types";

const SOL = 180;

function token(overrides: Partial<Token> = {}): Token {
  const base: Token = {
    id: `solana:${overrides.symbol ?? "TEST"}`,
    chain: "solana",
    pairAddress: `PAIR${overrides.symbol ?? "TEST"}`,
    tokenAddress: "MINT",
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
    simulated: true,
    ...overrides,
  };
  return { ...base, id: `solana:${base.symbol}` };
}

function makeCtx(tokens: Token[], wallet = new PaperWallet(10)): AgentContext & { board: Blackboard } {
  const board = new Blackboard();
  board.setUniverse(tokens);
  return {
    tick: 1,
    board,
    wallet,
    risk: { ...AGGRESSIVE },
    flags: {
      autonomy: "auto",
      killSwitch: false,
      marketMode: "simulated",
      chains: ["solana"],
      narrativeAugmented: false,
      providers: { birdeye: false, helius: false, anthropic: false },
    },
    solPriceUsd: SOL,
    log: () => {},
  };
}

test("SCOUT ranks a deep, active pool above a dead one", () => {
  const good = token({ symbol: "GOOD" });
  const dead = token({ symbol: "DEAD", liquidityUsd: 2_000, volume24hUsd: 1_000, volume5mUsd: 10, ageMinutes: 40_000 });
  const ctx = makeCtx([good, dead]);
  new ScoutAgent().run(ctx);

  const goodSignal = ctx.board.signalBy("solana:GOOD", "scout")!;
  const deadSignal = ctx.board.signalBy("solana:DEAD", "scout")!;
  assert.ok(goodSignal.score > deadSignal.score, "the tradable pair must rank higher");
  assert.ok(deadSignal.score < 0, "a dead pair scores negative");
});

test("SENTINEL vetoes a honeypot pattern and lets a healthy pair through", async () => {
  const healthy = token({ symbol: "HEALTHY" });
  const honeypot = token({ symbol: "TRAP", buys5m: 240, sells5m: 2 });
  const ctx = makeCtx([healthy, honeypot]);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);

  assert.equal(ctx.board.signalBy("solana:TRAP", "sentinel")?.veto, true, "one-way flow must be vetoed");
  assert.notEqual(ctx.board.signalBy("solana:HEALTHY", "sentinel")?.veto, true);
});

test("SENTINEL vetoes a sell cascade", async () => {
  const rugging = token({ symbol: "RUG", buys5m: 4, sells5m: 300, change5m: -55 });
  const ctx = makeCtx([rugging]);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  assert.equal(ctx.board.signalBy("solana:RUG", "sentinel")?.veto, true);
});

test("QUANT prefers constructive flow over a dump, and discounts an extended move", () => {
  const strong = token({ symbol: "STRONG" });
  const dumping = token({ symbol: "DUMP", change5m: -18, change1h: -40, change24h: -70, buys5m: 20, sells5m: 160 });
  const blownOff = token({ symbol: "BLOWOFF", change5m: 140 });
  const ctx = makeCtx([strong, dumping, blownOff]);
  new ScoutAgent().run(ctx);
  new QuantAgent().run(ctx);

  const s = ctx.board.signalBy("solana:STRONG", "quant")!.score;
  const d = ctx.board.signalBy("solana:DUMP", "quant")!.score;
  const b = ctx.board.signalBy("solana:BLOWOFF", "quant")!.score;
  assert.ok(s > d, "an uptrend with buy-side flow beats a dump");
  assert.ok(s > b, "a fresh setup beats one that already went vertical");
});

test("a veto overrides a bullish consensus", async () => {
  const trap = token({ symbol: "TRAP", buys5m: 300, sells5m: 1, change1h: 90, change5m: 20 });
  const ctx = makeCtx([trap]);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);

  const view = ctx.board.consensus().find((c) => c.tokenId === "solana:TRAP")!;
  assert.equal(view.verdict, "vetoed");
  assert.ok(view.score < 0, "a vetoed name cannot carry a positive score");
});

test("RISK never sizes a vetoed name and respects the position cap", async () => {
  const trap = token({ symbol: "TRAP", buys5m: 300, sells5m: 1, change1h: 90 });
  const good = token({ symbol: "GOOD" });
  const ctx = makeCtx([trap, good]);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);

  const risk = new RiskAgent();
  risk.run(ctx);
  assert.ok(!risk.pending.some((i) => i.tokenId === "solana:TRAP"), "a vetoed name is never sized");

  ctx.risk.maxOpenPositions = 0;
  risk.run(ctx);
  assert.equal(risk.pending.length, 0, "no slots means no tickets");
});

test("RISK keeps every ticket inside the per-position and exposure caps", async () => {
  const tokens = Array.from({ length: 8 }, (_, i) => token({ symbol: `HOT${i}` }));
  const ctx = makeCtx(tokens);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);

  const risk = new RiskAgent();
  risk.run(ctx);

  const equity = ctx.wallet.snapshot(SOL).equitySol;
  const cap = equity * (ctx.risk.maxPositionPct / 100);
  assert.ok(risk.pending.length > 0, "a clean, liquid, trending universe should produce tickets");
  for (const intent of risk.pending) {
    assert.ok(intent.sizeSol <= cap + 1e-9, `${intent.sizeSol} exceeds the ${cap} per-position cap`);
  }
  const total = risk.pending.reduce((s, i) => s + i.sizeSol, 0);
  assert.ok(total <= equity * (ctx.risk.maxPortfolioExposurePct / 100) + 1e-9, "exposure cap holds across tickets");
  assert.ok(risk.pending.length <= ctx.risk.maxOpenPositions);
});

test("the kill switch stops RISK from opening anything", async () => {
  const ctx = makeCtx([token({ symbol: "GOOD" })]);
  ctx.flags = { ...ctx.flags, killSwitch: true };
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);
  assert.equal(risk.pending.length, 0);
});

test("RISK halts new entries once the daily loss limit is breached", async () => {
  const wallet = new PaperWallet(10);
  // Manufacture a drawdown past the limit.
  wallet.applyBuy(
    { id: "a", tokenId: "solana:GOOD", symbol: "GOOD", chain: "solana", side: "buy", quantity: 1000,
      priceUsd: 0.001, valueSol: 6, feeSol: 0.01, slippagePct: 0.4, reason: "t", at: Date.now(),
      txRef: "paper-a", mode: "paper" },
    AGGRESSIVE,
  );
  wallet.applySell(
    { id: "b", tokenId: "solana:GOOD", symbol: "GOOD", chain: "solana", side: "sell", quantity: 1000,
      priceUsd: 0.0001, valueSol: 0.6, feeSol: 0.01, slippagePct: 0.4, realizedPnlSol: -5.4, reason: "sl",
      at: Date.now(), txRef: "paper-b", mode: "paper" },
    false,
  );

  const ctx = makeCtx([token({ symbol: "GOOD" })], wallet);
  new ScoutAgent().run(ctx);
  await new SentinelAgent().run(ctx);
  new QuantAgent().run(ctx);
  const risk = new RiskAgent();
  risk.run(ctx);
  assert.equal(risk.pending.length, 0, "past the daily loss limit the desk stops opening risk");
});
