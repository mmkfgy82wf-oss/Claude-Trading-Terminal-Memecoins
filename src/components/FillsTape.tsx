"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Fill } from "@/lib/types";
import { arrow, formatClock, formatNative, formatUsdPrice } from "@/lib/util/format";
import { EmptyState, Panel } from "./ui";

/** Execution tape: what actually got filled, at what price, for what reason. */
export function FillsTape({ fills, className }: { fills: Fill[]; className?: string }) {
  return (
    <Panel title="execution tape" accent="var(--series-1)" bodyClassName="overflow-y-auto" className={className}>
      {fills.length === 0 ? (
        <EmptyState>No fills yet.</EmptyState>
      ) : (
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
      )}
    </Panel>
  );
}
