import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCoin } from "../src/lib/market/pumpfun";

/**
 * pump.fun publishes no official data API — this reads its undocumented
 * frontend endpoint, whose field names have changed before. The parser has to
 * survive that, so these pin down the tolerance rather than one exact shape.
 */

test("reads the documented-ish shape", () => {
  const mint = normalizeCoin({
    mint: "8xyzMint",
    symbol: "pepo",
    name: "Pepo the Frog",
    created_timestamp: 1_757_600_000_000,
    usd_market_cap: 34_500,
    complete: false,
  });
  assert.equal(mint?.mint, "8xyzMint");
  assert.equal(mint?.symbol, "PEPO", "tickers are normalised to upper case");
  assert.equal(mint?.graduated, false);
  assert.ok(mint!.graduationProgress! > 0.4 && mint!.graduationProgress! < 0.6, "≈half way up the curve");
});

test("accepts renamed address and ticker fields", () => {
  for (const raw of [
    { address: "A1", ticker: "wif" },
    { ca: "A1", symbol: "wif" },
    { coinMint: "A1", ticker: "wif" },
  ]) {
    const mint = normalizeCoin(raw);
    assert.equal(mint?.mint, "A1", `failed on ${JSON.stringify(raw)}`);
    assert.equal(mint?.symbol, "WIF");
  }
});

test("handles second- and millisecond timestamps alike", () => {
  const seconds = normalizeCoin({ mint: "A", created_timestamp: 1_757_600_000 });
  const millis = normalizeCoin({ mint: "A", created_timestamp: 1_757_600_000_000 });
  assert.equal(seconds?.createdAt, millis?.createdAt, "a seconds timestamp must not read as 1970");
  assert.ok(seconds!.createdAt > 1_700_000_000_000);
});

test("detects graduation however the source spells it", () => {
  assert.equal(normalizeCoin({ mint: "A", complete: true })?.graduated, true);
  assert.equal(normalizeCoin({ mint: "A", graduated: true })?.graduated, true);
  assert.equal(normalizeCoin({ mint: "A", raydium_pool: "pool123" })?.graduated, true);
  assert.equal(normalizeCoin({ mint: "A", pump_swap_pool: "pool123" })?.graduated, true);
  assert.equal(normalizeCoin({ mint: "A", complete: false })?.graduated, false);
  // A graduated token is by definition all the way up the curve.
  assert.equal(normalizeCoin({ mint: "A", complete: true })?.graduationProgress, 1);
});

test("reads curve progress whether it arrives as a fraction or a percentage", () => {
  assert.equal(normalizeCoin({ mint: "A", bonding_curve_progress: 0.75 })?.graduationProgress, 0.75);
  assert.equal(normalizeCoin({ mint: "A", bonding_curve_progress: 75 })?.graduationProgress, 0.75);
  // Never above 1, whatever the source claims.
  assert.equal(normalizeCoin({ mint: "A", bonding_curve_progress: 140 })?.graduationProgress, 1);
});

test("drops an entry with no address rather than inventing one", () => {
  assert.equal(normalizeCoin({ symbol: "GHOST", name: "no mint here" }), null);
  assert.equal(normalizeCoin({}), null);
});

test("survives junk without throwing", () => {
  // An unofficial endpoint can return anything, including nulls and wrong types.
  const mint = normalizeCoin({
    mint: "A",
    symbol: null,
    name: undefined,
    created_timestamp: "not a number",
    usd_market_cap: {},
  });
  assert.equal(mint?.mint, "A");
  assert.equal(mint?.symbol, "???", "an unreadable ticker is marked, not guessed");
  assert.equal(mint?.graduationProgress, null, "unknown progress stays unknown");
  assert.ok(mint!.createdAt > 0, "an unreadable timestamp falls back to now, not NaN");
});
