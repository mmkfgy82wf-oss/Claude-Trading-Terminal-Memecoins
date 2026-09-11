"use client";

import type { PortfolioSnapshot } from "@/lib/types";
import { arrow, formatPct, formatSol } from "@/lib/util/format";
import { EquityCurve } from "./EquityCurve";
import { Panel, StatTile } from "./ui";

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
          SOL ≈ ${portfolio.solPriceUsd.toFixed(0)}
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
            <div
              className="tabular text-[30px] font-bold leading-none"
              style={{ color: "var(--text-primary)", textShadow: "0 0 26px rgba(34,211,238,0.16)" }}
            >
              {portfolio.equitySol.toFixed(3)}
              <span className="ml-1.5 text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
                SOL
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
              {formatSol(portfolio.equitySol - portfolio.startingEquitySol)} SOL vs start
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <EquityCurve data={portfolio.equityCurve} baseline={portfolio.startingEquitySol} />
      </div>

      <div
        className="grid grid-cols-2 border-t sm:grid-cols-3"
        style={{ borderColor: "var(--grid-line)" }}
      >
        <StatTile label="free cash" value={`${portfolio.cashSol.toFixed(3)}`} sub="SOL" />
        <StatTile label="in positions" value={`${portfolio.positionsValueSol.toFixed(3)}`} sub={`${portfolio.openPositions} open`} />
        <StatTile
          label="realised"
          value={formatSol(portfolio.realizedPnlSol)}
          sub="SOL"
          tone={portfolio.realizedPnlSol >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="unrealised"
          value={formatSol(portfolio.unrealizedPnlSol)}
          sub="SOL"
          tone={portfolio.unrealizedPnlSol >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="hit rate"
          value={settled ? `${portfolio.winRate.toFixed(0)}%` : "—"}
          sub={settled ? `${portfolio.wins}W / ${portfolio.losses}L` : "no closed trades"}
        />
        <StatTile
          label="best / worst"
          value={`${formatSol(portfolio.bestTradeSol, 2)}`}
          sub={`worst ${formatSol(portfolio.worstTradeSol, 2)} SOL`}
          tone={portfolio.bestTradeSol > 0 ? "pos" : "neutral"}
        />
      </div>
    </Panel>
  );
}
