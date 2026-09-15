import { Blackboard } from "@/lib/agents/blackboard";
import type { AgentContext } from "@/lib/agents/base";
import { ExecutorAgent } from "@/lib/agents/executor";
import { NarratorAgent } from "@/lib/agents/narrator";
import { runDeskCycle } from "@/lib/agents/pipeline";
import { QuantAgent } from "@/lib/agents/quant";
import { RiskAgent } from "@/lib/agents/risk";
import { ScoutAgent } from "@/lib/agents/scout";
import { SentinelAgent } from "@/lib/agents/sentinel";
import { PaperExecutor } from "@/lib/trading/executor";
import { AGGRESSIVE } from "@/lib/trading/risk";
import { PaperWallet, type QuotePrices } from "@/lib/trading/wallet";
import type { ChainId, ClosedTrade, EngineFlags, PricePoint, RiskConfig, Token } from "@/lib/types";
import { setClock, VirtualClock } from "@/lib/util/clock";
import { seeded, setRandom } from "@/lib/util/random";
import { tokenFeatures } from "./features";
import type { SnapshotSource } from "./source";

/**
 * Replay a market tape through the real desk.
 *
 * The point of this file is what it *does not* contain: no second copy of the
 * pipeline, no backtest-flavoured wallet, no re-implemented exit rules. It
 * builds the same six agents the terminal builds, hands them the same
 * blackboard and the same PaperWallet, and calls the same `runDeskCycle`. What
 * it replaces is only the two things a replay must control — where the tokens
 * come from, and what time it is.
 *
 * Determinism is deliberate. The clock is driven off the tape's own timestamps
 * and the slippage jitter is seeded, so running the same tape twice with the
 * same config gives the same trades to the cent. Without that an A/B comparison
 * measures the random number generator.
 */

export interface ReplayOptions {
  /** Shown in reports. Defaults to the source origin. */
  label?: string;
  /** Overrides on top of the AGGRESSIVE profile — the thing under test. */
  risk?: Partial<RiskConfig>;
  seed?: number;
  chains?: ChainId[];
  /**
   * Close whatever is still open on the last frame. On by default: a config
   * that ends holding three losers has not avoided them, and leaving them out
   * of the tally flatters exactly the rules that hesitate.
   */
  liquidateAtEnd?: boolean;
  /** Called once per position opened, with what the desk saw at that moment. */
  onEntry?: (entry: EntryObservation) => void;
}

/**
 * A position the moment it was opened: everything the desk could see about the
 * token, plus what each agent thought of it. Joined to the trade's outcome
 * afterwards, this is what turns "which rule should we try next" from a guess
 * into a measurement.
 */
export interface EntryObservation {
  /** `${tokenId}@${openedAt}` — the same key the closed trade can be found by. */
  key: string;
  tokenId: string;
  symbol: string;
  at: number;
  features: Record<string, number>;
}

export interface EquityPoint {
  t: number;
  usd: number;
}

export interface ReplayResult {
  label: string;
  origin: string;
  kind: string;
  risk: RiskConfig;
  frames: number;
  /** Simulated wall-clock span of the tape. */
  spanMs: number;
  trades: ClosedTrade[];
  equity: EquityPoint[];
  startingEquityUsd: number;
  finalEquityUsd: number;
  /**
   * What the book would have done untouched: the funded treasuries valued at
   * the tape's closing quote prices.
   *
   * Without this every return above is read against zero, which is the wrong
   * line. Over one recorded night SOL and ETH fell 3.6%, so a configuration
   * that made 0% beat one that made -3% by doing nothing at all — and a
   * configuration that took a hundred trades to reach +2.3% only cleared
   * holding by six points, not by two.
   */
  holdReturnPct: number;
  /**
   * What the run paid to trade: DEX fees plus gas, and what slippage cost on
   * top. Reported because the two scale differently with ticket size — a flat
   * gas cost is a rounding error on a $270 order and a real drag on a $15 one,
   * which is exactly the question a small live book raises.
   */
  feesUsd: number;
  slippageUsd: number;
  /** Positions force-closed on the last frame, if any. */
  forcedExits: number;
  /** Entries the desk wanted but could not take, by reason. */
  rejections: Map<string, number>;
  /** Set only on a pooled result, where a single equity curve is meaningless. */
  pooledDrawdownPct?: number;
}

const QUOTE_FALLBACK: QuotePrices = { solana: 180, robinhood: 3200 };

export async function replay(source: SnapshotSource, options: ReplayOptions = {}): Promise<ReplayResult> {
  const risk: RiskConfig = { ...AGGRESSIVE, ...options.risk };
  const chains = options.chains ?? ["solana", "robinhood"];

  const clock = new VirtualClock(Date.now());
  const restoreClock = setClock(clock.now);
  const restoreRandom = setRandom(seeded(options.seed ?? 0x5eed));

  try {
    const board = new Blackboard();
    const wallet = new PaperWallet(risk.startingCapitalUsd, chains, QUOTE_FALLBACK);
    const agents = {
      scout: new ScoutAgent(),
      sentinel: new SentinelAgent(),
      quant: new QuantAgent(),
      narrator: new NarratorAgent(),
      risk: new RiskAgent(),
      executor: new ExecutorAgent(new PaperExecutor()),
    };

    const rejections = new Map<string, number>();
    const equity: EquityPoint[] = [];
    // Price history is rebuilt exactly as the live feed rebuilds it, so QUANT
    // sees the same slope and realised volatility it would have seen live.
    const history = new Map<string, PricePoint[]>();

    let frames = 0;
    let tick = 0;
    let firstAt = 0;
    let lastAt = 0;
    let lastTokens: Token[] = [];
    let quotes: QuotePrices = { ...QUOTE_FALLBACK };
    let startingEquityUsd = 0;
    const seenPositions = new Set<string>();

    for await (const frame of source.frames()) {
      tick += 1;
      frames += 1;
      clock.set(frame.t);
      if (firstAt === 0) {
        firstAt = frame.t;
        // Fund at the tape's own quote prices, not at a guess, or the run
        // opens with a paper loss it never traded for.
        quotes = { ...quotes, ...frame.quotes };
        wallet.setPrices(quotes);
        wallet.refundAtPrices(quotes);
        startingEquityUsd = wallet.equityUsd();
      }
      lastAt = frame.t;

      quotes = { ...quotes, ...frame.quotes };
      wallet.setPrices(quotes);

      const tokens: Token[] = frame.tokens.map((raw) => {
        const prior = history.get(raw.id) ?? [];
        const next = [...prior, { t: frame.t, p: raw.priceUsd, l: raw.liquidityUsd }].slice(-120);
        history.set(raw.id, next);
        return { ...raw, history: next } as Token;
      });
      lastTokens = tokens;

      // Anything no longer on the tape stops accumulating history, so a pair
      // that comes back after an hour does not look continuous.
      const live = new Set(tokens.map((t) => t.id));
      for (const id of history.keys()) if (!live.has(id)) history.delete(id);

      board.setUniverse(tokens);
      const byId = new Map(tokens.map((t) => [t.id, t]));
      wallet.markToMarket(byId);

      const contextFor = (): AgentContext => ({
        tick,
        board,
        wallet,
        risk,
        flags: flags(chains),
        log: (level, message) => {
          if (level === "warn" && message.startsWith("entry rejected")) {
            const why = message.slice(message.indexOf(":") + 1).trim().split(/\s+/).slice(0, 2).join(" ");
            rejections.set(why, (rejections.get(why) ?? 0) + 1);
          }
        },
      });

      await runDeskCycle(
        agents,
        contextFor,
        async (ctx) => {
          // A replay is always autonomous. An approval queue would need a human
          // in it, and "what would the desk have done unattended" is the whole
          // question a backtest is asked.
          for (const intent of agents.risk.pending) await agents.executor.enter(intent, ctx);
        },
      );

      if (options.onEntry) {
        for (const position of wallet.openPositions()) {
          if (seenPositions.has(position.id)) continue;
          seenPositions.add(position.id);
          const token = byId.get(position.tokenId);
          if (token) options.onEntry(observe(position.id, position.tokenId, position.symbol, position.openedAt, token, board));
        }
      }

      equity.push({ t: frame.t, usd: wallet.equityUsd() });
    }

    let forcedExits = 0;
    if (frames > 0 && (options.liquidateAtEnd ?? true)) {
      board.setUniverse(lastTokens);
      wallet.markToMarket(new Map(lastTokens.map((t) => [t.id, t])));
      const ctx: AgentContext = {
        tick: tick + 1,
        board,
        wallet,
        risk,
        flags: flags(chains),
        log: () => {},
      };
      forcedExits = await agents.executor.liquidateAll(ctx, "end of tape");
      if (forcedExits > 0) equity.push({ t: lastAt, usd: wallet.equityUsd() });
    }

    const closed = wallet.closedTrades(1_000_000);
    const feesUsd = closed.reduce((sum, t) => sum + t.feesNative * wallet.quotePrice(t.chain), 0);
    // Slippage is not booked anywhere — it is the gap between the quote and the
    // fill — so it has to be recovered from the fills themselves.
    const slippageUsd = wallet
      .recentFills(1_000_000)
      .reduce((sum, f) => sum + f.valueNative * wallet.quotePrice(f.chain) * (f.slippagePct / 100), 0);

    return {
      label: options.label ?? source.origin,
      origin: source.origin,
      kind: source.kind,
      risk,
      frames,
      spanMs: Math.max(0, lastAt - firstAt),
      trades: closed,
      equity,
      startingEquityUsd: startingEquityUsd || wallet.benchmarkUsd(),
      finalEquityUsd: wallet.equityUsd(),
      holdReturnPct:
        startingEquityUsd > 0 ? (wallet.benchmarkUsd() / startingEquityUsd - 1) * 100 : 0,
      feesUsd,
      slippageUsd,
      forcedExits,
      rejections,
    };
  } finally {
    restoreRandom();
    restoreClock();
  }
}

/**
 * The features are deliberately the raw things the agents already read, not
 * derived scores of my own invention. If a ratio separates winners from losers
 * here, it is a ratio the desk could act on tomorrow without new data.
 */
function observe(
  positionId: string,
  tokenId: string,
  symbol: string,
  openedAt: number,
  token: Token,
  board: Blackboard,
): EntryObservation {
  const consensus = board.consensus().find((c) => c.tokenId === tokenId);
  const scoreOf = (agent: "scout" | "sentinel" | "quant" | "narrator"): number =>
    board.signalBy(tokenId, agent)?.score ?? NaN;

  return {
    key: `${tokenId}@${openedAt}`,
    tokenId,
    symbol,
    at: openedAt,
    features: {
      ...tokenFeatures(token),
      konsens: consensus?.score ?? NaN,
      scout: scoreOf("scout"),
      sentinel: scoreOf("sentinel"),
      quant: scoreOf("quant"),
      narrator: scoreOf("narrator"),
    },
  };
  void positionId;
}

function flags(chains: ChainId[]): EngineFlags {
  return {
    autonomy: "auto",
    killSwitch: false,
    marketMode: "live",
    chains,
    narrativeAugmented: false,
    providers: { birdeye: false, helius: false, anthropic: false },
  };
}
