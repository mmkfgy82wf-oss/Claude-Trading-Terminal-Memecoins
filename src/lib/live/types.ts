export interface TokenBalanceDelta {
  mint: string;
  decimals: number;
  /** Base units gained (positive) or spent (negative) by the owner. */
  delta: bigint;
}

/** Where a send ended up. The third case is the one that matters. */
export type SendOutcome =
  | { state: "confirmed"; signature: string; meta: unknown }
  | { state: "failed"; signature: string | null; error: string }
  /**
   * Sent, but no confirmation was seen before the deadline. The transaction
   * may still land. Treating this as a failure and retrying is how a desk
   * buys the same position twice.
   */
  | { state: "unknown"; signature: string | null; error: string };
