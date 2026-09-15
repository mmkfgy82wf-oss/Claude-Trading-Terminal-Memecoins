import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadSigner } from "../src/lib/live/signer";
import { lamportDelta, tokenDelta, type RpcTransactionMeta } from "../src/lib/live/rpc";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function meta(over: Partial<RpcTransactionMeta> = {}): RpcTransactionMeta {
  return { err: null, fee: 5_000, preBalances: [], postBalances: [], ...over };
}

// ── the signer ──────────────────────────────────────────────────────────────

test("no path means no wallet, said plainly", () => {
  const load = loadSigner({});
  assert.equal(load.keypair, null);
  assert.match(load.reason ?? "", /SOLANA_KEYPAIR_PATH/);
});

test("a key inside the project is refused outright", () => {
  // One `git add -A` away from being public, and permanent once pushed.
  const load = loadSigner({ SOLANA_KEYPAIR_PATH: "./secrets/burner.json" });
  assert.equal(load.keypair, null);
  assert.match(load.reason ?? "", /absolute path outside the project/);
});

test("a solana-keygen file loads into the right public key", () => {
  const dir = mkdtempSync(join(tmpdir(), "key-"));
  const path = join(dir, "burner.json");
  const generated = Keypair.generate();
  writeFileSync(path, JSON.stringify([...generated.secretKey]), "utf8");

  const load = loadSigner({ SOLANA_KEYPAIR_PATH: path });
  assert.equal(load.reason, null);
  assert.equal(load.keypair?.publicKey.toBase58(), generated.publicKey.toBase58());
});

test("a truncated or wrong-shaped key file is refused, not padded", () => {
  const dir = mkdtempSync(join(tmpdir(), "key-"));
  const short = join(dir, "short.json");
  writeFileSync(short, JSON.stringify([1, 2, 3]), "utf8");
  assert.match(loadSigner({ SOLANA_KEYPAIR_PATH: short }).reason ?? "", /64-byte/);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify(Array.from({ length: 64 }, () => 999)), "utf8");
  assert.match(loadSigner({ SOLANA_KEYPAIR_PATH: bad }).reason ?? "", /outside 0\.\.255/);
});

test("an unreadable key file never leaks its contents into the message", () => {
  const load = loadSigner({ SOLANA_KEYPAIR_PATH: "/nonexistent/burner.json" });
  assert.equal(load.keypair, null);
  assert.ok(load.reason && !load.reason.includes("burner.json".repeat(2)));
  assert.match(load.reason, /could not be read/);
});

// ── reading what actually moved ─────────────────────────────────────────────

test("a buy reads as the token units that actually arrived", () => {
  const delta = tokenDelta(
    meta({
      preTokenBalances: [{ accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "0", decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "967123", decimals: 6 } }],
    }),
    OWNER,
    MINT,
  );
  assert.deepEqual(delta, { mint: MINT, decimals: 6, delta: 967_123n });
});

test("someone else's balance in the same transaction is not counted", () => {
  // A swap moves the counterparty's balances too. Summing the whole array
  // would book the pool's side of the trade as ours.
  const delta = tokenDelta(
    meta({
      preTokenBalances: [
        { accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "0", decimals: 6 } },
        { accountIndex: 7, mint: MINT, owner: "OtherWallet1111111111111111111111111111111", uiTokenAmount: { amount: "50000000", decimals: 6 } },
      ],
      postTokenBalances: [
        { accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "967123", decimals: 6 } },
        { accountIndex: 7, mint: MINT, owner: "OtherWallet1111111111111111111111111111111", uiTokenAmount: { amount: "49032877", decimals: 6 } },
      ],
    }),
    OWNER,
    MINT,
  );
  assert.equal(delta?.delta, 967_123n);
});

test("a sale reads as a negative delta", () => {
  const delta = tokenDelta(
    meta({
      preTokenBalances: [{ accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "967123", decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 3, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "0", decimals: 6 } }],
    }),
    OWNER,
    MINT,
  );
  assert.equal(delta?.delta, -967_123n);
});

test("a mint the wallet never touched reads as nothing, not as zero", () => {
  assert.equal(tokenDelta(meta({}), OWNER, MINT), null);
});

test("the SOL leg adds the fee back, or every sale looks short", () => {
  // Native SOL never appears in the token balance arrays. Sold 0.01 SOL and
  // paid 5000 lamports of fee: the swap itself returned the full amount.
  const delta = lamportDelta(
    meta({ fee: 5_000, preBalances: [100_000_000], postBalances: [109_995_000] }),
    0,
  );
  assert.equal(delta, 10_000_000n);
});

test("a missing account index is null rather than a silent zero", () => {
  assert.equal(lamportDelta(meta({ preBalances: [1], postBalances: [2] }), 9), null);
});
