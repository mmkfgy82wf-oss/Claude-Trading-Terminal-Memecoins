import { liquidityTrend, MIN_TREND_SAMPLES } from "@/lib/market/liquidity";
import type { PricePoint } from "@/lib/types";
import type { SnapshotSource } from "./source";

/**
 * Does the pool see the rug coming?
 *
 * This is the one question the scenario bench cannot answer, because in the
 * bench the moment of the pull was placed independently of everything else —
 * by me, arbitrarily. On a recorded tape it is a measurement: find the pairs
 * that actually collapsed, look at what their pool was doing in the minutes
 * before, and compare that against every pair that did not collapse.
 *
 * The answer that matters is not "do rugs drain beforehand" — some will, by
 * chance. It is the pair of rates: how many collapses a given threshold would
 * have caught, against how many healthy pairs it would have thrown away to do
 * it. A rule that catches 90% of rugs and vetoes half the market is worse than
 * no rule, and only the second number says so.
 */

/** A price fall this deep, this fast, is not a drawdown. */
export const COLLAPSE_DROP_PCT = 70;
/** Frames the fall may be spread over — a pull can straddle a sample boundary. */
export const COLLAPSE_WINDOW_FRAMES = 2;

export interface ThresholdRow {
  /** Pool decline over the trend window, in percent, treated as the trigger. */
  thresholdPct: number;
  caught: number;
  missed: number;
  catchRatePct: number;
  falsePositives: number;
  falsePositiveRatePct: number;
}

export interface RugStudy {
  pairsSeen: number;
  pairsWithEnoughHistory: number;
  collapses: number;
  survivors: number;
  /** Pool change over the window ending just before each collapse. */
  preCollapseLiquidityPct: number[];
  /** The same statistic sampled across pairs that never collapsed. */
  survivorLiquidityPct: number[];
  rows: ThresholdRow[];
  windowMs: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * @param windowMs how far back to look before a collapse. Must match what the
 *                 live rule would use, or the study measures a rule nobody runs.
 */
export async function studyRugs(
  source: SnapshotSource,
  windowMs = 6 * 60_000,
  thresholds = [10, 15, 20, 30, 40, 60],
): Promise<RugStudy> {
  const series = new Map<string, PricePoint[]>();
  for await (const frame of source.frames()) {
    for (const token of frame.tokens) {
      if (!(token.priceUsd > 0)) continue;
      const prior = series.get(token.id) ?? [];
      prior.push({ t: frame.t, p: token.priceUsd, l: token.liquidityUsd });
      series.set(token.id, prior);
    }
  }

  const preCollapse: number[] = [];
  const survivor: number[] = [];
  let collapses = 0;
  let survivors = 0;
  let usable = 0;

  for (const points of series.values()) {
    if (points.length < MIN_TREND_SAMPLES + 2) continue;
    usable += 1;

    const at = firstCollapse(points);
    if (at == null) {
      survivors += 1;
      // One sample per surviving pair, taken at its own midpoint, so a pair
      // tracked for six hours does not outvote one tracked for twenty minutes.
      const mid = Math.floor(points.length / 2);
      const trend = liquidityTrend(points.slice(0, mid + 1), windowMs);
      if (trend) survivor.push(trend.liquidityChangePct);
      continue;
    }

    collapses += 1;
    // Everything strictly before the collapse frame: what the desk would have
    // been looking at on its last chance to act.
    const trend = liquidityTrend(points.slice(0, at), windowMs);
    if (trend) preCollapse.push(trend.liquidityChangePct);
  }

  const rows: ThresholdRow[] = thresholds.map((thresholdPct) => {
    const caught = preCollapse.filter((pct) => pct <= -thresholdPct).length;
    const falsePositives = survivor.filter((pct) => pct <= -thresholdPct).length;
    return {
      thresholdPct,
      caught,
      missed: preCollapse.length - caught,
      catchRatePct: preCollapse.length ? (caught / preCollapse.length) * 100 : 0,
      falsePositives,
      falsePositiveRatePct: survivor.length ? (falsePositives / survivor.length) * 100 : 0,
    };
  });

  return {
    pairsSeen: series.size,
    pairsWithEnoughHistory: usable,
    collapses,
    survivors,
    preCollapseLiquidityPct: preCollapse,
    survivorLiquidityPct: survivor,
    rows,
    windowMs,
  };
}

/** Index of the frame at which the price has fallen through the floor. */
export function firstCollapse(points: PricePoint[]): number | null {
  for (let i = 1; i < points.length; i++) {
    const from = points[Math.max(0, i - COLLAPSE_WINDOW_FRAMES)];
    if (!(from.p > 0)) continue;
    const dropPct = ((from.p - points[i].p) / from.p) * 100;
    if (dropPct >= COLLAPSE_DROP_PCT) return i - COLLAPSE_WINDOW_FRAMES + 1;
  }
  return null;
}

export function formatRugStudy(study: RugStudy): string {
  const minutes = Math.round(study.windowMs / 60_000);
  const lines = [
    `── Sagt der Pool den Rug voraus? ───────────────────────`,
    `Paare auf dem Tape      ${study.pairsSeen}  (${study.pairsWithEnoughHistory} mit genug Historie)`,
    `Einbrüche  ≥${COLLAPSE_DROP_PCT}%          ${study.collapses}  ·  überlebt: ${study.survivors}`,
    ``,
    `Pooländerung in den ${minutes} Minuten davor:`,
    `  vor einem Einbruch    Median ${fmt(median(study.preCollapseLiquidityPct))}   (n=${study.preCollapseLiquidityPct.length})`,
    `  bei Überlebenden      Median ${fmt(median(study.survivorLiquidityPct))}   (n=${study.survivorLiquidityPct.length})`,
    ``,
    `Schwelle   gefangen        Fehlalarm`,
    `────────   ──────────────  ──────────────`,
  ];
  for (const row of study.rows) {
    lines.push(
      `  -${String(row.thresholdPct).padStart(3)}%   ` +
        `${String(row.caught).padStart(3)}/${String(row.caught + row.missed).padEnd(3)} ${row.catchRatePct.toFixed(0).padStart(3)}%   ` +
        `${String(row.falsePositives).padStart(4)}/${String(study.survivorLiquidityPct.length).padEnd(4)} ${row.falsePositiveRatePct.toFixed(0).padStart(3)}%`,
    );
  }

  lines.push(``);
  lines.push(...verdict(study));
  return lines.join("\n");
}

/**
 * The reading, in plain words.
 *
 * Kept separate because the interesting cases are the negative ones, and a
 * single formatted sentence that says "best threshold: -60%" when that
 * threshold catches nothing would be a lie told by a sort function.
 */
function verdict(study: RugStudy): string[] {
  const n = study.preCollapseLiquidityPct.length;
  if (study.collapses === 0) {
    return ["Kein einziger Einbruch auf diesem Tape — nichts zu messen."];
  }
  if (n === 0) {
    return [
      `${study.collapses} Einbrüche, aber keiner mit genug Pool-Historie davor.`,
      `Länger aufzeichnen, oder das Fenster mit --window verkleinern.`,
    ];
  }

  const best = [...study.rows].sort(
    (a, b) => b.catchRatePct - b.falsePositiveRatePct - (a.catchRatePct - a.falsePositiveRatePct),
  )[0];
  const out: string[] = [];

  // The bar is deliberately high. A threshold that catches one rug in six is
  // arithmetically "better than nothing" and practically nothing: five of six
  // still land in full, and the desk pays the false alarms every time.
  const USEFUL_CATCH_PCT = 40;
  const USEFUL_EDGE = 25;
  const edge = best.catchRatePct - best.falsePositiveRatePct;

  if (best.catchRatePct === 0) {
    out.push(
      `Keine der Schwellen fängt auch nur einen Einbruch. Auf diesen Daten`,
      `leert sich der Pool vor einem Rug nicht — er wird bis zuletzt gefüllt.`,
    );
  } else if (best.catchRatePct < USEFUL_CATCH_PCT || edge < USEFUL_EDGE) {
    out.push(
      `Zu schwach zum Handeln. Die beste Schwelle (-${best.thresholdPct}%) fängt ${best.catchRatePct.toFixed(0)}% der`,
      `Einbrüche — ${(100 - best.catchRatePct).toFixed(0)}% treffen also weiterhin voll — bei ${best.falsePositiveRatePct.toFixed(0)}% Fehlalarmen.`,
      `Als Regel wäre das vor allem ein Weg, gesunde Positionen zu verlieren.`,
    );
  } else {
    out.push(
      `Kandidat: -${best.thresholdPct}% fängt ${best.catchRatePct.toFixed(0)}% der Einbrüche bei ${best.falsePositiveRatePct.toFixed(0)}% Fehlalarmen,`,
      `Vorsprung ${edge.toFixed(0)} Punkte. Vor dem Übernehmen gegen dasselbe Tape`,
      `backtesten — ob die Regel Geld verdient, sagt diese Tabelle nicht.`,
    );
  }

  out.push(
    ``,
    `Zur Einordnung der Fehlalarmquote: gezählt wird ein Messpunkt je`,
    `überlebendem Paar. Live wird die Regel bei jedem Tick auf jede offene`,
    `Position angewandt — die tatsächliche Auslösehäufigkeit liegt also`,
    `höher als hier. Diese Spalte ist eine Untergrenze, keine Prognose.`,
  );

  const gap = median(study.preCollapseLiquidityPct) - median(study.survivorLiquidityPct);
  if (Number.isFinite(gap) && Math.abs(gap) >= 8) {
    out.push(
      ``,
      `Nebenbefund: die Mediane liegen ${Math.abs(gap).toFixed(0)} Punkte auseinander`,
      `(${fmt(median(study.preCollapseLiquidityPct))} gegen ${fmt(median(study.survivorLiquidityPct))}). Ein Unterschied besteht also,`,
      `nur nicht dort, wo eine feste Schwelle ihn greifen könnte — er wäre`,
      `relativ zum eigenen Verlauf des Paares zu messen, nicht absolut.`,
    );
  }

  if (n < 15) {
    out.push(
      ``,
      `⚠ Nur ${n} auswertbare Einbrüche. Das reicht für eine Richtung, nicht`,
      `  für eine Schwelle. Länger aufzeichnen.`,
    );
  }
  return out;
}

const fmt = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "—");
