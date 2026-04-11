#!/usr/bin/env node
//
// DeFiLlama Fusion vault collector.
// Fetches yield pool list from DeFiLlama, filters for project='fusion-by-ipor',
// and extracts vault addresses from each pool's URL field.
//
// Usage: node collect-llama-vaults.js
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'llama-vaults.json');
const LLAMA_POOLS_URL = 'https://yields.llama.fi/pools';
const LLAMA_URLS_URL = 'https://yields.llama.fi/poolsEnriched'; // fallback

// Chain name → our internal short form
const CHAIN_NAMES = {
  'Ethereum': 'ethereum',
  'Arbitrum': 'arbitrum',
  'Base': 'base',
  'Unichain': 'unichain',
  'Plasma': 'plasma',
};

function extractAddress(url) {
  if (!url) return null;
  // URLs are typically https://app.ipor.io/fusion/<chain>/0x...
  const match = url.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

async function main() {
  console.log('=== DeFiLlama Fusion Vault Collector ===\n');

  let pools;
  try {
    console.log('Fetching pool list from DeFiLlama...');
    const res = await fetch(LLAMA_POOLS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    pools = json.data || json;
    console.log(`Fetched ${pools.length} total pools`);
  } catch (e) {
    console.error(`Failed to fetch pool list: ${e.message}`);
    process.exit(0); // don't break pipeline
  }

  // Filter for Fusion vaults
  const fusionPools = pools.filter(p => {
    const proj = (p.project || '').toLowerCase();
    return proj === 'fusion-by-ipor' || proj.includes('fusion') && proj.includes('ipor');
  });
  console.log(`Found ${fusionPools.length} Fusion pools\n`);

  if (fusionPools.length === 0) {
    console.log('No Fusion pools found. DeFiLlama project name may have changed.');
    process.exit(0);
  }

  // Each pool has a URL we need. For some APIs the URL is in enriched endpoint.
  // Try to fetch enriched data if URLs missing.
  let needUrls = fusionPools.some(p => !p.url && !p.poolMeta);
  let enriched = null;
  if (needUrls) {
    try {
      console.log('Fetching enriched pool data for URLs...');
      const res = await fetch(LLAMA_URLS_URL);
      if (res.ok) {
        const json = await res.json();
        enriched = json.data || json;
        const urlMap = new Map(enriched.map(p => [p.pool, p.url]));
        fusionPools.forEach(p => {
          if (!p.url) p.url = urlMap.get(p.pool);
        });
      }
    } catch (e) {
      console.log(`  (enriched fetch failed: ${e.message})`);
    }
  }

  // Extract data
  const vaults = [];
  const seen = new Set();
  for (const p of fusionPools) {
    const addr = extractAddress(p.url) || extractAddress(p.poolMeta);
    if (!addr) {
      console.log(`  skip: ${p.symbol || p.pool} — no address found in URL=${p.url}`);
      continue;
    }
    if (seen.has(addr)) continue;
    seen.add(addr);

    vaults.push({
      address: addr,
      symbol: p.symbol,
      chain: (p.chain || '').toLowerCase(),
      tvlUsd: p.tvlUsd || 0,
      apy: p.apy || null,
      apyBase: p.apyBase || null,
      apyReward: p.apyReward || null,
      pool: p.pool,
      poolMeta: p.poolMeta || null,
      url: p.url || null,
    });
  }

  // Sort by TVL descending
  vaults.sort((a, b) => b.tvlUsd - a.tvlUsd);

  const output = {
    updatedAt: new Date().toISOString(),
    source: 'defillama',
    sourceUrl: 'https://defillama.com/protocol/yields/fusion-by-IPOR',
    total: vaults.length,
    vaults,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${vaults.length} vaults to ${OUTPUT_FILE}`);
  console.log(`Total TVL: $${(vaults.reduce((s, v) => s + v.tvlUsd, 0) / 1e6).toFixed(2)}M`);

  // Chain breakdown
  const byChain = {};
  vaults.forEach(v => { byChain[v.chain] = (byChain[v.chain] || 0) + 1; });
  console.log('\nBy chain:');
  Object.entries(byChain).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(0);
});
