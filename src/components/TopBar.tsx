"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { TerminalSnapshot } from "@/lib/types";
import { arrow, formatPct, formatSol } from "@/lib/util/format";
import type { ConnectionState } from "@/lib/useTerminal";
import { Pill } from "./ui";

export function TopBar({
  snapshot,
  connection,
  onAutonomy,
  onKill,
  onOpenSettings,
}: {
  snapshot: TerminalSnapshot;
  connection: ConnectionState;
  onAutonomy: (mode: "auto" | "manual") => void;
  onKill: (on: boolean) => void;
  onOpenSettings: () => void;
}) {
  const [clock, setClock] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("de-DE", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const { flags, portfolio } = snapshot;
  const pnlPositive = portfolio.totalPnlPct >= 0;

  return (
    <header
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2"
      style={{ borderColor: "var(--grid-line)", background: "rgba(14,16,23,0.82)", backdropFilter: "blur(10px)" }}
    >
      <div className="flex items-center gap-2">
        <motion.span
          className="text-[15px] font-bold tracking-[0.2em]"
          style={{ color: "var(--series-1-glow)", textShadow: "0 0 18px rgba(34,211,238,0.5)" }}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
        >
          MEMEDESK
        </motion.span>
        <span className="hidden text-[9px] uppercase tracking-[0.18em] sm:inline" style={{ color: "var(--text-muted)" }}>
          autonomous agent terminal
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`pulse-dot inline-block h-2 w-2 rounded-full`}
          style={{
            background: connection === "live" ? "var(--pos)" : "var(--warn)",
            ["--ring" as string]: connection === "live" ? "rgba(3,175,88,0.5)" : "rgba(217,115,11,0.5)",
          }}
          aria-hidden
        />
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          {connection === "live" ? "stream live" : connection === "connecting" ? "connecting" : "reconnecting"}
        </span>
        <Pill tone={flags.marketMode === "live" ? "info" : "warn"} glyph={flags.marketMode === "live" ? "◉" : "◌"}>
          {flags.marketMode === "live" ? "on-chain data" : "simulated feed"}
        </Pill>
        <Pill tone="neutral" glyph="⌗">
          paper
        </Pill>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="tabular flex items-baseline gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            equity
          </span>
          <span className="text-[14px] font-semibold">{formatSol(portfolio.equitySol, 3)} SOL</span>
          <span
            className="text-[11px] font-semibold"
            style={{ color: pnlPositive ? "var(--pos-glow)" : "var(--neg-glow)" }}
          >
            {arrow(portfolio.totalPnlPct)} {formatPct(portfolio.totalPnlPct)}
          </span>
        </div>

        <div className="flex items-center overflow-hidden rounded-md border" style={{ borderColor: "var(--grid-line)" }}>
          {(["auto", "manual"] as const).map((mode) => {
            const active = flags.autonomy === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onAutonomy(mode)}
                className="relative px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                style={{ color: active ? "var(--surface-0)" : "var(--text-secondary)" }}
              >
                {active && (
                  <motion.span
                    layoutId="autonomy-pill"
                    className="absolute inset-0"
                    style={{ background: mode === "auto" ? "var(--series-1-glow)" : "var(--series-2-glow)" }}
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  />
                )}
                <span className="relative">{mode}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors hover:brightness-125"
          style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
        >
          ⚙ risk
        </button>

        <motion.button
          type="button"
          onClick={() => onKill(!flags.killSwitch)}
          whileTap={{ scale: 0.95 }}
          className="rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{
            background: flags.killSwitch ? "var(--neg)" : "rgba(229,72,77,0.12)",
            color: flags.killSwitch ? "#fff" : "var(--neg-glow)",
            border: "1px solid rgba(229,72,77,0.45)",
            boxShadow: flags.killSwitch ? "0 0 22px rgba(229,72,77,0.5)" : "none",
          }}
        >
          {flags.killSwitch ? "◼ halted — release" : "◼ kill switch"}
        </motion.button>

        <span className="tabular hidden text-[11px] md:inline" style={{ color: "var(--text-secondary)" }}>
          {clock}
        </span>
      </div>
    </header>
  );
}
