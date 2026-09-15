import { CHAINS } from "@/lib/market/chains";
import type { ChainId, RiskConfig } from "@/lib/types";

/**
 * Gas the desk is not allowed to spend.
 *
 * Every exit costs a transaction, and that transaction is paid for in the same
 * asset the desk buys with. Sizing against the full cash balance therefore has
 * a failure mode with no recovery: the treasury goes into positions, the market
 * turns, and there is nothing left to pay for the sells. The position is not
 * illiquid — you are.
 *
 * On a $1800 book the numbers involved are pennies and the mistake never
 * surfaces. On a 100-euro book, eight open positions and a ladder that can fire
 * four times each is real money against a real balance, which is why this
 * exists now rather than later.
 *
 * The reserve covers every open position through a full ladder, times a margin,
 * because a priority fee in a contested block is not the fee you budgeted for.
 */
export function gasReserveNative(
  chain: ChainId,
  openPositions: number,
  risk: RiskConfig,
): number {
  if (openPositions <= 0) return 0;
  // Rungs plus the final exit: the most transactions one position can need.
  const legsPerPosition = risk.takeProfitLadder.length + 1;
  return CHAINS[chain].fee.flat * openPositions * legsPerPosition * risk.gasReserveMultiple;
}

/**
 * Cash a new ticket may actually be paid from, after the reserve for the
 * positions already open *and* the one about to be opened.
 */
export function deployableCashNative(
  chain: ChainId,
  cashNative: number,
  openPositions: number,
  risk: RiskConfig,
): number {
  const reserve = gasReserveNative(chain, openPositions + 1, risk);
  return Math.max(0, cashNative - reserve);
}
