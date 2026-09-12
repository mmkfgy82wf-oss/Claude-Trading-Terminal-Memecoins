import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PaperWallet } from "../src/lib/trading/wallet";
import { AGGRESSIVE } from "../src/lib/trading/risk";
import type { ChainId, Fill } from "../src/lib/types";

const SOL = 180;
const ETH = 3200;
const PRICES = { solana: SOL, robinhood: ETH };
const ACTIVE: ChainId[] = ["solana", "robinhood"];
const BOOK_USD = 3_600;

const wallet = () => new PaperWallet(BOOK_USD, ACTIVE, PRICES);

const fill = (over: Partial<Fill> = {}): Fill => ({
  id: "f1",
  tokenId: "solana:P",
  symbol: "TEST",
  chain: "solana",
  side: "buy",
  quantity: 1000,
  priceUsd: 0.001,
  valueNative: 1,
  feeNative: 0.002,
  quote: "SOL",
  slippagePct: 0.5,
  reason: "t",
  at: Date.now(),
  txRef: "paper-1",
  mode: "paper",
  ...over,
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "memedesk-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("a saved book restores positions, cash and history exactly", async () => {
  const { saveBook, loadBook } = await import("../src/lib/trading/persistence");
  await withTempDir(async () => {
    const before = wallet();
    before.applyBuy(fill(), AGGRESSIVE);
    before.applyBuy(
      fill({ id: "f2", tokenId: "robinhood:Q", symbol: "RHC", chain: "robinhood", quote: "ETH", valueNative: 0.05 }),
      AGGRESSIVE,
    );
    before.applySell(
      fill({ id: "f3", side: "sell", valueNative: 1.4, realizedPnlNative: 0.35, realizedPnlUsd: 0.35 * SOL }),
      false,
    );

    await saveBook(before.serialize());
    const state = await loadBook();
    assert.ok(state, "the book was written and read back");

    const after = wallet();
    after.restore(state!);

    assert.equal(after.openPositions().length, before.openPositions().length);
    assert.equal(after.cashOn("solana"), before.cashOn("solana"));
    assert.equal(after.cashOn("robinhood"), before.cashOn("robinhood"), "the ETH treasury survives too");

    const a = after.snapshot();
    const b = before.snapshot();
    assert.equal(a.realizedPnlUsd, b.realizedPnlUsd);
    assert.equal(a.wins, b.wins);
    assert.equal(a.losses, b.losses);
    assert.ok(Math.abs(a.equityUsd - b.equityUsd) < 1e-9, "equity is identical after a restart");
  });
});

test("a restart does not become a way around the daily loss limit", async () => {
  const { saveBook, loadBook } = await import("../src/lib/trading/persistence");
  await withTempDir(async () => {
    const before = wallet();
    const size = (BOOK_USD * 0.5) / SOL;
    before.applyBuy(fill({ valueNative: size }), AGGRESSIVE);
    before.applySell(
      fill({ id: "loss", side: "sell", valueNative: 0.0001, realizedPnlNative: -size, realizedPnlUsd: -size * SOL }),
      false,
    );
    const breached = before.dailyDrawdownPct();
    assert.ok(breached > AGGRESSIVE.dailyLossLimitPct, "the limit is breached before saving");

    await saveBook(before.serialize());
    const after = wallet();
    after.restore((await loadBook())!);

    assert.ok(
      after.dailyDrawdownPct() > AGGRESSIVE.dailyLossLimitPct,
      "restarting must not hand the desk a clean slate on a limit it had already breached",
    );
  });
});

test("a corrupt or missing book starts fresh instead of crashing the desk", async () => {
  const { loadBook } = await import("../src/lib/trading/persistence");
  await withTempDir(async (dir) => {
    assert.equal(await loadBook(), null, "no file at all is not an error");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "book.json"), "{ this is not json", "utf8");
    assert.equal(await loadBook(), null, "unparseable content is not an error either");

    await writeFile(path.join(dir, "book.json"), JSON.stringify({ version: 99 }), "utf8");
    assert.equal(await loadBook(), null, "a book from a future format is refused, not half-read");
  });
});

test("the book is written atomically, leaving no partial file behind", async () => {
  const { saveBook } = await import("../src/lib/trading/persistence");
  await withTempDir(async (dir) => {
    const w = wallet();
    w.applyBuy(fill(), AGGRESSIVE);
    await saveBook(w.serialize());

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.deepEqual(files, ["book.json"], `a .tmp file was left behind: ${files.join(", ")}`);

    // And the file on disk is valid JSON, not a truncated write.
    JSON.parse(await readFile(path.join(dir, "book.json"), "utf8"));
  });
});
