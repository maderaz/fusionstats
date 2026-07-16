#!/usr/bin/env node
//
// collect-zyfai.js — pull ZyfAI's EOAs + smart wallets per chain and write
// zyfai-wallets.json. The /dust page reads this to attribute deposits to
// ZyfAI (a deposit is ZyfAI when its `sender` or `owner` is in `addresses`).
//
// Source: ZyfAI's public wallets-and-eoas endpoint, one call per chainId
//   https://api.zyf.ai/api/v1/data/wallets-and-eoas?chain=<id>
//
// Shape-agnostic: we extract every 0x-address from each chain's response
// (the endpoint returns only ZyfAI's own wallets/EOAs), so we don't depend
// on the exact JSON structure — and we log the raw shape once for review.
// Runs in CI (open network); the sandbox can't reach api.zyf.ai.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'zyfai-wallets.json');
const CHAINS = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum' };
const url = (id) => `https://api.zyf.ai/api/v1/data/wallets-and-eoas?chain=${id}`;
const TIMEOUT_MS = 25000;

// Confirmed ZyfAI adapter/router addresses — always retained even if a fetch fails.
const SEED = [
  '0xaffd3c3cd06cf499deddf78b26868018a93f2c31',
  '0x677251190c0cccc6e7e71c385b3ea660dfd89c00',
  '0xea49d02c248b357b99670d9e9741f54f72df9cb3',
  '0x9af838b8bb05269dac4f30a127f171d3cf76dac3',
  '0x399502b8dc8a38e2cd2d670f4f40cc168c063585',
  '0xecd2bf892e2ee99cf2cbbc81f6877132e25e34db',
];

function extractAddrs(text) {
  const set = {}; const re = /0x[0-9a-fA-F]{40}/g; let m;
  while ((m = re.exec(text))) set[m[0].toLowerCase()] = 1;
  return Object.keys(set);
}

async function fetchChain(id) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url(id), { headers: { accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return { ok: true, text, addrs: extractAddrs(text) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

(async function main() {
  const perChain = {}; const all = {}; let shapeLogged = false;
  SEED.forEach((a) => { all[a] = 1; });

  for (const id of Object.keys(CHAINS)) {
    const r = await fetchChain(id);
    if (r.ok) {
      perChain[id] = r.addrs;
      r.addrs.forEach((a) => { all[a] = 1; });
      console.log(`chain ${id} (${CHAINS[id]}): ${r.addrs.length} addresses`);
      if (!shapeLogged) { console.log('  raw shape (first 700 chars):', r.text.slice(0, 700)); shapeLogged = true; }
    } else {
      perChain[id] = [];
      console.log(`chain ${id} (${CHAINS[id]}): FETCH FAILED — ${r.err}`);
    }
  }

  const addresses = Object.keys(all).sort();
  const counts = { total: addresses.length };
  Object.keys(CHAINS).forEach((id) => { counts[CHAINS[id]] = (perChain[id] || []).length; });

  const out = {
    updatedAt: new Date().toISOString(),
    source: 'https://api.zyf.ai/api/v1/data/wallets-and-eoas',
    note: 'ZyfAI EOAs + smart wallets per chain. A deposit is attributed to ZyfAI when its sender or owner is in `addresses`.',
    counts,
    perChain,
    seed: SEED,
    addresses,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${addresses.length} total addresses to ${OUT}`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
