"use client";

import { motion } from "framer-motion";
import type { ConsensusView, Token } from "@/lib/types";
import { arrow, formatPct, formatUsdPrice } from "@/lib/util/format";

/**
 * The loudest name on the board right now. Click through to the inspector.
 */
export function Spotlight({
  tokens,
  consensus,
  onInspect,
}: {
  tokens: Token[];
  consensus: ConsensusView[];
  onInspect: (tokenId: string) => void;
}) {
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const candidates = consensus
    .filter((c) => c.verdict === "strong-buy" || c.verdict === "buy")
    .map((c) => {
      const token = byId.get(c.tokenId);
      return token ? { view: c, token } : null;
    })
    .filter((x): x is { view: ConsensusView; token: Token } => x != null)
    .sort((a, b) => Math.abs(b.token.change1h) - Math.abs(a.token.change1h));

  const top = candidates[0];
  if (!top) return null;
  const { token, view } = top;
  const up = token.change1h >= 0;

  return (
    <motion.button
      type="button"
      onClick={() => onInspect(token.id)}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="spotlight-bar flex w-full items-center gap-3 border-b px-3 py-1.5 text-left"
      style={{
        borderColor: "var(--grid-line)",
        background: "linear-gradient(90deg, rgba(3,175,88,0.12), transparent 70%)",
      }}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--pos-glow)" }}>
        spotlight
      </span>
      <span className="text-[12px] font-bold">{token.symbol}</span>
      <span className="tabular text-[11px]" style={{ color: "var(--text-secondary)" }}>
        {formatUsdPrice(token.priceUsd)}
      </span>
      <span className={`tabular text-[12px] font-bold ${up ? "glow-pos" : "glow-neg"}`} style={{ color: up ? "var(--pos-glow)" : "var(--neg-glow)" }}>
        {arrow(token.change1h)} {formatPct(token.change1h)} 1h
      </span>
      <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {view.verdict.replace("-", " ")} · score {view.score.toFixed(0)}
      </span>
      <span className="ml-auto hidden text-[9px] uppercase tracking-wider sm:inline" style={{ color: "var(--text-muted)" }}>
        click to inspect
      </span>
    </motion.button>
  );
}
