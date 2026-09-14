import { now } from "@/lib/util/clock";
import { liquidityTrend, MIN_TREND_SAMPLES } from "@/lib/market/liquidity";
import { fetchHolderIntel, fetchMintIntel } from "@/lib/market/providers";
import type { Token } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

/**
 * SENTINEL — the only agent with a veto.
 *
 * Memecoin losses are rarely "the trade went against me"; they are liquidity
 * pulls, honeypots and live mint authorities. SENTINEL scores those specific
 * failure modes and, past a threshold, stops the desk cold regardless of how
 * bullish everyone else is.
 */
interface Finding {
  points: number;
  reason: string;
  fatal?: boolean;
}

const CACHE_TTL_MS = 5 * 60_000;

export class SentinelAgent extends Agent {
  /** Provider lookups are rate-limited and cached per token. */
  private readonly intel = new Map<string, { at: number; findings: Finding[] }>();

  constructor() {
    super("sentinel");
  }

  async run(ctx: AgentContext): Promise<void> {
    const watchlist = ctx.board.watchlistTokens();
    this.working(`auditing ${watchlist.length} candidates`, Math.min(1, watchlist.length / 14));

    let vetoes = 0;
    for (const token of watchlist) {
      const findings = this.staticChecks(token, ctx);
      const enriched = await this.providerChecks(token);
      findings.push(...enriched);

      const risk = findings.reduce((s, f) => s + f.points, 0);
      const fatal = findings.some((f) => f.fatal);
      const veto = fatal || risk >= 60;
      if (veto) vetoes += 1;

      const safety = Math.max(-100, 100 - risk * 1.6);
      ctx.board.publish(
        this.signal(
          token.id,
          safety,
          0.55 + Math.min(0.4, findings.length * 0.08),
          veto ? "VETO" : risk >= 35 ? "elevated risk" : risk >= 15 ? "acceptable" : "clean",
          findings.length ? findings.map((f) => f.reason).slice(0, 4) : ["no rug markers found"],
          veto,
        ),
      );

      if (veto && !ctx.board.readNote(`veto:${token.id}`)) {
        ctx.board.note(`veto:${token.id}`, "1");
        ctx.log("warn", `VETO ${token.symbol} — ${findings.find((f) => f.fatal)?.reason ?? `risk score ${risk}`}`, {
          tokenSymbol: token.symbol,
          meta: { riskScore: risk },
        });
      }
    }

    if (vetoes > 0) this.blocked(`${vetoes} token(s) vetoed`);
    else this.settle("no rug markers on the board");
    this.decisions += watchlist.length ? 1 : 0;
  }

  /** Checks that need nothing but the pair data we already hold. */
  private staticChecks(token: Token, ctx: AgentContext): Finding[] {
    const out: Finding[] = [];

    if (token.liquidityUsd < 8_000) {
      out.push({ points: 45, reason: `pool only $${Math.round(token.liquidityUsd).toLocaleString("en-US")}`, fatal: token.liquidityUsd < 3_000 });
    }

    // A market cap that dwarfs the pool means the exit is a hundred times
    // thinner than the paper wealth it implies.
    const fdvToLiq = token.fdvUsd / Math.max(1, token.liquidityUsd);
    if (fdvToLiq > 60) out.push({ points: 30, reason: `FDV ${fdvToLiq.toFixed(0)}x liquidity` });
    else if (fdvToLiq > 25) out.push({ points: 15, reason: `FDV ${fdvToLiq.toFixed(0)}x liquidity` });

    // One-way flow: buys with almost no sells is the classic honeypot tell.
    const trades = token.buys5m + token.sells5m;
    if (trades > 25 && token.sells5m / trades < 0.06) {
      out.push({ points: 55, reason: `${token.buys5m} buys vs ${token.sells5m} sells — possible honeypot`, fatal: true });
    }

    // Sell stampede into a draining pool.
    if (token.sells5m > token.buys5m * 4 && token.change5m < -20) {
      out.push({ points: 50, reason: "sell cascade in progress", fatal: true });
    }

    if (token.change24h < -70 && token.liquidityUsd < 25_000) {
      out.push({ points: 35, reason: `down ${token.change24h.toFixed(0)}% on a thin pool` });
    }

    // The pool over time, not the pool right now. This is the only check here
    // that could have seen the overnight losses coming: on every one of them
    // the snapshot looked fine until the frame it did not.
    const floor = ctx.risk.liquidityTrendExitPct;
    const trend = floor > 0 ? liquidityTrend(token.history) : null;
    if (trend && trend.samples >= MIN_TREND_SAMPLES) {
      const drained = -trend.liquidityChangePct;
      const minutes = Math.max(1, Math.round(trend.spanMs / 60_000));
      if (trend.distributing && drained >= floor * 1.25) {
        out.push({
          points: 60,
          reason: `pool -${drained.toFixed(0)}% in ${minutes}m while price ${trend.priceChangePct >= 0 ? "+" : ""}${trend.priceChangePct.toFixed(0)}% — being distributed into`,
          fatal: true,
        });
      } else if (trend.distributing && drained >= floor * 0.6) {
        out.push({ points: 38, reason: `pool -${drained.toFixed(0)}% in ${minutes}m on a rising price` });
      } else if (drained >= floor * 1.75) {
        out.push({ points: 25, reason: `pool -${drained.toFixed(0)}% in ${minutes}m` });
      }
    }

    if (token.ageMinutes < 8) {
      out.push({ points: 20, reason: `${token.ageMinutes}m since launch — no track record` });
    }

    if (token.volume24hUsd < ctx.risk.minVolume24hUsd * 0.25) {
      out.push({ points: 18, reason: "volume too thin to exit cleanly" });
    }

    return out;
  }

  /** Checks that need an API key. Silently skipped when none is configured. */
  private async providerChecks(token: Token): Promise<Finding[]> {
    const cached = this.intel.get(token.id);
    if (cached && now() - cached.at < CACHE_TTL_MS) return cached.findings;

    const findings: Finding[] = [];
    const [holders, mint] = await Promise.all([fetchHolderIntel(token), fetchMintIntel(token)]);

    if (holders?.top10Share != null) {
      this.augmented = true;
      const pct = holders.top10Share * 100;
      if (pct > 60) findings.push({ points: 50, reason: `top 10 wallets hold ${pct.toFixed(0)}%`, fatal: pct > 80 });
      else if (pct > 35) findings.push({ points: 22, reason: `top 10 wallets hold ${pct.toFixed(0)}%` });
    }
    if (mint) {
      this.augmented = true;
      if (mint.mintAuthorityActive) findings.push({ points: 60, reason: "mint authority still active", fatal: true });
      if (mint.freezeAuthorityActive) findings.push({ points: 55, reason: "freeze authority still active", fatal: true });
    }

    this.intel.set(token.id, { at: now(), findings });
    return findings;
  }
}
