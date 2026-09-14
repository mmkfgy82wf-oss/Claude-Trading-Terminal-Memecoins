import type { ChainId } from "@/lib/types";

export interface ChainAdapter {
  id: ChainId;
  label: string;
  /** Short tag rendered in the UI. */
  tag: string;
  /** EVM chain id, or null for non-EVM chains. */
  chainId: number | null;
  /** Public RPC endpoint — rate limited, fine for reads, not for production. */
  rpcUrl: string;
  /** Native gas/quote asset — what a position on this chain is actually paid for in. */
  native: string;
  /** Per-trade cost model for this chain, in native units. */
  fee: { rate: number; flat: number };
  /**
   * Candidate slugs this chain might be indexed under on DexScreener.
   *
   * Aggregators do not agree on naming, and a chain that lists later can appear
   * under a slug nobody documented. Rather than hard-code one guess, the client
   * probes these in order and locks onto whichever actually returns pairs.
   */
  dexscreenerSlugs: string[];
  /**
   * GeckoTerminal's network id, for the key-free new-pools feed. Null when the
   * chain is not listed there.
   */
  geckoterminalNetwork: string | null;
  /** Search terms used to discover trending pairs on this chain. */
  discoveryQueries: string[];
  /** Explorer URL builder for an address. */
  explorer: (address: string) => string;
  note: string;
}

export const CHAINS: Record<ChainId, ChainAdapter> = {
  solana: {
    id: "solana",
    label: "Solana",
    tag: "SOL",
    chainId: null,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    native: "SOL",
    // DEX fee plus a priority fee large enough to land in a contested block.
    fee: { rate: 0.0025, flat: 0.00045 },
    dexscreenerSlugs: ["solana"],
    geckoterminalNetwork: "solana",
    discoveryQueries: ["SOL", "pump", "bonk", "wif", "moon"],
    explorer: (a) => `https://solscan.io/account/${a}`,
    note: "Raydium, Pump.fun, Meteora, Orca.",
  },
  robinhood: {
    id: "robinhood",
    label: "Robinhood Chain",
    tag: "RHC",
    // Arbitrum Orbit L2, mainnet since July 2026. Gas is ETH, like its parent.
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    native: "ETH",
    // L2 gas is cheap in absolute terms, but ETH is worth far more per unit.
    fee: { rate: 0.003, flat: 0.000012 },
    // "robinhood" is what the aggregators appear to use; the longer forms are
    // kept as fallbacks so a rename does not silently drop the chain to simulated.
    dexscreenerSlugs: ["robinhood", "robinhoodchain", "robinhood-chain"],
    geckoterminalNetwork: "robinhood",
    discoveryQueries: ["ETH", "USDC", "robinhood", "moon", "meme"],
    explorer: (a) => `https://robinhoodchain.blockscout.com/address/${a}`,
    // Pons is the dominant launchpad here — by late August 2026 it was taking
    // more launchpad fees than pump.fun. It publishes no open REST API (the
    // documented route is Bitquery's GraphQL, which needs a token), so fresh
    // launches are picked up from the pool that appears when one becomes
    // tradable.
    note: "Pons launchpad, Uniswap and Pleiades AMMs.",
  },
};

export const CHAIN_LIST: ChainAdapter[] = Object.values(CHAINS);
