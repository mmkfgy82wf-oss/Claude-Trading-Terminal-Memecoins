/**
 * Reports which chains actually have live DexScreener coverage right now, and
 * under which slug.
 *
 * The terminal detects this by itself at runtime; this script exists so you can
 * answer "is Robinhood Chain live or simulated for me?" without reading logs.
 *
 *   node scripts/check-chains.mjs
 */
const CANDIDATES = {
  Solana: ["solana"],
  "Robinhood Chain": ["robinhood", "robinhoodchain", "robinhood-chain"],
};
const QUERIES = ["ETH", "USDC", "SOL", "moon", "meme", "robinhood"];

async function search(q) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.pairs ?? [];
  } catch (err) {
    console.error(`  ! request failed for "${q}": ${err.message}`);
    return [];
  }
}

const all = (await Promise.all(QUERIES.map(search))).flat();
if (all.length === 0) {
  console.log("No response from DexScreener at all — check your network, not the chain.");
  process.exit(1);
}

// What the API actually calls each chain, ranked by how often it showed up.
const seen = new Map();
for (const p of all) seen.set(p.chainId, (seen.get(p.chainId) ?? 0) + 1);

console.log(`DexScreener answered with ${all.length} pairs across ${seen.size} chains.\n`);

for (const [label, candidates] of Object.entries(CANDIDATES)) {
  const hit = candidates.find((slug) => seen.has(slug));
  if (hit) {
    const pairs = all.filter((p) => p.chainId === hit);
    const deepest = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    console.log(`${label}: LIVE  slug="${hit}"  (${pairs.length} pairs in this sample)`);
    if (deepest) {
      console.log(
        `   deepest here: ${deepest.baseToken?.symbol} $${Math.round(deepest.liquidity?.usd ?? 0).toLocaleString("en-US")} liquidity on ${deepest.dexId}`,
      );
    }
  } else {
    console.log(`${label}: not found under ${candidates.map((c) => `"${c}"`).join(", ")} — the terminal will simulate it.`);
    const guess = [...seen.keys()].filter((k) => k.includes("robin") || k.includes("hood"));
    if (guess.length) console.log(`   but the API did return: ${guess.join(", ")} — add that slug to chains.ts`);
  }
}
