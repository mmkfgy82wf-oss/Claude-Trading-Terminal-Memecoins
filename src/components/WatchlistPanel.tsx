"use client";

import { useMemo, useState } from "react";
import { CHAINS } from "@/lib/market/chains";
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
type Filter = "all" | ConsensusView["verdict"];
type SortKey = "score" | "change1h" | "liq" | "age";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "strong-buy", label: "strong" },
  { id: "buy", label: "buy" },
  { id: "watch", label: "watch" },
  { id: "avoid", label: "avoid" },
  { id: "vetoed", label: "veto" },
];

export function WatchlistPanel({
  consensus,
  tokens,
  selectedId,
  onInspect,
  className,
}: {
  consensus: ConsensusView[];
  tokens: Token[];
  selectedId?: string | null;
  onInspect?: (tokenId: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const byId = useMemo(() => new Map(tokens.map((t) => [t.id, t])), [tokens]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = consensus.filter((view) => {
      const token = byId.get(view.tokenId);
      if (!token) return false;
      if (filter !== "all" && view.verdict !== filter) return false;
      if (q && !token.symbol.toLowerCase().includes(q) && !token.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const ranked = [...list];
    ranked.sort((a, b) => {
      const ta = byId.get(a.tokenId);
      const tb = byId.get(b.tokenId);
      if (!ta || !tb) return 0;
      if (sort === "score") return b.score - a.score;
      if (sort === "change1h") return tb.change1h - ta.change1h;
      if (sort === "liq") return tb.liquidityUsd - ta.liquidityUsd;
      return ta.ageMinutes - tb.ageMinutes;
    });
    return ranked;
  }, [byId, consensus, filter, query, sort]);

  const headers: { key: string; sort?: SortKey }[] = [
    { key: "token" },
    { key: "price" },
    { key: "5m" },
    { key: "1h", sort: "change1h" },
    { key: "liq", sort: "liq" },
    { key: "age", sort: "age" },
    { key: "trace" },
    { key: "consensus", sort: "score" },
    { key: "" },
  ];

  return (
    <Panel
      title="consensus board"
      accent="var(--series-1)"
      right={
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {rows.length}/{consensus.length}
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: "var(--grid-line)" }}>
        <input
          className="board-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search ⌕"
          aria-label="Filter the board by symbol"
        />
        {FILTERS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="filter-chip"
            data-on={filter === chip.id}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {consensus.length === 0 ? (
        <EmptyState>SCOUT is still building the first watchlist…</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>Nothing on the board matches that filter.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10" style={{ background: "var(--surface-1)" }}>
            <tr style={{ color: "var(--text-muted)" }}>
              {headers.map((h) => (
                <th
                  key={h.key}
                  className="border-b px-2 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ borderColor: "var(--grid-line)", cursor: h.sort ? "pointer" : undefined }}
                  onClick={h.sort ? () => setSort(h.sort!) : undefined}
                >
                  {h.key}
                  {h.sort && sort === h.sort ? " ▾" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((view) => {
              const token = byId.get(view.tokenId);
              if (!token) return null;
              const selected = selectedId === view.tokenId;
              const chain = CHAINS[view.chain];
              const hot = view.verdict === "strong-buy";

              return (
                <tr
                  key={view.tokenId}
                  className={`cursor-pointer border-b transition-colors hover:bg-[rgba(34,211,238,0.045)] ${hot ? "row-hot" : ""}`}
                  style={{
                    borderColor: "var(--grid-line)",
                    background: selected ? "rgba(34,211,238,0.08)" : undefined,
                  }}
                  onClick={() => onInspect?.(view.tokenId)}
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
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
