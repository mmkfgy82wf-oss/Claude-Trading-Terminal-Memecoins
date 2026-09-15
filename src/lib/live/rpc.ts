import type { TokenBalanceDelta } from "./types";

/**
 * Solana JSON-RPC over plain fetch.
 *
 * web3.js ships a Connection that does this, and it drags in a JSON-RPC client
 * whose own dependencies carry advisories. Everything else in this project
 * talks HTTP through a small defensive helper with its own timeout, so the RPC
 * does too — and web3.js is used for what only it can do: the transaction wire
 * format and the keypair.
 */
const TIMEOUT_MS = 20_000;

export interface RpcError {
  code: number;
  message: string;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

let requestId = 0;

export async function rpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  timeoutMs = TIMEOUT_MS,
): Promise<RpcResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
    if (!res.ok) return { ok: false, error: `${method}: HTTP ${res.status}` };

    const payload = (await res.json()) as { result?: T; error?: RpcError };
    if (payload.error) return { ok: false, error: `${method}: ${payload.error.message}` };
    if (payload.result === undefined) return { ok: false, error: `${method}: empty result` };
    return { ok: true, value: payload.result };
  } catch (err) {
    // An aborted send is the dangerous case: the transaction may well have
    // landed. The caller has to treat this as "unknown", never as "failed".
    return { ok: false, error: `${method}: ${(err as Error).name}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Shape of one entry in a confirmed transaction's token balance arrays. */
export interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface RpcTransactionMeta {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: RpcTokenBalance[];
  postTokenBalances?: RpcTokenBalance[];
}

/**
 * What actually moved, read from the confirmed transaction.
 *
 * This is the difference between a book that matches the wallet and one that
 * drifts. A quote is a promise; the balances in the confirmed transaction are
 * what happened. Anything that builds a fill from the quote is guessing, and
 * the guess compounds silently over every trade.
 */
export function tokenDelta(
  meta: RpcTransactionMeta,
  owner: string,
  mint: string,
): TokenBalanceDelta | null {
  const before = (meta.preTokenBalances ?? []).filter((b) => b.mint === mint && b.owner === owner);
  const after = (meta.postTokenBalances ?? []).filter((b) => b.mint === mint && b.owner === owner);
  if (before.length === 0 && after.length === 0) return null;

  const sum = (rows: RpcTokenBalance[]): bigint =>
    rows.reduce((total, row) => {
      try {
        return total + BigInt(row.uiTokenAmount.amount);
      } catch {
        return total;
      }
    }, 0n);

  const decimals = after[0]?.uiTokenAmount.decimals ?? before[0]?.uiTokenAmount.decimals ?? 0;
  return { mint, decimals, delta: sum(after) - sum(before) };
}

/**
 * Lamports the owner gained or lost, net of the fee it paid.
 *
 * Native SOL never appears in the token balance arrays, so a SOL leg has to be
 * read from `preBalances`/`postBalances` instead — and the fee has to be added
 * back, or every SOL sale looks slightly smaller than it was.
 */
export function lamportDelta(meta: RpcTransactionMeta, accountIndex: number): bigint | null {
  const before = meta.preBalances?.[accountIndex];
  const after = meta.postBalances?.[accountIndex];
  if (typeof before !== "number" || typeof after !== "number") return null;
  return BigInt(after) - BigInt(before) + BigInt(meta.fee ?? 0);
}

/** What the wallet actually holds of one mint, straight from the chain. */
export interface TokenHolding {
  /** Base units. */
  amount: bigint;
  decimals: number;
  /** The associated token account the balance sits in. */
  account: string;
}

interface RpcTokenAccount {
  pubkey: string;
  account: {
    data: {
      parsed?: {
        info?: {
          tokenAmount?: { amount?: string; decimals?: number };
        };
      };
    };
  };
}

/**
 * Ask the chain what the wallet holds, rather than trusting the book.
 *
 * A sell sized from the book's own quantity is a sell sized from a number that
 * has never been checked against reality. Every partial fill, every rounding
 * step and every transaction whose outcome we recorded as "unknown" widens the
 * gap, and the first symptom is a sell that reverts for insufficient funds —
 * at full fee, in the middle of an exit. It also answers the decimals, which
 * no price aggregator reports and which a swap cannot be sized without.
 */
export async function tokenHolding(
  endpoint: string,
  owner: string,
  mint: string,
): Promise<TokenHolding | null> {
  const res = await rpc<{ value: RpcTokenAccount[] }>(endpoint, "getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  if (!res.ok) return null;

  const accounts = res.value.value ?? [];
  if (accounts.length === 0) return null;

  // A wallet can hold the same mint in more than one account. The deepest is
  // the one a swap should be sized against; the others are dust or leftovers.
  let best: TokenHolding | null = null;
  for (const entry of accounts) {
    const raw = entry.account?.data?.parsed?.info?.tokenAmount;
    const decimals = typeof raw?.decimals === "number" ? raw.decimals : null;
    if (!raw?.amount || decimals === null) continue;
    let amount: bigint;
    try {
      amount = BigInt(raw.amount);
    } catch {
      continue;
    }
    if (!best || amount > best.amount) best = { amount, decimals, account: entry.pubkey };
  }
  return best;
}

/** Lamports the wallet holds. Used to keep the treasury honest. */
export async function solBalance(endpoint: string, owner: string): Promise<bigint | null> {
  const res = await rpc<{ value: number }>(endpoint, "getBalance", [
    owner,
    { commitment: "confirmed" },
  ]);
  if (!res.ok || typeof res.value.value !== "number") return null;
  return BigInt(Math.round(res.value.value));
}
