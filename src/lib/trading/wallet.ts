import { CHAINS } from "@/lib/market/chains";
import type {
  ChainId,
  ChainTreasury,
  Fill,
  PortfolioSnapshot,
  Position,
  PricePoint,
  RiskConfig,
  Token,
} from "@/lib/types";

let posSeq = 0;

/** USD price of each chain's quote asset, refreshed by the orchestrator. */
export type QuotePrices = Record<ChainId, number>;

/**
 * The paper book.
 *
 * Capital is held **per chain, in that chain's own quote asset** — SOL on
 * Solana, ETH on an EVM L2. That is not a formality: SOL cannot pay for a swap
 * on a chain whose gas and quote asset are ETH, so one shared balance would
 * quietly let the desk spend money it could not actually spend there.
 *
 * Aggregates (equity, P/L, the equity curve) are in USD, the only unit that
 * means the same thing on both chains.
 */
export class PaperWallet {
  private readonly cash = new Map<ChainId, number>();
  private readonly positions = new Map<string, Position>();
  private readonly fills: Fill[] = [];
  private realizedPnlUsd = 0;
  private wins = 0;
  private losses = 0;
  private bestTradeUsd = 0;
  private worstTradeUsd = 0;
  private readonly equityCurve: PricePoint[] = [];
  private dayAnchorEquityUsd: number;
  private dayAnchorAt = Date.now();

  constructor(
    private startingEquityUsd: number,
    private readonly chains: ChainId[],
    private prices: QuotePrices,
  ) {
    this.fund(startingEquityUsd, prices);
    this.dayAnchorEquityUsd = startingEquityUsd;
    this.equityCurve.push({ t: Date.now(), p: startingEquityUsd });
  }

  /** Split the book evenly across the active chains, held natively. */
  private fund(totalUsd: number, prices: QuotePrices): void {
    const perChainUsd = totalUsd / Math.max(1, this.chains.length);
    this.cash.clear();
    for (const chain of this.chains) {
      this.cash.set(chain, perChainUsd / Math.max(1e-9, prices[chain]));
    }
  }

  /** Quote-asset prices change; positions and cash keep their native amounts. */
  setPrices(prices: QuotePrices): void {
    this.prices = prices;
  }

  quotePrice(chain: ChainId): number {
    return this.prices[chain] ?? 1;
  }

  quoteSymbol(chain: ChainId): string {
    return CHAINS[chain].native;
  }

  /** Free cash on one chain, in that chain's quote asset. */
  cashOn(chain: ChainId): number {
    return this.cash.get(chain) ?? 0;
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

  /** Book a buy: cash leaves that chain's treasury, a position opens on it. */
  applyBuy(fill: Fill, risk: RiskConfig): Position {
    this.cash.set(fill.chain, this.cashOn(fill.chain) - fill.valueNative);
    this.fills.push(fill);

    const existing = this.positions.get(fill.tokenId);
    if (existing) {
      const quantity = existing.quantity + fill.quantity;
      const costNative = existing.costNative + fill.valueNative;
      const merged: Position = {
        ...existing,
        quantity,
        costNative,
        entryPriceUsd:
          (existing.entryPriceUsd * existing.quantity + fill.priceUsd * fill.quantity) / quantity,
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
      costNative: fill.valueNative,
      quote: fill.quote,
      openedAt: fill.at,
      stopLossPct: risk.stopLossPct,
      takeProfitLadder: [...risk.takeProfitLadder],
      filledRungs: 0,
      peakPriceUsd: fill.priceUsd,
      trailingStopPct: risk.trailingStopPct,
      currentPriceUsd: fill.priceUsd,
      unrealizedPnlNative: 0,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
    };
    this.positions.set(fill.tokenId, position);
    return position;
  }

  /** Book a sell: proceeds return to the same chain's treasury. */
  applySell(fill: Fill, rungTaken: boolean): void {
    const position = this.positions.get(fill.tokenId);
    this.cash.set(fill.chain, this.cashOn(fill.chain) + fill.valueNative - fill.feeNative);
    this.fills.push(fill);

    const pnlUsd = fill.realizedPnlUsd ?? 0;
    this.realizedPnlUsd += pnlUsd;
    this.bestTradeUsd = Math.max(this.bestTradeUsd, pnlUsd);
    this.worstTradeUsd = Math.min(this.worstTradeUsd, pnlUsd);

    if (!position) return;
    const remaining = position.quantity - fill.quantity;
    const closed = remaining <= position.quantity * 0.005;

    if (closed) {
      if (pnlUsd >= 0) this.wins += 1;
      else this.losses += 1;
      this.positions.delete(fill.tokenId);
      return;
    }
    this.positions.set(fill.tokenId, {
      ...position,
      quantity: remaining,
      costNative: position.costNative * (remaining / position.quantity),
      filledRungs: rungTaken ? position.filledRungs + 1 : position.filledRungs,
    });
  }

  /** Re-price open positions against the latest market snapshot. */
  markToMarket(tokens: Map<string, Token>): void {
    for (const [id, position] of this.positions) {
      const token = tokens.get(id);
      const price = token?.priceUsd ?? position.currentPriceUsd;
      const quotePrice = this.quotePrice(position.chain);
      const valueNative = (position.quantity * price) / quotePrice;
      const pnlNative = valueNative - position.costNative;
      this.positions.set(id, {
        ...position,
        currentPriceUsd: price,
        peakPriceUsd: Math.max(position.peakPriceUsd, price),
        unrealizedPnlNative: pnlNative,
        unrealizedPnlUsd: pnlNative * quotePrice,
        unrealizedPnlPct: ((price - position.entryPriceUsd) / position.entryPriceUsd) * 100,
      });
    }
  }

  /** Marked value of open positions on one chain, in its quote asset. */
  positionsValueOn(chain: ChainId): number {
    let sum = 0;
    for (const p of this.positions.values()) {
      if (p.chain !== chain) continue;
      sum += (p.quantity * p.currentPriceUsd) / this.quotePrice(chain);
    }
    return sum;
  }

  /** Everything the desk owns on one chain, in that chain's quote asset. */
  equityOn(chain: ChainId): number {
    return this.cashOn(chain) + this.positionsValueOn(chain);
  }

  equityUsd(): number {
    let sum = 0;
    for (const chain of this.chains) sum += this.equityOn(chain) * this.quotePrice(chain);
    return sum;
  }

  /** Percentage drawdown since the rolling 24h anchor — feeds the loss limit. */
  dailyDrawdownPct(): number {
    if (Date.now() - this.dayAnchorAt > 24 * 60 * 60_000) {
      this.dayAnchorAt = Date.now();
      this.dayAnchorEquityUsd = this.equityUsd();
    }
    return ((this.dayAnchorEquityUsd - this.equityUsd()) / this.dayAnchorEquityUsd) * 100;
  }

  treasuries(): ChainTreasury[] {
    return this.chains.map((chain) => {
      const quotePriceUsd = this.quotePrice(chain);
      const cashNative = this.cashOn(chain);
      const positionsValueNative = this.positionsValueOn(chain);
      const equityNative = cashNative + positionsValueNative;
      return {
        chain,
        label: CHAINS[chain].label,
        quote: CHAINS[chain].native,
        quotePriceUsd,
        cashNative,
        positionsValueNative,
        equityNative,
        equityUsd: equityNative * quotePriceUsd,
        openPositions: [...this.positions.values()].filter((p) => p.chain === chain).length,
      };
    });
  }

  snapshot(): PortfolioSnapshot {
    const treasuries = this.treasuries();
    const equityUsd = treasuries.reduce((s, t) => s + t.equityUsd, 0);
    const cashUsd = treasuries.reduce((s, t) => s + t.cashNative * t.quotePriceUsd, 0);
    const unrealizedUsd = [...this.positions.values()].reduce((s, p) => s + p.unrealizedPnlUsd, 0);

    const last = this.equityCurve[this.equityCurve.length - 1];
    if (!last || Math.abs(last.p - equityUsd) > 1e-9) {
      this.equityCurve.push({ t: Date.now(), p: equityUsd });
      if (this.equityCurve.length > 240) this.equityCurve.shift();
    }

    const settled = this.wins + this.losses;
    return {
      treasuries,
      cashUsd,
      positionsValueUsd: equityUsd - cashUsd,
      equityUsd,
      startingEquityUsd: this.startingEquityUsd,
      realizedPnlUsd: this.realizedPnlUsd,
      unrealizedPnlUsd: unrealizedUsd,
      totalPnlPct: ((equityUsd - this.startingEquityUsd) / this.startingEquityUsd) * 100,
      openPositions: this.positions.size,
      wins: this.wins,
      losses: this.losses,
      winRate: settled ? (this.wins / settled) * 100 : 0,
      bestTradeUsd: this.bestTradeUsd,
      worstTradeUsd: this.worstTradeUsd,
      equityCurve: [...this.equityCurve],
    };
  }

  /** Used when the operator changes the book size from the settings panel. */
  resetTo(startingEquityUsd: number): void {
    this.startingEquityUsd = startingEquityUsd;
    this.fund(startingEquityUsd, this.prices);
    this.positions.clear();
    this.fills.length = 0;
    this.realizedPnlUsd = 0;
    this.wins = 0;
    this.losses = 0;
    this.bestTradeUsd = 0;
    this.worstTradeUsd = 0;
    this.equityCurve.length = 0;
    this.equityCurve.push({ t: Date.now(), p: startingEquityUsd });
    this.dayAnchorEquityUsd = startingEquityUsd;
    this.dayAnchorAt = Date.now();
  }
}
