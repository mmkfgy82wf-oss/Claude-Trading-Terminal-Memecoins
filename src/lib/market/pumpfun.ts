import type { ChainId } from "@/lib/types";

/**
 * Pump.fun as a **discovery** source — nothing more.
 *
 * It answers one question the aggregators cannot: what launched in the last few
 * minutes. A brand-new token has a name nobody has searched for, so a text
 * search can never surface it; the launchpad's own feed can.
 *
 * What it deliberately does *not* do is price anything. Pre-graduation tokens
 * trade against a bonding curve rather than a pool, and the desk's slippage and
 * liquidity models assume a pool. So this module returns mint addresses, and
 * DexScreener is asked what they are actually worth. That keeps every agent and
 * the whole execution model unchanged.
 *
 * Caveat worth knowing: pump.fun publishes no official data API. This is the
 * undocumented frontend endpoint, so the parser is written to tolerate renamed
 * or missing fields and the whole module degrades to an empty list rather than
 * breaking a tick. `npm run check-sources` verifies it against the live API.
 */

const ENDPOINTS = [
  "https://frontend-api-v3.pump.fun",
  "https://frontend-api-v2.pump.fun",
  "https://frontend-api.pump.fun",
];

const TIMEOUT_MS = 7_000;

/** Market cap at which a pump.fun token migrates to a real pool. */
const GRADUATION_MCAP_USD = 69_000;

export interface NewMint {
  mint: string;
  symbol: string;
  name: string;
  createdAt: number;
  /** 0..1 along the bonding curve, when the source reports enough to tell. */
  graduationProgress: number | null;
  /** True once it has migrated to a real pool. */
  graduated: boolean;
  chain: ChainId;
}

/** The endpoint that last answered, so we stop probing the dead ones. */
let liveBase: string | null = null;

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
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Unofficial API: field names have changed before, so read them defensively. */
export type RawCoin = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function normalizeCoin(raw: RawCoin): NewMint | null {
  const mint = str(raw.mint) ?? str(raw.address) ?? str(raw.ca) ?? str(raw.coinMint);
  if (!mint) return null;

  const created =
    num(raw.created_timestamp) ?? num(raw.createdAt) ?? num(raw.created_at) ?? Date.now();
  // Some fields come in seconds, some in milliseconds.
  const createdAt = created < 1e12 ? created * 1000 : created;

  const graduated =
    raw.complete === true ||
    raw.graduated === true ||
    Boolean(str(raw.raydium_pool)) ||
    Boolean(str(raw.pump_swap_pool));

  const explicitProgress = num(raw.bonding_curve_progress);
  const mcap = num(raw.usd_market_cap) ?? num(raw.market_cap);
  const graduationProgress = graduated
    ? 1
    : explicitProgress != null
      ? Math.min(1, explicitProgress > 1 ? explicitProgress / 100 : explicitProgress)
      : mcap != null
        ? Math.min(1, mcap / GRADUATION_MCAP_USD)
        : null;

  return {
    mint,
    symbol: (str(raw.symbol) ?? str(raw.ticker) ?? "???").toUpperCase().slice(0, 12),
    name: str(raw.name) ?? str(raw.symbol) ?? "unknown",
    createdAt,
    graduationProgress,
    graduated,
    chain: "solana",
  };
}

async function query(path: string): Promise<RawCoin[]> {
  const bases = liveBase ? [liveBase] : ENDPOINTS;
  for (const base of bases) {
    const data = await getJson<RawCoin[] | { coins?: RawCoin[]; data?: RawCoin[] }>(`${base}${path}`);
    if (!data) continue;
    const list = Array.isArray(data) ? data : (data.coins ?? data.data ?? []);
    if (list.length > 0) {
      liveBase = base;
      return list;
    }
  }
  return [];
}

/**
 * The two cohorts worth trading, and why they are different:
 *
 * - **freshly launched** — maximum asymmetry, almost no information, most will
 *   die. SENTINEL vetoes the majority of these on liquidity alone, which is
 *   correct.
 * - **close to graduation** — the curve has filled, real money is in, and a
 *   migration to a proper pool is imminent. This is the band where the desk's
 *   liquidity floors and slippage model actually hold.
 *
 * Both are returned; SCOUT and SENTINEL decide what survives.
 */
export async function fetchNewMints(limit = 50): Promise<NewMint[]> {
  const [fresh, graduating] = await Promise.all([
    query(`/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`),
    query(`/coins?offset=0&limit=${limit}&sort=market_cap&order=DESC&includeNsfw=false&complete=false`),
  ]);

  const seen = new Map<string, NewMint>();
  for (const raw of [...fresh, ...graduating]) {
    const mint = normalizeCoin(raw);
    if (mint && !seen.has(mint.mint)) seen.set(mint.mint, mint);
  }
  return [...seen.values()];
}

/** Whether the launchpad feed is answering at all — surfaced in the UI. */
export function pumpfunReachable(): boolean {
  return liveBase !== null;
}
