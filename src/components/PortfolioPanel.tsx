"use client";

import type { PortfolioSnapshot } from "@/lib/types";
import { arrow, formatCompactUsd, formatPct, formatSignedUsd } from "@/lib/util/format";
import { EquityCurve } from "./EquityCurve";
import { CountUp, Panel, StatTile } from "./ui";

/**
 * Portfolio state. The hero number is equity; everything else is context for
 * it. The curve is one series against the starting-equity reference line.
 */
export function PortfolioPanel({
  portfolio,
  className,
}: {
  portfolio: PortfolioSnapshot;
  className?: string;
}) {
  const up = portfolio.totalPnlPct >= 0;
  const settled = portfolio.wins + portfolio.losses;

  return (
    <Panel
      title="paper portfolio"
      accent="var(--series-4)"
      right={
        <span className="tabular text-[10px]" style={{ color: "var(--text-muted)" }}>
          {portfolio.treasuries.map((t) => `${t.quote} $${t.quotePriceUsd.toFixed(0)}`).join(" · ")}
        </span>
      }
      bodyClassName="overflow-y-auto"
      className={className}
    >
      <div className="px-3 pt-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              equity
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <div
                className={`tabular text-[30px] font-bold leading-none ${up ? "glow-pos" : "glow-neg"}`}
                style={{ color: "var(--text-primary)", textShadow: up ? "0 0 28px rgba(74,222,128,0.22)" : "0 0 28px rgba(255,99,105,0.18)" }}
              >
                <CountUp
                  value={portfolio.equityUsd}
                  format={(n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                />
              </div>
              <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
                total book
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="tabular text-[17px] font-bold"
              style={{ color: up ? "var(--pos-glow)" : "var(--neg-glow)" }}
            >
              {arrow(portfolio.totalPnlPct)} {formatPct(portfolio.totalPnlPct, 2)}
            </div>
            <div className="tabular text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {formatSignedUsd(portfolio.equityUsd - portfolio.startingEquityUsd)} gegen die
              Startbestände
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2">
        {/* The curve is indexed to 100 at funding, so that is the reference line. */}
        <EquityCurve data={portfolio.equityCurve} baseline={100} />
      </div>

      {/* Per-chain treasuries. Capital does not cross chains on its own, so the
          desk shows what it actually holds where, in that chain's own asset. */}
      <div className="grid gap-px border-t sm:grid-cols-2" style={{ borderColor: "var(--grid-line)", background: "var(--grid-line)" }}>
        {portfolio.treasuries.map((treasury) => (
          <div key={treasury.chain} className="px-3 py-2" style={{ background: "var(--surface-1)" }}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {treasury.label}
              </span>
              <span
                className="rounded px-1 text-[9px] font-bold"
                style={{ color: "var(--series-1-glow)", background: "rgba(7,164,186,0.14)" }}
              >
                {treasury.quote}
              </span>
              <span className="tabular ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                {formatCompactUsd(treasury.equityUsd)}
              </span>
            </div>
            <div className="tabular mt-0.5 text-[12px] font-semibold">
              {treasury.cashNative.toFixed(4)}{" "}
              <span className="text-[10px] font-normal" style={{ color: "var(--text-secondary)" }}>
                {treasury.quote} free
              </span>
            </div>
            <div className="tabular text-[9px]" style={{ color: "var(--text-muted)" }}>
              {treasury.positionsValueNative.toFixed(4)} {treasury.quote} in {treasury.openPositions} position(s)
            </div>
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-2 border-t sm:grid-cols-3"
        style={{ borderColor: "var(--grid-line)" }}
      >
        <StatTile label="free cash" value={formatCompactUsd(portfolio.cashUsd)} sub="across treasuries" />
        <StatTile
          label="in positions"
          value={formatCompactUsd(portfolio.positionsValueUsd)}
          sub={`${portfolio.openPositions} open`}
        />
        <StatTile
          label="realised"
          value={formatSignedUsd(portfolio.realizedPnlUsd)}
          sub="closed trades"
          tone={portfolio.realizedPnlUsd >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="unrealised"
          value={formatSignedUsd(portfolio.unrealizedPnlUsd)}
          sub="open trades"
          tone={portfolio.unrealizedPnlUsd >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="hit rate"
          value={settled ? `${portfolio.winRate.toFixed(0)}%` : "—"}
          sub={settled ? `${portfolio.wins}W / ${portfolio.losses}L` : "no closed trades"}
        />
        <StatTile
          label="best / worst"
          value={formatSignedUsd(portfolio.bestTradeUsd)}
          sub={`worst ${formatSignedUsd(portfolio.worstTradeUsd)}`}
          tone={portfolio.bestTradeUsd > 0 ? "pos" : "neutral"}
        />
      </div>
    </Panel>
  );
}
