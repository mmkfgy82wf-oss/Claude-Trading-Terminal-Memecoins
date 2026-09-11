import type { ChainId, Token } from "@/lib/types";
import { CHAINS } from "./chains";

const BASE = "https://api.dexscreener.com/latest/dex";
const TIMEOUT_MS = 8_000;

/** Raw shape of the bits of the DexScreener payload we consume. */
interface DsPair {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number } | undefined>;
  volume?: Record<string, number | undefined>;
  priceChange?: Record<string, number | undefined>;
  liquidity?: { usd?: number };
  fdv?: number;
  pairCreatedAt?: number;
}

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Offline, rate-limited, blocked by an egress policy — the caller decides
    // what to do; it is never fatal.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePair(p: DsPair, chain: ChainId): Token | null {
  const priceUsd = num(p.priceUsd);
  if (!p.pairAddress || !p.baseToken?.symbol || priceUsd <= 0) return null;
  const created = p.pairCreatedAt ?? Date.now();
  return {
    id: `${chain}:${p.pairAddress}`,
    chain,
    pairAddress: p.pairAddress,
    tokenAddress: p.baseToken.address,
    symbol: p.baseToken.symbol.toUpperCase().slice(0, 12),
    name: p.baseToken.name ?? p.baseToken.symbol,
    priceUsd,
    priceNative: num(p.priceNative),
    liquidityUsd: num(p.liquidity?.usd),
    fdvUsd: num(p.fdv),
    volume24hUsd: num(p.volume?.h24),
    volume5mUsd: num(p.volume?.m5),
    buys5m: num(p.txns?.m5?.buys),
    sells5m: num(p.txns?.m5?.sells),
    change5m: num(p.priceChange?.m5),
    change1h: num(p.priceChange?.h1),
    change24h: num(p.priceChange?.h24),
    ageMinutes: Math.max(0, Math.round((Date.now() - created) / 60_000)),
    dex: p.dexId ?? "unknown",
    url: p.url,
    history: [{ t: Date.now(), p: priceUsd }],
    simulated: false,
  };
}

/** Trending/hot pairs for a chain, discovered through DexScreener search. */
export async function fetchChainPairs(chain: ChainId, limit = 40): Promise<Token[]> {
  const adapter = CHAINS[chain];
  if (!adapter.dexscreenerSlug) return [];

  const results = await Promise.all(
    adapter.discoveryQueries.map((q) =>
      getJson<{ pairs?: DsPair[] }>(`${BASE}/search?q=${encodeURIComponent(q)}`),
    ),
  );

  const seen = new Map<string, Token>();
  for (const r of results) {
    for (const p of r?.pairs ?? []) {
      if (p.chainId !== adapter.dexscreenerSlug) continue;
      const t = normalizePair(p, chain);
      if (t && !seen.has(t.id)) seen.set(t.id, t);
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, limit);
}

/** Refresh a known set of pairs in one batched call (30 addresses per request). */
export async function refreshPairs(chain: ChainId, addresses: string[]): Promise<Map<string, Token>> {
  const adapter = CHAINS[chain];
  const out = new Map<string, Token>();
  if (!adapter.dexscreenerSlug || addresses.length === 0) return out;

  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30).join(",");
    const r = await getJson<{ pairs?: DsPair[] }>(`${BASE}/pairs/${adapter.dexscreenerSlug}/${batch}`);
    for (const p of r?.pairs ?? []) {
      const t = normalizePair(p, chain);
      if (t) out.set(t.id, t);
    }
  }
  return out;
}

/** One cheap request used to decide whether a chain has live coverage at all. */
export async function probeChain(chain: ChainId): Promise<boolean> {
  const adapter = CHAINS[chain];
  if (!adapter.dexscreenerSlug) return false;
  const q = adapter.discoveryQueries[0];
  const r = await getJson<{ pairs?: DsPair[] }>(`${BASE}/search?q=${encodeURIComponent(q)}`);
  return Boolean(r?.pairs?.some((p) => p.chainId === adapter.dexscreenerSlug));
}
