"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { TerminalSnapshot } from "@/lib/types";
import { arrow, formatCompactUsd, formatPct } from "@/lib/util/format";
import type { ConnectionState } from "@/lib/useTerminal";
import { LogoMark } from "./LogoMark";
import { CountUp, Pill } from "./ui";

export function TopBar({
  snapshot,
  connection,
  sessionStartedAt,
  sound,
  onAutonomy,
  onKill,
  onOpenSettings,
  onOpenPalette,
  onOpenHelp,
  onToggleSound,
}: {
  snapshot: TerminalSnapshot;
  connection: ConnectionState;
  sessionStartedAt: number;
  sound: boolean;
  onAutonomy: (mode: "auto" | "manual") => void;
  onKill: (on: boolean) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onToggleSound: () => void;
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
      style={{
        borderColor: "var(--grid-line)",
        background: "rgba(14,16,23,0.78)",
        backdropFilter: "blur(14px)",
        boxShadow: "0 1px 0 color-mix(in srgb, var(--series-1) 28%, transparent)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <LogoMark size={20} />
        <motion.span
          className="glitch-title text-[15px] font-bold tracking-[0.2em]"
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
          <span className="text-[14px] font-semibold">
            <CountUp value={portfolio.equityUsd} format={formatCompactUsd} />
          </span>
          <span
            className={`text-[11px] font-semibold ${pnlPositive ? "glow-pos" : "glow-neg"}`}
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
          onClick={onOpenPalette}
          className="desk-btn hidden items-center gap-1 rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider sm:inline-flex"
          style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
          title="Command palette"
        >
          ⌕ <kbd className="kbd">⌘K</kbd>
        </button>

        <button
          type="button"
          onClick={onToggleSound}
          className="desk-btn rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider"
          style={{
            borderColor: sound ? "color-mix(in srgb, var(--series-1) 45%, var(--grid-line))" : "var(--grid-line)",
            color: sound ? "var(--series-1-glow)" : "var(--text-secondary)",
          }}
          title="Desk sounds"
        >
          {sound ? "♪ on" : "♪ off"}
        </button>

        <button
          type="button"
          onClick={onOpenHelp}
          className="desk-btn rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider"
          style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
          title="Keyboard shortcuts"
        >
          ?
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="desk-btn rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider"
          style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
        >
          ⚙ risk
        </button>

        <motion.button
          type="button"
          onClick={() => onKill(!flags.killSwitch)}
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.03 }}
          className="desk-btn rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{
            background: flags.killSwitch ? "var(--neg)" : "rgba(229,72,77,0.12)",
            color: flags.killSwitch ? "#fff" : "var(--neg-glow)",
            border: "1px solid rgba(229,72,77,0.45)",
            boxShadow: flags.killSwitch ? "0 0 22px rgba(229,72,77,0.5)" : "none",
          }}
        >
          {flags.killSwitch ? "◼ halted — release" : "◼ kill switch"}
        </motion.button>

        <span className="tabular hidden text-[10px] uppercase tracking-wider lg:inline" style={{ color: "var(--text-muted)" }} title="session length">
          {formatSession(sessionStartedAt)}
        </span>
        <span className="tabular hidden text-[11px] md:inline" style={{ color: "var(--text-secondary)" }}>
          {clock.slice(0, -3)}
          <span className="blink">:</span>
          {clock.slice(-2)}
        </span>
      </div>
    </header>
  );
}

function formatSession(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
