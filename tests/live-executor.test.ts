import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { LiveSolanaExecutor, WSOL_MINT } from "../src/lib/live/executor";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { Position, Token, TradeIntent } from "../src/lib/types";

const ENDPOINT = "https://rpc.test.invalid";
const MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";

/** A real unsigned transaction, so the signing path is genuinely exercised. */
function unsignedTx(signer: Keypair): string {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 1 }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message as MessageV0).serialize()).toString("base64");
}

function keyfile(): { path: string; keypair: Keypair } {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  const path = join(dir, "burner.json");
  const keypair = Keypair.generate();
  writeFileSync(path, JSON.stringify([...keypair.secretKey]), "utf8");
  return { path, keypair };
}

const LIVE_ENV = (path: string) => ({
  ENABLE_LIVE_TRADING: "yes-i-accept-the-risk",
  SOLANA_KEYPAIR_PATH: path,
  LIVE_MAX_TICKET_USD: "15",
  LIVE_MAX_DEPLOYED_USD: "80",
  LIVE_MAX_BOOK_USD: "120",
});

function token(over: Partial<Token> = {}): Token {
  return {
    id: `solana:${MINT}`, chain: "solana", pairAddress: "PAIR", tokenAddress: MINT,
    symbol: "LIVE", name: "Live", priceUsd: 0.00004, priceNative: 4e-7,
    liquidityUsd: 80_000, fdvUsd: 900_000, volume24hUsd: 400_000, volume5mUsd: 9_000,
    buys5m: 70, sells5m: 40, change5m: 4, change1h: 30, change24h: 120,
    ageMinutes: 25, dex: "pumpswap", history: [], simulated: false, ...over,
  };
}

const intent: TradeIntent = {
  id: "i1", tokenId: `solana:${MINT}`, symbol: "LIVE", chain: "solana", side: "buy",
  sizeNative: 0.1, quote: "SOL", reason: "test", consensusScore: 70, confidence: 0.8,
  createdAt: Date.now(),
};

/** Route stubbed answers by URL and, for the RPC, by method. */
function stub(routes: {
  quote?: unknown | null;
  swap?: unknown;
  rpc?: Record<string, (params: unknown[]) => unknown>;
}) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/quote")) {
      seen.push("quote");
      if (!routes.quote) return { ok: false, status: 404 } as Response;
      return { ok: true, json: async () => routes.quote } as unknown as Response;
    }
    if (href.includes("/swap")) {
      seen.push("swap");
      return { ok: true, json: async () => routes.swap } as unknown as Response;
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    seen.push(body.method);
    const handler = routes.rpc?.[body.method];
    if (!handler) return { ok: false, status: 501 } as Response;
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: handler(body.params) }) } as unknown as Response;
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const quoteFor = (outAmount: string, impact = "0") => ({
  inputMint: WSOL_MINT, inAmount: "100000000", outputMint: MINT, outAmount,
  otherAmountThreshold: outAmount, swapMode: "ExactIn", slippageBps: 300,
  priceImpactPct: impact, routePlan: [], contextSlot: 1,
});

// ── refusals ────────────────────────────────────────────────────────────────

test("without the opt-in flag the desk stays on paper", () => {
  const made = LiveSolanaExecutor.create(ENDPOINT, {});
  assert.ok("refusal" in made);
  assert.match(made.refusal, /ENABLE_LIVE_TRADING/);
});

test("the flag alone is not enough — a signer has to load", () => {
  const made = LiveSolanaExecutor.create(ENDPOINT, { ENABLE_LIVE_TRADING: "yes-i-accept-the-risk" });
  assert.ok("refusal" in made);
  assert.match(made.refusal, /SOLANA_KEYPAIR_PATH/);
});

test("a signer without ceilings is still refused", () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, {
    ENABLE_LIVE_TRADING: "yes-i-accept-the-risk",
    SOLANA_KEYPAIR_PATH: path,
  });
  assert.ok("refusal" in made);
  assert.match(made.refusal, /ceilings/i);
});

test("with all three it builds, on the wallet it was given", () => {
  const { path, keypair } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);
  assert.equal(made.executor.publicKey, keypair.publicKey.toBase58());
});

test("a non-Solana pair is refused before any network call", async () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);
  const s = stub({});
  try {
    const out = await made.executor.buy(intent, token({ chain: "robinhood" }), 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /Solana only/);
    assert.equal(s.seen.length, 0);
  } finally {
    s.restore();
  }
});

test("price impact over budget stops before a fee is paid", async () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);
  // 0.09 -> 9%, against a 3% budget.
  const s = stub({ quote: quoteFor("1000000", "0.09") });
  try {
    const out = await made.executor.buy(intent, token(), 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /price impact/);
    assert.ok(!s.seen.includes("swap"), "no transaction was even built");
  } finally {
    s.restore();
  }
});

// ── the fill comes from the chain ───────────────────────────────────────────

const META_BUY = {
  err: null,
  fee: 105_000,
  // Spent 0.1 SOL plus the fee.
  preBalances: [1_000_000_000],
  postBalances: [899_895_000],
  preTokenBalances: [],
  postTokenBalances: [] as unknown[],
};

test("a buy is booked from what actually arrived, not from the quote", async () => {
  const { path, keypair } = keyfile();
  const owner = keypair.publicKey.toBase58();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  const s = stub({
    // The quote promises 2,000,000 base units…
    quote: quoteFor("2000000"),
    swap: {
      swapTransaction: unsignedTx(keypair),
      lastValidBlockHeight: 500,
      prioritizationFeeLamports: 100_000,
      computeUnitLimit: 1_400_000,
    },
    rpc: {
      sendTransaction: () => "SIGBUY",
      getSignatureStatuses: () => ({ value: [{ slot: 1, confirmations: 2, err: null, confirmationStatus: "confirmed" }] }),
      getTransaction: () => ({
        meta: {
          ...META_BUY,
          // …and the chain delivers 1,960,000. That 2% gap is the whole
          // reason for spending real money: it is the number the paper
          // slippage model has only ever guessed at.
          postTokenBalances: [
            { accountIndex: 3, mint: MINT, owner, uiTokenAmount: { amount: "1960000", decimals: 6 } },
          ],
        },
      }),
    },
  });
  try {
    const out = await made.executor.buy(intent, token(), 100, AGGRESSIVE);
    assert.ok(out.ok, `expected a fill, got: ${out.error}`);
    const fill = out.fill!;

    assert.equal(fill.mode, "live");
    assert.equal(fill.txRef, "SIGBUY");
    assert.equal(fill.side, "buy");
    // 1,960,000 units at six decimals — the chain's number, not the quote's.
    assert.equal(fill.quantity, 1.96);
    // 0.1 SOL out, with the 105,000 lamport fee added back and booked apart.
    assert.ok(Math.abs(fill.valueNative - 0.1) < 1e-9, `got ${fill.valueNative}`);
    assert.ok(Math.abs(fill.feeNative - 0.000105) < 1e-12, `got ${fill.feeNative}`);
    // (2,000,000 - 1,960,000) / 2,000,000 = 2%
    assert.ok(Math.abs(fill.slippagePct - 2) < 1e-9, `got ${fill.slippagePct}`);
    // $100/SOL, 0.1 SOL for 1.96 tokens.
    assert.ok(Math.abs(fill.priceUsd - 10 / 1.96) < 1e-9);
  } finally {
    s.restore();
  }
});

test("a confirmation the desk cannot read stops short of inventing a fill", async () => {
  const { path, keypair } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  const s = stub({
    quote: quoteFor("2000000"),
    swap: { swapTransaction: unsignedTx(keypair), lastValidBlockHeight: 500 },
    rpc: {
      sendTransaction: () => "SIGBLIND",
      getSignatureStatuses: () => ({ value: [{ slot: 1, confirmations: 2, err: null, confirmationStatus: "confirmed" }] }),
      // Confirmed, but the node will not hand over the transaction.
      getTransaction: () => null,
    },
  });
  try {
    const out = await made.executor.buy(intent, token(), 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /reconcile before trading again/);
  } finally {
    s.restore();
  }
});

test("a send with no confirmation carries the signature out, and books nothing", async () => {
  // The case that must never become a retry: the trade may have landed.
  const { path, keypair } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  const s = stub({
    quote: quoteFor("2000000"),
    swap: { swapTransaction: unsignedTx(keypair), lastValidBlockHeight: 500 },
    rpc: {
      sendTransaction: () => "SIGLOST",
      getSignatureStatuses: () => ({ value: [null] }),
      getBlockHeight: () => 400,
    },
  });
  try {
    const out = await made.executor.buy(intent, token(), 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /unknown/);
    assert.match(out.error ?? "", /SIGLOST/, "the signature has to reach the operator");
  } finally {
    s.restore();
  }
});

// ── sizing a sell ───────────────────────────────────────────────────────────

const position: Position = {
  id: "p1", tokenId: `solana:${MINT}`, symbol: "LIVE", chain: "solana",
  quantity: 999_999, entryPriceUsd: 0.00004, currentPriceUsd: 0.00005,
  costNative: 0.1, quote: "SOL", openedAt: Date.now(), unrealizedPnlNative: 0,
  unrealizedPnlPct: 0, stopLossPct: 25, breakevenTriggerPct: 14, breakevenBufferPct: 2,
  earlyTrailPct: 12, takeProfitLadder: [50, 150, 400], filledRungs: 0,
  peakPriceUsd: 0.00005, entryLiquidityUsd: 80_000, peakLiquidityUsd: 80_000,
  trailingStopPct: 30,
} as Position;

test("a sell the wallet cannot cover is refused, and says the book is ahead", async () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  const s = stub({ rpc: { getTokenAccountsByOwner: () => ({ value: [] }) } });
  try {
    const out = await made.executor.sell(position, token(), 1, "stop", 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /book is ahead of the chain/);
    assert.ok(!s.seen.includes("quote"), "no quote was fetched for a position we do not hold");
  } finally {
    s.restore();
  }
});

test("a partial sell is sized off the chain balance, not the book quantity", async () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  let quotedAmount: string | null = null;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/quote")) {
      quotedAmount = new URL(href).searchParams.get("amount");
      return { ok: false, status: 404 } as Response;
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
    if (body.method === "getTokenAccountsByOwner") {
      return {
        ok: true,
        json: async () => ({
          jsonrpc: "2.0", id: 1,
          result: { value: [{ pubkey: "ATA", account: { data: { parsed: { info: { tokenAmount: { amount: "500000", decimals: 6 } } } } } }] },
        }),
      } as unknown as Response;
    }
    return { ok: false, status: 501 } as Response;
  }) as typeof fetch;

  try {
    // The book claims 999,999 units. The chain says 500,000. 40% of the real
    // balance is 200,000 — anything else would be sized off a stale number.
    await made.executor.sell(position, token(), 0.4, "rung", 100, AGGRESSIVE);
    assert.equal(quotedAmount, "200000");
  } finally {
    globalThis.fetch = original;
  }
});

test("a fraction that rounds to nothing is refused rather than sent", async () => {
  const { path } = keyfile();
  const made = LiveSolanaExecutor.create(ENDPOINT, LIVE_ENV(path));
  assert.ok("executor" in made);

  const s = stub({
    rpc: {
      getTokenAccountsByOwner: () => ({
        value: [{ pubkey: "ATA", account: { data: { parsed: { info: { tokenAmount: { amount: "3", decimals: 6 } } } } } }],
      }),
    },
  });
  try {
    const out = await made.executor.sell(position, token(), 0.0000001, "dust", 100, AGGRESSIVE);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /rounds to nothing/);
  } finally {
    s.restore();
  }
});
