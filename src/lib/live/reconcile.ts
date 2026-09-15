import type { Position } from "@/lib/types";
import { solBalance, tokenHolding } from "./rpc";

/**
 * Does the book still describe the wallet?
 *
 * Paper trading can assume an order filled exactly and instantly. On chain it
 * never does: a leg partially fills, a rounding step leaves dust, a send times
 * out and the outcome is recorded as unknown. Each one is small, and each one
 * is permanent — the book and the wallet drift apart monotonically and there is
 * no event that announces it. The first symptom is a sell that reverts for
 * insufficient funds, at full fee, in the middle of an exit.
 *
 * So it gets checked, and when the two disagree the chain is right.
 */
export interface PositionDrift {
  tokenId: string;
  symbol: string;
  bookQuantity: number;
  chainQuantity: number;
  /** Positive when the book claims more than the wallet holds — the dangerous way. */
  driftPct: number;
}

export interface Reconciliation {
  positionsChecked: number;
  /** Positions whose drift exceeded the tolerance. */
  drifts: PositionDrift[];
  /** Positions the chain could not be asked about. Not the same as agreeing. */
  unreadable: string[];
  solBookNative: number;
  solChainNative: number;
  solDriftPct: number;
  worstDriftPct: number;
}

/** Below this, a difference is dust and rounding rather than a problem. */
export const DRIFT_TOLERANCE_PCT = 1;

export async function reconcile(
  endpoint: string,
  owner: string,
  positions: Position[],
  cashNative: number,
  tolerancePct = DRIFT_TOLERANCE_PCT,
): Promise<Reconciliation> {
  const drifts: PositionDrift[] = [];
  const unreadable: string[] = [];
  let worst = 0;

  for (const position of positions) {
    const mint = position.tokenId.split(":")[1] ?? "";
    const holding = mint ? await tokenHolding(endpoint, owner, mint) : null;
    if (!holding) {
      // A position the chain says nothing about is either fully gone or
      // unreadable. Both are worth naming; neither is agreement.
      unreadable.push(position.symbol);
      continue;
    }

    const chainQuantity = Number(holding.amount) / 10 ** holding.decimals;
    const driftPct =
      position.quantity > 0 ? ((position.quantity - chainQuantity) / position.quantity) * 100 : 0;
    worst = Math.max(worst, Math.abs(driftPct));
    if (Math.abs(driftPct) > tolerancePct) {
      drifts.push({
        tokenId: position.tokenId,
        symbol: position.symbol,
        bookQuantity: position.quantity,
        chainQuantity,
        driftPct,
      });
    }
  }

  const lamports = await solBalance(endpoint, owner);
  const solChainNative = lamports === null ? Number.NaN : Number(lamports) / 1e9;
  const solDriftPct =
    cashNative > 0 && Number.isFinite(solChainNative)
      ? ((cashNative - solChainNative) / cashNative) * 100
      : 0;

  return {
    positionsChecked: positions.length,
    drifts,
    unreadable,
    solBookNative: cashNative,
    solChainNative,
    solDriftPct,
    worstDriftPct: Math.max(worst, Math.abs(solDriftPct)),
  };
}

/**
 * Whether this is bad enough to stop trading, and why.
 *
 * The asymmetry is deliberate. A book that claims *less* than the wallet holds
 * is untidy; a book that claims *more* is a desk about to sell something it
 * does not have. Only the second halts anything.
 */
export function haltReason(result: Reconciliation, haltAbovePct = 5): string | null {
  const overstated = result.drifts.filter((d) => d.driftPct > haltAbovePct);
  if (overstated.length > 0) {
    const worst = overstated.reduce((a, b) => (b.driftPct > a.driftPct ? b : a));
    return `Book claims ${worst.driftPct.toFixed(1)}% more ${worst.symbol} than the wallet holds — stopping before an exit reverts.`;
  }
  if (result.solDriftPct > haltAbovePct) {
    return `Book claims ${result.solDriftPct.toFixed(1)}% more SOL than the wallet holds — stopping before a fee cannot be paid.`;
  }
  return null;
}
