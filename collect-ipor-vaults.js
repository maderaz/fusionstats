#!/usr/bin/env node
//
// IPOR Fusion vault list collector.
// Fetches the canonical addresses.json from IPOR-Labs/ipor-abi GitHub repo,
// which is the same source DeFiLlama's yield adapter uses.
//
// Output schema (ipor-vaults.json):
//   {
//     updatedAt: ISO string,
//     source: URL,
//     total: number,
//     byChain: { [chain]: count },
//     vaults: [ { chain, name, token, address } ]
//   }
//
// Usage: node collect-ipor-vaults.js
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'ipor-vaults.json');
const ADDRESSES_URL = 'https://raw.githubusercontent.com/IPOR-Labs/ipor-abi/main/mainnet/addresses.json';

async function main() {
  console.log('=== IPOR Fusion Vault List Collector ===\n');
  console.log(`Source: ${ADDRESSES_URL}`);

  let json;
  try {
    const res = await fetch(ADDRESSES_URL, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error(`Failed to fetch: ${e.message}`);
    process.exit(0); // don't break pipeline
  }

  // Extract vaults per chain. The structure is:
  // { ethereum: [{name, token, PlasmaVault, ...}, ...], arbitrum: [...], ... }
  // Some chains use top-level arrays, some may nest under subkeys (fuses, pools, etc.)
  const vaults = [];
  const byChain = {};

  for (const [chain, value] of Object.entries(json)) {
    if (!Array.isArray(value)) continue; // skip nested structures
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const addr = entry.PlasmaVault || entry.plasmaVault || entry.address;
      if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
      vaults.push({
        chain,
        name: entry.name || '',
        token: entry.token || entry.asset || entry.symbol || '',
        address: addr.toLowerCase(),
      });
      byChain[chain] = (byChain[chain] || 0) + 1;
    }
  }

  // Deduplicate by (chain, address) — same vault may appear multiple times with diff names
  const seen = new Set();
  const deduped = [];
  for (const v of vaults) {
    const key = `${v.chain}:${v.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }

  // Sort: chain alpha, then name
  deduped.sort((a, b) => a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name));

  const output = {
    updatedAt: new Date().toISOString(),
    source: ADDRESSES_URL,
    total: deduped.length,
    byChain,
    vaults: deduped,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');

  console.log(`\nWrote ${deduped.length} vaults to ${OUTPUT_FILE}`);
  console.log('\nBy chain:');
  Object.entries(byChain).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(0);
});
