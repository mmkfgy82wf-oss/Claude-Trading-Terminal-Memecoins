import type { ChainId, Token } from "@/lib/types";

/**
 * A memecoin market simulator.
 *
 * It is not a random walk: real memecoins move through recognisable regimes,
 * and the agents are only worth testing against a feed that reproduces them.
 * Each synthetic token is assigned an archetype that drives its drift, its
 * volatility and the lifecycle events it can throw (rug, plateau, revival).
 */

type Archetype = "runner" | "ruggable" | "slow-burner" | "dead" | "pumper";

interface SimToken {
  token: Token;
  archetype: Archetype;
  /** Per-tick log-drift. */
  drift: number;
  vol: number;
  /** Ticks until the next regime change. */
  fuse: number;
  rugged: boolean;
  birthTick: number;
}

const NAMES = [
  ["DOGWIF", "dogwifhat clone"], ["PEPO", "Pepo the Frog"], ["MOONCAT", "Moon Cat"],
  ["GIGACHAD", "Gigachad Coin"], ["BONKIE", "Bonkie Inu"], ["SOLARIS", "Solaris Dog"],
  ["WOJAK", "Wojak Finance"], ["TURBO", "Turbo Toad"], ["FROGE", "Froge Protocol"],
  ["HARAMBE", "Harambe Memorial"], ["NYAN", "Nyan Rocket"], ["CHONK", "Chonky Cat"],
  ["RETARDIO", "Retardio"], ["PONKE", "Ponke Monke"], ["MICHI", "Michi Cat"],
  ["SIGMA", "Sigma Grindset"], ["SKIBIDI", "Skibidi Coin"], ["GOATSE", "Goat Token"],
  ["BANANA", "Banana Gun Ape"], ["HOPPY", "Hoppy Frog"], ["LUMI", "Lumi Lightbug"],
  ["ZOOMER", "Zoomer Coin"], ["SNEK", "Snek"], ["POPCAT", "Popcat Redux"],
];

const ARCHETYPE_MIX: Archetype[] = [
  "runner", "ruggable", "ruggable", "slow-burner", "pumper", "dead", "slow-burner", "pumper",
];

let seq = 0;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function mkAddress(prefix: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = prefix;
  while (s.length < 44) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s.slice(0, 44);
}

function spawn(chain: ChainId, tick: number): SimToken {
  const [symbol, name] = pick(NAMES);
  const archetype = pick(ARCHETYPE_MIX);
  const suffix = (++seq).toString(36).toUpperCase();
  const price = rnd(0.000012, 0.0085);
  const liq = archetype === "ruggable" ? rnd(3_000, 28_000) : rnd(18_000, 640_000);
  const ageMinutes = Math.round(rnd(2, 900));
  const pairAddress = mkAddress(chain === "solana" ? "So" : "0x");

  const drift: Record<Archetype, number> = {
    runner: rnd(0.004, 0.014),
    pumper: rnd(0.002, 0.02),
    "slow-burner": rnd(-0.001, 0.004),
    ruggable: rnd(0.003, 0.012),
    dead: rnd(-0.004, -0.0005),
  };
  const vol: Record<Archetype, number> = {
    runner: rnd(0.02, 0.05),
    pumper: rnd(0.05, 0.11),
    "slow-burner": rnd(0.012, 0.03),
    ruggable: rnd(0.03, 0.08),
    dead: rnd(0.008, 0.02),
  };

  return {
    archetype,
    drift: drift[archetype],
    vol: vol[archetype],
    fuse: Math.round(rnd(25, 160)),
    rugged: false,
    birthTick: tick,
    token: {
      id: `${chain}:${pairAddress}`,
      chain,
      pairAddress,
      tokenAddress: mkAddress(chain === "solana" ? "Mi" : "0x"),
      symbol: `${symbol}${suffix}`.slice(0, 12),
      name,
      priceUsd: price,
      priceNative: price / 180,
      liquidityUsd: liq,
      fdvUsd: liq * rnd(4, 45),
      volume24hUsd: liq * rnd(0.4, 9),
      volume5mUsd: liq * rnd(0.005, 0.2),
      buys5m: Math.round(rnd(5, 300)),
      sells5m: Math.round(rnd(3, 260)),
      change5m: rnd(-8, 12),
      change1h: rnd(-25, 60),
      change24h: rnd(-60, 400),
      ageMinutes,
      dex: chain === "solana" ? pick(["raydium", "pumpswap", "meteora", "orca"]) : "rhswap",
      history: [{ t: Date.now(), p: price }],
      simulated: true,
    },
  };
}

export class MarketSimulator {
  private readonly pool = new Map<string, SimToken>();
  private tick = 0;

  constructor(private readonly chain: ChainId, private readonly size = 22) {}

  /** Advance the world one step and return the current universe. */
  step(): Token[] {
    this.tick += 1;
    while (this.pool.size < this.size) {
      const s = spawn(this.chain, this.tick);
      this.pool.set(s.token.id, s);
    }

    for (const sim of [...this.pool.values()]) {
      this.advance(sim);
      // Retire tokens that rugged a while ago so fresh launches keep appearing.
      if (sim.rugged && this.tick - sim.birthTick > 40) this.pool.delete(sim.token.id);
    }
    return [...this.pool.values()].map((s) => s.token);
  }

  private advance(sim: SimToken): void {
    const t = sim.token;
    sim.fuse -= 1;

    if (sim.fuse <= 0) {
      sim.fuse = Math.round(rnd(20, 140));
      if (sim.archetype === "ruggable" && !sim.rugged && Math.random() < 0.45) {
        // Liquidity pull: price collapses, the pool empties, sells spike.
        sim.rugged = true;
        t.priceUsd *= rnd(0.01, 0.09);
        t.liquidityUsd *= rnd(0.01, 0.05);
        t.sells5m = Math.round(rnd(200, 900));
        t.buys5m = Math.round(rnd(0, 6));
      } else if (sim.archetype === "pumper" && Math.random() < 0.5) {
        // A fresh bid comes in.
        sim.drift = rnd(0.01, 0.035);
        sim.vol = rnd(0.06, 0.13);
        t.liquidityUsd *= rnd(1.05, 1.8);
      } else {
        sim.drift = rnd(-0.006, 0.01);
        sim.vol = rnd(0.015, 0.07);
      }
    }

    const shock = (Math.random() + Math.random() + Math.random() - 1.5) * sim.vol;
    const ret = sim.rugged ? Math.min(0, shock) - 0.01 : sim.drift + shock;
    const prev = t.priceUsd;
    t.priceUsd = Math.max(1e-9, prev * Math.exp(ret));

    const pct = ((t.priceUsd - prev) / prev) * 100;
    t.priceNative = t.priceUsd / 180;
    t.change5m = t.change5m * 0.55 + pct * 2.4;
    t.change1h = t.change1h * 0.88 + pct * 1.6;
    t.change24h = t.change24h * 0.985 + pct;
    t.ageMinutes += 1;

    const heat = Math.min(4, Math.abs(pct) / 3 + 0.4);
    t.volume5mUsd = Math.max(50, t.liquidityUsd * 0.02 * heat * rnd(0.5, 1.6));
    t.volume24hUsd = t.volume24hUsd * 0.97 + t.volume5mUsd * 4;
    const flow = pct >= 0 ? rnd(1.05, 2.4) : rnd(0.35, 0.95);
    t.buys5m = Math.round(Math.max(0, 40 * heat * flow * rnd(0.6, 1.4)));
    t.sells5m = Math.round(Math.max(0, (40 * heat * rnd(0.6, 1.4)) / flow));
    if (!sim.rugged) t.liquidityUsd = Math.max(500, t.liquidityUsd * (1 + ret * 0.35));
    t.fdvUsd = t.liquidityUsd * rnd(6, 30);

    t.history = [...t.history, { t: Date.now(), p: t.priceUsd }].slice(-120);
  }
}
