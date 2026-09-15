import assert from "node:assert/strict";
import { test } from "node:test";
import { haltReason, reconcile, type Reconciliation } from "../src/lib/live/reconcile";
import type { Position } from "../src/lib/types";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MINT_A = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";
const ENDPOINT = "https://rpc.test.invalid";

function position(symbol: string, mint: string, quantity: number): Position {
  return { id: symbol, tokenId: `solana:${mint}`, symbol, chain: "solana", quantity } as Position;
}

/** Answer getTokenAccountsByOwner per mint, and getBalance once. */
function stub(holdings: Record<string, { amount: string; decimals: number } | null>, lamports: number | null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    if (body.method === "getTokenAccountsByOwner") {
      const mint = (body.params[1] as { mint: string }).mint;
      const held = holdings[mint];
      const value = held
        ? [{ pubkey: "ATA", account: { data: { parsed: { info: { tokenAmount: held } } } } }]
        : [];
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { value } }) } as unknown as Response;
    }
    if (body.method === "getBalance") {
      if (lamports === null) return { ok: false, status: 500 } as Response;
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { value: lamports } }) } as unknown as Response;
    }
    return { ok: false, status: 501 } as Response;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("a book that matches the chain reports no drift", async () => {
  const restore = stub({ [MINT_A]: { amount: "1500000", decimals: 6 } }, 2_000_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [position("A", MINT_A, 1.5)], 2);
    assert.equal(out.drifts.length, 0);
    assert.equal(out.unreadable.length, 0);
    assert.ok(out.worstDriftPct < 1e-6);
  } finally {
    restore();
  }
});

test("dust is tolerated rather than reported every tick", async () => {
  // The wallet holds a hair less after a rounding step. That is normal.
  const restore = stub({ [MINT_A]: { amount: "1499250", decimals: 6 } }, 2_000_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [position("A", MINT_A, 1.5)], 2);
    assert.equal(out.drifts.length, 0, "0.05% is dust");
    assert.ok(out.worstDriftPct > 0, "but it is still measured");
  } finally {
    restore();
  }
});

test("a book claiming more than the wallet holds is the case that halts", async () => {
  const restore = stub({ [MINT_A]: { amount: "1000000", decimals: 6 } }, 2_000_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [position("A", MINT_A, 1.5)], 2);
    assert.equal(out.drifts.length, 1);
    assert.ok(Math.abs(out.drifts[0].driftPct - 33.33) < 0.01);
    assert.match(haltReason(out) ?? "", /more A than the wallet holds/);
  } finally {
    restore();
  }
});

test("a book claiming less is untidy, not dangerous, and does not halt", async () => {
  // Selling something you do have is always possible. The reverse is not.
  const restore = stub({ [MINT_A]: { amount: "3000000", decimals: 6 } }, 2_000_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [position("A", MINT_A, 1.5)], 2);
    assert.equal(out.drifts.length, 1, "still reported");
    assert.ok(out.drifts[0].driftPct < 0);
    assert.equal(haltReason(out), null, "but it stops nothing");
  } finally {
    restore();
  }
});

test("a position the chain says nothing about is unreadable, not agreed", async () => {
  const restore = stub({ [MINT_A]: null }, 2_000_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [position("A", MINT_A, 1.5)], 2);
    assert.deepEqual(out.unreadable, ["A"]);
    assert.equal(out.drifts.length, 0);
  } finally {
    restore();
  }
});

test("missing SOL is its own halt, because the exits are paid from it", async () => {
  const restore = stub({}, 500_000_000);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [], 2);
    assert.ok(out.solDriftPct > 70, `book 2 SOL against 0.5 on chain, got ${out.solDriftPct}`);
    assert.match(haltReason(out) ?? "", /more SOL than the wallet holds/);
  } finally {
    restore();
  }
});

test("an unreachable node does not fabricate a balance", async () => {
  const restore = stub({}, null);
  try {
    const out = await reconcile(ENDPOINT, OWNER, [], 2);
    assert.ok(Number.isNaN(out.solChainNative));
    assert.equal(out.solDriftPct, 0, "unknown is not the same as zero");
    assert.equal(haltReason(out), null);
  } finally {
    restore();
  }
});

test("nothing open and nothing held is a clean slate", () => {
  const empty: Reconciliation = {
    positionsChecked: 0, drifts: [], unreadable: [],
    solBookNative: 0, solChainNative: 0, solDriftPct: 0, worstDriftPct: 0,
  };
  assert.equal(haltReason(empty), null);
});
