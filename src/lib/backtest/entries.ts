import type { ClosedTrade } from "@/lib/types";
import type { EntryObservation } from "./replay";

/**
 * Which of the things the desk can see actually separates a winner from a loser.
 *
 * Three rounds of tuning the exits have now come back null or negative on real
 * data, which is itself an answer: once a memecoin position is open there is
 * very little left to decide. Everything that matters was decided at the
 * entry — and the entry rules were written from intuition and have never been
 * checked against an outcome.
 *
 * This does not propose a rule. It reports, per observable, how winners and
 * losers differed, and how the trades in the top half of that observable did
 * against the bottom half. Reading a rule out of it is a separate act that
 * needs its own backtest, and the warning printed with the table says so —
 * because with a hundred trades and a dozen features, something will always
 * look like a signal.
 */
export interface FeatureSplit {
  name: string;
  /** Median of the feature among winning and losing trades. */
  medianWin: number;
  medianLoss: number;
  /** Mean trade return, in percent, for the low and high half of the feature. */
  lowHalfPnlPct: number;
  highHalfPnlPct: number;
  lowHalfHitPct: number;
  highHalfHitPct: number;
  n: number;
  /** highHalf − lowHalf, in percentage points of mean return. */
  spread: number;
}

export interface EntryStudy {
  matched: number;
  entries: number;
  trades: number;
  splits: FeatureSplit[];
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function studyEntries(entries: EntryObservation[], trades: ClosedTrade[]): EntryStudy {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const pairs: { entry: EntryObservation; trade: ClosedTrade }[] = [];
  for (const trade of trades) {
    const entry = byKey.get(`${trade.tokenId}@${trade.openedAt}`);
    if (entry) pairs.push({ entry, trade });
  }

  const names = [...new Set(pairs.flatMap((p) => Object.keys(p.entry.features)))];
  const splits: FeatureSplit[] = [];

  for (const name of names) {
    // A feature the desk could not read for this token is dropped rather than
    // defaulted — a zero would be a value, and an invented one at that.
    const usable = pairs.filter((p) => Number.isFinite(p.entry.features[name]));
    if (usable.length < 8) continue;

    const wins = usable.filter((p) => p.trade.pnlUsd > 0);
    const losses = usable.filter((p) => p.trade.pnlUsd <= 0);

    // Split by value, not by position.
    //
    // Slicing a sorted array in half looks equivalent and is not: where values
    // tie, the sort leaves them in input order, so the "halves" are really the
    // first and second half of the run. A feature that is constant across every
    // trade then reports whatever the chronology happened to do — on a cohort
    // where the early trades won, a flat feature scored a 70-point separation.
    // Ties belong to neither side.
    const values = usable.map((p) => p.entry.features[name]);
    const mid = median(values);
    const low = usable.filter((p) => p.entry.features[name] < mid);
    const high = usable.filter((p) => p.entry.features[name] > mid);
    if (low.length < 4 || high.length < 4) continue;

    const lowPnl = mean(low.map((p) => p.trade.pnlPct));
    const highPnl = mean(high.map((p) => p.trade.pnlPct));

    splits.push({
      name,
      medianWin: median(wins.map((p) => p.entry.features[name])),
      medianLoss: median(losses.map((p) => p.entry.features[name])),
      lowHalfPnlPct: lowPnl,
      highHalfPnlPct: highPnl,
      lowHalfHitPct: low.length ? (low.filter((p) => p.trade.pnlUsd > 0).length / low.length) * 100 : NaN,
      highHalfHitPct: high.length ? (high.filter((p) => p.trade.pnlUsd > 0).length / high.length) * 100 : NaN,
      n: usable.length,
      spread: highPnl - lowPnl,
    });
  }

  // Largest separation first — but see the warning in the formatter.
  splits.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
  return { matched: pairs.length, entries: entries.length, trades: trades.length, splits };
}

const num = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100_000) return `${(n / 1000).toFixed(0)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

export function formatEntryStudy(study: EntryStudy): string {
  const lines = [
    `── Was am Einstieg Gewinner von Verlierern trennt ──────`,
    `${study.matched} von ${study.trades} Trades konnten ihrem Einstieg zugeordnet werden.`,
    ``,
    `Merkmal          Median W    Median L   untere Hälfte   obere Hälfte   Abstand`,
    `───────────────  ──────────  ──────────  ─────────────  ─────────────  ───────`,
  ];

  for (const s of study.splits) {
    lines.push(
      `${s.name.padEnd(15)}  ` +
        `${num(s.medianWin).padStart(10)}  ` +
        `${num(s.medianLoss).padStart(10)}  ` +
        `${`${num(s.lowHalfPnlPct)}% / ${s.lowHalfHitPct.toFixed(0)}%`.padStart(13)}  ` +
        `${`${num(s.highHalfPnlPct)}% / ${s.highHalfHitPct.toFixed(0)}%`.padStart(13)}  ` +
        `${num(s.spread).padStart(7)}`,
    );
  }

  lines.push(
    ``,
    `Median W / L   = Medianwert des Merkmals bei Gewinnern und bei Verlierern.`,
    `untere / obere = Ø Rendite und Trefferquote der Trades in der unteren bzw.`,
    `                 oberen Hälfte dieses Merkmals.`,
    `Abstand        = obere minus untere, in Prozentpunkten Ø Rendite.`,
    ``,
    `⚠ Bei ${study.matched} Trades und ${study.splits.length} Merkmalen sieht immer irgendetwas nach Signal aus.`,
    `  Die Sortierung nach Abstand macht das schlimmer, nicht besser — sie zeigt`,
    `  per Konstruktion das größte Rauschen zuerst. Ein Abstand ist erst dann`,
    `  interessant, wenn er auf einem zweiten, unabhängigen Tape wieder auftaucht,`,
    `  und erst dann eine Regel, wenn ein Backtest damit Geld verdient.`,
  );
  return lines.join("\n");
}
