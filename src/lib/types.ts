/**
 * Shared domain vocabulary for the terminal.
 *
 * Everything that crosses an agent boundary, a network boundary (SSE payloads)
 * or the server/client boundary is typed here so the wire format has exactly
 * one definition.
 */

export type ChainId = "solana" | "robinhood";

export type MarketMode = "live" | "simulated";

/** What the terminal is allowed to do with a trade decision. */
export type AutonomyMode = "auto" | "manual";

export type AgentId =
  | "scout"
  | "sentinel"
  | "quant"
  | "narrator"
  | "risk"
  | "executor";

export type AgentStatus = "idle" | "thinking" | "acting" | "blocked" | "offline";

export interface AgentDescriptor {
  id: AgentId;
  /** Short call-sign shown in the UI. */
  name: string;
  role: string;
  /** Categorical palette slot, validated for the dark surface. */
  color: string;
  glyph: string;
}

export interface AgentRuntimeState extends AgentDescriptor {
  status: AgentStatus;
  /** Human-readable one-liner of what the agent is doing right now. */
  activity: string;
  /** Rolling count of decisions the agent contributed this session. */
  decisions: number;
  /** Last tick (epoch ms) the agent produced output. */
  lastActiveAt: number;
  /** 0..1 — how loaded the agent is, drives the UI pulse. */
  load: number;
  /** Set when an optional upstream (e.g. Claude) is wired up. */
  augmented?: boolean;
}

/** A tradable memecoin pair as the terminal understands it. */
export interface Token {
  /** `${chain}:${pairAddress}` — stable identity across ticks. */
  id: string;
  chain: ChainId;
  pairAddress: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceNative: number;
  liquidityUsd: number;
  fdvUsd: number;
  volume24hUsd: number;
  volume5mUsd: number;
  buys5m: number;
  sells5m: number;
  change5m: number;
  change1h: number;
  change24h: number;
  /** Minutes since the pair was created. */
  ageMinutes: number;
  dex: string;
  url?: string;
  /** Newest-last price history the terminal keeps in memory. */
  history: PricePoint[];
  /** True when values come from the simulator rather than a live feed. */
  simulated: boolean;
}

export interface PricePoint {
  t: number;
  p: number;
  /**
   * Pool depth at that moment, in USD.
   *
   * Recorded alongside the price because the single most useful rug signal is
   * not any one snapshot but the difference between two: a pool that empties
   * while the chart climbs is being distributed into, and the desk lost real
   * money to that shape while showing a green position the whole way down.
   * Optional so a restored or hand-built history is still valid.
   */
  l?: number;
}

/** Per-agent verdict on a token, published to the blackboard each tick. */
export interface Signal {
  agent: AgentId;
  tokenId: string;
  /** -100 (strong avoid) .. +100 (strong conviction). */
  score: number;
  /** 0..1 how sure the agent is. */
  confidence: number;
  label: string;
  reasons: string[];
  /** A sentinel veto stops the whole pipeline for that token. */
  veto?: boolean;
  createdAt: number;
}

export interface ConsensusView {
  tokenId: string;
  symbol: string;
  chain: ChainId;
  /** Weighted blend of all agent scores, -100..100. */
  score: number;
  confidence: number;
  verdict: "strong-buy" | "buy" | "watch" | "avoid" | "vetoed";
  signals: Signal[];
  updatedAt: number;
}

export type TradeSide = "buy" | "sell";

export interface TradeIntent {
  id: string;
  tokenId: string;
  symbol: string;
  chain: ChainId;
  side: TradeSide;
  /** Notional in the chain's own quote asset (SOL on Solana, ETH on an L2). */
  sizeNative: number;
  /** Ticker of that quote asset, so the UI never mislabels a ticket. */
  quote: string;
  reason: string;
  consensusScore: number;
  confidence: number;
  createdAt: number;
  /** Populated for exits. */
  positionId?: string;
}

/**
 * One completed round trip: everything from the first buy to the fill that
 * closed the position.
 *
 * This is the unit a trader actually judges — a `Fill` is a leg, and a position
 * exited across a take-profit ladder produces several of them. Asking "did that
 * one win?" of a single leg gives the wrong answer whenever the ladder ran.
 */
export interface ClosedTrade {
  id: string;
  tokenId: string;
  symbol: string;
  chain: ChainId;
  /** The chain's quote asset — what the P/L below is denominated in. */
  quote: string;
  openedAt: number;
  closedAt: number;
  holdMs: number;
  /** Quantity-weighted averages across every leg. */
  entryPriceUsd: number;
  exitPriceUsd: number;
  quantity: number;
  costNative: number;
  /** Received across all exits, net of fees. */
  proceedsNative: number;
  feesNative: number;
  pnlNative: number;
  pnlUsd: number;
  /** Return on cost, in percent. */
  pnlPct: number;
  /** How far up the trade ever was — the give-back is peak minus result. */
  peakGainPct: number;
  /** Deepest the pool was while held, and what was left at the exit. */
  peakLiquidityUsd: number;
  exitLiquidityUsd: number;
  /** How many separate exits it took — more than one means the ladder ran. */
  exits: number;
  rungsTaken: number;
  /** Why the final leg fired: stop-loss, a ladder rung, a veto, the kill switch. */
  exitReason: string;
  outcome: "win" | "loss";
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired";

export interface PendingApproval extends TradeIntent {
  state: ApprovalState;
  expiresAt: number;
}

export interface Position {
  id: string;
  tokenId: string;
  symbol: string;
  chain: ChainId;
  /** Units of the memecoin held. */
  quantity: number;
  entryPriceUsd: number;
  /** Cost basis in the chain's quote asset. */
  costNative: number;
  quote: string;
  openedAt: number;
  stopLossPct: number;
  /** Peak gain at which the stop moves up to entry. */
  breakevenTriggerPct: number;
  /** Where that stop sits, above entry, to cover round-trip costs. */
  breakevenBufferPct: number;
  /** Trail distance while the position is armed but below the first rung. */
  earlyTrailPct: number;
  takeProfitLadder: number[];
  /** Ladder rungs already taken. */
  filledRungs: number;
  /** Highest price seen since entry — drives the trailing stop. */
  peakPriceUsd: number;
  /** Pool depth when the position was opened. */
  entryLiquidityUsd: number;
  /** Deepest the pool has been while held — a drain is measured from here. */
  peakLiquidityUsd: number;
  trailingStopPct: number;
  currentPriceUsd: number;
  unrealizedPnlNative: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
}

export interface Fill {
  id: string;
  tokenId: string;
  symbol: string;
  chain: ChainId;
  side: TradeSide;
  quantity: number;
  priceUsd: number;
  /** Pool depth at the moment of the fill — the reference a drain is measured against. */
  liquidityUsd: number;
  /** Value and fee in the chain's quote asset. */
  valueNative: number;
  feeNative: number;
  quote: string;
  slippagePct: number;
  realizedPnlNative?: number;
  realizedPnlUsd?: number;
  reason: string;
  at: number;
  /** Mirrors how a real executor would report a signature. */
  txRef: string;
  mode: "paper" | "live";
}

/**
 * A chain's own book. Capital does not move between chains by itself, so each
 * one holds its own cash in its own quote asset — a SOL balance cannot pay for
 * a trade on an L2 whose gas and quote asset are ETH.
 */
export interface ChainTreasury {
  chain: ChainId;
  label: string;
  /** Quote asset ticker, e.g. SOL or ETH. */
  quote: string;
  quotePriceUsd: number;
  /** Free cash, in quote units. */
  cashNative: number;
  /** Open positions marked to market, in quote units. */
  positionsValueNative: number;
  equityNative: number;
  equityUsd: number;
  openPositions: number;
}

/**
 * The book as a whole. Aggregates are in USD because it is the only unit that
 * is meaningful across chains; each chain's own balance stays native.
 */
export interface PortfolioSnapshot {
  treasuries: ChainTreasury[];
  cashUsd: number;
  positionsValueUsd: number;
  equityUsd: number;
  startingEquityUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlPct: number;
  openPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  /** Equity in USD over the session. */
  equityCurve: PricePoint[];
}

export type LogLevel = "info" | "signal" | "trade" | "warn" | "error" | "system";

export interface LogEntry {
  id: string;
  at: number;
  agent: AgentId | "system";
  level: LogLevel;
  message: string;
  tokenSymbol?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface RiskConfig {
  /** Total book funding in USD, split evenly across the active chains. */
  startingCapitalUsd: number;
  maxPositionPct: number;
  maxOpenPositions: number;
  maxPortfolioExposurePct: number;
  stopLossPct: number;
  /**
   * Peak gain at which the stop moves up to the entry price.
   *
   * Without it a position could peak at +45%, get no protection at all because
   * the trailing stop only arms at the first take-profit rung, and ride the
   * whole way down to the hard stop. A trade that was clearly working should
   * not be able to become a full loser.
   */
  breakevenTriggerPct: number;
  /** Where the breakeven stop actually sits, above entry, to cover round-trip costs. */
  breakevenBufferPct: number;
  /**
   * Trail distance between the breakeven trigger and the first take-profit
   * rung. A fixed breakeven line is only crossed once the position is already
   * back at entry, and on a gapping asset the tick that notices is well below
   * it — measuring from the peak instead reacts while the trade is still up.
   */
  earlyTrailPct: number;
  takeProfitLadder: number[];
  trailingStopPct: number;
  /**
   * Exit when the pool has drained this far below its deepest level while held.
   * On most rugs liquidity leaves with the price or just before it, and an
   * absolute floor reacts far too late for a pool that started deep.
   */
  liquidityDropExitPct: number;
  maxSlippagePct: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxPairAgeMinutes: number;
  /**
   * How far a pair may already have run in an hour and still be entered.
   * Past it the desk is paying for a move that has happened; the penalty
   * scales rather than switching off, so a strong trend is not banned outright.
   */
  maxEntryRunPct: number;
  /**
   * How far the pool may empty under a held position, in percent over the
   * trend window, before the desk gets out — and how hard SENTINEL scores the
   * same shape on a candidate. 0 switches both off.
   */
  liquidityTrendExitPct: number;
  /**
   * Safety factor on the gas held back for exits. 2 means twice the budgeted
   * fee, because a priority fee in a contested block is not the fee you
   * budgeted for.
   */
  gasReserveMultiple: number;
  /**
   * How hard QUANT leans on each of three inputs the tape has now measured.
   *
   * Order-flow imbalance (`quantFlowWeight`) failed three independent checks —
   * both horizons and both halves of the recording — and is still the second
   * heaviest term in the heaviest vote. Volume acceleration
   * (`quantVolumeWeight`) predicts return and predicts collapse in the same
   * breath; it is the risk dial, not an edge. Turnover against pool depth
   * (`quantTurnoverWeight`) is the only reading so far that bought return
   * without buying the same amount of rug, in both halves — and QUANT does not
   * read it at all today, which is why it defaults to zero: the default must
   * change nothing until a backtest says otherwise.
   */
  quantFlowWeight: number;
  quantVolumeWeight: number;
  quantTurnoverWeight: number;
  minConsensusScore: number;
  dailyLossLimitPct: number;
}

export interface EngineFlags {
  autonomy: AutonomyMode;
  killSwitch: boolean;
  marketMode: MarketMode;
  chains: ChainId[];
  narrativeAugmented: boolean;
  providers: { birdeye: boolean; helius: boolean; anthropic: boolean };
}

/** The single object the UI renders. Sent over SSE on every tick. */
export interface TerminalSnapshot {
  tick: number;
  at: number;
  flags: EngineFlags;
  risk: RiskConfig;
  agents: AgentRuntimeState[];
  watchlist: Token[];
  consensus: ConsensusView[];
  positions: Position[];
  fills: Fill[];
  closedTrades: ClosedTrade[];
  approvals: PendingApproval[];
  portfolio: PortfolioSnapshot;
  logs: LogEntry[];
  chainStatus: ChainStatus[];
  diagnostics: TickDiagnostics;
}

/**
 * Why the desk did or did not open anything this tick.
 *
 * An autonomous desk whose inaction you cannot read is not trustworthy, however
 * good its logic. This is the funnel from "pairs we know about" down to "ticket
 * sized", so a quiet desk can be told apart from a stuck one at a glance.
 */
export interface TickDiagnostics {
  universeSize: number;
  watchlistSize: number;
  /** Where this tick's pairs came from. */
  discovery: {
    fromLaunchpad: number;
    fromSearch: number;
    addedThisCycle: number;
    agedOut: number;
    lastDiscoveryAt: number;
  };
  /** Each stage counts candidates that stopped there. */
  funnel: {
    considered: number;
    vetoed: number;
    belowScore: number;
    alreadyHeld: number;
    noCash: number;
    tooSmall: number;
    slippage: number;
    noSlot: number;
    sized: number;
  };
  /** Single-sentence answer to "why is nothing happening?", or null when trading. */
  blocker: string | null;
  /**
   * Set only while the daily loss limit is holding the desk. Carries what the
   * operator needs to decide: how deep the drawdown is, and when it lifts on
   * its own if they do nothing.
   */
  halt: { drawdownPct: number; limitPct: number; rollsAt: number } | null;
  /** Median age of the watchlist, in minutes — a stale board shows up here. */
  medianAgeMinutes: number;
}

export interface ChainStatus {
  chain: ChainId;
  label: string;
  mode: MarketMode | "unavailable";
  pairsTracked: number;
  lastFetchAt: number;
  note: string;
  /** Pairs this chain contributed from its launchpad feed last discovery. */
  freshLaunches: number;
  /** Pairs dropped as stale since the last poll. */
  agedOut: number;
}
