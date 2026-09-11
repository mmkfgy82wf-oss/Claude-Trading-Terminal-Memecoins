"use client";

import { CHAINS } from "@/lib/market/chains";
import type { ChainStatus } from "@/lib/types";
import { relativeTime } from "@/lib/util/format";

/**
 * Per-chain data provenance. It says plainly whether the numbers on screen are
 * on-chain or simulated — the terminal never quietly mixes the two.
 */
export function ChainStatusBar({ statuses }: { statuses: ChainStatus[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-3 py-1.5 text-[10px]"
      style={{ borderColor: "var(--grid-line)", background: "rgba(10,11,16,0.7)" }}
    >
      {statuses.map((status) => {
        const chain = CHAINS[status.chain];
        const live = status.mode === "live";
        return (
          <span key={status.chain} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: live ? "var(--pos)" : "var(--warn)" }}
              aria-hidden
            />
            <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
              {chain.label}
            </span>
            <span
              className="rounded px-1 text-[9px] uppercase tracking-wider"
              style={{ color: live ? "var(--pos-glow)" : "var(--series-2-glow)", background: live ? "rgba(3,175,88,0.12)" : "rgba(217,115,11,0.12)" }}
            >
              {live ? "live" : "simulated"}
            </span>
            <span className="tabular" style={{ color: "var(--text-muted)" }}>
              {status.pairsTracked} pairs
            </span>
            <span style={{ color: "var(--text-muted)" }}>· {status.note}</span>
            {status.lastFetchAt > 0 && (
              <span className="tabular" style={{ color: "var(--text-muted)" }}>
                · {relativeTime(status.lastFetchAt)} ago
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
