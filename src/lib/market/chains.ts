import type { ChainId } from "@/lib/types";

export interface ChainAdapter {
  id: ChainId;
  label: string;
  /** Short tag rendered in the UI. */
  tag: string;
  /** Native gas/quote asset — what a position on this chain is actually paid for in. */
  native: string;
  /** Per-trade cost model for this chain, in native units. */
  fee: { rate: number; flat: number };
  /** DexScreener's chain slug, when the chain is indexed there. */
  dexscreenerSlug: string | null;
  /** Search terms used to discover trending pairs on this chain. */
  discoveryQueries: string[];
  /** Explorer URL builder for a pair/tx. */
  explorer: (address: string) => string;
  /**
   * Chains that are not (yet) indexed by a public aggregator run in simulated
   * mode instead of showing invented numbers as if they were live.
   */
  liveDataAvailable: boolean;
  note: string;
}

export const CHAINS: Record<ChainId, ChainAdapter> = {
  solana: {
    id: "solana",
    label: "Solana",
    tag: "SOL",
    native: "SOL",
    // DEX fee plus a priority fee large enough to land in a contested block.
    fee: { rate: 0.0025, flat: 0.00045 },
    dexscreenerSlug: "solana",
    discoveryQueries: ["SOL", "pump", "bonk", "wif", "moon"],
    explorer: (a) => `https://solscan.io/account/${a}`,
    liveDataAvailable: true,
    note: "Live via DexScreener (Raydium, Pump.fun, Meteora, Orca).",
  },
  robinhood: {
    id: "robinhood",
    label: "Robinhood Chain",
    tag: "RHC",
    native: "ETH",
    // L2 gas is cheap in absolute terms but ETH is worth ~20x SOL per unit.
    fee: { rate: 0.003, flat: 0.000012 },
    // Robinhood Chain is a young Arbitrum-Orbit L2. If/when DexScreener indexes
    // it under this slug the adapter starts returning live pairs automatically;
    // until then the probe fails and the chain falls back to the simulator.
    dexscreenerSlug: "robinhoodchain",
    discoveryQueries: ["robinhood", "rhc"],
    explorer: (a) => `https://blockscout.robinhood.com/address/${a}`,
    liveDataAvailable: false,
    note: "Early L2 — public DEX indexing is thin. Probed live each cycle, simulated until pairs appear.",
  },
};

export const CHAIN_LIST: ChainAdapter[] = Object.values(CHAINS);
