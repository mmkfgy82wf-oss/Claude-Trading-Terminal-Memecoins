import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

/**
 * Where the key comes from, and where it must not.
 *
 * The path is read from the environment and the file is read from disk. There
 * is deliberately no way to pass a key inline, through the UI, or through a
 * setting — an inline key ends up in a shell history, a settings file, a
 * screenshot, or a commit, and every one of those is permanent.
 *
 * The file is expected in the format `solana-keygen` writes: a JSON array of
 * 64 byte values. That is also the format every Solana tool already reads, so
 * nothing here invents a new one.
 *
 * None of this is the real protection. The real protection is that the wallet
 * behind this key holds the amount you are prepared to lose and nothing else.
 */
export interface SignerLoad {
  keypair: Keypair | null;
  /** Why there is no signer, in words worth showing an operator. */
  reason: string | null;
}

export function loadSigner(env: Record<string, string | undefined> = process.env): SignerLoad {
  const path = env.SOLANA_KEYPAIR_PATH;
  if (!path) {
    return { keypair: null, reason: "SOLANA_KEYPAIR_PATH is not set — no wallet is attached." };
  }
  // A key inside the working tree is one `git add -A` away from being public.
  if (!path.startsWith("/") && !path.startsWith("~")) {
    return {
      keypair: null,
      reason: `SOLANA_KEYPAIR_PATH must be an absolute path outside the project (got "${path}").`,
    };
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path.replace(/^~/, env.HOME ?? "~"), "utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      return { keypair: null, reason: "Keypair file is not a 64-byte solana-keygen array." };
    }
    // Checked before the Uint8Array, not after. `Uint8Array.from` wraps out of
    // range values modulo 256 without complaint, so a mistyped file would
    // silently become a *different, valid* wallet rather than an error — and
    // the first sign of it would be funds arriving nowhere.
    if (parsed.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255)) {
      return { keypair: null, reason: "Keypair file contains values outside 0..255." };
    }
    const bytes = Uint8Array.from(parsed as number[]);
    return { keypair: Keypair.fromSecretKey(bytes), reason: null };
  } catch (err) {
    // The message is shown to an operator, so it must not carry file contents.
    return { keypair: null, reason: `Keypair file could not be read: ${(err as Error).name}.` };
  }
}
