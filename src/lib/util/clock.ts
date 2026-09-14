/**
 * The desk's notion of "now".
 *
 * Live, this is `Date.now()`. Under replay it is a virtual clock that the
 * backtest advances candle by candle, so a position that the harness holds for
 * twenty simulated minutes reports twenty minutes held — not the two hundred
 * milliseconds the replay actually took. Every decision that depends on elapsed
 * time (hold duration, cache TTLs, signal staleness) reads from here.
 *
 * Only the decision layers are wired to it. Network adapters keep using the
 * wall clock, because a rate limit is a real-time thing no matter what the
 * simulation believes.
 */
let source: () => number = Date.now;

export function now(): number {
  return source();
}

/** Point the desk at a virtual clock. Returns a handle to restore the old one. */
export function setClock(fn: () => number): () => void {
  const previous = source;
  source = fn;
  return () => {
    source = previous;
  };
}

/** A clock the caller advances by hand. */
export class VirtualClock {
  constructor(private t: number) {}

  now = (): number => this.t;

  advance(ms: number): void {
    this.t += ms;
  }

  set(t: number): void {
    this.t = t;
  }
}
