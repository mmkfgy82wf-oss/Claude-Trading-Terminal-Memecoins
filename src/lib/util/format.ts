/** Formatting helpers shared by every panel, so numbers read the same everywhere. */

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1) return `$${value.toFixed(value >= 100 ? 2 : 4)}`;
  // Sub-cent memecoin prices: keep four significant digits rather than zeros.
  return `$${value.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatSol(value: number, digits = 3): string {
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(digits)}`;
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Direction glyph — the secondary encoding that keeps P/L readable without colour. */
export function arrow(value: number): "▲" | "▼" | "—" {
  if (value > 0) return "▲";
  if (value < 0) return "▼";
  return "—";
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString("de-DE", { hour12: false });
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
