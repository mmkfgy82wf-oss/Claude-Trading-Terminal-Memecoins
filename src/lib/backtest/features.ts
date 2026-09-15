import type { Token } from "@/lib/types";

/**
 * What the desk can read off a pair, as numbers.
 *
 * Shared so the two entry studies cannot drift: one asks what the desk saw on
 * the positions it actually opened, the other asks the same of every pair it
 * could have opened. If those two used different definitions of "buy share",
 * comparing them would be meaningless.
 *
 * Deliberately raw. These are the inputs SCOUT and QUANT already read, not
 * scores of my own invention — so anything that separates here is something
 * the desk could act on tomorrow without new data.
 */
export type Features = Record<string, number>;

export function tokenFeatures(token: Pick<Token,
  | "ageMinutes" | "liquidityUsd" | "fdvUsd" | "volume24hUsd" | "volume5mUsd"
  | "buys5m" | "sells5m" | "change5m" | "change1h" | "change24h">): Features {
  const trades = token.buys5m + token.sells5m;
  const baseline = token.volume24hUsd / 288;
  return {
    alterMin: token.ageMinutes,
    poolUsd: token.liquidityUsd,
    fdvZuPool: token.fdvUsd / Math.max(1, token.liquidityUsd),
    umsatzZuPool: token.volume24hUsd / Math.max(1, token.liquidityUsd),
    lauf5m: token.change5m,
    lauf1h: token.change1h,
    lauf24h: token.change24h,
    // NaN rather than 50 when nothing traded: "no reading" is not "balanced".
    kaufanteil: trades > 0 ? (token.buys5m / trades) * 100 : NaN,
    volumenschub: token.volume5mUsd / Math.max(1, baseline),
  };
}

export const FEATURE_NAMES = Object.keys(
  tokenFeatures({
    ageMinutes: 0, liquidityUsd: 1, fdvUsd: 1, volume24hUsd: 1, volume5mUsd: 1,
    buys5m: 1, sells5m: 1, change5m: 0, change1h: 0, change24h: 0,
  }),
);
