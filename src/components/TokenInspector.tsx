"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ROSTER } from "@/lib/agents/roster";
import { CHAINS } from "@/lib/market/chains";
import type { ConsensusView, Position, Token } from "@/lib/types";
import {
  arrow,
  formatAge,
  formatCompactUsd,
  formatNative,
  formatPct,
  formatUsdPrice,
} from "@/lib/util/format";
import { Sparkline } from "./Sparkline";
import { Pill, ScoreBar } from "./ui";

const VERDICT_TONE: Record<ConsensusView["verdict"], "pos" | "info" | "neutral" | "neg"> = {
  "strong-buy": "pos",
  buy: "pos",
  watch: "info",
  avoid: "neutral",
  vetoed: "neg",
};

/**
 * A full read of one name: tape, agents, contract. Pure presentation — it
 * cannot send an order.
 */
export function TokenInspector({
  token,
  view,
  position,
  onClose,
}: {
  token: Token | null;
  view?: ConsensusView;
  position?: Position;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const open = Boolean(token);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.tokenAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <AnimatePresence>
      {open && token && (
        <>
          <motion.div
            className="fixed inset-0 z-[54]"
            style={{ background: "rgba(5,6,10,0.55)", backdropFilter: "blur(3px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="inspector-sheet fixed inset-y-0 right-0 z-[55] flex w-full max-w-[460px] flex-col border-l"
            style={{
              background: "var(--surface-1)",
              borderColor: "var(--grid-line)",
              boxShadow: "-22px 0 70px rgba(7,164,186,0.14), -1px 0 0 rgba(34,211,238,0.4)",
            }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
          >
            <header className="panel-header shrink-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[15px] font-bold tracking-wider">{token.symbol}</h2>
                <span
                  className="rounded px-1 text-[8px] uppercase tracking-wider"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--grid-line)" }}
                >
                  {CHAINS[token.chain].tag}
                </span>
                {view && (
                  <Pill tone={VERDICT_TONE[view.verdict]} glyph={view.verdict === "strong-buy" ? "⇈" : undefined}>
                    {view.verdict.replace("-", " ")}
                  </Pill>
                )}
              </div>
              <button type="button" onClick={onClose} className="desk-btn text-[12px]" style={{ color: "var(--text-secondary)" }}>
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-3 pt-3">
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                  {token.name}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <div className="tabular text-[26px] font-bold leading-none">{formatUsdPrice(token.priceUsd)}</div>
                  <div
                    className={`tabular text-[14px] font-bold ${token.change1h >= 0 ? "glow-pos" : "glow-neg"}`}
                    style={{ color: token.change1h >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                  >
                    {arrow(token.change1h)} {formatPct(token.change1h)} 1h
                  </div>
                </div>
              </div>

              <div className="mt-2 px-1">
                <Sparkline data={token.history} width={440} height={110} positive={token.change1h >= 0} fluid />
              </div>

              <div
                className="mt-1 grid grid-cols-3 gap-px border-y"
                style={{ borderColor: "var(--grid-line)", background: "var(--grid-line)" }}
              >
                <Stat label="5m" value={`${arrow(token.change5m)} ${formatPct(token.change5m, 0)}`} hot={token.change5m} />
                <Stat label="24h" value={`${arrow(token.change24h)} ${formatPct(token.change24h, 0)}`} hot={token.change24h} />
                <Stat label="age" value={formatAge(token.ageMinutes)} />
                <Stat label="liq" value={formatCompactUsd(token.liquidityUsd)} />
                <Stat label="vol 24h" value={formatCompactUsd(token.volume24hUsd)} />
                <Stat label="fdv" value={formatCompactUsd(token.fdvUsd)} />
                <Stat label="buys 5m" value={String(token.buys5m)} />
                <Stat label="sells 5m" value={String(token.sells5m)} />
                <Stat label="dex" value={token.dex} />
              </div>

              {position && (
                <div className="border-b px-3 py-2" style={{ borderColor: "var(--grid-line)", background: "rgba(221,93,162,0.06)" }}>
                  <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                    open position
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="tabular text-[12px]">
                      {position.costNative.toFixed(4)} {position.quote} @ {formatUsdPrice(position.entryPriceUsd)}
                    </span>
                    <span
                      className="tabular text-[13px] font-bold"
                      style={{ color: position.unrealizedPnlPct >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                    >
                      {arrow(position.unrealizedPnlPct)} {formatPct(position.unrealizedPnlPct)} · {formatNative(position.unrealizedPnlNative, position.quote)}
                    </span>
                  </div>
                </div>
              )}

              {view && (
                <div className="px-3 py-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                      agent audit
                    </span>
                    <span className="tabular text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      score {view.score.toFixed(0)} · {(view.confidence * 100).toFixed(0)}% conf
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {view.signals.map((signal) => {
                      const agent = ROSTER[signal.agent];
                      return (
                        <div key={`${signal.agent}-${signal.createdAt}`} className="rounded border px-2 py-1.5" style={{ borderColor: "var(--grid-line)" }}>
                          <div className="flex items-center gap-1.5">
                            <span style={{ color: agent.color }}>{agent.glyph}</span>
                            <span className="text-[10px] font-bold tracking-wider" style={{ color: agent.color }}>
                              {agent.name}
                            </span>
                            <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                              {signal.label}
                            </span>
                            <span className="tabular ml-auto text-[10px] font-semibold" style={{ color: signal.veto ? "var(--neg-glow)" : "var(--text-primary)" }}>
                              {signal.veto ? "VETO" : signal.score.toFixed(0)}
                            </span>
                          </div>
                          <div className="mt-1">
                            <ScoreBar
                              score={signal.veto ? -100 : signal.score}
                              color={signal.veto ? "var(--neg)" : signal.score >= 0 ? agent.color : "var(--neg)"}
                            />
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {signal.reasons.map((reason, i) => (
                              <li key={i} className="text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>
                                ▸ {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <footer className="flex shrink-0 gap-2 border-t px-3 py-3" style={{ borderColor: "var(--grid-line)" }}>
              <button
                type="button"
                onClick={() => void copy()}
                className="desk-btn flex-1 rounded border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
                title={token.tokenAddress}
              >
                {copied ? "copied" : "copy contract"}
              </button>
              {token.url && (
                <a
                  href={token.url}
                  target="_blank"
                  rel="noreferrer"
                  className="desk-btn flex-1 rounded px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider"
                  style={{ background: "var(--series-1)", color: "var(--surface-0)" }}
                >
                  open chart ↗
                </a>
              )}
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value, hot }: { label: string; value: string; hot?: number }) {
  const color =
    hot == null ? "var(--text-primary)" : hot >= 0 ? "var(--pos-glow)" : "var(--neg-glow)";
  return (
    <div className="px-2.5 py-2" style={{ background: "var(--surface-1)" }}>
      <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="tabular mt-0.5 truncate text-[12px] font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
