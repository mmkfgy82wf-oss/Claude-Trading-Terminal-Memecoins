/**
 * The desk's source of randomness.
 *
 * Only one thing in the decision path is random: the jitter in the slippage
 * model. Live that is the point — two identical orders do not fill identically.
 * Under a backtest it is noise that swamps the signal, because comparing two
 * configurations over the same tape is only meaningful if everything except the
 * configuration is held still. So the replay seeds it.
 */
let source: () => number = Math.random;

export function random(): number {
  return source();
}

/** Swap in a deterministic source. Returns a handle to restore the old one. */
export function setRandom(fn: () => number): () => void {
  const previous = source;
  source = fn;
  return () => {
    source = previous;
  };
}

/** mulberry32 — small, fast, and good enough for jitter. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
