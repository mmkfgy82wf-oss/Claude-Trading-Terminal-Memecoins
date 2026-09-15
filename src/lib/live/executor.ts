import type { Keypair } from "@solana/web3.js";
import type { ExecutionResult, TradeExecutor } from "@/lib/trading/executor";
import { limitsFromEnv, liveStartupRefusal, liveTradingRequested, type EnvLike } from "@/lib/trading/limits";
import type { Fill, Position, RiskConfig, Token, TradeIntent } from "@/lib/types";
import { now } from "@/lib/util/clock";
import { fetchQuote, type JupiterQuote } from "./jupiter";
import { lamportDelta, tokenDelta, tokenHolding, type RpcTransactionMeta } from "./rpc";
import { sendAndConfirm } from "./send";
import { loadSigner } from "./signer";
import { buildSwap, estimatedFeeLamports } from "./swap";

/**
 * Live execution on Solana.
 *
 * It is the same seam the paper executor fills, so the agents above it do not
 * know the difference — which is the point of having had that seam all along.
 * Everything specific to being real lives here: the quote, the transaction,
 * the confirmation, and above all the insistence on reading what happened off
 * the chain rather than off the quote.
 *
 * Three refusals, checked before anything moves:
 *   - the opt-in flag, the ceilings, and the wallet being under the book cap
 *   - a signer that actually loaded
 *   - a quote whose worst case still fits the slippage budget
 *
 * The fee is charged in SOL on both legs. A sell therefore needs SOL to exist
 * before it can happen, which is what the gas reserve in the sizing agent is
 * for; this class assumes that reserve did its job and says so loudly when it
 * did not.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

let liveSeq = 0;
const fillId = () => `l${now().toString(36)}${(++liveSeq).toString(36)}`;

export interface LiveExecutorOptions {
  endpoint: string;
  signer: Keypair;
  /**
   * Lamports to pay for inclusion. Jupiter's default is a ceiling of about a
   * cent while its own estimate for landing is twenty times that, so this is
   * worth setting deliberately rather than inheriting.
   */
  priorityFeeLamports?: number;
  env?: EnvLike;
}

export class LiveSolanaExecutor implements TradeExecutor {
  readonly mode = "live" as const;

  constructor(private readonly options: LiveExecutorOptions) {}

  /**
   * Build one, or explain why not. Returns a reason rather than throwing,
   * because "live trading is not configured" is the normal state.
   */
  static create(
    endpoint: string,
    env: EnvLike = process.env,
  ): { executor: LiveSolanaExecutor } | { refusal: string } {
    if (!liveTradingRequested(env)) {
      return { refusal: "ENABLE_LIVE_TRADING is not set — the desk stays on paper." };
    }
    const { keypair, reason } = loadSigner(env);
    if (!keypair) return { refusal: reason ?? "no signer" };

    const limits = limitsFromEnv(env);
    // The book value is checked again at the first trade, against the real
    // wallet. This only catches a missing or contradictory ceiling.
    const refusal = liveStartupRefusal(limits, 0, env);
    if (refusal) return { refusal };

    const priority = Number(env.SOLANA_PRIORITY_FEE_LAMPORTS);
    return {
      executor: new LiveSolanaExecutor({
        endpoint,
        signer: keypair,
        priorityFeeLamports: Number.isFinite(priority) && priority > 0 ? Math.trunc(priority) : undefined,
        env,
      }),
    };
  }

  get publicKey(): string {
    return this.options.signer.publicKey.toBase58();
  }

  async buy(
    intent: TradeIntent,
    token: Token,
    quotePriceUsd: number,
    risk: RiskConfig,
  ): Promise<ExecutionResult> {
    if (token.chain !== "solana") {
      return { ok: false, error: `live execution is Solana only (got ${token.chain})` };
    }
    const lamports = BigInt(Math.floor(intent.sizeNative * LAMPORTS_PER_SOL));
    if (lamports <= 0n) return { ok: false, error: "non-positive order size" };

    return this.swap({
      inputMint: WSOL_MINT,
      outputMint: token.tokenAddress,
      amount: lamports,
      side: "buy",
      token,
      quotePriceUsd,
      risk,
      reason: intent.reason,
    });
  }

  async sell(
    position: Position,
    token: Token,
    fraction: number,
    reason: string,
    quotePriceUsd: number,
    risk: RiskConfig,
  ): Promise<ExecutionResult> {
    if (token.chain !== "solana") {
      return { ok: false, error: `live execution is Solana only (got ${token.chain})` };
    }

    // Sized from the chain, never from the book. The book's quantity has never
    // been checked against reality, and a sell that reverts for insufficient
    // funds costs a full fee in the middle of an exit.
    const holding = await tokenHolding(this.options.endpoint, this.publicKey, token.tokenAddress);
    if (!holding || holding.amount <= 0n) {
      return { ok: false, error: `wallet holds none of ${token.symbol} — the book is ahead of the chain` };
    }

    const share = Math.min(1, Math.max(0, fraction));
    // Integer maths throughout: a float here rounds a balance into dust that
    // can never be sold, and the account stays open forever.
    const amount =
      share >= 1 ? holding.amount : (holding.amount * BigInt(Math.round(share * 1e6))) / 1_000_000n;
    if (amount <= 0n) return { ok: false, error: "fraction rounds to nothing" };

    void position;
    return this.swap({
      inputMint: token.tokenAddress,
      outputMint: WSOL_MINT,
      amount,
      side: "sell",
      token,
      quotePriceUsd,
      risk,
      reason,
      decimals: holding.decimals,
    });
  }

  private async swap(args: {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    side: "buy" | "sell";
    token: Token;
    quotePriceUsd: number;
    risk: RiskConfig;
    reason: string;
    decimals?: number;
  }): Promise<ExecutionResult> {
    const slippageBps = Math.round(args.risk.maxSlippagePct * 100);

    const quote = await fetchQuote({
      inputMint: args.inputMint,
      outputMint: args.outputMint,
      amount: args.amount,
      slippageBps,
    });
    if (!quote) return { ok: false, error: "no route" };

    // Price impact is Jupiter's own estimate for the route it picked. If it
    // already exceeds the budget there is no point paying a fee to find out.
    const impactPct = quote.priceImpactPct * 100;
    if (impactPct > args.risk.maxSlippagePct) {
      return { ok: false, error: `price impact ${impactPct.toFixed(2)}% over the ${args.risk.maxSlippagePct}% budget` };
    }

    const built = await buildSwap({
      quote,
      userPublicKey: this.publicKey,
      prioritizationFeeLamports: this.options.priorityFeeLamports,
    });
    if ("error" in built) return { ok: false, error: built.error };

    const outcome = await sendAndConfirm(built.build.swapTransaction, this.options.signer, {
      endpoint: this.options.endpoint,
      lastValidBlockHeight: built.build.lastValidBlockHeight,
    });

    if (outcome.state !== "confirmed") {
      // "unknown" is deliberately not retried here. The caller has to decide,
      // with the signature in hand, and the desk must not open the position a
      // second time on its own initiative.
      return {
        ok: false,
        error: `${outcome.state}: ${outcome.error}${outcome.signature ? ` (${outcome.signature})` : ""}`,
      };
    }

    const meta = outcome.meta as RpcTransactionMeta | null;
    if (!meta) {
      return { ok: false, error: `confirmed but unreadable (${outcome.signature}) — reconcile before trading again` };
    }

    return this.fillFromChain(args, quote, meta, outcome.signature, built.build.lastValidBlockHeight);
  }

  /**
   * Build the fill from what the transaction actually moved.
   *
   * Everything here could have been taken from the quote in two lines. That
   * version would be wrong every single time by a little, and the error would
   * compound silently across every trade until the book and the wallet had
   * nothing to do with each other.
   */
  private fillFromChain(
    args: { side: "buy" | "sell"; token: Token; quotePriceUsd: number; reason: string; decimals?: number },
    quote: JupiterQuote,
    meta: RpcTransactionMeta,
    signature: string,
    _lastValidBlockHeight: number | null,
  ): ExecutionResult {
    // Index 0 of a Solana message is always the fee payer — our wallet.
    const solDelta = lamportDelta(meta, 0);
    if (solDelta === null) return { ok: false, error: `no SOL movement in ${signature}` };

    const moved = tokenDelta(meta, this.publicKey, args.token.tokenAddress);
    if (!moved || moved.delta === 0n) {
      return { ok: false, error: `no ${args.token.symbol} movement in ${signature}` };
    }

    const decimals = moved.decimals || args.decimals || 0;
    const quantity = Math.abs(Number(moved.delta)) / 10 ** decimals;
    const valueNative = Math.abs(Number(solDelta)) / LAMPORTS_PER_SOL;
    const feeNative = (meta.fee ?? 0) / LAMPORTS_PER_SOL;
    if (!(quantity > 0) || !(valueNative > 0)) {
      return { ok: false, error: `degenerate fill in ${signature}` };
    }

    // The number the whole live experiment exists to produce: what the quote
    // promised against what the chain delivered.
    const expected = Number(quote.outAmount);
    const actual = args.side === "buy" ? Math.abs(Number(moved.delta)) : Math.abs(Number(solDelta));
    const slippagePct = expected > 0 ? ((expected - actual) / expected) * 100 : 0;

    const fill: Fill = {
      id: fillId(),
      tokenId: args.token.id,
      symbol: args.token.symbol,
      chain: "solana",
      side: args.side,
      quantity,
      priceUsd: (valueNative * args.quotePriceUsd) / quantity,
      liquidityUsd: args.token.liquidityUsd,
      valueNative,
      feeNative,
      quote: "SOL",
      slippagePct,
      reason: args.reason,
      at: now(),
      txRef: signature,
      mode: "live",
    };
    return { ok: true, fill };
  }

  /** What the last build said inclusion would cost, for the cost model. */
  static feeEstimateSol(build: Parameters<typeof estimatedFeeLamports>[0]): number {
    return estimatedFeeLamports(build) / LAMPORTS_PER_SOL;
  }
}
