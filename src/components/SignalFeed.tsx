"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ROSTER } from "@/lib/agents/roster";
import type { LogEntry } from "@/lib/types";
import { formatClock } from "@/lib/util/format";
import { EmptyState, Panel } from "./ui";

const LEVEL_COLOR: Record<LogEntry["level"], string> = {
  info: "var(--text-secondary)",
  signal: "var(--series-1-glow)",
  trade: "var(--pos-glow)",
  warn: "var(--series-2-glow)",
  error: "var(--neg-glow)",
  system: "var(--text-muted)",
};

const LEVEL_GLYPH: Record<LogEntry["level"], string> = {
  info: "·",
  signal: "◈",
  trade: "▶",
  warn: "▲",
  error: "✖",
  system: "▪",
};

/** The desk's running commentary — every agent decision, newest first. */
export function SignalFeed({ logs, className }: { logs: LogEntry[]; className?: string }) {
  return (
    <Panel
      title="signal feed"
      accent="var(--series-2)"
      right={
        <span className="blink text-[10px]" style={{ color: "var(--series-1-glow)" }}>
          ●
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      {logs.length === 0 ? (
        <EmptyState>Waiting for the first tick…</EmptyState>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {logs.slice(0, 60).map((entry) => {
              const agent = entry.agent === "system" ? null : ROSTER[entry.agent];
              return (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="flex gap-2 border-b px-2.5 py-1.5 last:border-b-0"
                  style={{ borderColor: "rgba(30,36,51,0.55)" }}
                >
                  <span className="tabular shrink-0 text-[9px] leading-4" style={{ color: "var(--text-muted)" }}>
                    {formatClock(entry.at)}
                  </span>
                  <span
                    className="shrink-0 text-[10px] leading-4"
                    style={{ color: agent?.color ?? "var(--text-muted)" }}
                    aria-hidden
                  >
                    {agent?.glyph ?? LEVEL_GLYPH[entry.level]}
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase leading-4 tracking-wider" style={{ color: agent?.color ?? "var(--text-muted)", width: 58 }}>
                    {agent?.name ?? "SYSTEM"}
                  </span>
                  <span className="text-[10px] leading-4" style={{ color: LEVEL_COLOR[entry.level] }}>
                    {entry.message}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
