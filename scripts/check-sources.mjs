/**
 * Checks every upstream the terminal can use and reports what actually answers
 * from *your* network, since availability differs by machine and region.
 *
 *   node scripts/check-sources.mjs
 */
const TIMEOUT = 9000;

async function probe(label, url, extract) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const ms = Date.now() - started;
    if (!res.ok) return console.log(`  ✗ ${label.padEnd(26)} HTTP ${res.status} (${ms}ms)`);
    const json = await res.json();
    console.log(`  ✓ ${label.padEnd(26)} ${extract(json)} (${ms}ms)`);
    return json;
  } catch (err) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    console.log(`  ✗ ${label.padEnd(26)} ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

console.log("\nDISCOVERY — what is new right now\n");

const pump = await probe(
  "pump.fun (new mints)",
  "https://frontend-api-v3.pump.fun/coins?offset=0&limit=20&sort=created_timestamp&order=DESC&includeNsfw=false",
  (j) => {
    const list = Array.isArray(j) ? j : (j.coins ?? j.data ?? []);
    if (!list.length) return "answered, but returned nothing";
    const newest = list[0];
    const ts = newest.created_timestamp ?? newest.createdAt ?? 0;
    const ageMin = ts ? Math.round((Date.now() - (ts < 1e12 ? ts * 1000 : ts)) / 60000) : "?";
    return `${list.length} coins · newest "${newest.symbol ?? newest.ticker}" ${ageMin}m old`;
  },
);

// If the field names moved, the terminal's parser needs to know.
if (pump) {
  const list = Array.isArray(pump) ? pump : (pump.coins ?? pump.data ?? []);
  if (list[0]) {
    const known = ["mint", "address", "ca", "coinMint"];
    if (!known.some((k) => typeof list[0][k] === "string")) {
      console.log(`    ! no known address field. Keys seen: ${Object.keys(list[0]).slice(0, 12).join(", ")}`);
      console.log("      Add the right one to normalizeCoin() in src/lib/market/pumpfun.ts");
    }
  }
}

await probe(
  "GeckoTerminal (new pools)",
  "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1",
  (j) => `${j.data?.length ?? 0} pools created in the last 48h`,
);

console.log("\nPRICING — what is it worth\n");

await probe(
  "DexScreener (Solana)",
  "https://api.dexscreener.com/latest/dex/search?q=SOL",
  (j) => `${(j.pairs ?? []).filter((p) => p.chainId === "solana").length} Solana pairs`,
);

const CANDIDATES = ["robinhood", "robinhoodchain", "robinhood-chain"];
const rh = await probe(
  "DexScreener (Robinhood)",
  "https://api.dexscreener.com/latest/dex/search?q=ETH",
  (j) => {
    const slugs = new Set((j.pairs ?? []).map((p) => p.chainId));
    const hit = CANDIDATES.find((c) => slugs.has(c));
    return hit ? `indexed as "${hit}"` : `not in this sample (saw: ${[...slugs].slice(0, 6).join(", ")})`;
  },
);
void rh;

console.log("\nOPTIONAL — only with a key in .env.local\n");
for (const [label, key] of [["Birdeye", "BIRDEYE_API_KEY"], ["Helius", "HELIUS_API_KEY"], ["Anthropic", "ANTHROPIC_API_KEY"]]) {
  console.log(`  ${process.env[key] ? "✓" : "·"} ${label.padEnd(26)} ${process.env[key] ? "key set" : "no key — feature off, not broken"}`);
}
console.log("");
