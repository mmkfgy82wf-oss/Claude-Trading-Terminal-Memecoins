/**
 * Replay a market tape (or the scenario bench) through the desk.
 *
 *   npm run backtest                       — the bench, baseline only
 *   npm run backtest -- --tape run.jsonl   — a recording from a live run
 *   npm run backtest -- --compare          — baseline against the variants below
 *   npm run backtest -- --tape run.jsonl --rugs      — does the pool predict the rug?
 *   npm run backtest -- --tape run.jsonl --entries   — what separated the trades it took
 *   npm run backtest -- --tape run.jsonl --signals   — …and every pair it could have taken
 *
 * A tape is produced by running the terminal with MARKET_RECORD set:
 *
 *   MARKET_RECORD=./tapes/overnight.jsonl npm run dev
 */
import { inspectTape, tapeSource, type SnapshotSource } from "@/lib/backtest/source";
import { scenarioSource } from "@/lib/backtest/scenarios";
import { formatRugStudy, studyRugs } from "@/lib/backtest/rugs";
import { formatEntryStudy, studyEntries } from "@/lib/backtest/entries";
import { formatSignalStudy, studySignals } from "@/lib/backtest/signals";
import { replay, type EntryObservation, type ReplayResult } from "@/lib/backtest/replay";
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
  // The shipped default, and on 13.9h of recorded market the only variant that
  // finished green. Everything below is measured against it.
  { label: "baseline", risk: {} },

  // The early rung, retried now that the trail handover no longer moves with
  // it. Its first run conflated two changes; this one isolates the ladder.
  { label: "early rung", risk: { takeProfitLadder: [25, 90, 300] } },

  // On the bench this was the worst variant by a distance. On the tape it came
  // second and had the lowest drawdown of all five, which is the clearest
  // single demonstration that the bench's mix was not the market's.
  { label: "late 150", risk: { maxEntryRunPct: 150 } },
  { label: "late 300", risk: { maxEntryRunPct: 300 } },

  // What the rug study nominated: the threshold with the widest gap between
  // collapses caught and healthy pairs thrown away.
  { label: "drain -15", risk: { liquidityTrendExitPct: 15 } },
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

  // The rug study is an analysis of the data, not a run of the desk, so it
  // short-circuits everything below it.
  if (args.has("rugs")) {
    if (!tape) {
      console.error("--rugs needs a real tape: the bench places its rugs arbitrarily, so studying them would only measure my own assumption.");
      process.exitCode = 1;
      return;
    }
    const minutes = Number(args.get("window") ?? 6);
    console.log(`\n${formatRugStudy(await studyRugs(source, minutes * 60_000))}`);
    return;
  }

  if (args.has("signals")) {
    if (!tape) {
      console.error("--signals needs a real tape.");
      process.exitCode = 1;
      return;
    }
    const horizon = Number(args.get("horizon") ?? 30);
    console.log(`\n${formatSignalStudy(await studySignals(source, { horizonMs: horizon * 60_000 }))}`);
    return;
  }

  if (args.has("entries")) {
    const entries: EntryObservation[] = [];
    const result = await replay(source, { label: "baseline", seed, onEntry: (e) => entries.push(e) });
    console.log(`\n${formatEntryStudy(studyEntries(entries, result.trades))}`);
    return;
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
