import assert from "node:assert/strict";
import { test } from "node:test";
import { baseTokenAddress, poolAgeMinutes } from "../src/lib/market/geckoterminal";

/**
 * Robinhood Chain's dominant launchpad, Pons, has no open REST API, so fresh
 * launches there are read off the pools that appear when one becomes tradable.
 * These pin down the parsing, which is the part that breaks silently.
 */

test("strips the network prefix off a relationship id", () => {
  const evm = baseTokenAddress(
    { relationships: { base_token: { data: { id: "robinhood_0xAbC123" } } } },
    "robinhood",
  );
  assert.equal(evm, "0xAbC123");

  const sol = baseTokenAddress(
    { relationships: { base_token: { data: { id: "solana_So1111" } } } },
    "solana",
  );
  assert.equal(sol, "So1111");
});

test("leaves an address alone when it carries no prefix", () => {
  const address = baseTokenAddress(
    { relationships: { base_token: { data: { id: "0xAbC123" } } } },
    "robinhood",
  );
  assert.equal(address, "0xAbC123");
});

test("falls back to the attributes when the relationship is absent", () => {
  assert.equal(
    baseTokenAddress({ attributes: { base_token_address: "0xDeF" } }, "robinhood"),
    "0xDeF",
  );
  assert.equal(baseTokenAddress({ attributes: { token_address: "0xDeF" } }, "robinhood"), "0xDeF");
});

test("returns null rather than inventing an address", () => {
  assert.equal(baseTokenAddress({}, "robinhood"), null);
  assert.equal(baseTokenAddress({ attributes: { name: "SOMETHING / ETH" } }, "robinhood"), null);
  assert.equal(
    baseTokenAddress({ relationships: { base_token: { data: {} } } }, "robinhood"),
    null,
  );
});

test("reads the pool age, and admits when it cannot", () => {
  const created = new Date(Date.now() - 42 * 60_000).toISOString();
  const age = poolAgeMinutes({ attributes: { pool_created_at: created } });
  assert.ok(age !== null && Math.abs(age - 42) <= 1, `expected ~42 minutes, got ${age}`);

  assert.equal(poolAgeMinutes({}), null);
  assert.equal(poolAgeMinutes({ attributes: { pool_created_at: "not a date" } }), null);
});
