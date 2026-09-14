/**
 * Replay a market tape (or the scenario bench) through the desk.
 *
 *   npm run backtest                       — the bench, baseline only
 *   npm run backtest -- --tape run.jsonl   — a recording from a live run
 *   npm run backtest -- --compare          — baseline against the variants below
 *
 * A tape is produced by running the terminal with MARKET_RECORD set:
 *
 *   MARKET_RECORD=./tapes/overnight.jsonl npm run dev
 */
import { inspectTape, tapeSource, type SnapshotSource } from "@/lib/backtest/source";
import { scenarioSource } from "@/lib/backtest/scenarios";
import { replay, type ReplayResult } from "@/lib/backtest/replay";
import { formatComparison, formatReport, poolResults } from "@/lib/backtest/report";
import type { RiskConfig } from "@/lib/types";

interface Variant {
  label: string;
  risk?: Partial<RiskConfig>;
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

/**
 * The variants under test.
 *
 * Each one isolates a single hypothesis about the live losses, so a result can
 * be attributed. Bundling them would tell us the bundle is better without
 * telling us which part earned it.
 */
const VARIANTS: Variant[] = [
  // The state the desk was in during the overnight run, so every row below is
  // measured against what actually lost the money rather than against itself.
  {
    label: "before",
    risk: { takeProfitLadder: [50, 150, 400], liquidityTrendExitPct: 0, maxEntryRunPct: 100_000 },
  },
  {
    label: "+early rung",
    risk: { takeProfitLadder: [25, 90, 300], liquidityTrendExitPct: 0, maxEntryRunPct: 100_000 },
  },
  {
    label: "+drain trend",
    risk: { takeProfitLadder: [50, 150, 400], liquidityTrendExitPct: 20, maxEntryRunPct: 100_000 },
  },
  {
    label: "+late filter",
    risk: { takeProfitLadder: [50, 150, 400], liquidityTrendExitPct: 0, maxEntryRunPct: 150 },
  },
  { label: "shipped", risk: {} },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tape = args.get("tape");
  const seed = Number(args.get("seed") ?? 1337);

  let source: SnapshotSource;
  if (tape) {
    const stats = await inspectTape(tape);
    if (stats.frames === 0) {
      console.error(`No readable frames in ${tape}. Was it recorded with MARKET_RECORD?`);
      process.exitCode = 1;
      return;
    }
    const hours = (stats.lastAt - stats.firstAt) / 3_600_000;
    console.log(
      `Tape ${tape}: ${stats.frames} frames over ${hours.toFixed(1)}h` +
        (stats.skipped ? ` (${stats.skipped} unreadable line(s) skipped)` : ""),
    );
    source = tapeSource(tape);
  } else {
    console.log("No --tape given, running the scenario bench.\n");
    source = scenarioSource({ seed, frames: Number(args.get("frames") ?? 240) });
  }

  let variants = args.has("compare") ? VARIANTS : [VARIANTS[0]];
  const sweep = args.get("sweep");
  if (sweep) {
    // --sweep stopLossPct=10,15,25 — one variant per value, so a single knob
    // can be answered without editing this file.
    const [key, list] = sweep.split("=");
    const values = (list ?? "").split(",").map(Number).filter(Number.isFinite);
    if (!key || values.length === 0) {
      console.error(`--sweep wants key=v1,v2,v3 (got "${sweep}")`);
      process.exitCode = 1;
      return;
    }
    variants = values.map((v) => ({ label: `${key}=${v}`, risk: { [key]: v } as Partial<RiskConfig> }));
  }

  // Cohorts only apply to the bench: a tape is the one run that happened, and
  // replaying it under a different seed would only re-roll the fill jitter.
  const cohorts = tape ? 1 : Math.max(1, Number(args.get("cohorts") ?? 12));
  if (cohorts > 1) console.log(`Pooling ${cohorts} independent cohorts per variant.\n`);

  const results: ReplayResult[] = [];
  for (const variant of variants) {
    const runs: ReplayResult[] = [];
    for (let c = 0; c < cohorts; c++) {
      const cohortSeed = seed + c * 7919;
      const cohortSource = tape
        ? source
        : scenarioSource({ seed: cohortSeed, frames: Number(args.get("frames") ?? 240) });
      runs.push(
        await replay(cohortSource, { label: variant.label, risk: variant.risk, seed: cohortSeed }),
      );
    }
    results.push(runs.length === 1 ? runs[0] : poolResults(variant.label, runs));
  }

  for (const result of results) console.log(`\n${formatReport(result)}`);
  if (results.length > 1) console.log(`\n\n${formatComparison(results)}`);
}

void main();
