"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Position } from "@/lib/types";
import { CHAINS } from "@/lib/market/chains";
import { arrow, formatNative, formatPct, formatUsdPrice, relativeTime } from "@/lib/util/format";
import { EmptyState, Panel } from "./ui";

/**
 * Open positions, with the exit plan made visible: where the stop sits, which
 * take-profit rungs are already taken, and how far the trailing stop is.
 */
export function PositionsPanel({
  positions,
  onClose,
  className,
}: {
  positions: Position[];
  onClose: (positionId: string) => void;
  className?: string;
}) {
  return (
    <Panel
      title="open positions"
      accent="var(--series-5)"
      right={
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {positions.length} live
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      {positions.length === 0 ? (
        <EmptyState>Flat. The desk opens risk as soon as consensus clears the threshold.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {positions.map((position) => {
              const up = position.unrealizedPnlPct >= 0;
              const peakGain = ((position.peakPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
              const ladderArmed = peakGain >= (position.takeProfitLadder[0] ?? Infinity);
              // Distance from here to the stop, as a share of the full stop band.
              const stopProgress = Math.min(100, Math.max(0, (-position.unrealizedPnlPct / position.stopLossPct) * 100));

              return (
                <motion.li
                  key={position.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-b px-3 py-2 last:border-b-0"
                  style={{ borderColor: "var(--grid-line)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold">{position.symbol}</span>
                    <span
                      className="rounded px-1 text-[8px] uppercase tracking-wider"
                      style={{ color: "var(--text-muted)", border: "1px solid var(--grid-line)" }}
                      title={CHAINS[position.chain].label}
                    >
                      {CHAINS[position.chain].tag}
                    </span>
                    <span className="tabular text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {position.costNative.toFixed(4)} {position.quote} @ {formatUsdPrice(position.entryPriceUsd)}
                    </span>
                    <span className="tabular ml-auto text-[12px] font-bold" style={{ color: up ? "var(--pos-glow)" : "var(--neg-glow)" }}>
                      {arrow(position.unrealizedPnlPct)} {formatPct(position.unrealizedPnlPct)}
                    </span>
                    <span className="tabular w-24 text-right text-[10px]" style={{ color: up ? "var(--pos)" : "var(--neg)" }}>
                      {formatNative(position.unrealizedPnlNative, position.quote)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onClose(position.id)}
                      className="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider transition-colors hover:brightness-150"
                      style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
                    >
                      close
                    </button>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    {/* Stop proximity: full bar means the stop is being hit. */}
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                      <motion.div
                        className="absolute inset-y-0 left-0"
                        style={{ background: "var(--neg)", borderRadius: "0 4px 4px 0" }}
                        initial={false}
                        animate={{ width: `${stopProgress}%` }}
                        transition={{ type: "spring", stiffness: 150, damping: 24 }}
                      />
                    </div>
                    <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      SL −{position.stopLossPct}%
                    </span>
                    <span className="flex items-center gap-0.5" title="take-profit ladder">
                      {position.takeProfitLadder.map((rung, i) => (
                        <span
                          key={rung}
                          className="rounded px-1 text-[8px] font-semibold tabular"
                          style={{
                            color: i < position.filledRungs ? "var(--surface-0)" : "var(--text-muted)",
                            background: i < position.filledRungs ? "var(--pos)" : "var(--surface-2)",
                          }}
                        >
                          +{rung}%
                        </span>
                      ))}
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-wider"
                      style={{ color: ladderArmed ? "var(--series-2-glow)" : "var(--text-muted)" }}
                      title="trailing stop arms after the first take-profit rung"
                    >
                      {ladderArmed ? `trail −${position.trailingStopPct}%` : "trail idle"}
                    </span>
                    <span className="tabular text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {relativeTime(position.openedAt)}
                    </span>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
