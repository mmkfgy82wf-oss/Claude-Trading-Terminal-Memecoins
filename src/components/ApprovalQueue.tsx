"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { PendingApproval } from "@/lib/types";
import { EmptyState, Panel } from "./ui";

/**
 * MANUAL mode: the desk sizes the ticket, you decide whether it goes.
 * Tickets carry a countdown — a memecoin entry that sat for 90 seconds is a
 * different trade than the one the agents actually proposed.
 */
export function ApprovalQueue({
  approvals,
  autonomy,
  onApprove,
  onReject,
  className,
}: {
  approvals: PendingApproval[];
  autonomy: "auto" | "manual";
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const pending = approvals.filter((a) => a.state === "pending");

  return (
    <Panel
      title="approval queue"
      accent="var(--series-5)"
      right={
        <span className="text-[10px] uppercase tracking-wider" style={{ color: autonomy === "manual" ? "var(--series-2-glow)" : "var(--text-muted)" }}>
          {autonomy === "manual" ? `${pending.length} awaiting` : "auto — not gating"}
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      {autonomy === "auto" ? (
        <EmptyState>
          AUTO mode: the desk fills its own tickets. Switch to MANUAL to review every entry first.
        </EmptyState>
      ) : pending.length === 0 ? (
        <EmptyState>No tickets awaiting approval.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {pending.map((approval) => {
              const remaining = Math.max(0, approval.expiresAt - now);
              const pct = (remaining / 90_000) * 100;
              return (
                <motion.li
                  key={approval.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="border-b px-3 py-2 last:border-b-0"
                  style={{ borderColor: "var(--grid-line)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold">{approval.symbol}</span>
                    <span className="tabular text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      BUY {approval.sizeNative.toFixed(4)} {approval.quote}
                    </span>
                    <span className="tabular ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {(remaining / 1000).toFixed(0)}s
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {approval.reason}
                  </div>
                  <div className="mt-1.5 h-0.5 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                    <div
                      className="h-full transition-[width] duration-500 ease-linear"
                      style={{ width: `${pct}%`, background: "var(--series-2)", borderRadius: "0 4px 4px 0" }}
                    />
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onApprove(approval.id)}
                      className="flex-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-transform active:scale-95"
                      style={{ background: "rgba(3,175,88,0.16)", color: "var(--pos-glow)", border: "1px solid rgba(3,175,88,0.4)" }}
                    >
                      ✓ approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(approval.id)}
                      className="flex-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-transform active:scale-95"
                      style={{ background: "rgba(229,72,77,0.12)", color: "var(--neg-glow)", border: "1px solid rgba(229,72,77,0.35)" }}
                    >
                      ✕ reject
                    </button>
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
