"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Panel({
  title,
  accent,
  right,
  children,
  className,
  bodyClassName,
  scanline,
}: {
  title: string;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  scanline?: boolean;
}) {
  return (
    <section
      className={clsx("panel panel-accent flex min-h-0 flex-col", className)}
      style={{ ["--accent" as string]: accent ?? "var(--series-1)" }}
    >
      {scanline && <div className="scanline" />}
      <header className="panel-header shrink-0">
        <h2 className="panel-title">{title}</h2>
        {right}
      </header>
      <div className={clsx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = "neutral",
  glyph,
}: {
  children: ReactNode;
  tone?: "neutral" | "pos" | "neg" | "warn" | "info";
  glyph?: string;
}) {
  const colors: Record<string, { fg: string; bg: string }> = {
    neutral: { fg: "var(--text-secondary)", bg: "rgba(148,163,184,0.1)" },
    pos: { fg: "var(--pos-glow)", bg: "rgba(3,175,88,0.14)" },
    neg: { fg: "var(--neg-glow)", bg: "rgba(229,72,77,0.14)" },
    warn: { fg: "var(--series-2-glow)", bg: "rgba(217,115,11,0.14)" },
    info: { fg: "var(--series-1-glow)", bg: "rgba(7,164,186,0.14)" },
  };
  const c = colors[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-[filter] duration-150 hover:brightness-125"
      style={{ color: c.fg, background: c.bg }}
    >
      {glyph && <span aria-hidden>{glyph}</span>}
      {children}
    </span>
  );
}

/**
 * A headline number. Per the form heuristic, a single value with no comparison
 * is a stat tile, not a chart — so this is the shape the KPI row uses.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "neutral" | "pos" | "neg";
}) {
  const color = tone === "pos" ? "var(--pos-glow)" : tone === "neg" ? "var(--neg-glow)" : "var(--text-primary)";
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="tabular text-[17px] font-semibold leading-tight" style={{ color }}>
        {value}
      </span>
      {sub && <span className="tabular text-[10px]" style={{ color: "var(--text-secondary)" }}>{sub}</span>}
    </div>
  );
}

/** A value bar: 4px rounded data-end, anchored to a shared baseline. */
export function ScoreBar({ score, color }: { score: number; color: string }) {
  const clamped = Math.max(-100, Math.min(100, score));
  const width = Math.abs(clamped) / 2; // percent of the track, centre-anchored
  const positive = clamped >= 0;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
      <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--grid-line)" }} />
      <motion.div
        className="absolute inset-y-0"
        style={{
          background: color,
          left: positive ? "50%" : undefined,
          right: positive ? undefined : "50%",
          borderRadius: positive ? "0 4px 4px 0" : "4px 0 0 4px",
        }}
        initial={false}
        animate={{ width: `${width}%` }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
      />
    </div>
  );
}

/** Tweens a number across ticks so the headline doesn't jump. */
export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 420);
      const eased = 1 - (1 - p) * (1 - p);
      const next = from + (value - from) * eased;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-2 px-4 py-6 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
      <span
        className="pulse-dot inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--series-1)", ["--ring" as string]: "rgba(34,211,238,0.4)" }}
        aria-hidden
      />
      {children}
    </div>
  );
}
