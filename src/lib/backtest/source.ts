import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { decodeFrame, type TapeFrame } from "@/lib/market/recorder";

/**
 * Where a replay gets its market from.
 *
 * Two kinds exist, and the difference is worth keeping in the type name rather
 * than in a comment nobody reads:
 *
 *   a *tape* is what the live desk actually saw, written down as it happened;
 *   a *scenario* is a shape we constructed on purpose to test one rule.
 *
 * Only a tape is evidence about the market. A scenario is evidence about the
 * code — which is the more useful of the two when the question is "would this
 * exit rule have got us out", and worthless when the question is "does this
 * strategy make money".
 */
export type SourceKind = "tape" | "scenario";

export interface SnapshotSource {
  kind: SourceKind;
  /** Where this came from — a filename, or the scenario's name. */
  origin: string;
  frames(): AsyncIterable<TapeFrame>;
}

export interface TapeStats {
  frames: number;
  firstAt: number;
  lastAt: number;
  skipped: number;
}

/** Stream a recorded tape off disk, skipping anything unreadable. */
export function tapeSource(path: string): SnapshotSource {
  return {
    kind: "tape",
    origin: path,
    async *frames() {
      const rl = createInterface({
        input: createReadStream(path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of rl) {
          const frame = decodeFrame(line);
          if (frame) yield frame;
        }
      } finally {
        rl.close();
      }
    },
  };
}

/** Read a tape end to end just to describe it, without running a desk. */
export async function inspectTape(path: string): Promise<TapeStats> {
  const stats: TapeStats = { frames: 0, firstAt: 0, lastAt: 0, skipped: 0 };
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const frame = decodeFrame(line);
      if (!frame) {
        stats.skipped += 1;
        continue;
      }
      if (stats.frames === 0) stats.firstAt = frame.t;
      stats.lastAt = frame.t;
      stats.frames += 1;
    }
  } finally {
    rl.close();
  }
  return stats;
}

/** Wrap an in-memory frame list — how scenarios become a source. */
export function memorySource(origin: string, frames: TapeFrame[], kind: SourceKind = "scenario"): SnapshotSource {
  return {
    kind,
    origin,
    async *frames() {
      for (const frame of frames) yield frame;
    },
  };
}
