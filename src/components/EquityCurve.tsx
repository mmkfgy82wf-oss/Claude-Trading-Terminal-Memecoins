"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { PricePoint } from "@/lib/types";
import { formatClock } from "@/lib/util/format";

/**
 * Portfolio equity over the session — one series, so it carries no legend; the
 * panel title names it. Interaction is a crosshair plus a value tooltip, which
 * an HTML chart should ship by default.
 */
export function EquityCurve({
  data,
  baseline,
  height = 132,
}: {
  data: PricePoint[];
  baseline: number;
  height?: number;
}) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  const points = useMemo(() => data.slice(-180), [data]);
  const width = 640; // viewBox units; the SVG scales to its container

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.p);
    const min = Math.min(...values, baseline);
    const max = Math.max(...values, baseline);
    const span = max - min || max || 1;
    const padY = 12;
    const scaleX = (i: number) => (i / (points.length - 1)) * width;
    const scaleY = (v: number) => height - padY - ((v - min) / span) * (height - padY * 2);
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleY(p.p).toFixed(1)}`)
      .join(" ");
    return { scaleX, scaleY, path, min, max, baselineY: scaleY(baseline) };
  }, [points, baseline, height]);

  if (!geometry) {
    return (
      <div
        className="flex items-center justify-center text-[11px]"
        style={{ height, color: "var(--text-muted)" }}
      >
        equity curve builds after the first ticks
      </div>
    );
  }

  const last = points[points.length - 1].p;
  const up = last >= baseline;
  const stroke = up ? "var(--pos)" : "var(--neg)";

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (points.length - 1));
    setHover({ x: geometry.scaleX(i), i });
  };

  const hovered = hover ? points[hover.i] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full touch-none"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Portfolio equity in SOL over the session"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.26} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Starting equity — the only reference line that matters here. */}
        <line
          x1={0}
          y1={geometry.baselineY}
          x2={width}
          y2={geometry.baselineY}
          stroke="var(--text-muted)"
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.5}
        />
        <path d={`${geometry.path} L${width},${height} L0,${height} Z`} fill={`url(#${gradientId})`} />
        <path d={geometry.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />

        {hover && (
          <g>
            <line x1={hover.x} y1={0} x2={hover.x} y2={height} stroke="var(--text-muted)" strokeWidth={1} />
            <circle
              cx={hover.x}
              cy={geometry.scaleY(points[hover.i].p)}
              r={4}
              fill={stroke}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-1 rounded-md px-2 py-1 text-[10px] tabular"
          style={{
            left: `${(hover!.x / width) * 100}%`,
            transform: "translateX(-50%)",
            background: "var(--surface-3)",
            border: "1px solid var(--grid-line)",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>{formatClock(hovered.t)}</span>{" "}
          {hovered.p.toFixed(4)} SOL
        </div>
      )}
    </div>
  );
}
