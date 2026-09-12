/** Formatting helpers shared by every panel, so numbers read the same everywhere. */

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${value.toExponential(1).replace("e+", "e")}`;
  if (value >= 1) return `$${value.toFixed(value >= 100 ? 2 : 4)}`;
  // Sub-cent memecoin prices: keep four significant digits rather than zeros.
  return `$${value.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

const UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Compact USD. Falls back to exponent notation past a trillion rather than
 * printing "$90699400060341696.00B", which is what a long-running simulator or
 * a bad price feed will otherwise put on screen.
 */
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1e15) return `${sign}$${abs.toExponential(1).replace("e+", "e")}`;
  for (const [scale, suffix] of UNITS) {
    if (abs >= scale) return `${sign}$${(abs / scale).toFixed(abs / scale >= 100 ? 0 : 2)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

/** A signed amount in a chain's quote asset, e.g. "+0.0421 ETH". */
export function formatNative(value: number, quote: string, digits = 4): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)} ${quote}`;
}

/** A signed USD amount. USD is the only unit comparable across chains. */
export function formatSignedUsd(value: number): string {
  const abs = Math.abs(value);
  const body = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(2);
  return `${value >= 0 ? "+" : "-"}$${body}`;
}

/**
 * A percentage. Beyond six figures the exact value stops carrying information
 * and only costs layout, so it is abbreviated rather than spelled out — and it
 * never renders as "5.03e+24%".
 */
export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M%`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(0)}K%`;
  return `${sign}${abs.toFixed(digits)}%`;
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
