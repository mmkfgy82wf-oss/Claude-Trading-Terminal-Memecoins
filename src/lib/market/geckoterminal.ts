import type { ChainId } from "@/lib/types";
import { CHAINS } from "./chains";

/**
 * New pools, from GeckoTerminal — the key-free way to see fresh launches on a
 * chain that has no open launchpad API.
 *
 * On Solana, pump.fun answers "what just launched" directly. Robinhood Chain's
 * dominant launchpad is Pons, which publishes no comparable public endpoint —
 * its documented API is Bitquery's GraphQL and needs a token. What every chain
 * does expose is the pool that appears when a launch becomes tradable, and that
 * is the moment the desk cares about anyway: before a pool exists there is
 * nothing to size a position against.
 *
 * Returns base-token addresses only. As with the launchpad feed, DexScreener is
 * asked what they are worth — one pricing model for the whole desk.
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const TIMEOUT_MS = 8_000;

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json;version=20230302" },
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

/** Only the shape we consume; everything is read defensively. */
type RawPool = {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * A pool's base-token address.
 *
 * GeckoTerminal namespaces relationship ids as `<network>_<address>`, so the
 * network prefix has to come off — and an EVM address contains no underscore
 * while a Solana one contains no `0x`, which is why the split is on the first
 * separator rather than the last.
 */
export function baseTokenAddress(pool: RawPool, network: string): string | null {
  const rel = pool.relationships as { base_token?: { data?: { id?: unknown } } } | undefined;
  const id = str(rel?.base_token?.data?.id);
  if (id) {
    const prefix = `${network}_`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  }
  // Some responses carry it on the attributes instead.
  const attrs = pool.attributes ?? {};
  return str(attrs.base_token_address) ?? str(attrs.token_address) ?? null;
}

/** Minutes since the pool was created, when the response says. */
export function poolAgeMinutes(pool: RawPool): number | null {
  const created = str(pool.attributes?.pool_created_at);
  if (!created) return null;
  const at = Date.parse(created);
  return Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : null;
}

/** Which network id this chain is listed under. */
function network(chain: ChainId): string | null {
  return CHAINS[chain].geckoterminalNetwork;
}

let reachable = false;

/** Whether the new-pools feed is answering at all — surfaced in the UI. */
export function geckoterminalReachable(): boolean {
  return reachable;
}

/**
 * Base-token addresses of pools created in the last 48 hours, newest first.
 * Two pages, because one launchpad can mint tens of thousands of tokens a day
 * and the first twenty would otherwise be seconds old and unpriceable.
 */
export async function fetchNewPoolTokens(chain: ChainId, pages = 2): Promise<string[]> {
  const net = network(chain);
  if (!net) return [];

  const responses = await Promise.all(
    Array.from({ length: Math.max(1, pages) }, (_, i) =>
      getJson<{ data?: RawPool[] }>(`${BASE}/networks/${net}/new_pools?page=${i + 1}`),
    ),
  );

  const seen = new Set<string>();
  for (const response of responses) {
    if (!response?.data) continue;
    reachable = true;
    for (const pool of response.data) {
      const address = baseTokenAddress(pool, net);
      if (address) seen.add(address);
    }
  }
  return [...seen];
}
