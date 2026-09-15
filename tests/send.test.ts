import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { sendAndConfirm, signTransaction } from "../src/lib/live/send";
import { parseSwapBuild, estimatedFeeLamports, swapRequestBody } from "../src/lib/live/swap";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAW_SWAP: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "jupiter-swap.json"), "utf8"),
);

const ENDPOINT = "https://rpc.test.invalid";

/** A real unsigned VersionedTransaction, so signing is exercised for real. */
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

/** Answer JSON-RPC calls by method name, in order. */
function stubRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    calls.push(body.method);
    const handler = handlers[body.method];
    if (!handler) return { ok: false, status: 501 } as Response;
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: handler(body.params) }),
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const clock = () => {
  let t = 1_000;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

// ── the swap envelope ───────────────────────────────────────────────────────

test("the live swap response parses into what the sender needs", () => {
  const build = parseSwapBuild(RAW_SWAP);
  assert.ok(build);
  assert.equal(build.lastValidBlockHeight, 425_406_804);
  assert.equal(build.prioritizationFeeLamports, 99_999);
  assert.equal(build.computeUnitLimit, 1_400_000);
  // 1,514,268 microLamports per CU over 1.4M CU — Jupiter's own estimate of
  // what landing costs, twenty-one times what it actually set.
  assert.equal(build.estimatedPriorityLamports, 2_119_975);
  assert.equal(estimatedFeeLamports(build), 104_999);
});

test("a simulation failure is not a transaction worth sending", () => {
  const build = parseSwapBuild({ ...(RAW_SWAP as object), simulationError: { err: "InsufficientFunds" } });
  assert.ok(build?.simulationError, "the field survives parsing so buildSwap can refuse");
});

test("the swap body sends the untouched quote back", () => {
  const raw = { anything: "jupiter knows about", we: "do not" };
  const body = JSON.parse(
    swapRequestBody({ quote: { raw } as never, userPublicKey: "PK", prioritizationFeeLamports: 50_000 }),
  );
  assert.deepEqual(body.quoteResponse, raw);
  assert.equal(body.prioritizationFeeLamports, 50_000);
});

// ── signing ─────────────────────────────────────────────────────────────────

test("signing produces a transaction the chain would accept as signed", () => {
  const signer = Keypair.generate();
  const signed = signTransaction(unsignedTx(signer), signer);
  assert.equal(signed.signatures.length, 1);
  assert.ok(signed.signatures[0].some((b) => b !== 0), "the signature slot is filled");
});

test("a transaction that will not deserialize fails before anything is sent", async () => {
  const stub = stubRpc({});
  try {
    const out = await sendAndConfirm("not-base64-at-all", Keypair.generate(), {
      endpoint: ENDPOINT,
      lastValidBlockHeight: 1,
      ...clock(),
    });
    assert.equal(out.state, "failed");
    assert.equal(out.signature, null);
    assert.equal(stub.calls.length, 0, "nothing reached the network");
  } finally {
    stub.restore();
  }
});

// ── the three outcomes ──────────────────────────────────────────────────────

test("a confirmed transaction comes back with its meta", async () => {
  const signer = Keypair.generate();
  const meta = { err: null, fee: 5_000, preBalances: [1], postBalances: [2] };
  const stub = stubRpc({
    sendTransaction: () => "SIG123",
    getSignatureStatuses: () => ({ value: [{ slot: 1, confirmations: 3, err: null, confirmationStatus: "confirmed" }] }),
    getTransaction: () => ({ meta }),
  });
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, ...clock(),
    });
    assert.equal(out.state, "confirmed");
    assert.equal(out.signature, "SIG123");
    assert.deepEqual(out.meta, meta);
  } finally {
    stub.restore();
  }
});

test("a transaction the chain rejected is failed, with the reason", async () => {
  const signer = Keypair.generate();
  const stub = stubRpc({
    sendTransaction: () => "SIGERR",
    getSignatureStatuses: () => ({ value: [{ slot: 1, confirmations: 0, err: { InstructionError: [0, "SlippageToleranceExceeded"] } }] }),
  });
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, ...clock(),
    });
    assert.equal(out.state, "failed");
    assert.match(out.state === "failed" ? out.error : "", /SlippageToleranceExceeded/);
  } finally {
    stub.restore();
  }
});

test("an expired blockhash is the one silence that means failure", async () => {
  // No status, and the chain is past the height the transaction was built for.
  // It can never land, so retrying is safe — and only here.
  const signer = Keypair.generate();
  const stub = stubRpc({
    sendTransaction: () => "SIGGONE",
    getSignatureStatuses: () => ({ value: [null] }),
    getBlockHeight: () => 600,
  });
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, ...clock(),
    });
    assert.equal(out.state, "failed");
    assert.match(out.state === "failed" ? out.error : "", /expired/);
  } finally {
    stub.restore();
  }
});

test("silence before the blockhash expires is unknown, never failed", async () => {
  // This is the case that costs money if it is called failed: the transaction
  // may still be in flight, and retrying would buy the position twice.
  const signer = Keypair.generate();
  const stub = stubRpc({
    sendTransaction: () => "SIGWAIT",
    getSignatureStatuses: () => ({ value: [null] }),
    getBlockHeight: () => 400,
  });
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, timeoutMs: 10_000, pollMs: 2_000, ...clock(),
    });
    assert.equal(out.state, "unknown");
    assert.equal(out.signature, "SIGWAIT");
    assert.match(out.state === "unknown" ? out.error : "", /before retrying/);
  } finally {
    stub.restore();
  }
});

test("a send that timed out in transport is unknown, not failed", async () => {
  const signer = Keypair.generate();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as typeof fetch;
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, ...clock(),
    });
    assert.equal(out.state, "unknown", "the node may have accepted it before the abort");
    assert.match(out.state === "unknown" ? out.error : "", /may still have landed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("a node that names a reason is a real failure", async () => {
  const signer = Keypair.generate();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Blockhash not found" } }),
  })) as unknown as typeof fetch;
  try {
    const out = await sendAndConfirm(unsignedTx(signer), signer, {
      endpoint: ENDPOINT, lastValidBlockHeight: 500, ...clock(),
    });
    assert.equal(out.state, "failed");
    assert.match(out.state === "failed" ? out.error : "", /Blockhash not found/);
  } finally {
    globalThis.fetch = original;
  }
});
