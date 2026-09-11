import type {
  Fill,
  PortfolioSnapshot,
  Position,
  PricePoint,
  RiskConfig,
  Token,
} from "@/lib/types";

let posSeq = 0;

/**
 * The paper wallet: cash, open positions, realised history.
 *
 * It holds no opinions about *when* to trade — it only books what the executor
 * reports and keeps the accounting honest (cost basis, fees, realised P/L).
 */
export class PaperWallet {
  private cashSol: number;
  private readonly positions = new Map<string, Position>();
  private readonly fills: Fill[] = [];
  private realizedPnlSol = 0;
  private wins = 0;
  private losses = 0;
  private bestTradeSol = 0;
  private worstTradeSol = 0;
  private readonly equityCurve: PricePoint[] = [];
  private dayAnchorEquity: number;
  private dayAnchorAt = Date.now();

  constructor(private startingEquity: number) {
    this.cashSol = startingEquity;
    this.dayAnchorEquity = startingEquity;
    this.equityCurve.push({ t: Date.now(), p: startingEquity });
  }

  get cash(): number {
    return this.cashSol;
  }

  openPositions(): Position[] {
    return [...this.positions.values()];
  }

  positionFor(tokenId: string): Position | undefined {
    return this.positions.get(tokenId);
  }

  recentFills(limit = 60): Fill[] {
    return this.fills.slice(-limit).reverse();
  }

  /** Book a buy fill: cash out, position in (or averaged up). */
  applyBuy(fill: Fill, risk: RiskConfig): Position {
    this.cashSol -= fill.valueSol;
    this.fills.push(fill);

    const existing = this.positions.get(fill.tokenId);
    if (existing) {
      const quantity = existing.quantity + fill.quantity;
      const costSol = existing.costSol + fill.valueSol;
      const merged: Position = {
        ...existing,
        quantity,
        costSol,
        entryPriceUsd: (existing.entryPriceUsd * existing.quantity + fill.priceUsd * fill.quantity) / quantity,
        currentPriceUsd: fill.priceUsd,
        peakPriceUsd: Math.max(existing.peakPriceUsd, fill.priceUsd),
      };
      this.positions.set(fill.tokenId, merged);
      return merged;
    }

    const position: Position = {
      id: `p${Date.now().toString(36)}${(++posSeq).toString(36)}`,
      tokenId: fill.tokenId,
      symbol: fill.symbol,
      chain: fill.chain,
      quantity: fill.quantity,
      entryPriceUsd: fill.priceUsd,
      costSol: fill.valueSol,
      openedAt: fill.at,
      stopLossPct: risk.stopLossPct,
      takeProfitLadder: [...risk.takeProfitLadder],
      filledRungs: 0,
      peakPriceUsd: fill.priceUsd,
      trailingStopPct: risk.trailingStopPct,
      currentPriceUsd: fill.priceUsd,
      unrealizedPnlSol: 0,
      unrealizedPnlPct: 0,
    };
    this.positions.set(fill.tokenId, position);
    return position;
  }

  /** Book a sell fill: cash in, position reduced or closed. */
  applySell(fill: Fill, rungTaken: boolean): void {
    const position = this.positions.get(fill.tokenId);
    this.cashSol += fill.valueSol - fill.feeSol;
    this.fills.push(fill);

    const pnl = fill.realizedPnlSol ?? 0;
    this.realizedPnlSol += pnl;
    this.bestTradeSol = Math.max(this.bestTradeSol, pnl);
    this.worstTradeSol = Math.min(this.worstTradeSol, pnl);

    if (!position) return;
    const remaining = position.quantity - fill.quantity;
    const closed = remaining <= position.quantity * 0.005;

    if (closed) {
      if (pnl >= 0) this.wins += 1;
      else this.losses += 1;
      this.positions.delete(fill.tokenId);
      return;
    }
    this.positions.set(fill.tokenId, {
      ...position,
      quantity: remaining,
      costSol: position.costSol * (remaining / position.quantity),
      filledRungs: rungTaken ? position.filledRungs + 1 : position.filledRungs,
    });
  }

  /** Re-price open positions against the latest market snapshot. */
  markToMarket(tokens: Map<string, Token>, solPriceUsd: number): void {
    for (const [id, position] of this.positions) {
      const token = tokens.get(id);
      const price = token?.priceUsd ?? position.currentPriceUsd;
      const valueSol = (position.quantity * price) / solPriceUsd;
      this.positions.set(id, {
        ...position,
        currentPriceUsd: price,
        peakPriceUsd: Math.max(position.peakPriceUsd, price),
        unrealizedPnlSol: valueSol - position.costSol,
        unrealizedPnlPct: ((price - position.entryPriceUsd) / position.entryPriceUsd) * 100,
      });
    }
  }

  positionsValueSol(solPriceUsd: number): number {
    let sum = 0;
    for (const p of this.positions.values()) sum += (p.quantity * p.currentPriceUsd) / solPriceUsd;
    return sum;
  }

  equity(solPriceUsd: number): number {
    return this.cashSol + this.positionsValueSol(solPriceUsd);
  }

  /** Percentage drawdown since the rolling 24h anchor — feeds the loss limit. */
  dailyDrawdownPct(solPriceUsd: number): number {
    if (Date.now() - this.dayAnchorAt > 24 * 60 * 60_000) {
      this.dayAnchorAt = Date.now();
      this.dayAnchorEquity = this.equity(solPriceUsd);
    }
    const eq = this.equity(solPriceUsd);
    return ((this.dayAnchorEquity - eq) / this.dayAnchorEquity) * 100;
  }

  snapshot(solPriceUsd: number): PortfolioSnapshot {
    const positionsValueSol = this.positionsValueSol(solPriceUsd);
    const equitySol = this.cashSol + positionsValueSol;
    const unrealized = [...this.positions.values()].reduce((s, p) => s + p.unrealizedPnlSol, 0);
    const last = this.equityCurve[this.equityCurve.length - 1];
    if (!last || Math.abs(last.p - equitySol) > 1e-9) {
      this.equityCurve.push({ t: Date.now(), p: equitySol });
      if (this.equityCurve.length > 240) this.equityCurve.shift();
    }
    const settled = this.wins + this.losses;
    return {
      cashSol: this.cashSol,
      positionsValueSol,
      equitySol,
      startingEquitySol: this.startingEquity,
      realizedPnlSol: this.realizedPnlSol,
      unrealizedPnlSol: unrealized,
      totalPnlPct: ((equitySol - this.startingEquity) / this.startingEquity) * 100,
      openPositions: this.positions.size,
      wins: this.wins,
      losses: this.losses,
      winRate: settled ? (this.wins / settled) * 100 : 0,
      bestTradeSol: this.bestTradeSol,
      worstTradeSol: this.worstTradeSol,
      equityCurve: [...this.equityCurve],
      solPriceUsd,
    };
  }

  /** Used when the operator changes starting capital from the settings panel. */
  resetTo(startingEquity: number): void {
    this.startingEquity = startingEquity;
    this.cashSol = startingEquity;
    this.positions.clear();
    this.fills.length = 0;
    this.realizedPnlSol = 0;
    this.wins = 0;
    this.losses = 0;
    this.bestTradeSol = 0;
    this.worstTradeSol = 0;
    this.equityCurve.length = 0;
    this.equityCurve.push({ t: Date.now(), p: startingEquity });
    this.dayAnchorEquity = startingEquity;
    this.dayAnchorAt = Date.now();
  }
}
