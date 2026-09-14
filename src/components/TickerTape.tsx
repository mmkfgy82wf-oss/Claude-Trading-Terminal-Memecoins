"use client";

import type { Token } from "@/lib/types";
import { arrow, formatPct, formatUsdPrice } from "@/lib/util/format";
import { TokenChip } from "./ui";

/**
 * The scrolling tape. Duplicated once so the marquee loops seamlessly at -50%;
 * it pauses on hover so a symbol can actually be read.
 */
export function TickerTape({
  tokens,
  onInspect,
}: {
  tokens: Token[];
  onInspect?: (tokenId: string) => void;
}) {
  if (tokens.length === 0) return null;
  const row = [...tokens, ...tokens];

  return (
    <div
      className="marquee-viewport relative overflow-hidden border-b py-1.5"
      style={{ borderColor: "var(--grid-line)", background: "rgba(10,11,16,0.6)" }}
    >
      <div className="marquee-track" style={{ ["--marquee-duration" as string]: `${Math.max(30, tokens.length * 4)}s` }}>
        {row.map((token, i) => {
          const up = token.change1h >= 0;
          return (
            <button
              key={`${token.id}-${i}`}
              type="button"
              className="tape-item tabular mx-4 inline-flex shrink-0 items-center gap-1.5 text-[11px]"
              onClick={() => onInspect?.(token.id)}
            >
              <TokenChip symbol={token.symbol} size={14} />
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {token.symbol}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>{formatUsdPrice(token.priceUsd)}</span>
              <span
                className={up ? "tape-up" : "tape-down"}
                style={{ color: up ? "var(--pos-glow)" : "var(--neg-glow)" }}
              >
                {arrow(token.change1h)} {formatPct(token.change1h)}
              </span>
              <span style={{ color: "var(--surface-3)" }}>│</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
