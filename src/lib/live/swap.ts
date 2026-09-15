import type { JupiterQuote } from "./jupiter";

/**
 * Jupiter's swap endpoint: a quote in, a transaction out.
 *
 * Field names below come from a live response, listed in
 * tests/fixtures/jupiter-swap.json. The transaction blob itself is not kept —
 * it is a one-time artefact of that quote — but the envelope around it is
 * exactly what the API returned.
 *
 * Two of those fields decide whether this desk can be trusted with money.
 *
 * `lastValidBlockHeight` is the only honest way to say a transaction failed.
 * A send that times out has not failed; it may be in flight. Once the chain
 * passes this height the blockhash cannot be used, so a transaction that has
 * not landed by then never will — and only then is retrying safe.
 *
 * `prioritizationFeeLamports` is what the desk is actually paying to be
 * included, and it is worth looking at rather than assuming. On the observed
 * response it was 99,999 lamports — about a cent — while Jupiter's own
 * estimate for landing reliably, in `prioritizationType`, was twenty-one times
 * that. The default is a ceiling, not a recommendation: pay it in a contested
 * block and the likely outcome is not a bad fill but no fill, which lands in
 * the "unknown" state rather than the failed one.
 */

export const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v1/swap";
const TIMEOUT_MS = 12_000;

export interface SwapBuild {
  /** Base64 VersionedTransaction, unsigned. */
  swapTransaction: string;
  /** The chain height past which this transaction can never land. */
  lastValidBlockHeight: number | null;
  /** What is actually being paid for inclusion, in lamports. */
  prioritizationFeeLamports: number | null;
  computeUnitLimit: number | null;
  /** Jupiter's own estimate of what landing would cost, when it offers one. */
  estimatedPriorityLamports: number | null;
  /** Set when Jupiter simulated the swap and it failed. Never ignore this. */
  simulationError: unknown;
}

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.trunc(v)
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Math.trunc(Number(v))
      : null;

export function parseSwapBuild(payload: unknown): SwapBuild | null {
  if (!payload || typeof payload !== "object") return null;
  const s = payload as Record<string, unknown>;
  const tx = s.swapTransaction;
  if (typeof tx !== "string" || tx.length === 0) return null;

  const budget = (s.prioritizationType as { computeBudget?: Record<string, unknown> } | null)
    ?.computeBudget;
  const estMicro = int(budget?.estimatedMicroLamports);
  const units = int(s.computeUnitLimit);

  return {
    swapTransaction: tx,
    lastValidBlockHeight: int(s.lastValidBlockHeight),
    prioritizationFeeLamports: int(s.prioritizationFeeLamports),
    computeUnitLimit: units,
    // microLamports are per compute unit; the fee is the product over the budget.
    estimatedPriorityLamports:
      estMicro !== null && units !== null ? Math.round((estMicro * units) / 1e6) : null,
    simulationError: s.simulationError ?? null,
  };
}

export interface SwapRequest {
  quote: JupiterQuote;
  userPublicKey: string;
  /** Lamports to pay for inclusion. Omitted lets Jupiter choose its default. */
  prioritizationFeeLamports?: number;
}

export function swapRequestBody(request: SwapRequest): string {
  return JSON.stringify({
    // The whole original response, not a re-serialised parse: the endpoint
    // reads fields this build may not know about.
    quoteResponse: request.quote.raw,
    userPublicKey: request.userPublicKey,
    ...(request.prioritizationFeeLamports != null
      ? { prioritizationFeeLamports: request.prioritizationFeeLamports }
      : {}),
  });
}

export async function buildSwap(
  request: SwapRequest,
  base = JUPITER_SWAP_URL,
): Promise<{ build: SwapBuild } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: swapRequestBody(request),
    });
    if (!res.ok) return { error: `swap build: HTTP ${res.status}` };

    const build = parseSwapBuild(await res.json());
    if (!build) return { error: "swap build: no transaction in the response" };
    // Jupiter simulates before returning. A simulation that failed here is a
    // trade that would fail on chain, at full cost and for nothing.
    if (build.simulationError) {
      return { error: `swap build: simulation failed (${JSON.stringify(build.simulationError).slice(0, 120)})` };
    }
    return { build };
  } catch (err) {
    return { error: `swap build: ${(err as Error).name}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Total lamports the transaction will cost in fees, as far as we can tell. */
export const BASE_SIGNATURE_FEE_LAMPORTS = 5_000;

export function estimatedFeeLamports(build: SwapBuild): number {
  return BASE_SIGNATURE_FEE_LAMPORTS + (build.prioritizationFeeLamports ?? 0);
}
