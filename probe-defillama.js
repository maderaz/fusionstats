#!/usr/bin/env node
//
// One-off probe: does DeFiLlama's yields API cover our IPOR Fusion vaults?
// Run via the "Probe DeFiLlama coverage" workflow (workflow_dispatch).
// Output goes to the workflow log — no files written.
//
// What we want to learn:
//   1. Does DefiLlama track Fusion vaults at all? Under what `project` slug?
//   2. Of our 351 vaults in ipor-vaults.json, how many can we match?
//   3. What does the per-pool history endpoint return (depth, schema)?
//
// API used (no auth, no headers needed):
//   GET https://yields.llama.fi/pools         — all yield pools
//   GET https://yields.llama.fi/chart/{uuid}  — per-pool TVL+APY time series
//
// Both are free, 300 req/min rate limit.

const fs = require('fs');
const path = require('path');

const POOLS_URL = 'https://yields.llama.fi/pools';
const CHART_URL = (uuid) => `https://yields.llama.fi/chart/${uuid}`;

async function fetchJson(url, timeoutMs = 30_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function fmtUsd(v) {
  if (!v) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

async function main() {
  console.log('=== DeFiLlama coverage probe for IPOR Fusion vaults ===\n');

  const ipor = JSON.parse(fs.readFileSync(path.join(__dirname, 'ipor-vaults.json')));
  console.log(`Local: ${ipor.vaults.length} vaults from ipor-vaults.json (snapshot ${ipor.updatedAt})`);
  const ourByAddr = new Map(ipor.vaults.map(v => [v.address.toLowerCase(), v]));

  console.log(`\nFetching ${POOLS_URL} …`);
  const resp = await fetchJson(POOLS_URL);
  const allPools = resp.data || resp.pools || resp;
  console.log(`  → ${allPools.length} total pools on DefiLlama yields\n`);

  // Look for anything Fusion / IPOR related — the project slug we suspect is
  // "fusion-by-ipor" but let's not assume.
  const projectCounts = new Map();
  for (const p of allPools) {
    if (!p.project) continue;
    if (/fusion|ipor/i.test(p.project) || /fusion|ipor/i.test(p.symbol || '')) {
      projectCounts.set(p.project, (projectCounts.get(p.project) || 0) + 1);
    }
  }
  console.log('Fusion/IPOR-related projects on DefiLlama:');
  if (projectCounts.size === 0) {
    console.log('  (none matched — Fusion may use a different slug)');
  } else {
    for (const [proj, count] of [...projectCounts.entries()].sort((a,b) => b[1] - a[1])) {
      console.log(`  ${proj.padEnd(28)} ${count} pools`);
    }
  }

  // Take the top fusion-ish project and inspect
  const fusionPools = allPools.filter(p =>
    p.project && /fusion|ipor/i.test(p.project)
  );
  console.log(`\nTaking ${fusionPools.length} pools tagged with a Fusion/IPOR project for mapping…`);

  // Try matching each pool to one of our vaults. DefiLlama pool fields:
  //   - pool (uuid),  chain (e.g. "Ethereum"),  project, symbol,
  //   - underlyingTokens: [address], tvlUsd, apy, apyBase, apyReward,
  //   - poolMeta (sometimes contains vault address)
  let matched = 0;
  const sampleMatches = [];
  const unmatched = [];

  // Build a lookup: lower(addr) → vault
  const matchedAddrs = new Set();
  for (const p of fusionPools) {
    let ourVault = null;
    // 1. Try poolMeta as address
    if (p.poolMeta && /^0x[a-f0-9]{40}$/i.test(p.poolMeta)) {
      ourVault = ourByAddr.get(p.poolMeta.toLowerCase());
    }
    // 2. Try underlyingTokens[0] (sometimes the vault itself)
    if (!ourVault && Array.isArray(p.underlyingTokens)) {
      for (const t of p.underlyingTokens) {
        if (typeof t === 'string') {
          const hit = ourByAddr.get(t.toLowerCase());
          if (hit) { ourVault = hit; break; }
        }
      }
    }
    // 3. Try p.pool as if it were an address (unlikely — usually UUID)
    if (!ourVault && /^0x[a-f0-9]{40}$/i.test(p.pool || '')) {
      ourVault = ourByAddr.get(p.pool.toLowerCase());
    }

    if (ourVault) {
      matched++;
      matchedAddrs.add(ourVault.address.toLowerCase());
      if (sampleMatches.length < 5) {
        sampleMatches.push({ ours: ourVault, theirs: p });
      }
    } else {
      if (unmatched.length < 5) unmatched.push(p);
    }
  }

  console.log(`\nMatched ${matched} / ${fusionPools.length} DefiLlama pools to our vaults`);
  console.log(`Of our ${ipor.vaults.length} vaults, ${matchedAddrs.size} are covered by DefiLlama\n`);

  console.log('Sample matched (ours ↔ llama):');
  for (const m of sampleMatches) {
    console.log(`  ${m.ours.name.slice(0, 38).padEnd(38)} ${m.ours.chain.padEnd(10)} ${fmtUsd(m.ours.tvl).padStart(10)}`);
    console.log(`    ↔ llama: pool=${m.theirs.pool}  symbol=${m.theirs.symbol}  chain=${m.theirs.chain}  tvl=${fmtUsd(m.theirs.tvlUsd)}  apy=${(m.theirs.apy || 0).toFixed(2)}%`);
  }

  if (unmatched.length) {
    console.log('\nSample UNMATCHED llama pools (no address mapping worked):');
    for (const p of unmatched) {
      console.log(`  pool=${p.pool}  project=${p.project}  symbol=${p.symbol}  chain=${p.chain}  poolMeta=${p.poolMeta || '-'}`);
      console.log(`    underlyingTokens=${JSON.stringify((p.underlyingTokens || []).slice(0,3))}`);
    }
  }

  // Pull the chart for one matched pool to see history depth & schema
  if (sampleMatches.length) {
    const sample = sampleMatches[0];
    console.log(`\nFetching history for sample pool ${sample.theirs.pool} (${sample.ours.name})…`);
    try {
      const chart = await fetchJson(CHART_URL(sample.theirs.pool));
      const rows = chart.data || chart;
      console.log(`  → ${rows.length} rows`);
      if (rows.length) {
        console.log(`  first row: ${JSON.stringify(rows[0])}`);
        console.log(`  last  row: ${JSON.stringify(rows[rows.length - 1])}`);
        const earliest = new Date(rows[0].timestamp || rows[0].date || rows[0].ts || 0);
        const latest   = new Date(rows[rows.length - 1].timestamp || rows[rows.length - 1].date || rows[rows.length - 1].ts || 0);
        console.log(`  span: ${earliest.toISOString().slice(0,10)} → ${latest.toISOString().slice(0,10)}`);
      }
    } catch (e) {
      console.log(`  chart fetch failed: ${e.message}`);
    }
  }

  console.log('\n=== End of probe ===');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
