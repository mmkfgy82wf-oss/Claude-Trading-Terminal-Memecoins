/**
 * Ceilings the interface cannot raise.
 *
 * Every other limit in this project lives in RiskConfig, which the settings
 * panel edits at runtime. That is right for a paper desk and wrong for a live
 * one: the whole point of a hard cap is that it does not move when someone —
 * including me, in a later commit — decides it should.
 *
 * These come from the environment, are read once, and are never written to.
 * They are a second line only. The first is that the burner wallet holds the
 * amount you are willing to lose and nothing else, which holds even when the
 * code is wrong.
 */
export interface LiveLimits {
  /** Largest single ticket, in USD. */
  maxTicketUsd: number;
  /** Largest total value in open positions at any moment, in USD. */
  maxDeployedUsd: number;
  /** Refuse to trade at all if the book is worth more than this. */
  maxBookUsd: number;
}

export const UNLIMITED: LiveLimits = {
  maxTicketUsd: Infinity,
  maxDeployedUsd: Infinity,
  maxBookUsd: Infinity,
};

function positive(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveLimits {
  return {
    maxTicketUsd: positive(env.LIVE_MAX_TICKET_USD),
    maxDeployedUsd: positive(env.LIVE_MAX_DEPLOYED_USD),
    maxBookUsd: positive(env.LIVE_MAX_BOOK_USD),
  };
}

export function liveTradingRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_LIVE_TRADING === "yes-i-accept-the-risk";
}

/**
 * Why live trading must not start. Null when it may.
 *
 * Unset limits are refused rather than defaulted. A default here would be a
 * number I picked for someone else's wallet, and the one thing a cap must be
 * is deliberate.
 */
export function liveStartupRefusal(
  limits: LiveLimits,
  bookUsd: number,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!liveTradingRequested(env)) return null;

  const missing = (Object.entries(limits) as [keyof LiveLimits, number][])
    .filter(([, value]) => !Number.isFinite(value))
    .map(([name]) => `LIVE_${name.replace(/([A-Z])/g, "_$1").toUpperCase().replace("MAX_", "MAX_")}`);
  if (missing.length > 0) {
    return `Live trading needs explicit ceilings. Unset: ${missing.join(", ")}.`;
  }
  if (bookUsd > limits.maxBookUsd) {
    return `Book is $${bookUsd.toFixed(2)}, over the $${limits.maxBookUsd.toFixed(2)} ceiling. Move funds off the wallet before trading it.`;
  }
  if (limits.maxTicketUsd > limits.maxDeployedUsd) {
    return `A ticket ceiling of $${limits.maxTicketUsd.toFixed(2)} above the deployed ceiling of $${limits.maxDeployedUsd.toFixed(2)} cannot both hold.`;
  }
  return null;
}

/** Clamp one ticket against the ceilings. */
export function capTicketUsd(
  sizeUsd: number,
  deployedUsd: number,
  limits: LiveLimits,
): number {
  const roomLeft = Math.max(0, limits.maxDeployedUsd - deployedUsd);
  return Math.max(0, Math.min(sizeUsd, limits.maxTicketUsd, roomLeft));
}
