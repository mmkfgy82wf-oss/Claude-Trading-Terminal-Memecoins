import { AGGRESSIVE } from "@/lib/trading/risk";
import type { RiskConfig } from "@/lib/types";
import { tokenFeatures, type Features } from "./features";
import type { SnapshotSource } from "./source";

/**
 * What predicts the next half hour, across every pair on the tape.
 *
 * The sibling study, `entries.ts`, looks at the positions the desk actually
 * opened. On a night's tape that is ninety-odd trades, and splitting ninety
 * trades by a feature leaves forty-five a side — less statistical power than
 * the variant comparison that already came back unable to separate anything.
 *
 * This asks the same question of the whole population instead: for every pair
 * that passed the desk's own gates, at every sampled minute, what did the next
 * N minutes do? That is thousands of observations off the same file, and it
 * drops the selection distortion of only studying what the desk chose.
 *
 * The column that matters is the last one. Rugs dominate the losses, so
 * "which reading at entry precedes a collapse" is worth more than any average.
 */

/** A forward return this bad is a collapse, not a drawdown — same bar as rugs.ts. */
export const COLLAPSE_PCT = -70;

export interface SignalSplit {
  name: string;
  n: number;
  /** Mean forward return, in percent, for the low and high half of the feature. */
  lowMeanPct: number;
  highMeanPct: number;
  lowMedianPct: number;
  highMedianPct: number;
  /** Share of observations whose forward return was a collapse. */
  lowCollapsePct: number;
  highCollapsePct: number;
  spread: number;
}

export interface SignalStudy {
  horizonMs: number;
  pairs: number;
  observations: number;
  /** Observations the tape ended before the horizon could be read. */
  unresolved: number;
  /** Observations rejected because the desk would not have looked at them. */
  ineligible: number;
  baselineMeanPct: number;
  baselineCollapsePct: number;
  splits: SignalSplit[];
}

interface Obs {
  f: Features;
  fwd: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface SignalOptions {
  /** How far ahead to look. Default 30 minutes — a few times the median hold. */
  horizonMs?: number;
  /** Take an observation every Nth frame, so neighbouring rows are not near-copies. */
  everyNthFrame?: number;
  risk?: RiskConfig;
}

export async function studySignals(
  source: SnapshotSource,
  options: SignalOptions = {},
): Promise<SignalStudy> {
  const horizonMs = options.horizonMs ?? 30 * 60_000;
  const stride = Math.max(1, options.everyNthFrame ?? 4);
  const risk = options.risk ?? AGGRESSIVE;

  // Per pair: the price track, and the sampled points we want a forward return
  // for. Features are kept only for sampled points — storing them for every
  // frame of a long tape is a lot of numbers for no gain.
  const track = new Map<string, { t: number[]; p: number[] }>();
  const sampled: { id: string; t: number; f: Features }[] = [];
  let ineligible = 0;
  let frameIndex = 0;

  for await (const frame of source.frames()) {
    const sample = frameIndex % stride === 0;
    frameIndex += 1;

    for (const token of frame.tokens) {
      if (!(token.priceUsd > 0)) continue;
      let series = track.get(token.id);
      if (!series) {
        series = { t: [], p: [] };
        track.set(token.id, series);
      }
      series.t.push(frame.t);
      series.p.push(token.priceUsd);

      if (!sample) continue;
      // Only pairs the desk would have considered. Without this the study is
      // dominated by dust the desk filters out long before it ever decides.
      if (
        token.liquidityUsd < risk.minLiquidityUsd ||
        token.volume24hUsd < risk.minVolume24hUsd ||
        token.ageMinutes > risk.maxPairAgeMinutes
      ) {
        ineligible += 1;
        continue;
      }
      sampled.push({ id: token.id, t: frame.t, f: tokenFeatures(token) });
    }
  }

  const obs: Obs[] = [];
  let unresolved = 0;
  for (const point of sampled) {
    const series = track.get(point.id);
    if (!series) continue;
    const i = indexAt(series.t, point.t);
    const j = indexAt(series.t, point.t + horizonMs);
    // The tape has to actually reach the horizon. A pair that simply stops
    // being tracked tells us nothing we can read as a return.
    if (i < 0 || j < 0 || series.t[j] < point.t + horizonMs * 0.8) {
      unresolved += 1;
      continue;
    }
    const from = series.p[i];
    if (!(from > 0)) continue;
    obs.push({ f: point.f, fwd: (series.p[j] / from - 1) * 100 });
  }

  const names = [...new Set(obs.flatMap((o) => Object.keys(o.f)))];
  const splits: SignalSplit[] = [];
  for (const name of names) {
    const usable = obs.filter((o) => Number.isFinite(o.f[name]));
    if (usable.length < 40) continue;

    // Split by value, never by position: tied values keep their input order
    // under a sort, which on a time-ordered tape turns any flat feature into a
    // reading of the clock.
    const mid = median(usable.map((o) => o.f[name]));
    const low = usable.filter((o) => o.f[name] < mid);
    const high = usable.filter((o) => o.f[name] > mid);
    if (low.length < 20 || high.length < 20) continue;

    const lowMean = mean(low.map((o) => o.fwd));
    const highMean = mean(high.map((o) => o.fwd));
    splits.push({
      name,
      n: usable.length,
      lowMeanPct: lowMean,
      highMeanPct: highMean,
      lowMedianPct: median(low.map((o) => o.fwd)),
      highMedianPct: median(high.map((o) => o.fwd)),
      lowCollapsePct: (low.filter((o) => o.fwd <= COLLAPSE_PCT).length / low.length) * 100,
      highCollapsePct: (high.filter((o) => o.fwd <= COLLAPSE_PCT).length / high.length) * 100,
      spread: highMean - lowMean,
    });
  }

  splits.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
  return {
    horizonMs,
    pairs: track.size,
    observations: obs.length,
    unresolved,
    ineligible,
    baselineMeanPct: mean(obs.map((o) => o.fwd)),
    baselineCollapsePct: obs.length
      ? (obs.filter((o) => o.fwd <= COLLAPSE_PCT).length / obs.length) * 100
      : NaN,
    splits,
  };
}

/** Index of the last sample at or before `t`, or -1. Times are ascending. */
export function indexAt(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

const num = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100_000) return `${(n / 1000).toFixed(0)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

export function formatSignalStudy(study: SignalStudy): string {
  const minutes = Math.round(study.horizonMs / 60_000);
  const lines = [
    `── Was die nächsten ${minutes} Minuten vorhersagt ──────────────`,
    `${study.observations} Messpunkte aus ${study.pairs} Paaren.`,
    `(${study.ineligible} außerhalb der Filter des Desks, ${study.unresolved} ohne Kurs am Horizont)`,
    ``,
    `Basis über alle: Ø ${num(study.baselineMeanPct)}% · Einbruchquote ${num(study.baselineCollapsePct)}%`,
    ``,
    `Merkmal          untere Hälfte      obere Hälfte    Abstand   Einbruch u→o`,
    `───────────────  ────────────────  ────────────────  ───────  ────────────`,
  ];

  for (const s of study.splits) {
    lines.push(
      `${s.name.padEnd(15)}  ` +
        `${`${num(s.lowMeanPct)}% / ${num(s.lowMedianPct)}%`.padStart(16)}  ` +
        `${`${num(s.highMeanPct)}% / ${num(s.highMedianPct)}%`.padStart(16)}  ` +
        `${num(s.spread).padStart(7)}  ` +
        `${`${num(s.lowCollapsePct)}% → ${num(s.highCollapsePct)}%`.padStart(12)}`,
    );
  }

  lines.push(
    ``,
    `Je Hälfte: Ø Rendite / Median über ${minutes} Minuten. Der Median ist der`,
    `ehrlichere der beiden — ein einzelner Runner hebt jeden Durchschnitt.`,
    `Einbruch = Anteil der Messpunkte, die in diesen ${minutes} Minuten 70 % oder`,
    `mehr verloren haben. Das ist die Spalte, an der eine Einstiegsregel hängt.`,
    ``,
    `⚠ Messpunkte desselben Paares sind nicht unabhängig — ein Paar, das lange`,
    `  genug lebt, liefert mehrere. Die Zeilenzahl ist also größer als die Menge`,
    `  echter Information. Ein Abstand zählt erst, wenn er auf einem zweiten,`,
    `  unabhängigen Tape wieder auftaucht.`,
  );
  return lines.join("\n");
}
