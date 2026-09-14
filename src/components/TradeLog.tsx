"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { CHAINS } from "@/lib/market/chains";
import type { ClosedTrade, Fill } from "@/lib/types";
import {
  arrow,
  formatClock,
  formatCompactUsd,
  formatNative,
  formatPct,
  formatUsdPrice,
} from "@/lib/util/format";
import { EmptyState, Panel } from "./ui";

/**
 * Two views of the same history at different grain.
 *
 * TRADES is one row per completed round trip — the unit you actually judge.
 * FILLS is every individual leg, which is what you need when a trade looks
 * wrong and you want to see how it was assembled: a position exited across the
 * take-profit ladder produces several legs, and the last of them says nothing
 * about whether the trade won.
 */
export function TradeLog({
  trades,
  fills,
  className,
}: {
  trades: ClosedTrade[];
  fills: Fill[];
  className?: string;
}) {
  const [view, setView] = useState<"trades" | "fills">("trades");
  const stats = useMemo(() => summarise(trades), [trades]);

  return (
    <Panel
      title="trade log"
      accent="var(--series-4)"
      className={className}
      bodyClassName="overflow-y-auto"
      right={
        <div className="flex overflow-hidden rounded border" style={{ borderColor: "var(--grid-line)" }}>
          {(["trades", "fills"] as const).map((tab) => {
            const active = view === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setView(tab)}
                className="relative px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors"
                style={{ color: active ? "var(--surface-0)" : "var(--text-muted)" }}
              >
                {active && (
                  <motion.span
                    layoutId="tradelog-tab"
                    className="absolute inset-0"
                    style={{ background: "var(--series-4)" }}
                    transition={{ type: "spring", stiffness: 340, damping: 30 }}
                  />
                )}
                <span className="relative">{tab === "trades" ? `trades ${trades.length}` : "fills"}</span>
              </button>
            );
          })}
        </div>
      }
    >
      {view === "trades" ? (
        <>
          {trades.length > 0 && <Scoreboard stats={stats} />}
          {trades.length === 0 ? (
            <EmptyState>
              Noch kein Trade geschlossen. Eine Take-Profit-Stufe allein schließt eine Position nicht —
              hier steht erst etwas, wenn eine ganz zu ist.
            </EmptyState>
          ) : (
            <ul className="flex flex-col">
              <AnimatePresence initial={false}>
                {trades.map((trade) => (
                  <TradeRow key={trade.id} trade={trade} best={stats.largestAbs} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </>
      ) : (
        <FillRows fills={fills} />
      )}
    </Panel>
  );
}

interface Stats {
  wins: number;
  losses: number;
  winRate: number;
  grossWinUsd: number;
  grossLossUsd: number;
  /** Gross profit over gross loss — how much a winner covers a loser. */
  profitFactor: number | null;
  avgHoldMs: number;
  largestAbs: number;
}

function summarise(trades: ClosedTrade[]): Stats {
  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  const grossWinUsd = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLossUsd = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  return {
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    grossWinUsd,
    grossLossUsd,
    profitFactor: grossLossUsd > 0 ? grossWinUsd / grossLossUsd : null,
    avgHoldMs: trades.length ? trades.reduce((s, t) => s + t.holdMs, 0) / trades.length : 0,
    largestAbs: Math.max(1e-9, ...trades.map((t) => Math.abs(t.pnlNative))),
  };
}

/**
 * The header answers the question the log exists for. Hit rate alone is
 * misleading on memecoins — a desk can win two in three and still lose money —
 * so the profit factor sits beside it.
 */
function Scoreboard({ stats }: { stats: Stats }) {
  const healthy = stats.profitFactor != null && stats.profitFactor >= 1;
  return (
    <div
      className="grid grid-cols-3 gap-px border-b"
      style={{ borderColor: "var(--grid-line)", background: "var(--grid-line)" }}
    >
      <div className="px-2.5 py-2" style={{ background: "var(--surface-1)" }}>
        <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
          gewonnen / verloren
        </div>
        <div className="tabular mt-0.5 text-[13px] font-semibold">
          <span style={{ color: "var(--pos-glow)" }}>{stats.wins}</span>
          <span style={{ color: "var(--text-muted)" }}> / </span>
          <span style={{ color: "var(--neg-glow)" }}>{stats.losses}</span>
        </div>
      </div>
      <div className="px-2.5 py-2" style={{ background: "var(--surface-1)" }}>
        <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
          trefferquote
        </div>
        <div className="tabular mt-0.5 text-[13px] font-semibold">{stats.winRate.toFixed(0)}%</div>
      </div>
      <div className="px-2.5 py-2" style={{ background: "var(--surface-1)" }}>
        <div
          className="text-[9px] uppercase tracking-[0.14em]"
          style={{ color: "var(--text-muted)" }}
          title="Bruttogewinn geteilt durch Bruttoverlust. Unter 1 verliert der Desk Geld, auch bei hoher Trefferquote."
        >
          gewinnfaktor
        </div>
        <div
          className="tabular mt-0.5 text-[13px] font-semibold"
          style={{ color: stats.profitFactor == null ? "var(--text-primary)" : healthy ? "var(--pos-glow)" : "var(--neg-glow)" }}
        >
          {stats.profitFactor == null ? "—" : stats.profitFactor.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function TradeRow({ trade, best }: { trade: ClosedTrade; best: number }) {
  const won = trade.outcome === "win";
  const colour = won ? "var(--pos)" : "var(--neg)";
  const glow = won ? "var(--pos-glow)" : "var(--neg-glow)";
  // Bar length is relative to the biggest move in the log, so one glance
  // separates a scratch from the trade that actually mattered.
  const width = Math.min(100, (Math.abs(trade.pnlNative) / best) * 100);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="border-b px-2.5 py-2 last:border-b-0"
      style={{ borderColor: "rgba(30,36,51,0.55)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded px-1 text-[9px] font-bold uppercase"
          style={{ color: glow, background: won ? "rgba(3,175,88,0.14)" : "rgba(229,72,77,0.14)" }}
        >
          {won ? "win" : "loss"}
        </span>
        <span className="shrink-0 text-[11px] font-bold">{trade.symbol}</span>
        <span
          className="shrink-0 rounded px-1 text-[8px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)", border: "1px solid var(--grid-line)" }}
        >
          {CHAINS[trade.chain].tag}
        </span>
        <span className="tabular ml-auto shrink-0 text-[12px] font-bold" style={{ color: glow }}>
          {arrow(trade.pnlPct)} {formatPct(trade.pnlPct)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
          <motion.div
            className="h-full"
            style={{ background: colour, borderRadius: "0 4px 4px 0" }}
            initial={false}
            animate={{ width: `${width}%` }}
            transition={{ type: "spring", stiffness: 160, damping: 24 }}
          />
        </div>
        <span className="tabular shrink-0 text-[10px]" style={{ color: glow }}>
          {formatNative(trade.pnlNative, trade.quote)}
        </span>
      </div>

      <div className="tabular mt-1 flex flex-wrap gap-x-2.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
        <span>
          {formatUsdPrice(trade.entryPriceUsd)} → {formatUsdPrice(trade.exitPriceUsd)}
        </span>
        <span>{formatDuration(trade.holdMs)} gehalten</span>
        {trade.peakGainPct > 1 && (
          <span
            style={{ color: trade.peakGainPct - trade.pnlPct > 25 ? "var(--series-2-glow)" : "var(--text-muted)" }}
            title={`Höchststand +${trade.peakGainPct.toFixed(0)}%, Ergebnis ${trade.pnlPct.toFixed(0)}% — Rückgabe ${(trade.peakGainPct - trade.pnlPct).toFixed(0)} Punkte`}
          >
            Peak +{trade.peakGainPct.toFixed(0)}%
          </span>
        )}
        {trade.peakLiquidityUsd > 0 && trade.exitLiquidityUsd < trade.peakLiquidityUsd * 0.7 && (
          <span
            style={{ color: "var(--neg-glow)" }}
            title={`Pool von ${formatCompactUsd(trade.peakLiquidityUsd)} auf ${formatCompactUsd(trade.exitLiquidityUsd)} — die Liquidität war zuerst weg, nicht der Preis.`}
          >
            Pool −{(((trade.peakLiquidityUsd - trade.exitLiquidityUsd) / trade.peakLiquidityUsd) * 100).toFixed(0)}%
          </span>
        )}
        {trade.rungsTaken > 0 && (
          <span style={{ color: "var(--pos)" }}>
            {trade.rungsTaken} TP-Stufe{trade.rungsTaken > 1 ? "n" : ""}
          </span>
        )}
        <span>{formatClock(trade.closedAt)}</span>
      </div>
      <div className="mt-0.5 truncate text-[9px]" style={{ color: "var(--text-secondary)" }}>
        {trade.exitReason}
      </div>
    </motion.li>
  );
}

function FillRows({ fills }: { fills: Fill[] }) {
  if (fills.length === 0) return <EmptyState>Noch keine Fills.</EmptyState>;
  return (
    <ul className="flex flex-col">
      <AnimatePresence initial={false}>
        {fills.map((fill) => {
          const buy = fill.side === "buy";
          const pnl = fill.realizedPnlNative;
          return (
            <motion.li
              key={fill.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0 ${buy ? "flash-pos" : pnl != null && pnl < 0 ? "flash-neg" : ""}`}
              style={{ borderColor: "rgba(30,36,51,0.55)" }}
            >
              <span className="tabular shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>
                {formatClock(fill.at)}
              </span>
              <span
                className="shrink-0 rounded px-1 text-[9px] font-bold uppercase"
                style={{
                  color: buy ? "var(--pos-glow)" : "var(--series-2-glow)",
                  background: buy ? "rgba(3,175,88,0.14)" : "rgba(217,115,11,0.14)",
                }}
              >
                {fill.side}
              </span>
              <span className="shrink-0 text-[10px] font-semibold">{fill.symbol}</span>
              <span className="tabular shrink-0 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {fill.valueNative.toFixed(4)} {fill.quote} @ {formatUsdPrice(fill.priceUsd)}
              </span>
              <span className="tabular shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>
                slip {fill.slippagePct.toFixed(2)}%
              </span>
              <span className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                {fill.reason}
              </span>
              {pnl != null && (
                <span
                  className="tabular ml-auto shrink-0 text-[10px] font-bold"
                  style={{ color: pnl >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                >
                  {arrow(pnl)} {formatNative(pnl, fill.quote)}
                </span>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
