import { now } from "@/lib/util/clock";
import { CHAINS } from "@/lib/market/chains";
import type { BookState } from "./persistence";
import type {
  ChainId,
  ChainTreasury,
  ClosedTrade,
  Fill,
  PortfolioSnapshot,
  Position,
  PricePoint,
  RiskConfig,
  Token,
} from "@/lib/types";

let posSeq = 0;
let tradeSeq = 0;

/** A round trip while it is still open, accumulating legs as they fill. */
interface OpenTrade {
  id: string;
  tokenId: string;
  symbol: string;
  chain: ChainId;
  quote: string;
  openedAt: number;
  quantity: number;
  costNative: number;
  proceedsNative: number;
  feesNative: number;
  entryValueUsd: number;
  exitValueUsd: number;
  exitQuantity: number;
  exits: number;
  rungsTaken: number;
}

const DAY_MS = 24 * 60 * 60_000;

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
  /** Legs accumulate here until the position closes and the trade is booked. */
  private readonly openTrades = new Map<string, OpenTrade>();
  private readonly trades: ClosedTrade[] = [];
  private readonly fills: Fill[] = [];
  private realizedPnlUsd = 0;
  private wins = 0;
  private losses = 0;
  private bestTradeUsd = 0;
  private worstTradeUsd = 0;
  private readonly equityCurve: PricePoint[] = [];
  /**
   * What the book was funded with, in native units per chain.
   *
   * The benchmark has to be the *holdings*, not a dollar figure frozen at
   * funding time. Hold 5 SOL through a 40% drop in SOL and your dollar book
   * halves — real, but nothing the desk did. Measuring against what those same
   * holdings are worth right now isolates trading from the quote asset's own
   * market.
   */
  private readonly initialCash = new Map<ChainId, number>();
  /** Equity over benchmark at the anchor — a ratio, so prices cancel out. */
  private dayAnchorRatio = 1;
  private dayAnchorAt = now();

  constructor(
    private startingEquityUsd: number,
    private readonly chains: ChainId[],
    private prices: QuotePrices,
  ) {
    this.fund(startingEquityUsd, prices);
    this.equityCurve.push({ t: now(), p: 100 });
  }

  /** Split the book evenly across the active chains, held natively. */
  private fund(totalUsd: number, prices: QuotePrices): void {
    const perChainUsd = totalUsd / Math.max(1, this.chains.length);
    this.cash.clear();
    this.initialCash.clear();
    for (const chain of this.chains) {
      const native = perChainUsd / Math.max(1e-9, prices[chain]);
      this.cash.set(chain, native);
      this.initialCash.set(chain, native);
    }
    this.dayAnchorRatio = 1;
    this.dayAnchorAt = now();
  }

  /**
   * Re-fund an untraded book at corrected prices.
   *
   * Quote prices are fetched after boot, so the first funding necessarily uses
   * fallbacks. Revaluing those holdings then showed a double-digit loss the desk
   * never made. Refuses once anything has happened, so it can never be a way to
   * paper over a real result.
   */
  refundAtPrices(prices: QuotePrices): boolean {
    if (this.positions.size > 0 || this.fills.length > 0 || this.trades.length > 0) return false;
    this.prices = prices;
    this.fund(this.startingEquityUsd, prices);
    this.equityCurve.length = 0;
    this.equityCurve.push({ t: now(), p: 100 });
    return true;
  }

  /** What the originally funded holdings are worth at today's prices. */
  benchmarkUsd(): number {
    let sum = 0;
    for (const [chain, native] of this.initialCash) sum += native * this.quotePrice(chain);
    return sum;
  }

  /** Equity over benchmark. 1 is flat, 1.1 is up a tenth — prices cancel. */
  private performance(): number {
    const benchmark = this.benchmarkUsd();
    return benchmark > 0 ? this.equityUsd() / benchmark : 1;
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
    this.recordEntry(fill);

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
        peakLiquidityUsd: Math.max(existing.peakLiquidityUsd, fill.liquidityUsd),
      };
      this.positions.set(fill.tokenId, merged);
      return merged;
    }

    const position: Position = {
      id: `p${now().toString(36)}${(++posSeq).toString(36)}`,
      tokenId: fill.tokenId,
      symbol: fill.symbol,
      chain: fill.chain,
      quantity: fill.quantity,
      entryPriceUsd: fill.priceUsd,
      costNative: fill.valueNative,
      quote: fill.quote,
      openedAt: fill.at,
      stopLossPct: risk.stopLossPct,
      breakevenTriggerPct: risk.breakevenTriggerPct,
      breakevenBufferPct: risk.breakevenBufferPct,
      earlyTrailPct: risk.earlyTrailPct,
      takeProfitLadder: [...risk.takeProfitLadder],
      filledRungs: 0,
      peakPriceUsd: fill.priceUsd,
      entryLiquidityUsd: fill.liquidityUsd,
      peakLiquidityUsd: fill.liquidityUsd,
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

    this.realizedPnlUsd += fill.realizedPnlUsd ?? 0;
    this.recordExit(fill);

    if (!position) return;
    const remaining = position.quantity - fill.quantity;
    const closed = remaining <= position.quantity * 0.005;

    if (closed) {
      // Judge the round trip, not this leg. A position that took a rung at
      // +50% and stopped out of the rest can still be a winner overall, and
      // scoring the last fill alone would file it as a loss.
      this.bookTrade(fill.tokenId, fill.reason, position, fill.liquidityUsd);
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

  private recordEntry(fill: Fill): void {
    const existing = this.openTrades.get(fill.tokenId);
    const usd = fill.quantity * fill.priceUsd;
    if (existing) {
      existing.quantity += fill.quantity;
      existing.costNative += fill.valueNative;
      existing.entryValueUsd += usd;
      return;
    }
    this.openTrades.set(fill.tokenId, {
      id: `t${now().toString(36)}${(++tradeSeq).toString(36)}`,
      tokenId: fill.tokenId,
      symbol: fill.symbol,
      chain: fill.chain,
      quote: fill.quote,
      openedAt: fill.at,
      quantity: fill.quantity,
      costNative: fill.valueNative,
      proceedsNative: 0,
      feesNative: fill.feeNative,
      entryValueUsd: usd,
      exitValueUsd: 0,
      exitQuantity: 0,
      exits: 0,
      rungsTaken: 0,
    });
  }

  private recordExit(fill: Fill): void {
    const trade = this.openTrades.get(fill.tokenId);
    if (!trade) return;
    trade.proceedsNative += fill.valueNative - fill.feeNative;
    trade.feesNative += fill.feeNative;
    trade.exitValueUsd += fill.quantity * fill.priceUsd;
    trade.exitQuantity += fill.quantity;
    trade.exits += 1;
    if (fill.reason.startsWith("take-profit")) trade.rungsTaken += 1;
  }

  /** Close the round trip and file it in the log. */
  private bookTrade(
    tokenId: string,
    exitReason: string,
    position: Position,
    exitLiquidityUsd: number,
  ): void {
    const trade = this.openTrades.get(tokenId);
    this.openTrades.delete(tokenId);
    if (!trade) return;

    const pnlNative = trade.proceedsNative - trade.costNative;
    const pnlUsd = pnlNative * this.quotePrice(trade.chain);
    const closedAt = now();

    if (pnlNative >= 0) this.wins += 1;
    else this.losses += 1;
    this.bestTradeUsd = Math.max(this.bestTradeUsd, pnlUsd);
    this.worstTradeUsd = Math.min(this.worstTradeUsd, pnlUsd);

    this.trades.push({
      id: trade.id,
      tokenId: trade.tokenId,
      symbol: trade.symbol,
      chain: trade.chain,
      quote: trade.quote,
      openedAt: trade.openedAt,
      closedAt,
      holdMs: closedAt - trade.openedAt,
      entryPriceUsd: trade.quantity > 0 ? trade.entryValueUsd / trade.quantity : 0,
      exitPriceUsd: trade.exitQuantity > 0 ? trade.exitValueUsd / trade.exitQuantity : 0,
      quantity: trade.quantity,
      costNative: trade.costNative,
      proceedsNative: trade.proceedsNative,
      feesNative: trade.feesNative,
      pnlNative,
      pnlUsd,
      pnlPct: trade.costNative > 0 ? (pnlNative / trade.costNative) * 100 : 0,
      // Recorded so a run can answer why an exit landed where it did: a big
      // peak with a deep give-back means the price gapped past the rule, while
      // a collapsed pool means the exit could not clear at any sane price.
      peakGainPct:
        position.entryPriceUsd > 0
          ? ((position.peakPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100
          : 0,
      peakLiquidityUsd: position.peakLiquidityUsd,
      exitLiquidityUsd,
      exits: trade.exits,
      rungsTaken: trade.rungsTaken,
      exitReason,
      outcome: pnlNative >= 0 ? "win" : "loss",
    });
    if (this.trades.length > 300) this.trades.shift();
  }

  /** The trade log, newest first. */
  closedTrades(limit = 60): ClosedTrade[] {
    return this.trades.slice(-limit).reverse();
  }

  /** Re-price open positions against the latest market snapshot. */
  markToMarket(tokens: Map<string, Token>): void {
    for (const [id, position] of this.positions) {
      const token = tokens.get(id);
      const price = token?.priceUsd ?? position.currentPriceUsd;
      const liquidity = token?.liquidityUsd ?? 0;
      const quotePrice = this.quotePrice(position.chain);
      const valueNative = (position.quantity * price) / quotePrice;
      const pnlNative = valueNative - position.costNative;
      this.positions.set(id, {
        ...position,
        currentPriceUsd: price,
        peakPriceUsd: Math.max(position.peakPriceUsd, price),
        peakLiquidityUsd: Math.max(position.peakLiquidityUsd, liquidity),
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

  /**
   * Percentage drawdown since the rolling 24h anchor — feeds the loss limit.
   *
   * The anchor rolls on its own after 24h, but that is a long time to stare at
   * a halted desk: once entries stop, equity can only move through positions
   * that are already open, so a breached limit tends to stay breached. The
   * operator can therefore re-arm it deliberately (`rearmDailyLimit`), which is
   * the honest version of "I have seen it, carry on" — the halt is never lifted
   * silently.
   */
  dailyDrawdownPct(): number {
    if (now() - this.dayAnchorAt > DAY_MS) {
      this.dayAnchorAt = now();
      this.dayAnchorRatio = this.performance();
    }
    // Measured on the ratio, so a slide in SOL or ETH cannot halt the desk for
    // a loss it did not make.
    return ((this.dayAnchorRatio - this.performance()) / this.dayAnchorRatio) * 100;
  }

  /** When the anchor rolls by itself, as epoch ms. */
  dailyLimitRollsAt(): number {
    return this.dayAnchorAt + DAY_MS;
  }

  /**
   * Re-anchor the daily loss limit to right now.
   *
   * Positions, cash, fills and the equity curve are untouched — only the
   * reference point the limit measures against moves. Use this to carry on from
   * where the desk actually stands rather than wiping the run.
   */
  rearmDailyLimit(): void {
    this.dayAnchorAt = now();
    this.dayAnchorRatio = this.performance();
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

    // The curve is an index, 100 at funding: it answers "is the desk ahead?"
    // without a move in SOL or ETH dragging the whole line with it.
    const benchmarkUsd = this.benchmarkUsd();
    const index = benchmarkUsd > 0 ? (equityUsd / benchmarkUsd) * 100 : 100;
    const last = this.equityCurve[this.equityCurve.length - 1];
    if (!last || Math.abs(last.p - index) > 1e-9) {
      this.equityCurve.push({ t: now(), p: index });
      if (this.equityCurve.length > 240) this.equityCurve.shift();
    }

    const settled = this.wins + this.losses;
    return {
      treasuries,
      cashUsd,
      positionsValueUsd: equityUsd - cashUsd,
      equityUsd,
      startingEquityUsd: benchmarkUsd,
      realizedPnlUsd: this.realizedPnlUsd,
      unrealizedPnlUsd: unrealizedUsd,
      totalPnlPct: benchmarkUsd > 0 ? ((equityUsd - benchmarkUsd) / benchmarkUsd) * 100 : 0,
      openPositions: this.positions.size,
      wins: this.wins,
      losses: this.losses,
      winRate: settled ? (this.wins / settled) * 100 : 0,
      bestTradeUsd: this.bestTradeUsd,
      worstTradeUsd: this.worstTradeUsd,
      equityCurve: [...this.equityCurve],
    };
  }

  /** Everything needed to rebuild this book after a restart. */
  serialize(): BookState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      startingEquityUsd: this.startingEquityUsd,
      cash: Object.fromEntries(this.cash),
      positions: [...this.positions.values()],
      // The tape is unbounded over a long run; the recent past is what the UI
      // shows and what a restart needs to look continuous.
      fills: this.fills.slice(-200),
      trades: this.trades.slice(-300),
      realizedPnlUsd: this.realizedPnlUsd,
      wins: this.wins,
      losses: this.losses,
      bestTradeUsd: this.bestTradeUsd,
      worstTradeUsd: this.worstTradeUsd,
      equityCurve: [...this.equityCurve],
      initialCash: Object.fromEntries(this.initialCash),
      dayAnchorRatio: this.dayAnchorRatio,
      dayAnchorAt: this.dayAnchorAt,
    };
  }

  /**
   * Rebuild from a saved book.
   *
   * The daily-limit anchor is restored as it was: a restart must not hand the
   * desk a clean slate on a limit it had already breached, or restarting would
   * become the way around the loss limit.
   */
  restore(state: BookState): void {
    this.startingEquityUsd = state.startingEquityUsd;
    this.cash.clear();
    for (const [chain, amount] of Object.entries(state.cash)) {
      this.cash.set(chain as ChainId, Number(amount) || 0);
    }
    this.positions.clear();
    for (const position of state.positions) this.positions.set(position.tokenId, position);
    this.fills.length = 0;
    this.fills.push(...state.fills);
    this.trades.length = 0;
    // Books written before the trade log existed simply have none.
    if (Array.isArray(state.trades)) this.trades.push(...state.trades);
    this.openTrades.clear();
    this.realizedPnlUsd = state.realizedPnlUsd;
    this.wins = state.wins;
    this.losses = state.losses;
    this.bestTradeUsd = state.bestTradeUsd;
    this.worstTradeUsd = state.worstTradeUsd;
    this.equityCurve.length = 0;
    this.equityCurve.push(...state.equityCurve);
    this.initialCash.clear();
    if (state.initialCash) {
      for (const [chain, native] of Object.entries(state.initialCash)) {
        this.initialCash.set(chain as ChainId, Number(native) || 0);
      }
    } else {
      // A book from before the benchmark was held natively: rebuild it from the
      // dollar figure at today's prices. The baseline restarts from here rather
      // than carrying forward a number that was wrong to begin with.
      const perChainUsd = state.startingEquityUsd / Math.max(1, this.chains.length);
      for (const chain of this.chains) {
        this.initialCash.set(chain, perChainUsd / Math.max(1e-9, this.quotePrice(chain)));
      }
    }
    this.dayAnchorRatio = state.dayAnchorRatio ?? 1;
    this.dayAnchorAt = state.dayAnchorAt;
  }

  /**
   * Start the run over: fresh treasuries, no positions, no history.
   *
   * This is a paper-trading affordance and nothing else — it exists so a run
   * can be repeated under changed parameters, which is how you learn anything
   * from a simulated book.
   */
  resetTo(startingEquityUsd: number): void {
    this.startingEquityUsd = startingEquityUsd;
    this.fund(startingEquityUsd, this.prices);
    this.positions.clear();
    this.openTrades.clear();
    this.trades.length = 0;
    this.fills.length = 0;
    this.realizedPnlUsd = 0;
    this.wins = 0;
    this.losses = 0;
    this.bestTradeUsd = 0;
    this.worstTradeUsd = 0;
    this.equityCurve.length = 0;
    this.equityCurve.push({ t: now(), p: 100 });
  }
}
