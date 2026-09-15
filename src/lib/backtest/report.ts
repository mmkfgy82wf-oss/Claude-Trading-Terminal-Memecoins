import type { ClosedTrade } from "@/lib/types";
import type { ReplayResult } from "./replay";

/**
 * What a replay is worth knowing for.
 *
 * Hit rate and profit factor are the headline, but they hide the thing that
 * actually decided the live runs: a handful of positions that went to nearly
 * zero. So the tally also carries the tail — how many trades lost more than
 * half, what share of all losses the single worst one was, and how much of the
 * peak each winner gave back. A change that lifts profit factor by clipping
 * winners early is a different animal from one that removes a rug, and these
 * two rows are what tells them apart.
 */
export interface ReplayStats {
  trades: number;
  wins: number;
  losses: number;
  hitRatePct: number;
  grossWinUsd: number;
  grossLossUsd: number;
  netUsd: number;
  profitFactor: number;
  avgWinUsd: number;
  avgLossUsd: number;
  /** Average win over average loss — what the hit rate has to pay for. */
  payoffRatio: number;
  /** Payoff the current hit rate needs just to break even. */
  requiredPayoff: number;
  /** Trades that lost more than half their cost basis. */
  blowups: number;
  blowupLossUsd: number;
  /** Share of gross loss contributed by the single worst trade, in percent. */
  worstTradeSharePct: number;
  worstTradePct: number;
  bestTradePct: number;
  /** Mean (peak gain − realised gain) across winners: what the exits left behind. */
  avgGivebackPct: number;
  maxDrawdownPct: number;
  medianHoldMs: number;
  returnPct: number;
}

/**
 * Pool several independent replays into one result.
 *
 * A single two-hour cohort produces eight or nine trades, which is not enough
 * to tell two configurations apart — the comparison is mostly reading the seed.
 * Running the same configuration over many independently generated cohorts and
 * pooling the trades is the cheap fix: same rules, more draws.
 *
 * Equity is summed rather than compounded, because the runs are parallel
 * universes, not a sequence. Drawdown is the worst any single run suffered,
 * since that is the one an operator would have had to sit through.
 */
export function poolResults(label: string, runs: ReplayResult[]): ReplayResult {
  if (runs.length === 0) throw new Error("nothing to pool");
  const first = runs[0];
  const rejections = new Map<string, number>();
  for (const run of runs) {
    for (const [why, n] of run.rejections) rejections.set(why, (rejections.get(why) ?? 0) + n);
  }
  return {
    ...first,
    label,
    origin: `${first.origin} x${runs.length}`,
    frames: runs.reduce((s, r) => s + r.frames, 0),
    spanMs: Math.max(...runs.map((r) => r.spanMs)),
    trades: runs.flatMap((r) => r.trades),
    // Kept per-run so max drawdown stays the worst single experience rather
    // than an average that no operator ever lived through.
    equity: [],
    pooledDrawdownPct: Math.max(...runs.map((r) => maxDrawdownPct(r))),
    holdReturnPct: mean(runs.map((r) => r.holdReturnPct)),
    startingEquityUsd: runs.reduce((s, r) => s + r.startingEquityUsd, 0),
    finalEquityUsd: runs.reduce((s, r) => s + r.finalEquityUsd, 0),
    forcedExits: runs.reduce((s, r) => s + r.forcedExits, 0),
    rejections,
  };
}

export function summarise(result: ReplayResult): ReplayStats {
  const trades = result.trades;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);

  const grossWinUsd = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLossUsd = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const hitRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length ? grossWinUsd / wins.length : 0;
  const avgLoss = losses.length ? grossLossUsd / losses.length : 0;

  const blowups = losses.filter((t) => t.pnlPct <= -50);
  const worstTrade = losses.reduce<ClosedTrade | null>(
    (worst, t) => (worst === null || t.pnlUsd < worst.pnlUsd ? t : worst),
    null,
  );

  const givebacks = wins.map((t) => Math.max(0, t.peakGainPct - t.pnlPct));
  const holds = trades.map((t) => t.holdMs).sort((a, b) => a - b);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    hitRatePct: hitRate,
    grossWinUsd,
    grossLossUsd,
    netUsd: grossWinUsd - grossLossUsd,
    profitFactor: grossLossUsd > 0 ? grossWinUsd / grossLossUsd : grossWinUsd > 0 ? Infinity : 0,
    avgWinUsd: avgWin,
    avgLossUsd: avgLoss,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    requiredPayoff: hitRate > 0 && hitRate < 100 ? (100 - hitRate) / hitRate : 0,
    blowups: blowups.length,
    blowupLossUsd: Math.abs(blowups.reduce((s, t) => s + t.pnlUsd, 0)),
    worstTradeSharePct:
      grossLossUsd > 0 && worstTrade ? (Math.abs(worstTrade.pnlUsd) / grossLossUsd) * 100 : 0,
    worstTradePct: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
    bestTradePct: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    avgGivebackPct: givebacks.length ? givebacks.reduce((a, b) => a + b, 0) / givebacks.length : 0,
    maxDrawdownPct: result.pooledDrawdownPct ?? maxDrawdownPct(result),
    medianHoldMs: holds.length ? holds[Math.floor(holds.length / 2)] : 0,
    returnPct:
      result.startingEquityUsd > 0
        ? ((result.finalEquityUsd - result.startingEquityUsd) / result.startingEquityUsd) * 100
        : 0,
  };
}

function maxDrawdownPct(result: ReplayResult): number {
  let peak = result.startingEquityUsd || result.equity[0]?.usd || 0;
  let worst = 0;
  for (const point of result.equity) {
    if (point.usd > peak) peak = point.usd;
    if (peak > 0) worst = Math.max(worst, ((peak - point.usd) / peak) * 100);
  }
  return worst;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const ratio = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "∞");

export function formatReport(result: ReplayResult, stats = summarise(result)): string {
  const hours = result.spanMs / 3_600_000;
  const lines = [
    `── ${result.label} ${"─".repeat(Math.max(0, 54 - result.label.length))}`,
    `source      ${result.kind} · ${result.origin}`,
    `span        ${result.frames} frames over ${hours.toFixed(1)}h`,
    `equity      ${usd(result.startingEquityUsd)} → ${usd(result.finalEquityUsd)}  (${pct(stats.returnPct)})`,
    `vs. halten  ${pct(result.holdReturnPct)} vom Nichtstun  ·  Vorsprung ${pct(stats.returnPct - result.holdReturnPct)}`,
    `drawdown    ${stats.maxDrawdownPct.toFixed(1)}% max`,
    ``,
    `trades      ${stats.trades}  ·  ${stats.wins}W / ${stats.losses}L  ·  hit ${stats.hitRatePct.toFixed(0)}%`,
    `profit f.   ${ratio(stats.profitFactor)}   (net ${usd(stats.netUsd)})`,
    `payoff      ${ratio(stats.payoffRatio)}x   needs ${ratio(stats.requiredPayoff)}x at this hit rate`,
    `avg         win ${usd(stats.avgWinUsd)} · loss ${usd(stats.avgLossUsd)}`,
    ``,
    `blowups     ${stats.blowups} trade(s) worse than -50%  ·  ${usd(stats.blowupLossUsd)} of ${usd(stats.grossLossUsd)} gross loss`,
    `worst trade ${stats.worstTradePct.toFixed(1)}%  (${stats.worstTradeSharePct.toFixed(0)}% of all losses)`,
    `best trade  ${pct(stats.bestTradePct)}`,
    `giveback    ${stats.avgGivebackPct.toFixed(1)}pp mean peak-to-exit on winners`,
    `median hold ${(stats.medianHoldMs / 60_000).toFixed(1)}m`,
  ];
  if (result.forcedExits > 0) {
    lines.push(``, `note        ${result.forcedExits} position(s) closed at end of tape`);
  }
  if (result.rejections.size > 0) {
    const top = [...result.rejections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    lines.push(`rejected    ${top.map(([why, n]) => `${n}x ${why}`).join(" · ")}`);
  }
  return lines.join("\n");
}

/** Side-by-side of a baseline against one or more candidates. */
export function formatComparison(results: ReplayResult[]): string {
  if (results.length === 0) return "(nothing to compare)";
  const rows = results.map((r) => ({ r, s: summarise(r) }));
  const base = rows[0];

  const head = ["metric", ...rows.map((x) => x.r.label)];
  const table: string[][] = [
    head,
    ["return", ...rows.map((x) => pct(x.s.returnPct))],
    ["vs. halten", ...rows.map((x) => pct(x.s.returnPct - x.r.holdReturnPct))],
    ["net P/L", ...rows.map((x) => usd(x.s.netUsd))],
    ["trades", ...rows.map((x) => `${x.s.trades} (${x.s.wins}W/${x.s.losses}L)`)],
    ["hit rate", ...rows.map((x) => `${x.s.hitRatePct.toFixed(0)}%`)],
    ["profit factor", ...rows.map((x) => ratio(x.s.profitFactor))],
    ["payoff", ...rows.map((x) => `${ratio(x.s.payoffRatio)}x / ${ratio(x.s.requiredPayoff)}x`)],
    ["blowups <-50%", ...rows.map((x) => String(x.s.blowups))],
    ["worst trade", ...rows.map((x) => `${x.s.worstTradePct.toFixed(0)}%`)],
    ["giveback", ...rows.map((x) => `${x.s.avgGivebackPct.toFixed(0)}pp`)],
    ["max drawdown", ...rows.map((x) => `${x.s.maxDrawdownPct.toFixed(1)}%`)],
  ];

  const widths = head.map((_, col) => Math.max(...table.map((row) => row[col].length)));
  const render = (row: string[]) =>
    row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");

  const out = [render(table[0]), widths.map((w) => "─".repeat(w)).join("  "), ...table.slice(1).map(render)];

  // A comparison without this line invites reading noise as a result.
  const n = Math.min(...rows.map((x) => x.s.trades));
  out.push(
    ``,
    n < 30
      ? `⚠ ${n} trades in the smallest run — far too few to separate these. Treat every row above as a direction, not a measurement.`
      : `${n} trades in the smallest run.`,
  );
  if (base.r.kind === "scenario") {
    out.push(
      `⚠ Scenario data. This says what the rules do to a shape we built on purpose — not what they earn in the market.`,
    );
  }
  return out.join("\n");
}
