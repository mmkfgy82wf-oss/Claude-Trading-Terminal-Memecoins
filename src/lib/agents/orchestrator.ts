import { MarketFeed } from "@/lib/market/feed";
import { fetchQuotePrices, providerFlags } from "@/lib/market/providers";
import { PaperExecutor } from "@/lib/trading/executor";
import { AGGRESSIVE, sanitizeRisk } from "@/lib/trading/risk";
import { loadBook, saveBook } from "@/lib/trading/persistence";
import { PaperWallet, type QuotePrices } from "@/lib/trading/wallet";
import type {
  AgentId,
  AutonomyMode,
  ChainId,
  EngineFlags,
  LogEntry,
  LogLevel,
  PendingApproval,
  RiskConfig,
  TerminalSnapshot,
  TickDiagnostics,
  Token,
} from "@/lib/types";
import { Blackboard } from "./blackboard";
import type { AgentContext } from "./base";
import { ExecutorAgent } from "./executor";
import { NarratorAgent } from "./narrator";
import { QuantAgent } from "./quant";
import { RiskAgent } from "./risk";
import { ScoutAgent } from "./scout";
import { SentinelAgent } from "./sentinel";

const APPROVAL_TTL_MS = 90_000;
const MAX_LOGS = 300;

let logSeq = 0;

/**
 * The desk.
 *
 * One tick = poll the market, then run the agents in pipeline order through a
 * shared blackboard, then settle trades. It is a long-lived singleton so the
 * agents keep their memory (caches, price history, position state) between HTTP
 * requests; route handlers only read snapshots off it.
 */
export class Orchestrator {
  private readonly board = new Blackboard();
  private readonly wallet: PaperWallet;
  private readonly feed: MarketFeed;

  private readonly scout = new ScoutAgent();
  private readonly sentinel = new SentinelAgent();
  private readonly quant = new QuantAgent();
  private readonly narrator = new NarratorAgent();
  private readonly riskAgent = new RiskAgent();
  private readonly executor = new ExecutorAgent(new PaperExecutor());

  private risk: RiskConfig = { ...AGGRESSIVE };
  private autonomy: AutonomyMode = "auto";
  private killSwitch = false;
  private chains: ChainId[] = ["solana", "robinhood"];

  private approvals: PendingApproval[] = [];
  private logs: LogEntry[] = [];
  private tick = 0;
  /** USD price of each chain's own quote asset (SOL / ETH). */
  private quotePrices: QuotePrices = { solana: 180, robinhood: 3200 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private ticking = false;
  private readonly listeners = new Set<(snap: TerminalSnapshot) => void>();
  private lastSnapshot: TerminalSnapshot | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;

  constructor() {
    this.wallet = new PaperWallet(this.risk.startingCapitalUsd, this.chains, this.quotePrices);
    const preference = (process.env.MARKET_MODE as "live" | "simulated" | "auto") ?? "auto";
    this.feed = new MarketFeed(this.chains, preference);
    this.log(
      "system",
      `Terminal cold start — $${this.risk.startingCapitalUsd.toLocaleString("en-US")} split across ${this.chains.length} chain treasuries`,
    );
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log("system", "Agent desk online — SCOUT, SENTINEL, QUANT, NARRATOR, RISK, EXECUTOR");
    void this.boot();
  }

  /**
   * Pick the book back up before the first tick.
   *
   * A restart must not silently orphan open positions: without this the desk
   * would show a fresh book while whatever it opened is still out there, with
   * no stop-loss being evaluated for it.
   */
  private async boot(): Promise<void> {
    // Quote prices first. The wallet has to be funded at something, and the
    // constructor only has fallbacks — funding 5 SOL at a guessed $180 and then
    // revaluing at the real price showed a double-digit loss the desk never
    // made. Re-funding is refused the moment anything has traded.
    this.quotePrices = await fetchQuotePrices(this.quotePrices);
    this.wallet.setPrices(this.quotePrices);
    if (this.wallet.refundAtPrices(this.quotePrices)) {
      this.log(
        "system",
        `Treasuries funded at live prices — ${this.chains
          .map((c) => `${c === "solana" ? "SOL" : "ETH"} $${Math.round(this.quotePrices[c])}`)
          .join(" · ")}`,
      );
    }

    const saved = await loadBook();
    if (saved) {
      this.wallet.restore(saved);
      this.restored = true;
      this.log(
        "system",
        `Book restored from disk — ${saved.positions.length} open position(s), saved ${new Date(saved.savedAt).toLocaleString("de-DE")}`,
      );
      if (saved.positions.length > 0) {
        this.log(
          "warn",
          "Restored positions are marked against their last known price until the feed catches up",
        );
      }
    }
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    try {
      await this.runTick();
    } catch (err) {
      this.log("error", `tick failed: ${(err as Error).message}`);
    }
    const interval = Number(process.env.TICK_INTERVAL_MS ?? 4000);
    this.timer = setTimeout(() => void this.loop(), Math.max(1000, interval));
  }

  // ── the tick ────────────────────────────────────────────────────────────

  private async runTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.tick += 1;

      // Quote-asset prices move slowly relative to memecoins — refresh rarely.
      if (this.tick % 15 === 1) {
        this.quotePrices = await fetchQuotePrices(this.quotePrices);
        this.wallet.setPrices(this.quotePrices);
      }

      // Anything we still hold must stay in the universe, or its stop-loss
      // would quietly stop being evaluated.
      const held = new Set(this.wallet.openPositions().map((p) => p.tokenId));
      const tokens = await this.feed.poll(held);
      this.board.setUniverse(tokens);
      const byId = new Map<string, Token>(tokens.map((t) => [t.id, t]));
      this.wallet.markToMarket(byId);

      // Pipeline order matters: discovery → safety → signal → story → sizing.
      this.scout.run(this.context("scout"));
      await this.sentinel.run(this.context("sentinel"));
      this.quant.run(this.context("quant"));
      await this.narrator.run(this.context("narrator"));
      this.riskAgent.run(this.context("risk"));

      const execCtx = this.context("executor");
      await this.routeIntents(execCtx);
      await this.executor.run(execCtx);

      this.expireApprovals();
      this.emit();
      this.persist();
    } finally {
      this.ticking = false;
    }
  }

  /** AUTO fills immediately; MANUAL parks the ticket in the approval queue. */
  private async routeIntents(ctx: AgentContext): Promise<void> {
    for (const intent of this.riskAgent.pending) {
      if (this.killSwitch) continue;
      if (this.autonomy === "auto") {
        await this.executor.enter(intent, ctx);
        continue;
      }

      // Queue depth is bounded by the slots that are actually free. Without
      // this the queue fills with tickets that could never all be taken, and
      // every one of them ages out of the setup it was sized for.
      const pending = this.approvals.filter((a) => a.state === "pending");
      const freeSlots = this.risk.maxOpenPositions - this.wallet.openPositions().length;
      if (pending.length >= Math.max(0, freeSlots)) continue;

      const alreadyQueued = pending.some((a) => a.tokenId === intent.tokenId);
      if (alreadyQueued) continue;
      this.approvals = [
        { ...intent, state: "pending" as const, expiresAt: Date.now() + APPROVAL_TTL_MS },
        ...this.approvals,
      ].slice(0, 40);
      this.log(
        "signal",
        `APPROVAL REQUIRED · ${intent.symbol} · ${intent.sizeNative.toFixed(4)} ${intent.quote} · ${intent.reason}`,
        intent.symbol,
        undefined,
        "risk",
      );
    }
  }

  private expireApprovals(): void {
    const now = Date.now();
    this.approvals = this.approvals.map((a) =>
      a.state === "pending" && a.expiresAt < now ? { ...a, state: "expired" as const } : a,
    );
  }

  /** Each agent gets a context whose log entries are attributed to it. */
  private context(agent: AgentId | "system" = "system"): AgentContext {
    return {
      tick: this.tick,
      board: this.board,
      wallet: this.wallet,
      risk: this.risk,
      flags: this.flags(),
      log: (level, message, extra) => this.log(level, message, extra?.tokenSymbol, extra?.meta, agent),
    };
  }

  // ── commands from the UI ────────────────────────────────────────────────

  setAutonomy(mode: AutonomyMode): void {
    this.autonomy = mode;
    this.log("system", `Autonomy switched to ${mode.toUpperCase()}`);
    this.emit();
  }

  setKillSwitch(on: boolean): void {
    this.killSwitch = on;
    if (on) {
      this.log("error", "KILL SWITCH ENGAGED — liquidating every open position");
      void this.executor.liquidateAll(this.context("executor"), "kill switch").then((n) => {
        this.log("system", `Kill switch complete — ${n} position(s) closed`);
        this.emit();
      });
    } else {
      this.log("system", "Kill switch released — the desk may open risk again");
    }
    this.emit();
  }

  async approve(id: string): Promise<void> {
    const approval = this.approvals.find((a) => a.id === id && a.state === "pending");
    if (!approval) return;
    const ok = await this.executor.enter(approval, this.context("executor"));
    this.approvals = this.approvals.map((a) =>
      a.id === id ? { ...a, state: ok ? ("approved" as const) : ("rejected" as const) } : a,
    );
    this.emit();
  }

  reject(id: string): void {
    const approval = this.approvals.find((a) => a.id === id && a.state === "pending");
    if (!approval) return;
    this.approvals = this.approvals.map((a) => (a.id === id ? { ...a, state: "rejected" as const } : a));
    this.log("system", `Ticket rejected by operator · ${approval.symbol}`, approval.symbol);
    this.emit();
  }

  async closePosition(positionId: string): Promise<void> {
    const position = this.wallet.openPositions().find((p) => p.id === positionId);
    if (!position) return;
    await this.executor.liquidateOne(position, this.context("executor"), "manual close");
    this.emit();
  }

  /**
   * Re-anchor the daily loss limit without touching the book.
   *
   * Deliberately an operator action rather than something the desk does for
   * itself: a limit that lifts on its own is not a limit. Keeping positions and
   * history intact is the point — the run continues from where it stands.
   */
  rearmDailyLimit(): void {
    this.wallet.rearmDailyLimit();
    this.persist();
    this.log(
      "system",
      "Daily loss limit re-armed by the operator — entries resume from the current equity",
    );
    this.emit();
  }

  /** Start the paper run over at the configured book size. */
  resetBook(): void {
    this.wallet.resetTo(this.risk.startingCapitalUsd);
    this.approvals = [];
    this.persist();
    this.log(
      "system",
      `Book reset — $${this.risk.startingCapitalUsd.toLocaleString("en-US")} across ${this.chains.length} chain treasuries, no positions, no history`,
    );
    this.emit();
  }

  updateRisk(patch: Partial<RiskConfig>): void {
    const before = this.risk;
    this.risk = sanitizeRisk(this.risk, patch);
    if (patch.startingCapitalUsd != null && this.risk.startingCapitalUsd !== before.startingCapitalUsd) {
      this.wallet.resetTo(this.risk.startingCapitalUsd);
      this.log(
        "system",
        `Book reset to $${this.risk.startingCapitalUsd.toLocaleString("en-US")} across ${this.chains.length} chain treasuries`,
      );
    }
    this.log("system", "Risk parameters updated");
    this.emit();
  }

  // ── snapshots & streaming ───────────────────────────────────────────────

  flags(): EngineFlags {
    return {
      autonomy: this.autonomy,
      killSwitch: this.killSwitch,
      marketMode: this.feed.aggregateMode(),
      chains: this.chains,
      narrativeAugmented: providerFlags().anthropic,
      providers: providerFlags(),
    };
  }

  snapshot(): TerminalSnapshot {
    const watchlist = this.board.watchlistTokens();
    return {
      tick: this.tick,
      at: Date.now(),
      flags: this.flags(),
      risk: this.risk,
      agents: [
        this.scout.state(),
        this.sentinel.state(),
        this.quant.state(),
        this.narrator.state(),
        this.riskAgent.state(),
        this.executor.state(),
      ],
      watchlist,
      consensus: this.board.consensus(),
      positions: this.wallet.openPositions(),
      fills: this.wallet.recentFills(40),
      closedTrades: this.wallet.closedTrades(60),
      approvals: this.approvals.slice(0, 12),
      portfolio: this.wallet.snapshot(),
      logs: this.logs.slice(-120).reverse(),
      chainStatus: this.feed.statuses(),
      diagnostics: this.diagnostics(watchlist),
    };
  }

  private diagnostics(watchlist: Token[]): TickDiagnostics {
    const drawdownPct = this.wallet.dailyDrawdownPct();
    const ages = watchlist.map((t) => t.ageMinutes).sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : 0;

    // A blocker the operator set outranks anything the sizing pass found.
    const blocker = this.killSwitch
      ? "Kill switch engaged — no new risk until you release it."
      : this.riskAgent.blocker;

    return {
      universeSize: this.board.universe().length,
      watchlistSize: watchlist.length,
      discovery: this.feed.provenance(),
      funnel: this.riskAgent.funnel,
      blocker,
      halt:
        drawdownPct >= this.risk.dailyLossLimitPct
          ? {
              drawdownPct,
              limitPct: this.risk.dailyLossLimitPct,
              rollsAt: this.wallet.dailyLimitRollsAt(),
            }
          : null,
      medianAgeMinutes: median,
    };
  }

  subscribe(fn: (snap: TerminalSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.lastSnapshot ?? this.snapshot());
    return () => this.listeners.delete(fn);
  }

  /**
   * Debounced so a burst of fills costs one write, and never awaited inside a
   * tick — a slow disk must not stall the desk, and a failed write must not
   * stop it trading.
   */
  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void saveBook(this.wallet.serialize()).catch((err) => {
        this.log("warn", `Could not save the book: ${(err as Error).message}`);
      });
    }, 2_000);
  }

  private emit(): void {
    const snap = this.snapshot();
    this.lastSnapshot = snap;
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        // A dead SSE connection must never break the tick.
      }
    }
  }

  private log(
    level: LogLevel,
    message: string,
    tokenSymbol?: string,
    meta?: Record<string, string | number | boolean>,
    agent: AgentId | "system" = "system",
  ): void {
    this.logs.push({
      id: `l${Date.now().toString(36)}${(++logSeq).toString(36)}`,
      at: Date.now(),
      agent,
      level,
      message,
      tokenSymbol,
      meta,
    });
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
  }
}

/**
 * Next.js can evaluate a module more than once (dev HMR, separate route
 * bundles). Pinning the desk to globalThis keeps exactly one running.
 */
const KEY = Symbol.for("memecoin.terminal.orchestrator");
type GlobalWithDesk = typeof globalThis & { [KEY]?: Orchestrator };

export function getOrchestrator(): Orchestrator {
  const g = globalThis as GlobalWithDesk;
  if (!g[KEY]) {
    g[KEY] = new Orchestrator();
    g[KEY].start();
  }
  return g[KEY];
}
