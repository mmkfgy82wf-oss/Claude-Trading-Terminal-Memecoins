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
  takeProfitLadder: number[];
  /** Ladder rungs already taken. */
  filledRungs: number;
  /** Highest price seen since entry — drives the trailing stop. */
  peakPriceUsd: number;
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
  takeProfitLadder: number[];
  trailingStopPct: number;
  maxSlippagePct: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxPairAgeMinutes: number;
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
  approvals: PendingApproval[];
  portfolio: PortfolioSnapshot;
  logs: LogEntry[];
  chainStatus: ChainStatus[];
}

export interface ChainStatus {
  chain: ChainId;
  label: string;
  mode: MarketMode | "unavailable";
  pairsTracked: number;
  lastFetchAt: number;
  note: string;
}
