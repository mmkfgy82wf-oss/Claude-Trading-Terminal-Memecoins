import type { TapeFrame, TapeToken } from "@/lib/market/recorder";
import type { ChainId } from "@/lib/types";
import { seeded } from "@/lib/util/random";
import { memorySource, type SnapshotSource } from "./source";

/**
 * A bench of market shapes, built on purpose.
 *
 * This is not history and does not pretend to be. It is the memecoin equivalent
 * of a crash-test sled: each archetype reproduces one failure mode the desk
 * actually suffered, so an exit rule can be asked "would you have got out of
 * this" without waiting for the market to do it again.
 *
 * The archetypes come from the live trade log, not from imagination:
 *
 *   rug-early     peaked +9%, pool fell 93%, closed -98%   (DANCINGCATE)
 *   rug-late      peaked +75%, one rung taken, pool to 0   (BEM, -37.8%)
 *   distribution  price climbs while the pool quietly empties — the case
 *                 nothing in the desk could see, because nothing was
 *                 watching liquidity over time
 *   bleed         no rug, just a slide into the stop        (-28.6% stop-loss)
 *   chop          sideways noise; the thing that shakes out a tight trail
 *   runner        the one trade that has to pay for the rest (EPEP, +$191)
 *
 * The *mix* of those is the load-bearing assumption and the honest weakness:
 * change the proportions and every number moves. It is a parameter for that
 * reason, and the default is set from the observed run (20 losses, 8 wins, at
 * least five of the losses a pool drain) rather than chosen to look good.
 */

export type ArchetypeName =
  | "rug-early"
  | "rug-late"
  | "distribution"
  | "bleed"
  | "chop"
  | "runner";

export interface CohortMix {
  "rug-early": number;
  "rug-late": number;
  distribution: number;
  bleed: number;
  chop: number;
  runner: number;
}

/** Proportions taken from the overnight run, not tuned for a pretty result. */
export const OBSERVED_MIX: CohortMix = {
  "rug-early": 5,
  "rug-late": 2,
  distribution: 3,
  bleed: 4,
  chop: 4,
  runner: 2,
};

export interface ScenarioOptions {
  seed?: number;
  mix?: Partial<CohortMix>;
  /** Simulated seconds between frames. */
  stepSeconds?: number;
  frames?: number;
  chains?: ChainId[];
  startAt?: number;
}

interface Step {
  price: number;
  liquidity: number;
  buys: number;
  sells: number;
  volume: number;
}

/**
 * Every archetype pumps before it does whatever it does next.
 *
 * That is not decoration. The desk only ever buys strength, so a shape that
 * never rallies is a shape it never holds, and a bench full of them would
 * measure nothing. The calibration target is the live consensus board: fresh
 * pairs running +85% to +400% in an hour on pools between $24k and $126k.
 * `pumpPctPerHour` is that number, per archetype.
 */
const PUMP_PCT_PER_HOUR: Record<ArchetypeName, [number, number]> = {
  "rug-early": [60, 180],
  "rug-late": [120, 420],
  distribution: [90, 260],
  bleed: [40, 110],
  chop: [50, 140],
  runner: [300, 900],
};

/** One token's whole life, frame by frame. */
function path(kind: ArchetypeName, frames: number, stepMs: number, rng: () => number): Step[] {
  const pick = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const liq0 = pick(22_000, 130_000);
  const out: Step[] = [];

  const framesPerHour = 3_600_000 / stepMs;
  const [lo, hi] = PUMP_PCT_PER_HOUR[kind];
  // Per-frame drift that compounds to the hourly move above.
  const drift = Math.pow(1 + pick(lo, hi) / 100, 1 / framesPerHour) - 1;
  const noise = kind === "chop" ? 0.05 : 0.025;

  // Where the pump ends and the archetype's real behaviour starts.
  const turnAt = Math.floor(
    (kind === "rug-early" ? pick(0.15, 0.35) : kind === "runner" ? 0.95 : pick(0.35, 0.6)) * frames,
  );
  const rugAt =
    kind === "rug-early" || kind === "rug-late"
      ? turnAt + Math.floor(pick(0.02, 0.15) * frames)
      : Infinity;

  let price = 1;
  let liquidity = liq0;
  let peakLiquidity = liq0;

  for (let i = 0; i < frames; i++) {
    if (i === rugAt) {
      // One frame, because a pull is one transaction. No price stop can be hit
      // on the way down — the next quote the desk sees is already the bottom.
      // Any rule claiming to prevent this loss has to act before this frame.
      price *= pick(0.02, 0.09);
      liquidity *= pick(0, 0.07);
    } else if (i > rugAt) {
      price *= pick(0.9, 1.02);
      liquidity *= pick(0.9, 1.0);
    } else if (i < turnAt) {
      price *= 1 + drift + (rng() - 0.5) * noise;
      // A pump pulls liquidity *in*, on every archetype including the ones
      // that end badly — which is exactly why "the pool is smaller than it
      // was" cannot be the only rug signal. Distribution starts at the turn,
      // not at the launch: the position is bought while it still looks
      // healthy, and the pool only begins to leave afterwards. An archetype
      // that drained from frame zero would never clear the liquidity floor
      // and so would never be bought — it would test nothing at all.
      liquidity *= pick(1.0, 1.035);
    } else {
      switch (kind) {
        case "bleed":
          price *= pick(0.97, 1.005);
          liquidity *= pick(0.975, 1.0);
          break;
        case "chop":
          price *= pick(0.93, 1.075);
          liquidity *= pick(0.985, 1.015);
          break;
        case "distribution":
          // The pool leaves while residual buying holds the price up. That
          // cannot continue: once enough of the liquidity is gone the price is
          // standing on nothing, and it goes. An archetype that drained and
          // then drifted higher would not be distribution at all — it would be
          // a slow chop wearing the name, and measuring an exit rule against
          // it would reward doing nothing.
          if (liquidity > peakLiquidity * 0.45) {
            price *= pick(0.99, 1.025);
            liquidity *= pick(0.94, 0.985);
          } else {
            price *= pick(0.86, 0.99);
            liquidity *= pick(0.85, 0.97);
          }
          break;
        case "runner":
          price *= pick(0.96, 1.05);
          liquidity *= pick(0.99, 1.02);
          break;
        default:
          price *= 1 + drift * 0.3;
          liquidity *= pick(0.99, 1.02);
      }
    }

    price = Math.max(1e-12, price);
    liquidity = Math.max(0, liquidity);
    peakLiquidity = Math.max(peakLiquidity, liquidity);

    const prev = out[out.length - 1];
    const move = prev ? Math.abs(price / prev.price - 1) : 0.01;
    const rising = prev ? price > prev.price : true;
    // Turnover tracks how hard the thing is moving, so a burst shows up as a
    // burst rather than as a constant the volume filters cannot read.
    const volume = liquidity * (0.02 + move * 4) * pick(0.7, 1.6);
    const buys = Math.round(pick(25, 90) * (rising ? 1.4 : 0.75) * (1 + move * 6));
    const sells = Math.round(buys * (rising ? pick(0.4, 0.8) : pick(1.0, 1.9)));
    out.push({ price, liquidity, buys, sells, volume });
  }
  return out;
}

export function scenarioSource(options: ScenarioOptions = {}): SnapshotSource {
  const mix: CohortMix = { ...OBSERVED_MIX, ...options.mix };
  const frames = options.frames ?? 240;
  const stepMs = (options.stepSeconds ?? 30) * 1_000;
  const chains = options.chains ?? ["solana", "robinhood"];
  const startAt = options.startAt ?? Date.UTC(2026, 8, 13, 20, 0, 0);
  const rng = seeded(options.seed ?? 1337);

  const specs: { kind: ArchetypeName; symbol: string; chain: ChainId; base: number; steps: Step[] }[] = [];
  let n = 0;
  for (const [kind, count] of Object.entries(mix) as [ArchetypeName, number][]) {
    for (let i = 0; i < count; i++) {
      n += 1;
      specs.push({
        kind,
        symbol: `${kind.replace(/[^a-z]/g, "").toUpperCase().slice(0, 6)}${i + 1}`,
        chain: chains[n % chains.length],
        base: 1e-6 * (0.4 + rng() * 3),
        steps: path(kind, frames, stepMs, rng),
      });
    }
  }

  const tape: TapeFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const t = startAt + i * stepMs;
    const tokens: TapeToken[] = specs.map((spec, idx) => {
      const step = spec.steps[i];
      const priceUsd = spec.base * step.price;
      const prev5 = spec.steps[Math.max(0, i - Math.round(300_000 / stepMs))];
      const prev60 = spec.steps[Math.max(0, i - Math.round(3_600_000 / stepMs))];
      const first = spec.steps[0];
      const change = (from: Step) => (from.price > 0 ? (step.price / from.price - 1) * 100 : 0);
      // The 24h figure is a trailing mean of what the pair has actually done,
      // so a volume burst reads as a burst — pinning it to a fixed multiple of
      // the 5m number would hold acceleration at exactly 1.0 forever and the
      // bench would silently disable QUANT's third input.
      const volume5mUsd = step.volume;
      const window = spec.steps.slice(Math.max(0, i - 287), i + 1);
      const volume24hUsd = (window.reduce((a, b) => a + b.volume, 0) / window.length) * 288;

      return {
        id: `${spec.chain}:scenario${idx}`,
        chain: spec.chain,
        pairAddress: `scenario${idx}`,
        tokenAddress: `mint${idx}`,
        symbol: spec.symbol,
        name: `${spec.kind} ${idx}`,
        priceUsd,
        priceNative: priceUsd / (spec.chain === "solana" ? 180 : 3200),
        liquidityUsd: step.liquidity,
        fdvUsd: step.liquidity * (8 + rng() * 14),
        volume24hUsd,
        volume5mUsd,
        buys5m: step.buys,
        sells5m: step.sells,
        change5m: change(prev5),
        change1h: change(prev60),
        change24h: change(first),
        ageMinutes: 12 + Math.round((i * stepMs) / 60_000),
        dex: "scenario",
        simulated: true,
      };
    });

    tape.push({
      v: 1,
      t,
      tick: i + 1,
      quotes: { solana: 180, robinhood: 3200 },
      tokens,
    });
  }

  const label = Object.entries(mix)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${c}x${k}`)
    .join(" ");
  return memorySource(`bench(${label})`, tape, "scenario");
}
