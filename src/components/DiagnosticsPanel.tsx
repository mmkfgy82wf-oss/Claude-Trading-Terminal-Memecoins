"use client";

import { motion } from "framer-motion";
import type { ChainStatus, TickDiagnostics } from "@/lib/types";
import { formatAge, relativeTime } from "@/lib/util/format";
import { Panel } from "./ui";

/**
 * Why the desk did what it did.
 *
 * Two questions this answers that nothing else could: *where did these tokens
 * come from* and *why was nothing bought*. A quiet desk and a stuck desk look
 * identical from the outside, and that ambiguity is what makes an autonomous
 * system hard to trust — so the funnel from board to ticket is shown directly,
 * with the last gate that emptied it named in words.
 */

interface Stage {
  key: keyof TickDiagnostics["funnel"];
  label: string;
  /** Rejections are muted; the one success stage is not. */
  tone: "drop" | "pass";
}

const STAGES: Stage[] = [
  { key: "vetoed", label: "vetoed by SENTINEL", tone: "drop" },
  { key: "belowScore", label: "below consensus score", tone: "drop" },
  { key: "alreadyHeld", label: "already held", tone: "drop" },
  { key: "noSlot", label: "no free slot", tone: "drop" },
  { key: "noCash", label: "chain treasury empty", tone: "drop" },
  { key: "slippage", label: "slippage over budget", tone: "drop" },
  { key: "tooSmall", label: "ticket too small", tone: "drop" },
  { key: "sized", label: "sized into a ticket", tone: "pass" },
];

export function DiagnosticsPanel({
  diagnostics,
  chainStatus,
  className,
}: {
  diagnostics: TickDiagnostics;
  chainStatus: ChainStatus[];
  className?: string;
}) {
  const { funnel, discovery } = diagnostics;
  const max = Math.max(1, funnel.considered);
  const trading = funnel.sized > 0;
  // The simulator invents its own universe, so discovery counts are meant to be
  // zero there. Warning about a missing launchpad would be noise, not a finding.
  const anyLive = chainStatus.some((c) => c.mode === "live");

  return (
    <Panel
      title="why / why not"
      accent="var(--series-2)"
      className={className}
      bodyClassName="overflow-y-auto"
      right={
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: trading ? "var(--pos-glow)" : "var(--text-muted)" }}
        >
          {trading ? `${funnel.sized} ticket(s)` : "no entry"}
        </span>
      }
    >
      {/* The headline answer, in one sentence. */}
      {diagnostics.blocker && (
        <motion.div
          key={diagnostics.blocker}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b px-3 py-2 text-[11px] leading-snug"
          style={{
            borderColor: "var(--grid-line)",
            color: "var(--series-2-glow)",
            background: "rgba(217,115,11,0.07)",
          }}
        >
          {diagnostics.blocker}
        </motion.div>
      )}

      {/* Where the board came from — answers "why the same tokens again". */}
      <div className="border-b px-3 py-2" style={{ borderColor: "var(--grid-line)" }}>
        <div className="mb-1 text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          discovery
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          <Metric label="fresh launches" value={discovery.fromLaunchpad} highlight={discovery.fromLaunchpad > 0} />
          <Metric label="from search" value={discovery.fromSearch} />
          <Metric label="new this cycle" value={discovery.addedThisCycle} highlight={discovery.addedThisCycle > 0} />
          <Metric label="aged out" value={discovery.agedOut} />
        </div>
        {!anyLive && (
          <div className="mt-1 text-[9px] leading-snug" style={{ color: "var(--text-muted)" }}>
            Simulated feed — the universe is generated, so discovery counts stay at zero.
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 text-[9px]" style={{ color: "var(--text-muted)" }}>
          <span>{diagnostics.universeSize} tracked → {diagnostics.watchlistSize} watched</span>
          <span>median age {formatAge(diagnostics.medianAgeMinutes)}</span>
          {discovery.lastDiscoveryAt > 0 && <span>scanned {relativeTime(discovery.lastDiscoveryAt)} ago</span>}
        </div>
        {anyLive && discovery.fromLaunchpad === 0 && (
          <div className="mt-1 text-[9px] leading-snug" style={{ color: "var(--series-2-glow)" }}>
            No launchpad results — the board can only show what search returns, which skews
            old. Run <code>npm run check-sources</code>.
          </div>
        )}
      </div>

      {/* The funnel: where every candidate stopped. */}
      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            sizing funnel
          </span>
          <span className="tabular text-[10px]" style={{ color: "var(--text-secondary)" }}>
            {funnel.considered} considered
          </span>
        </div>

        <ul className="flex flex-col gap-1">
          {STAGES.filter((stage) => funnel[stage.key] > 0 || stage.key === "sized").map((stage) => {
            const value = funnel[stage.key];
            const pass = stage.tone === "pass";
            const color = pass
              ? value > 0
                ? "var(--pos)"
                : "var(--surface-3)"
              : "var(--series-2)";
            return (
              <li key={stage.key} className="flex items-center gap-2">
                <span className="tabular w-6 shrink-0 text-right text-[10px] font-semibold" style={{ color: pass && value > 0 ? "var(--pos-glow)" : "var(--text-secondary)" }}>
                  {value}
                </span>
                <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                  <motion.div
                    className="h-full"
                    style={{ background: color, borderRadius: "0 4px 4px 0" }}
                    initial={false}
                    animate={{ width: `${(value / max) * 100}%` }}
                    transition={{ type: "spring", stiffness: 160, damping: 24 }}
                  />
                </div>
                <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Per-chain feed health, so a silent chain is visible here too. */}
      <div className="border-t px-3 py-2" style={{ borderColor: "var(--grid-line)" }}>
        <div className="mb-1 text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          feeds
        </div>
        <ul className="flex flex-col gap-0.5">
          {chainStatus.map((status) => (
            <li key={status.chain} className="flex items-center gap-1.5 text-[10px]">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: status.mode === "live" ? "var(--pos)" : "var(--warn)" }}
                aria-hidden
              />
              <span className="shrink-0" style={{ color: "var(--text-secondary)" }}>
                {status.label}
              </span>
              <span
                className="shrink-0 text-[9px] uppercase"
                style={{ color: status.mode === "live" ? "var(--pos-glow)" : "var(--series-2-glow)" }}
              >
                {status.mode}
              </span>
              <span className="tabular ml-auto shrink-0" style={{ color: "var(--text-muted)" }}>
                {status.pairsTracked}
                {status.freshLaunches > 0 && ` · +${status.freshLaunches} new`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="tabular text-[12px] font-semibold"
        style={{ color: highlight ? "var(--series-1-glow)" : "var(--text-primary)" }}
      >
        {value}
      </span>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
