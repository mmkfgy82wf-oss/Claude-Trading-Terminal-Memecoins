import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeFrame, encodeFrame, TickRecorder, toTapeToken } from "../src/lib/market/recorder";
import { inspectTape, memorySource, tapeSource } from "../src/lib/backtest/source";
import { scenarioSource } from "../src/lib/backtest/scenarios";
import { replay } from "../src/lib/backtest/replay";
import { poolResults, summarise } from "../src/lib/backtest/report";
import type { Token } from "../src/lib/types";

function token(over: Partial<Token> = {}): Token {
  return {
    id: "solana:P1",
    chain: "solana",
    pairAddress: "P1",
    tokenAddress: "M1",
    symbol: "TAPE",
    name: "Tape",
    priceUsd: 0.000021,
    priceNative: 1.2e-7,
    liquidityUsd: 48_000,
    fdvUsd: 900_000,
    volume24hUsd: 700_000,
    volume5mUsd: 9_000,
    buys5m: 70,
    sells5m: 40,
    change5m: 6,
    change1h: 40,
    change24h: 180,
    ageMinutes: 22,
    dex: "pumpswap",
    history: [{ t: 1, p: 0.00002 }],
    simulated: false,
    ...over,
  };
}

test("the tape drops derived history and survives a round trip", () => {
  const taped = toTapeToken(token());
  assert.ok(!("history" in taped), "history is rebuilt on replay, never stored");

  const frame = { v: 1 as const, t: 1_700_000_000_000, tick: 4, quotes: { solana: 182, robinhood: 3210 }, tokens: [taped] };
  const back = decodeFrame(encodeFrame(frame));
  assert.deepEqual(back, frame);
});

test("a half-written last line costs only that line", async () => {
  // The recorder is appended to by a process that gets killed. Losing the run
  // because its final line was truncated would defeat the point of recording.
  const dir = await mkdtemp(join(tmpdir(), "tape-"));
  const path = join(dir, "run.jsonl");
  const good = encodeFrame({ v: 1, t: 1, tick: 1, quotes: { solana: 180, robinhood: 3200 }, tokens: [toTapeToken(token())] });
  await writeFile(path, `${good}${good}{"v":1,"t":3,"tok`, "utf8");

  const stats = await inspectTape(path);
  assert.equal(stats.frames, 2);
  assert.equal(stats.skipped, 1);
});

test("a tape from a future version is refused rather than misread", () => {
  assert.equal(decodeFrame('{"v":99,"t":1,"tokens":[]}'), null);
  assert.equal(decodeFrame("not json"), null);
  assert.equal(decodeFrame("   "), null);
});

test("the recorder samples rather than writing every tick", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tape-"));
  const recorder = new TickRecorder(join(dir, "r.jsonl"), 15_000);
  const t0 = 1_700_000_000_000;
  assert.equal(recorder.capture(1, [token()], { solana: 180, robinhood: 3200 }, t0), true);
  assert.equal(recorder.capture(2, [token()], { solana: 180, robinhood: 3200 }, t0 + 4_000), false);
  assert.equal(recorder.capture(3, [token()], { solana: 180, robinhood: 3200 }, t0 + 16_000), true);
  assert.equal(recorder.frames, 2);
});

test("the same tape and seed replay to the same trades, twice", async () => {
  // Without this an A/B comparison measures the random number generator.
  const source = scenarioSource({ seed: 4242, frames: 120 });
  const a = await replay(source, { seed: 99 });
  const b = await replay(source, { seed: 99 });

  assert.equal(a.trades.length, b.trades.length);
  assert.ok(a.trades.length > 0, "the bench actually trades");
  assert.deepEqual(
    a.trades.map((t) => [t.symbol, t.pnlNative.toFixed(10), t.exitReason]),
    b.trades.map((t) => [t.symbol, t.pnlNative.toFixed(10), t.exitReason]),
  );
  assert.equal(a.finalEquityUsd, b.finalEquityUsd);
});

test("a different configuration over the same tape changes the outcome", async () => {
  const source = scenarioSource({ seed: 4242, frames: 120 });
  const held = await replay(source, { seed: 99, risk: { takeProfitLadder: [500] } });
  const laddered = await replay(source, { seed: 99, risk: { takeProfitLadder: [25, 90, 300] } });
  assert.notEqual(held.finalEquityUsd, laddered.finalEquityUsd);
});

test("nothing is left open when the tape ends", async () => {
  // A configuration that ends holding three losers has not avoided them.
  const result = await replay(scenarioSource({ seed: 7, frames: 120 }), { seed: 7 });
  const stats = summarise(result);
  assert.ok(stats.trades > 0);
  assert.ok(result.equity.length > 0);
});

test("replaying restores the real clock afterwards", async () => {
  const before = Date.now();
  await replay(scenarioSource({ seed: 3, frames: 40 }), { seed: 3 });
  const after = Date.now();
  // The bench's virtual clock sits in 2026-09-13; if it leaked, `after` would
  // be wildly off from `before` and every later timestamp would be fiction.
  assert.ok(Math.abs(after - before) < 60_000, "the wall clock is back");
});

test("pooling cohorts sums the trades and keeps the worst drawdown", async () => {
  const runs = await Promise.all(
    [1, 2, 3].map((seed) => replay(scenarioSource({ seed, frames: 120 }), { seed, label: `c${seed}` })),
  );
  const pooled = poolResults("pooled", runs);
  assert.equal(pooled.trades.length, runs.reduce((s, r) => s + r.trades.length, 0));
  assert.equal(pooled.startingEquityUsd, runs.reduce((s, r) => s + r.startingEquityUsd, 0));

  const worst = Math.max(...runs.map((r) => summarise(r).maxDrawdownPct));
  assert.ok(Math.abs(summarise(pooled).maxDrawdownPct - worst) < 1e-9, "worst single run, not an average");
});

test("an empty source replays to an empty result rather than throwing", async () => {
  const result = await replay(memorySource("empty", []));
  assert.equal(result.frames, 0);
  assert.equal(result.trades.length, 0);
  const stats = summarise(result);
  assert.equal(stats.trades, 0);
  assert.equal(stats.profitFactor, 0);
});

test("a tape on disk replays like one in memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tape-"));
  const path = join(dir, "run.jsonl");
  const frames = [];
  for await (const frame of scenarioSource({ seed: 11, frames: 60 }).frames()) frames.push(frame);
  await writeFile(path, frames.map(encodeFrame).join(""), "utf8");

  const fromDisk = await replay(tapeSource(path), { seed: 5 });
  const fromMemory = await replay(memorySource(path, frames), { seed: 5 });
  assert.equal(fromDisk.frames, fromMemory.frames);
  assert.equal(fromDisk.finalEquityUsd, fromMemory.finalEquityUsd);
});

test("doing nothing is reported as its own line, so a return is read against it", async () => {
  // Over a recorded night SOL and ETH fell 3.6%, which made a flat run look
  // like a loss and a small gain look larger than it was. The hold benchmark
  // has to come from the tape's own quote prices, not from zero.
  const { memorySource } = await import("../src/lib/backtest/source");
  const frames = [];
  for await (const frame of scenarioSource({ seed: 21, frames: 40 }).frames()) frames.push(frame);

  // Same market, but the quote assets halve across the tape.
  const falling = frames.map((f, i) => ({
    ...f,
    quotes: { solana: 180 * (1 - i / (frames.length * 2)), robinhood: 3200 * (1 - i / (frames.length * 2)) },
  }));

  const flat = await replay(memorySource("flat", frames), { seed: 3 });
  const sinking = await replay(memorySource("sinking", falling), { seed: 3 });

  assert.ok(Math.abs(flat.holdReturnPct) < 0.01, `steady quotes hold flat, got ${flat.holdReturnPct}`);
  assert.ok(sinking.holdReturnPct < -30, `falling quotes must show up, got ${sinking.holdReturnPct}`);
});
