#!/usr/bin/env node
//
// IPOR Fusion vault list collector.
// Fetches from api.ipor.io/fusion/vaults (production vaults with TVL/APY),
// with fallback to the canonical addresses.json on GitHub (full list incl. test).
//
// Output schema (ipor-vaults.json):
//   {
//     updatedAt: ISO string,
//     sources: [URLs used],
//     total: number,
//     byChain: { [chain]: count },
//     vaults: [ { chainId, chain, name, token, address, assetAddress, tvl, apy, source,
//                 isPublic, firstSeen?, tvlSource?, tvlIpor? } ]
//   }
//
// Two things IPOR's list doesn't say, from what we read ourselves
// (reconcile, below):
//   firstSeen  when the vault first appeared in the list. A new deployment
//              is tracked by every collector for its first NEW_DAYS, whatever
//              its TVL, so its first deposits are caught (collect-activity.js).
//   tvl        IPOR's, unless IPOR shows the vault under FLOOR while our own
//              latest on-chain reading (tvl-snapshots.json, within
//              ONCHAIN_MAX_AGE_DAYS) is at least FLOOR: a vault IPOR shows
//              empty that isn't, which every collector gating on TVL would
//              otherwise drop. Then it is ours, with tvlSource 'onchain' and
//              IPOR's figure kept as tvlIpor.
//   recheck    our reading of such a vault is older than that (it was dropped,
//              so no one read it since): its TVL stays IPOR's, but it is read
//              again (collect-activity.js tracks it), and the next reading
//              settles it either way.
//
// Usage: node collect-ipor-vaults.js
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'ipor-vaults.json');
const SNAPSHOTS_FILE = path.join(__dirname, 'tvl-snapshots.json');
const FLOOR = 50;                  // the collectors' own TVL floor (collect-activity.js MIN_TVL_USD)
const ONCHAIN_MAX_AGE_DAYS = 30;   // an older reading of our own is not used
const NEW_STAMP_MAX = 20;          // more new vaults than this at once is a change of source, not deployments
const MAX_SANE_TVL = 2e9;          // as tools/build-tvl-latest.js
const API_URL = 'https://api.ipor.io/fusion/vaults';
const ADDRESSES_URL = 'https://raw.githubusercontent.com/IPOR-Labs/ipor-abi/main/mainnet/addresses.json';

// Chain ID → name
const CHAIN_NAMES = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  100: 'gnosis',
  137: 'polygon',
  130: 'unichain',
  146: 'sonic',
  239: 'tac',
  252: 'fraxtal',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanche',
  57073: 'ink',
  747474: 'katana',
  9745: 'plasma',
};

// GitHub addresses.json uses chain names as keys
const CHAIN_NAME_TO_ID = Object.fromEntries(
  Object.entries(CHAIN_NAMES).map(([id, name]) => [name, Number(id)])
);

async function fetchJson(url, timeoutMs = 20_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchFromApi() {
  console.log(`Trying IPOR API: ${API_URL}`);
  const data = await fetchJson(API_URL);
  const list = Array.isArray(data) ? data : (data.vaults || data.data || []);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('API returned empty or unexpected format');
  }
  console.log(`  OK — ${list.length} vaults from API`);
  return list.map(v => ({
    chainId: Number(v.chainId) || 0,
    chain: CHAIN_NAMES[Number(v.chainId)] || String(v.chainId),
    name: v.name || '',
    token: v.asset || v.token || '',
    address: (v.address || '').toLowerCase(),
    assetAddress: (v.assetAddress || '').toLowerCase() || null,
    tvl: typeof v.tvl === 'number' ? v.tvl : (parseFloat(v.tvl) || 0),
    apy: typeof v.apy === 'number' ? v.apy : (parseFloat(v.apy) || null),
    // IPOR's own alpha executes it: the Explorer names IPOR as its operator
    // when nothing else does (operators.js).
    ...(v.managedByIporAlpha === true ? { iporAlpha: true } : {}),
    source: 'api',
  })).filter(v => /^0x[a-f0-9]{40}$/.test(v.address));
}

async function fetchFromGithub() {
  console.log(`Trying GitHub: ${ADDRESSES_URL}`);
  const data = await fetchJson(ADDRESSES_URL);
  const out = [];
  for (const [chain, value] of Object.entries(data)) {
    // Structure: { ethereum: { vaults: [...], fuses: [...], ... }, arbitrum: { ... } }
    // The vaults array is nested under chainName.vaults
    const vaultsList = Array.isArray(value) ? value
      : (value && Array.isArray(value.vaults)) ? value.vaults
      : null;
    if (!vaultsList) continue;
    for (const entry of vaultsList) {
      if (!entry || typeof entry !== 'object') continue;
      const addr = (entry.PlasmaVault || entry.plasmaVault || entry.address || '').toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr)) continue;
      out.push({
        chainId: CHAIN_NAME_TO_ID[chain] || 0,
        chain,
        name: entry.name || '',
        token: entry.token || '',
        // The list's "token" is the vault's own share symbol ($TAUSIUSDETH,
        // TAUUSDCTZS…): it often names the vault's operator when its name doesn't.
        shareSymbol: entry.token || null,
        address: addr,
        assetAddress: null,
        tvl: 0,
        apy: null,
        source: 'github',
      });
    }
  }
  console.log(`  OK — ${out.length} vaults from GitHub`);
  return out;
}

// Each vault's latest on-chain TVL, as the TVL snapshots read it: { usd, at }.
function onchainLatest(snapshots) {
  const out = {};
  for (const [addr, v] of Object.entries((snapshots && snapshots.vaults) || {})) {
    const s = (v.snapshots || []).filter(x => typeof x.tvlUsd === 'number' && x.tvlUsd >= 0 && x.tvlUsd < MAX_SANE_TVL && x.timestamp);
    if (s.length) out[addr.toLowerCase()] = { usd: s[s.length - 1].tvlUsd, at: s[s.length - 1].timestamp };
  }
  return out;
}

// The list with what it doesn't say filled in (see the top of this file).
// prev is the list as the last run wrote it; fromApi, whether both it and
// this run had IPOR's API (a list from the fallback alone isn't one to
// compare against).
function reconcile(vaults, { prev = null, fromApi = true, onchain = {}, now = Date.now() } = {}) {
  const before = prev ? new Map((prev.vaults || []).map(v => [v.address, v])) : null;
  const fresh = before && fromApi ? vaults.filter(v => !before.has(v.address)) : [];
  const stamp = fresh.length <= NEW_STAMP_MAX;
  if (!stamp) console.log(`  ${fresh.length} vaults new to the list at once: a change of source, not stamped as new`);
  for (const v of vaults) {
    const p = before && before.get(v.address);
    if (p && p.firstSeen) v.firstSeen = p.firstSeen;
    else if (stamp && fresh.includes(v)) v.firstSeen = new Date(now).toISOString();
    const o = onchain[v.address];
    if (v.tvl < FLOOR && o && o.usd >= FLOOR) {
      if (now / 1000 - o.at <= ONCHAIN_MAX_AGE_DAYS * 86400) {
        v.tvlIpor = v.tvl;
        v.tvl = o.usd;
        v.tvlSource = 'onchain';
      } else v.recheck = true;
    }
  }
  return vaults;
}

async function main() {
  console.log('=== IPOR Fusion Vault List Collector ===\n');

  const sources = [];
  let vaults = [];

  // Try API first (richer data: TVL, APY, production-only)
  try {
    vaults = await fetchFromApi();
    sources.push(API_URL);
  } catch (e) {
    console.log(`  API failed: ${e.message}`);
  }

  // Always also pull from GitHub — this is the PUBLIC vault whitelist.
  // DeFiLlama uses the same file as their allowlist for fusion-by-ipor pools.
  let publicAddresses = new Set();
  try {
    const ghVaults = await fetchFromGithub();
    sources.push(ADDRESSES_URL);
    // Build public address set
    for (const gv of ghVaults) publicAddresses.add(gv.address);
    console.log(`  ${publicAddresses.size} public vault addresses from GitHub whitelist`);
    // Merge: API entries take precedence (richer), add any GitHub-only ones
    const byAddr = new Map(vaults.map(v => [v.address, v]));
    for (const gv of ghVaults) {
      if (!byAddr.has(gv.address)) byAddr.set(gv.address, gv);
      else if (gv.shareSymbol) byAddr.get(gv.address).shareSymbol = gv.shareSymbol;
    }
    vaults = [...byAddr.values()];
  } catch (e) {
    console.log(`  GitHub failed: ${e.message}`);
  }

  if (vaults.length === 0) {
    console.error('Both sources failed. Keeping existing ipor-vaults.json if present.');
    process.exit(0);
  }

  // Stamp isPublic based on GitHub whitelist presence
  for (const v of vaults) {
    v.isPublic = publicAddresses.has(v.address);
  }

  // What the list doesn't say: when each vault first appeared, and the TVL
  // of a vault IPOR shows empty that our own on-chain readings say isn't.
  let prev = null, snapshots = null;
  try { prev = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  try { snapshots = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8')); } catch {}
  reconcile(vaults, { prev, onchain: onchainLatest(snapshots),
    fromApi: sources.includes(API_URL) && !!(prev && (prev.sources || []).includes(API_URL)) });
  const fixed = vaults.filter(v => v.tvlSource === 'onchain'), stale = vaults.filter(v => v.recheck);
  const fresh = vaults.filter(v => v.firstSeen && Date.now() - Date.parse(v.firstSeen) < 864e5);
  if (fixed.length) console.log(`  ${fixed.length} vaults IPOR shows under $${FLOOR} hold more on-chain: ${fixed.map(v => v.name + ' $' + Math.round(v.tvl)).join(', ')}`);
  if (stale.length) console.log(`  ${stale.length} more to read again (our last reading of them is old): ${stale.map(v => v.name).join(', ')}`);
  if (fresh.length) console.log(`  New today: ${fresh.map(v => v.name + ' [' + v.chain + ']').join(', ')}`);

  // Deduplicate by (chainId, address)
  const seen = new Set();
  const deduped = [];
  for (const v of vaults) {
    const key = `${v.chainId}:${v.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }

  // Sort: chain asc, tvl desc, name asc
  deduped.sort((a, b) =>
    a.chain.localeCompare(b.chain) ||
    b.tvl - a.tvl ||
    a.name.localeCompare(b.name)
  );

  const byChain = {};
  for (const v of deduped) byChain[v.chain] = (byChain[v.chain] || 0) + 1;

  const output = {
    updatedAt: new Date().toISOString(),
    sources,
    total: deduped.length,
    byChain,
    vaults: deduped,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');

  console.log(`\nWrote ${deduped.length} vaults to ${OUTPUT_FILE}`);
  console.log('\nBy chain:');
  Object.entries(byChain).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    const totalTvl = deduped.filter(v => v.chain === c).reduce((s, v) => s + v.tvl, 0);
    console.log(`  ${c}: ${n} vaults, $${(totalTvl / 1e6).toFixed(2)}M TVL`);
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(0);
  });
}
module.exports = { reconcile, onchainLatest, FLOOR };
