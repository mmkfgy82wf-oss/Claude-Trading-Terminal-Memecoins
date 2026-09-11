import type { Fill, Position, RiskConfig, Token, TradeIntent } from "@/lib/types";

/**
 * The boundary between "decide" and "send".
 *
 * PaperExecutor is what runs today. LiveSolanaExecutor is the seam a real
 * wallet plugs into later: same interface, same call sites, so switching modes
 * is a constructor change rather than a rewrite of the agent pipeline.
 */
export interface ExecutionResult {
  ok: boolean;
  fill?: Fill;
  error?: string;
}

export interface TradeExecutor {
  readonly mode: "paper" | "live";
  buy(intent: TradeIntent, token: Token, solPriceUsd: number, risk: RiskConfig): Promise<ExecutionResult>;
  sell(
    position: Position,
    token: Token,
    fraction: number,
    reason: string,
    solPriceUsd: number,
    risk: RiskConfig,
  ): Promise<ExecutionResult>;
}

let fillSeq = 0;
const fillId = () => `f${Date.now().toString(36)}${(++fillSeq).toString(36)}`;

/**
 * Slippage model: memecoin fills degrade with the size of the order relative to
 * pool liquidity, so a 2 SOL ticket into a 12k pool hurts and the terminal
 * should feel that. Base spread + quadratic impact + jitter.
 */
export function estimateSlippagePct(orderUsd: number, liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 100;
  const share = orderUsd / liquidityUsd;
  const impact = share * 100 * 1.6 + share * share * 900;
  const jitter = Math.random() * 0.4;
  return Math.min(99, 0.35 + impact + jitter);
}

/** Solana-style costs: priority fee + DEX fee, expressed in SOL. */
function feeForSol(valueSol: number): number {
  return valueSol * 0.0025 + 0.00045;
}

export class PaperExecutor implements TradeExecutor {
  readonly mode = "paper" as const;

  async buy(
    intent: TradeIntent,
    token: Token,
    solPriceUsd: number,
    risk: RiskConfig,
  ): Promise<ExecutionResult> {
    const orderUsd = intent.sizeSol * solPriceUsd;
    const slippagePct = estimateSlippagePct(orderUsd, token.liquidityUsd);
    if (slippagePct > risk.maxSlippagePct) {
      return { ok: false, error: `slippage ${slippagePct.toFixed(2)}% > max ${risk.maxSlippagePct}%` };
    }
    const execPrice = token.priceUsd * (1 + slippagePct / 100);
    const fee = feeForSol(intent.sizeSol);
    const quantity = (orderUsd - fee * solPriceUsd) / execPrice;
    if (!(quantity > 0)) return { ok: false, error: "non-positive fill quantity" };

    return {
      ok: true,
      fill: {
        id: fillId(),
        tokenId: token.id,
        symbol: token.symbol,
        chain: token.chain,
        side: "buy",
        quantity,
        priceUsd: execPrice,
        valueSol: intent.sizeSol,
        feeSol: fee,
        slippagePct,
        reason: intent.reason,
        at: Date.now(),
        txRef: `paper-${fillId()}`,
        mode: "paper",
      },
    };
  }

  async sell(
    position: Position,
    token: Token,
    fraction: number,
    reason: string,
    solPriceUsd: number,
    risk: RiskConfig,
  ): Promise<ExecutionResult> {
    const qty = position.quantity * Math.min(1, Math.max(0, fraction));
    if (qty <= 0) return { ok: false, error: "nothing to sell" };

    const grossUsd = qty * token.priceUsd;
    const slippagePct = estimateSlippagePct(grossUsd, token.liquidityUsd);
    // Exits are never blocked by slippage: being stuck in a rug is worse than a
    // bad fill. The cost is applied in full instead.
    const execPrice = token.priceUsd * (1 - Math.min(95, slippagePct) / 100);
    const valueSol = (qty * execPrice) / solPriceUsd;
    const fee = feeForSol(valueSol);
    const costBasisSol = position.costSol * (qty / position.quantity);

    void risk;
    return {
      ok: true,
      fill: {
        id: fillId(),
        tokenId: token.id,
        symbol: token.symbol,
        chain: token.chain,
        side: "sell",
        quantity: qty,
        priceUsd: execPrice,
        valueSol,
        feeSol: fee,
        slippagePct,
        realizedPnlSol: valueSol - fee - costBasisSol,
        reason,
        at: Date.now(),
        txRef: `paper-${fillId()}`,
        mode: "paper",
      },
    };
  }
}

/**
 * Live execution seam — intentionally inert.
 *
 * Wiring this up means: load a keypair from a signer you control, build the
 * swap through a Jupiter quote, sign, send, confirm, then map the confirmed
 * transaction back onto a `Fill`. It refuses to run until both an explicit
 * opt-in flag and a signer are present, so no configuration accident can turn
 * paper trading into real orders.
 */
export class LiveSolanaExecutor implements TradeExecutor {
  readonly mode = "live" as const;

  constructor(private readonly signer: unknown | null = null) {}

  private guard(): ExecutionResult {
    if (process.env.ENABLE_LIVE_TRADING !== "yes-i-accept-the-risk") {
      return { ok: false, error: "live trading disabled (set ENABLE_LIVE_TRADING explicitly)" };
    }
    if (!this.signer) return { ok: false, error: "no signer attached" };
    return { ok: false, error: "live executor not implemented — connect a wallet adapter first" };
  }

  async buy(): Promise<ExecutionResult> {
    return this.guard();
  }

  async sell(): Promise<ExecutionResult> {
    return this.guard();
  }
}
