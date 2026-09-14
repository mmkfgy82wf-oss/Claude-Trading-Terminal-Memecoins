"use client";

import { useId } from "react";
import type { PricePoint } from "@/lib/types";

/**
 * A row-level price trace.
 *
 * Deliberately minimal: no axes, no labels, no legend — the row already names
 * the token and shows the signed change beside it, so this only has to carry
 * shape. Direction colour is backed by that signed number, never colour alone.
 */
export function Sparkline({
  data,
  width = 96,
  height = 26,
  positive,
  fluid,
}: {
  data: PricePoint[];
  width?: number;
  height?: number;
  positive?: boolean;
  fluid?: boolean;
}) {
  const gradientId = useId();
  const points = data.slice(-60);

  if (points.length < 2) {
    return (
      <svg
        width={fluid ? undefined : width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={fluid ? "w-full" : undefined}
        style={fluid ? { height } : undefined}
        role="img"
        aria-label="no price history yet"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--surface-3)"
          strokeWidth={2}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max || 1;
  const pad = 3;
  const scaleX = (i: number) => (i / (points.length - 1)) * width;
  const scaleY = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const up = positive ?? values[values.length - 1] >= values[0];
  const stroke = up ? "var(--pos)" : "var(--neg)";
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleY(p.p).toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const lastX = scaleX(points.length - 1);
  const lastY = scaleY(values[values.length - 1]);

  return (
    <svg
      width={fluid ? undefined : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={fluid ? "w-full" : undefined}
      style={fluid ? { height } : undefined}
      role="img"
      aria-label={`price trace, ${up ? "up" : "down"}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* 2px surface ring keeps the marker readable where it overlaps the line */}
      <circle className="spark-tip" cx={lastX} cy={lastY} r={3} fill={stroke} stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
