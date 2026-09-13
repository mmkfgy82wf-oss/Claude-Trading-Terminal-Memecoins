"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CHAINS } from "@/lib/market/chains";
import { ROSTER } from "@/lib/agents/roster";
import type { ConsensusView, Token } from "@/lib/types";
import {
  arrow,
  formatAge,
  formatCompactUsd,
  formatPct,
  formatUsdPrice,
} from "@/lib/util/format";
import { Sparkline } from "./Sparkline";
import { EmptyState, Panel, Pill, ScoreBar } from "./ui";

const VERDICT_TONE: Record<ConsensusView["verdict"], "pos" | "info" | "neutral" | "neg"> = {
  "strong-buy": "pos",
  buy: "pos",
  watch: "info",
  avoid: "neutral",
  vetoed: "neg",
};

const VERDICT_GLYPH: Record<ConsensusView["verdict"], string> = {
  "strong-buy": "⇈",
  buy: "↑",
  watch: "◎",
  avoid: "↓",
  vetoed: "⛔",
};

/**
 * The consensus board: what the desk is looking at and what each agent said.
 *
 * A row expands into the full audit trail — every agent's score, label and
 * stated reasons — because an autonomous desk is only trustworthy if you can
 * see why it wanted something.
 */
export function WatchlistPanel({
  consensus,
  tokens,
  className,
}: {
  consensus: ConsensusView[];
  tokens: Token[];
  className?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byId = new Map(tokens.map((t) => [t.id, t]));

  return (
    <Panel
      title="consensus board"
      accent="var(--series-1)"
      right={
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {consensus.length} tracked
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      {consensus.length === 0 ? (
        <EmptyState>SCOUT is still building the first watchlist…</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10" style={{ background: "var(--surface-1)" }}>
            <tr style={{ color: "var(--text-muted)" }}>
              {["token", "price", "5m", "1h", "liq", "age", "trace", "consensus", ""].map((h) => (
                <th
                  key={h}
                  className="border-b px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ borderColor: "var(--grid-line)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {consensus.map((view) => {
              const token = byId.get(view.tokenId);
              if (!token) return null;
              const open = expanded === view.tokenId;
              const chain = CHAINS[view.chain];

              return (
                <motion.tr
                  key={view.tokenId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="cursor-pointer border-b transition-colors hover:bg-[rgba(34,211,238,0.045)]"
                  style={{ borderColor: "var(--grid-line)" }}
                  onClick={() => setExpanded(open ? null : view.tokenId)}
                >
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{token.symbol}</span>
                      <span
                        className="rounded px-1 text-[8px] uppercase tracking-wider"
                        style={{ color: "var(--text-muted)", border: "1px solid var(--grid-line)" }}
                        title={chain.label}
                      >
                        {chain.tag}
                      </span>
                      {token.simulated && (
                        <span className="text-[8px] uppercase" style={{ color: "var(--warn)" }} title="simulated pair">
                          sim
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="tabular px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>
                    {formatUsdPrice(token.priceUsd)}
                  </td>
                  <td
                    className="tabular px-2 py-1.5"
                    style={{ color: token.change5m >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                  >
                    {arrow(token.change5m)} {formatPct(token.change5m, 0)}
                  </td>
                  <td
                    className="tabular px-2 py-1.5"
                    style={{ color: token.change1h >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                  >
                    {arrow(token.change1h)} {formatPct(token.change1h, 0)}
                  </td>
                  <td className="tabular px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>
                    {formatCompactUsd(token.liquidityUsd)}
                  </td>
                  <td className="tabular px-2 py-1.5" style={{ color: "var(--text-muted)" }}>
                    {formatAge(token.ageMinutes)}
                  </td>
                  <td className="px-2 py-1">
                    <Sparkline data={token.history} positive={token.change1h >= 0} />
                  </td>
                  <td className="px-2 py-1.5" style={{ minWidth: 120 }}>
                    <div className="flex items-center gap-2">
                      <div className="w-20">
                        <ScoreBar
                          score={view.score}
                          color={view.verdict === "vetoed" ? "var(--neg)" : view.score >= 55 ? "var(--pos)" : "var(--series-3)"}
                        />
                      </div>
                      <span className="tabular w-8 text-right text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        {view.score.toFixed(0)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Pill tone={VERDICT_TONE[view.verdict]} glyph={VERDICT_GLYPH[view.verdict]}>
                      {view.verdict.replace("-", " ")}
                    </Pill>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            key={expanded}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t"
            style={{ borderColor: "var(--grid-line)", background: "var(--surface-2)" }}
          >
            <AuditTrail view={consensus.find((c) => c.tokenId === expanded)} />
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

function AuditTrail({ view }: { view?: ConsensusView }) {
  if (!view) return null;
  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
        audit trail · {view.symbol} · confidence {(view.confidence * 100).toFixed(0)}%
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {view.signals.map((signal) => {
          const agent = ROSTER[signal.agent];
          return (
            <div
              key={`${signal.agent}-${signal.createdAt}`}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--grid-line)", background: "var(--surface-1)" }}
            >
              <div className="flex items-center gap-1.5">
                <span style={{ color: agent.color }} aria-hidden>
                  {agent.glyph}
                </span>
                <span className="text-[10px] font-bold tracking-wider" style={{ color: agent.color }}>
                  {agent.name}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {signal.label}
                </span>
                <span
                  className="tabular ml-auto text-[10px] font-semibold"
                  style={{ color: signal.veto ? "var(--neg-glow)" : "var(--text-primary)" }}
                >
                  {signal.veto ? "VETO" : signal.score.toFixed(0)}
                </span>
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
  );
}
