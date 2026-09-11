/**
 * Optional enrichment providers.
 *
 * The terminal is fully functional without any key. Each provider below turns
 * itself on only when its env var is present, and every failure degrades to
 * `null` so a missing/rate-limited upstream can never stall a tick.
 */

import type { Token } from "@/lib/types";

const TIMEOUT_MS = 6_000;

async function safeJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const providerFlags = () => ({
  birdeye: Boolean(process.env.BIRDEYE_API_KEY),
  helius: Boolean(process.env.HELIUS_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
});

export interface HolderIntel {
  holders: number | null;
  /** Share of supply held by the top 10 wallets, 0..1. */
  top10Share: number | null;
  source: "birdeye" | "heuristic";
}

/** Holder concentration — the single most useful rug tell we can buy cheaply. */
export async function fetchHolderIntel(token: Token): Promise<HolderIntel | null> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key || token.chain !== "solana" || token.simulated) return null;

  const data = await safeJson<{ data?: { items?: { ui_amount?: number }[] } }>(
    `https://public-api.birdeye.so/defi/v3/token/holder?address=${token.tokenAddress}&limit=10`,
    { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" },
  );
  const items = data?.data?.items;
  if (!items?.length) return null;

  const top10 = items.reduce((sum, i) => sum + (i.ui_amount ?? 0), 0);
  const supply = token.priceUsd > 0 ? token.fdvUsd / token.priceUsd : 0;
  return {
    holders: null,
    top10Share: supply > 0 ? Math.min(1, top10 / supply) : null,
    source: "birdeye",
  };
}

export interface MintIntel {
  /** True when the deployer can still mint new supply. */
  mintAuthorityActive: boolean | null;
  /** True when the deployer can still freeze holder accounts. */
  freezeAuthorityActive: boolean | null;
}

/** Mint/freeze authority — a hard veto signal when either is still live. */
export async function fetchMintIntel(token: Token): Promise<MintIntel | null> {
  const key = process.env.HELIUS_API_KEY;
  if (!key || token.chain !== "solana" || token.simulated) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mint-intel",
        method: "getAsset",
        params: { id: token.tokenAddress },
      }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      result?: { token_info?: { mint_authority?: string; freeze_authority?: string } };
    };
    const info = j.result?.token_info;
    if (!info) return null;
    return {
      mintAuthorityActive: Boolean(info.mint_authority),
      freezeAuthorityActive: Boolean(info.freeze_authority),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deepest-pool USD price for a token address, or null when unavailable. */
async function priceForToken(address: string): Promise<number | null> {
  const data = await safeJson<{ pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
  );
  const best = data?.pairs
    ?.filter((p) => Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const price = Number(best?.priceUsd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const WSOL = "So11111111111111111111111111111111111111112";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/**
 * USD price of each chain's quote asset. The book is held per chain in its own
 * asset, so one global rate would misprice every position on the other chain.
 */
export async function fetchQuotePrices(
  fallback: { solana: number; robinhood: number },
): Promise<{ solana: number; robinhood: number }> {
  const [sol, eth] = await Promise.all([priceForToken(WSOL), priceForToken(WETH)]);
  return {
    solana: sol ?? fallback.solana,
    // Robinhood Chain settles in ETH, so it is priced off ETH, not SOL.
    robinhood: eth ?? fallback.robinhood,
  };
}
