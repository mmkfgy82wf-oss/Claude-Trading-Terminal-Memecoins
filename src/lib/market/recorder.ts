import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChainId, Token } from "@/lib/types";

/**
 * Tape recorder for the live feed.
 *
 * The desk's decisions are only as testable as the data behind them, and the
 * numbers that matter most for a memecoin — pool depth, order flow, FDV — are
 * not in any free historical endpoint. They exist for exactly as long as the
 * terminal is looking at them. So the terminal writes them down: one frame per
 * sampled tick, append-only, and a backtest replays that tape through the very
 * same agents.
 *
 * Off by default. `MARKET_RECORD=<path>` turns it on.
 *
 * Price history is deliberately not recorded. It is derived state — the feed
 * rebuilds it by stitching successive snapshots together, and the replay does
 * the same, so storing it would both bloat the tape and let a replay inherit a
 * history the live desk had not yet earned at that point in the run.
 */

/** A token as it goes onto the tape: everything an agent reads, nothing derived. */
export type TapeToken = Omit<Token, "history">;

export interface TapeFrame {
  /** Tape format version, so a future reader can refuse an old shape loudly. */
  v: 1;
  /** Wall-clock time of the frame. The replay clock is driven from this. */
  t: number;
  tick: number;
  /** USD price of each chain's quote asset at that moment. */
  quotes: Record<ChainId, number>;
  tokens: TapeToken[];
}

export const TAPE_VERSION = 1;

/** Strip the derived history; round nothing, because the agents read the rest. */
export function toTapeToken(token: Token): TapeToken {
  const { history: _history, ...rest } = token;
  return rest;
}

export function encodeFrame(frame: TapeFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Parse one line of tape. Returns null for blanks, malformed JSON, or a version
 * this build does not understand — a truncated last line (the process was
 * killed mid-write) must not cost you the rest of the recording.
 */
export function decodeFrame(line: string): TapeFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<TapeFrame>;
    if (parsed.v !== TAPE_VERSION) return null;
    if (!Array.isArray(parsed.tokens) || typeof parsed.t !== "number") return null;
    return parsed as TapeFrame;
  } catch {
    return null;
  }
}

export class TickRecorder {
  private queue: string[] = [];
  private writing = false;
  private lastWriteAt = 0;
  private framesWritten = 0;
  private failed: string | null = null;

  /**
   * @param path       where the tape goes
   * @param sampleMs   minimum gap between frames — ticks are cheap, disk is not
   */
  constructor(
    private readonly path: string,
    private readonly sampleMs = 15_000,
  ) {}

  get frames(): number {
    return this.framesWritten;
  }

  get error(): string | null {
    return this.failed;
  }

  /** Non-blocking: a frame is queued and flushed behind the tick, never in it. */
  capture(tick: number, tokens: Token[], quotes: Record<ChainId, number>, at = Date.now()): boolean {
    if (this.failed) return false;
    if (at - this.lastWriteAt < this.sampleMs) return false;
    this.lastWriteAt = at;
    this.queue.push(
      encodeFrame({ v: TAPE_VERSION, t: at, tick, quotes, tokens: tokens.map(toTapeToken) }),
    );
    this.framesWritten += 1;
    void this.flush();
    return true;
  }

  private async flush(): Promise<void> {
    if (this.writing || this.queue.length === 0) return;
    this.writing = true;
    const batch = this.queue.join("");
    this.queue = [];
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, batch, "utf8");
    } catch (err) {
      // Recording is an observability feature. It must never be able to stop
      // the desk trading, so a failure disables the recorder and nothing else.
      this.failed = (err as Error).message;
    } finally {
      this.writing = false;
      if (this.queue.length > 0) void this.flush();
    }
  }
}

/** Build a recorder from the environment, or nothing at all. */
export function recorderFromEnv(): TickRecorder | null {
  const path = process.env.MARKET_RECORD;
  if (!path) return null;
  const sample = Number(process.env.MARKET_RECORD_SAMPLE_MS ?? 15_000);
  return new TickRecorder(path, Math.max(1_000, Number.isFinite(sample) ? sample : 15_000));
}
