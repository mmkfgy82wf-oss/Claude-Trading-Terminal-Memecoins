/**
 * Jupiter's quote endpoint, typed against a response that was actually fetched.
 *
 * The shape below is not remembered, inferred or assumed: it comes from a live
 * call whose output is kept verbatim in tests/fixtures/jupiter-quote.json and
 * parsed by the tests. That is deliberate. The one serious mistake in this
 * project so far was shipping an adapter built on an API shape I had not seen,
 * and it cost a day; an execution path is a far worse place to repeat it.
 *
 * Two details of the real payload matter and would be easy to get wrong:
 * every amount arrives as a decimal *string*, and so does `priceImpactPct`.
 * Amounts are parsed as bigint, because a token with nine decimals and a large
 * supply overflows a double long before the position does.
 */

export const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
const TIMEOUT_MS = 8_000;

export interface RouteLeg {
  /** The AMM that leg routes through — "Deriverse", "Raydium", … */
  label: string;
  /** Share of the order on this leg, in percent. */
  percent: number;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  /** Base units in. For SOL that is lamports. */
  inAmount: bigint;
  /** Base units out, at the quoted route. */
  outAmount: bigint;
  /**
   * The least the swap may return before it reverts — `outAmount` less the
   * slippage tolerance. This, not `outAmount`, is the number a position's
   * worst case should be sized against.
   */
  otherAmountThreshold: bigint;
  slippageBps: number;
  swapMode: string;
  priceImpactPct: number;
  /** USD value of the swap as Jupiter prices it, when it says. */
  swapUsdValue: number | null;
  contextSlot: number | null;
  route: RouteLeg[];
  /**
   * The untouched response. The swap endpoint wants the whole quote object
   * back, so re-serialising a parsed copy would silently drop any field this
   * build does not know about.
   */
  raw: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;

/** Amounts arrive as strings; a number is accepted too rather than refused. */
function big(v: unknown): bigint | null {
  const s = str(v);
  if (s === null) return null;
  try {
    return BigInt(s.includes(".") ? s.slice(0, s.indexOf(".")) : s);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a quote, or return null. Never throws: a malformed quote must cancel
 * one trade, not take down the desk.
 */
export function parseQuote(payload: unknown): JupiterQuote | null {
  if (!payload || typeof payload !== "object") return null;
  const q = payload as Record<string, unknown>;

  const inputMint = str(q.inputMint);
  const outputMint = str(q.outputMint);
  const inAmount = big(q.inAmount);
  const outAmount = big(q.outAmount);
  if (!inputMint || !outputMint || inAmount === null || outAmount === null) return null;
  if (inAmount <= 0n || outAmount <= 0n) return null;

  const rawRoute = Array.isArray(q.routePlan) ? q.routePlan : [];
  const route: RouteLeg[] = rawRoute.flatMap((leg) => {
    const info = (leg as Record<string, unknown>)?.swapInfo as Record<string, unknown> | undefined;
    const label = str(info?.label);
    return label ? [{ label, percent: num((leg as Record<string, unknown>).percent) ?? 0 }] : [];
  });

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    // Missing threshold is treated as "no protection", not as "no limit":
    // falling back to outAmount would quietly promise a fill that cannot slip.
    otherAmountThreshold: big(q.otherAmountThreshold) ?? 0n,
    slippageBps: num(q.slippageBps) ?? 0,
    swapMode: str(q.swapMode) ?? "ExactIn",
    priceImpactPct: num(q.priceImpactPct) ?? 0,
    swapUsdValue: num(q.swapUsdValue),
    contextSlot: num(q.contextSlot),
    route,
    raw: payload,
  };
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Base units of the input token. */
  amount: bigint;
  slippageBps: number;
}

export function quoteUrl(request: QuoteRequest, base = JUPITER_QUOTE_URL): string {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    slippageBps: String(Math.max(0, Math.round(request.slippageBps))),
  });
  return `${base}?${params.toString()}`;
}

export async function fetchQuote(
  request: QuoteRequest,
  base = JUPITER_QUOTE_URL,
): Promise<JupiterQuote | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(quoteUrl(request, base), {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseQuote(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The gap between what a quote promised and what the swap actually returned.
 *
 * This is the measurement the whole live experiment exists for. The desk's
 * slippage model is a guess that sits inside every backtest ever run here; the
 * only way to find out whether it is off by a factor of two is to compare a
 * quote against its own fill, a few dozen times.
 */
export interface FillVsQuote {
  quotedOut: bigint;
  actualOut: bigint;
  /** Negative when the fill came in under the quote, which is the usual way. */
  deviationPct: number;
  /** What the desk's own model predicted for an order this size. */
  modelledSlippagePct: number;
  /** Jupiter's own price-impact estimate for the route it chose. */
  quotedImpactPct: number;
}

export function compareFill(
  quote: JupiterQuote,
  actualOut: bigint,
  modelledSlippagePct: number,
): FillVsQuote {
  const quoted = Number(quote.outAmount);
  const actual = Number(actualOut);
  return {
    quotedOut: quote.outAmount,
    actualOut,
    deviationPct: quoted > 0 ? ((actual - quoted) / quoted) * 100 : 0,
    modelledSlippagePct,
    quotedImpactPct: quote.priceImpactPct,
  };
}
