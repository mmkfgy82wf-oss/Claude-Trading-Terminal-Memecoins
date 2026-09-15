import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { rpc, type RpcTransactionMeta } from "./rpc";
import type { SendOutcome } from "./types";

/**
 * Sign, send, and find out what happened.
 *
 * The whole file exists for one distinction. A send that produced no
 * confirmation has three possible meanings, not two:
 *
 *   the chain rejected it            → failed, and retrying is correct
 *   the blockhash expired unused     → failed, and retrying is correct
 *   we simply have not heard back    → unknown, and retrying buys it twice
 *
 * Only `lastValidBlockHeight` separates the second from the third. Once the
 * chain is past that height the transaction can never land, so silence means
 * failure; before it, silence means nothing at all. A desk that collapses
 * those two cases into "failed" will, sooner or later, open the same position
 * twice with money it does not have.
 */

export interface SendOptions {
  endpoint: string;
  /** From the swap build. Without it, no send can ever be declared failed. */
  lastValidBlockHeight: number | null;
  /** Give up waiting after this long and report `unknown`. */
  timeoutMs?: number;
  pollMs?: number;
  /** Injectable so the confirmation loop is testable without a chain. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface SignatureStatus {
  slot: number;
  confirmations: number | null;
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
}

export function signTransaction(base64: string, signer: Keypair): VersionedTransaction {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign([signer]);
  return tx;
}

export async function sendAndConfirm(
  base64: string,
  signer: Keypair,
  options: SendOptions,
): Promise<SendOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + (options.timeoutMs ?? 90_000);
  const pollMs = options.pollMs ?? 2_000;

  let signed: VersionedTransaction;
  try {
    signed = signTransaction(base64, signer);
  } catch (err) {
    // Nothing was sent, so this one is unambiguous.
    return { state: "failed", signature: null, error: `could not sign: ${(err as Error).message}` };
  }

  const wire = Buffer.from(signed.serialize()).toString("base64");
  const sent = await rpc<string>(options.endpoint, "sendTransaction", [
    wire,
    // Preflight stays on: a transaction that cannot simulate is one that would
    // burn the fee for nothing. maxRetries is left to the node.
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);

  if (!sent.ok) {
    // The node rejected it outright *or* the call timed out. Those differ: a
    // rejection names a reason, an abort names the transport.
    const aborted = /AbortError|TimeoutError|TypeError/.test(sent.error);
    return aborted
      ? { state: "unknown", signature: null, error: `${sent.error} — the send may still have landed` }
      : { state: "failed", signature: null, error: sent.error };
  }

  const signature = sent.value;

  while (now() < deadline) {
    const statuses = await rpc<{ value: (SignatureStatus | null)[] }>(
      options.endpoint,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );

    if (statuses.ok) {
      const status = statuses.value.value?.[0] ?? null;
      if (status) {
        if (status.err) {
          return { state: "failed", signature, error: JSON.stringify(status.err).slice(0, 200) };
        }
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          const meta = await fetchMeta(options.endpoint, signature);
          return { state: "confirmed", signature, meta };
        }
      } else if (options.lastValidBlockHeight != null) {
        // No status at all. Only the block height can turn that into a verdict.
        const height = await rpc<number>(options.endpoint, "getBlockHeight", [{ commitment: "confirmed" }]);
        if (height.ok && height.value > options.lastValidBlockHeight) {
          return {
            state: "failed",
            signature,
            error: `blockhash expired at height ${options.lastValidBlockHeight} — never landed`,
          };
        }
      }
    }

    await sleep(pollMs);
  }

  return {
    state: "unknown",
    signature,
    error: "no confirmation before the deadline — check the signature before retrying",
  };
}

async function fetchMeta(endpoint: string, signature: string): Promise<RpcTransactionMeta | null> {
  const tx = await rpc<{ meta: RpcTransactionMeta | null } | null>(endpoint, "getTransaction", [
    signature,
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ]);
  return tx.ok ? (tx.value?.meta ?? null) : null;
}
