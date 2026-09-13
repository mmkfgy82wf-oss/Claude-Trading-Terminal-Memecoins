"use client";

import { motion } from "framer-motion";
import type { AgentId, AgentRuntimeState } from "@/lib/types";
import { relativeTime } from "@/lib/util/format";
import { Panel } from "./ui";

const STATUS_LABEL: Record<AgentRuntimeState["status"], string> = {
  idle: "idle",
  thinking: "analysing",
  acting: "acting",
  blocked: "blocked",
  offline: "offline",
};

function statusColor(status: AgentRuntimeState["status"], agentColor: string): string {
  if (status === "blocked") return "var(--neg)";
  if (status === "acting") return "var(--pos)";
  if (status === "thinking") return agentColor;
  return "var(--text-muted)";
}

/**
 * The desk roster. Each card is one agent: what it is doing right now, how hard
 * it is working, and how many calls it has made this session.
 *
 * Identity never rests on colour alone — every agent carries a glyph and its
 * call-sign, and status is spelled out in words next to the dot.
 */
export function AgentConsole({
  agents,
  tick,
  selectedId,
  onSelect,
  className,
}: {
  agents: AgentRuntimeState[];
  tick: number;
  selectedId?: AgentId | null;
  onSelect?: (id: AgentId) => void;
  className?: string;
}) {
  return (
    <Panel
      title="agent desk"
      accent="var(--series-3)"
      scanline
      right={
        <span key={tick} className="tick-pop tabular text-[10px]" style={{ color: "var(--text-muted)" }}>
          tick {tick}
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      <ul className="flex flex-col">
        {agents.map((agent, index) => {
          const color = statusColor(agent.status, agent.color);
          const active = agent.status === "thinking" || agent.status === "acting";
          return (
            <motion.li
              key={agent.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06 }}
              className={`cursor-pointer border-b px-3 py-2 last:border-b-0 ${active ? "agent-live" : ""}`}
              style={{
                borderColor: "var(--grid-line)",
                ["--agent" as string]: agent.color,
                background: selectedId === agent.id ? `color-mix(in srgb, ${agent.color} 14%, transparent)` : undefined,
              }}
              onClick={() => onSelect?.(agent.id)}
              title="Filter the signal feed to this agent"
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px]"
                  style={{
                    color: agent.color,
                    background: `color-mix(in srgb, ${agent.color} 16%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${agent.color} 40%, transparent)`,
                  }}
                  aria-hidden
                >
                  {agent.glyph}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-bold tracking-wider" style={{ color: agent.color }}>
                      {agent.name}
                    </span>
                    <span className="truncate text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      {agent.role}
                    </span>
                    {agent.augmented && (
                      <span
                        className="rounded px-1 text-[8px] font-bold uppercase"
                        style={{ color: "var(--series-4-glow)", background: "rgba(3,175,88,0.15)" }}
                        title="enriched by an optional provider"
                      >
                        +ai
                      </span>
                    )}
                  </div>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={active ? "pulse-dot inline-block h-1.5 w-1.5 rounded-full" : "inline-block h-1.5 w-1.5 rounded-full"}
                      style={{ background: color, ["--ring" as string]: `color-mix(in srgb, ${color} 55%, transparent)` }}
                      aria-hidden
                    />
                    <span className="inline-flex items-center text-[9px] uppercase tracking-wider" style={{ color }}>
                      {STATUS_LABEL[agent.status]}
                      {agent.status === "thinking" && (
                        <span className="thinking-dots" aria-hidden>
                          <span>.</span>
                          <span>.</span>
                          <span>.</span>
                        </span>
                      )}
                    </span>
                    {/* Keyed on the text so a new activity fades in without
                        ever leaving the line blank between ticks. */}
                    <motion.span
                      key={agent.activity}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className="truncate text-[10px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {agent.activity}
                    </motion.span>
                  </div>
                </div>

                <div className="tabular shrink-0 text-right">
                  <div className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {agent.decisions}
                  </div>
                  <div className="text-[8px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    {agent.lastActiveAt ? relativeTime(agent.lastActiveAt) : "—"}
                  </div>
                </div>
              </div>

              {/* Load bar: 4px rounded data-end, anchored left. */}
              <div className="mt-2 h-1 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                <motion.div
                  className="h-full"
                  style={{ background: agent.color, borderRadius: "0 4px 4px 0" }}
                  initial={false}
                  animate={{ width: `${Math.round(agent.load * 100)}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 22 }}
                />
              </div>
            </motion.li>
          );
        })}
      </ul>
    </Panel>
  );
}
