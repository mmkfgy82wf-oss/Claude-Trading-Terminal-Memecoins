import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compareFill, parseQuote, quoteUrl } from "../src/lib/live/jupiter";

/**
 * The fixture is a response that was actually fetched, kept verbatim. If
 * Jupiter changes the shape, these tests go red against the old copy — which
 * is the point: the parser must fail loudly here rather than quietly in the
 * one place where failing quietly costs money.
 */
const RAW: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "jupiter-quote.json"), "utf8"),
);

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("the real response parses into the numbers the desk needs", () => {
  const quote = parseQuote(RAW);
  assert.ok(quote, "the live payload parses");
  assert.equal(quote.inputMint, SOL);
  assert.equal(quote.outputMint, USDC);
  // Strings in the payload, bigint here: a nine-decimal token overflows a
  // double long before the position does.
  assert.equal(quote.inAmount, 10_000_000n);
  assert.equal(quote.outAmount, 967_491n);
  assert.equal(quote.otherAmountThreshold, 957_817n);
  assert.equal(quote.slippageBps, 100);
  assert.equal(quote.swapMode, "ExactIn");
  assert.equal(quote.priceImpactPct, 0, "arrives as the string \"0\"");
  assert.ok(quote.swapUsdValue && Math.abs(quote.swapUsdValue - 0.9671) < 0.001);
  assert.equal(quote.contextSlot, 447_361_067);
  assert.deepEqual(quote.route, [{ label: "Deriverse", percent: 100 }]);
});

test("the untouched response is kept for the swap call", () => {
  // The swap endpoint wants the whole quote object back. Re-serialising a
  // parsed copy would drop every field this build does not know about.
  const quote = parseQuote(RAW);
  assert.equal(quote?.raw, RAW);
});

test("the threshold is the number a worst case is sized against", () => {
  const quote = parseQuote(RAW)!;
  const worstCasePct = (Number(quote.otherAmountThreshold) / Number(quote.outAmount) - 1) * 100;
  assert.ok(worstCasePct < -0.9 && worstCasePct > -1.1, `100 bps of tolerance, got ${worstCasePct.toFixed(2)}%`);
});

test("a missing threshold means no protection, not no limit", () => {
  // Falling back to outAmount would promise a fill that cannot slip.
  const { otherAmountThreshold: _drop, ...rest } = RAW as Record<string, unknown>;
  assert.equal(parseQuote(rest)?.otherAmountThreshold, 0n);
});

test("junk is refused rather than half-parsed", () => {
  assert.equal(parseQuote(null), null);
  assert.equal(parseQuote("nope"), null);
  assert.equal(parseQuote({}), null);
  assert.equal(parseQuote({ ...(RAW as object), outAmount: "0" }), null, "a zero-out quote is not a quote");
  assert.equal(parseQuote({ ...(RAW as object), inAmount: "abc" }), null);
});

test("a quote with no route still parses, because the amounts are what matter", () => {
  const quote = parseQuote({ ...(RAW as object), routePlan: undefined });
  assert.ok(quote);
  assert.deepEqual(quote.route, []);
});

test("the request URL carries base units, never a float", () => {
  const url = quoteUrl({ inputMint: SOL, outputMint: USDC, amount: 12_345_678n, slippageBps: 250 });
  assert.match(url, /amount=12345678/);
  assert.match(url, /slippageBps=250/);
  assert.ok(!url.includes("e+"), "no exponent notation can reach the API");
});

test("a fill under its quote reads as a negative deviation", () => {
  const quote = parseQuote(RAW)!;
  // 967491 quoted, 950000 received: about 1.8% worse than promised.
  const gap = compareFill(quote, 950_000n, 0.62);
  assert.ok(gap.deviationPct < -1.7 && gap.deviationPct > -1.9, `got ${gap.deviationPct.toFixed(2)}%`);
  assert.equal(gap.modelledSlippagePct, 0.62);
  assert.equal(gap.quotedImpactPct, 0);
});

test("a fill better than its quote is not clamped away", () => {
  // It happens, and a calibration that only ever recorded losses would bias
  // the very model it exists to correct.
  const quote = parseQuote(RAW)!;
  assert.ok(compareFill(quote, 975_000n, 0.5).deviationPct > 0);
});
