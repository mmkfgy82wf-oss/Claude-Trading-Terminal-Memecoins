import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChainId, ClosedTrade, Fill, PricePoint, Position } from "@/lib/types";

/**
 * Keeping the book across restarts.
 *
 * Without this the desk forgets everything the moment the process stops — a
 * curiosity on a laptop, a real problem for anything left running: after a
 * restart the terminal shows a fresh book while the positions it opened are
 * still out there, with no stop-loss being evaluated for them.
 */

export interface BookState {
  version: 1;
  savedAt: string;
  startingEquityUsd: number;
  cash: Record<string, number>;
  positions: Position[];
  fills: Fill[];
  /** Optional so a book written before the trade log still loads. */
  trades?: ClosedTrade[];
  realizedPnlUsd: number;
  wins: number;
  losses: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  equityCurve: PricePoint[];
  /** Native amounts the book was funded with — the benchmark. */
  initialCash?: Record<string, number>;
  /** Equity over benchmark at the anchor. Optional for books written before it. */
  dayAnchorRatio?: number;
  dayAnchorAt: number;
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

const bookPath = () => path.join(dataDir(), "book.json");

/**
 * Atomic write: a crash during `writeFile` leaves a truncated file, and a
 * truncated book is worse than no book. Write beside it, then rename — rename
 * is atomic on every filesystem this runs on.
 */
export async function saveBook(state: BookState): Promise<void> {
  const target = bookPath();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, target);
}

/** Returns null when there is nothing to restore, or the file is unusable. */
export async function loadBook(): Promise<BookState | null> {
  try {
    const raw = await readFile(bookPath(), "utf8");
    const parsed = JSON.parse(raw) as BookState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.positions)) return null;
    return parsed;
  } catch {
    // Missing, unreadable or corrupt — start fresh rather than crash the desk.
    return null;
  }
}

/** Chain ids the restored cash map actually carries. */
export function restoredChains(state: BookState): ChainId[] {
  return Object.keys(state.cash) as ChainId[];
}
