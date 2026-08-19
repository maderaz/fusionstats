#!/usr/bin/env node
//
// collect-tesseract-discover.js — discover every Tesseract-operated Fusion vault.
//
// Discovery is by OPERATOR, never by name. Names vary between "TESS ..." and
// "Tesseract ...", and two distinct vaults share the name
// "TESS cbETH (Base) Loop Vault" — so everything is keyed on chainId+address.
//
// Method:
//   1. Scan FusionInstanceCreated from the FusionFactory on every chain. The
//      event carries `initialOwner` inline, so the owner filter costs nothing.
//   2. Seed the Tesseract operator set: name-match TESS/Tesseract *only* to
//      pick seed vaults, then read their real owner (from the factory event)
//      and their ATOMIST_ROLE holders (RoleGranted logs on the AccessManager).
//      Name matching never decides membership — it only finds the operators.
//   3. Keep every vault whose initialOwner is in the operator set, plus any
//      vault whose AccessManager grants OWNER/ATOMIST to an operator.
//
// Output: tesseract-vaults.json  (input to collect-tesseract-series.js)
//
// Runs in CI — the dev sandbox has no RPC egress.

const fs = require('fs');
const path = require('path');
const { selector, topic } = require('./lib/keccak');

const OUT = path.join(__dirname, 'tesseract-vaults.json');

const FUSION_INSTANCE_CREATED = topic(
  'FusionInstanceCreated(uint256,uint256,string,string,uint8,address,string,uint8,address,address,address,address)'
);
const ROLE_GRANTED = topic('RoleGranted(uint64,address,uint32,uint48,bool)');
const SEL_ACCESS_MANAGER = selector('getAccessManagerAddress()');
const SEL_HAS_ROLE = selector('hasRole(uint64,address)');

const OWNER_ROLE = 1n;
const ATOMIST_ROLE = 100n;

// Chains with a Fusion factory deployment and a usable public RPC.
const CHAINS = [
  { id: 1,      name: 'ethereum',  slug: 'ethereum',  fromBlock: 21000000, rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com'] },
  { id: 8453,   name: 'base',      slug: 'base',      fromBlock: 22000000, rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'] },
  { id: 42161,  name: 'arbitrum',  slug: 'arbitrum',  fromBlock: 250000000, rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc'] },
  { id: 43114,  name: 'avalanche', slug: 'avalanche', fromBlock: 50000000, rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'] },
  { id: 130,    name: 'unichain',  slug: 'unichain',  fromBlock: 1, rpcs: ['https://mainnet.unichain.org'] },
  { id: 9745,   name: 'plasma',    slug: 'plasma',    fromBlock: 1, rpcs: ['https://evm-rpc.plasma.io/api'] },
  { id: 10,     name: 'optimism',  slug: 'optimism',  fromBlock: 120000000, rpcs: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'] },
  { id: 146,    name: 'sonic',     slug: 'sonic',     fromBlock: 1, rpcs: ['https://sonic-rpc.publicnode.com'] },
  { id: 57073,  name: 'ink',       slug: 'ink',       fromBlock: 1, rpcs: ['https://rpc-gel.inkonchain.com'] },
  { id: 747474, name: 'katana',    slug: 'katana',    fromBlock: 1, rpcs: ['https://rpc.katana.network'] },
  { id: 239,    name: 'tac',       slug: 'tac',       fromBlock: 1, rpcs: ['https://rpc.tac.build'] },
];

// Known factories (fallback when ipor-abi lookup fails).
const FACTORY_FALLBACK = {
  ethereum: '0xcd05909C4A1F8E501e4ED554cEF4Ed5E48D9b852',
  base: '0x1455717668fA96534f675856347A973fA907e922',
};

const ABI_URL = (slug) => `https://raw.githubusercontent.com/IPOR-Labs/ipor-abi/main/mainnet/mainnet-${slug}-fusion/addresses.json`;
const VAULTS_API = 'https://api.ipor.io/fusion/vaults';

// ---------- RPC ----------
let callId = 0;
const rpcState = {};

async function rpcCall(chain, method, params, { timeoutMs = 20000, tries = 3 } = {}) {
  const st = (rpcState[chain.name] = rpcState[chain.name] || { active: 0 });
  const order = [st.active, ...chain.rpcs.map((_, i) => i).filter((i) => i !== st.active)];
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    for (const idx of order) {
      try {
        const res = await fetch(chain.rpcs[idx], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error.message || 'rpc error');
        st.active = idx;
        return json.result;
      } catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`all RPCs failed for ${method}: ${lastErr && lastErr.message}`);
}

const ethCall = (chain, to, data, block = 'latest') =>
  rpcCall(chain, 'eth_call', [{ to, data }, block]);

// Adaptive log scan. Public RPCs cap eth_getLogs differently (and mostly by
// result size, not range), so we start wide and shrink the *learned* chunk for
// the chain on rejection rather than bisecting every call. A single factory
// address with few events answers fine over millions of blocks.
const chunkPref = {};
async function scanLogs(chain, address, topics, fromBlock, toBlock, deadline) {
  const name = typeof chain === 'string' ? chain : chain.name;
  const out = [];
  let chunk = chunkPref[name] || 5000000;
  let from = fromBlock;
  while (from <= toBlock) {
    if (Date.now() > deadline) throw new Error('deadline');
    const to = Math.min(from + chunk - 1, toBlock);
    try {
      const logs = await rpcCall(chain, 'eth_getLogs', [{
        ...(address ? { address } : {}),
        topics,
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      out.push(...logs);
      from = to + 1;
      chunkPref[name] = chunk;
    } catch (e) {
      if (String(e.message) === 'deadline') throw e;
      if (chunk <= 5000) { from = to + 1; continue; } // unscannable sliver: skip, don't stall
      chunk = Math.max(5000, Math.floor(chunk / 4));
      chunkPref[name] = chunk;
    }
  }
  return out;
}

// ---------- ABI decode ----------
const uint = (hex, slot) => BigInt('0x' + hex.slice(slot * 64, slot * 64 + 64));
const addr = (hex, slot) => '0x' + hex.slice(slot * 64 + 24, slot * 64 + 64).toLowerCase();
function str(hex, byteOffset) {
  const p = byteOffset * 2;
  const len = Number(BigInt('0x' + hex.slice(p, p + 64)));
  return Buffer.from(hex.slice(p + 64, p + 64 + len * 2), 'hex').toString('utf8');
}

function parseInstance(log) {
  const d = log.data.slice(2);
  return {
    index: Number(uint(d, 0)),
    version: Number(uint(d, 1)),
    assetDecimals: Number(uint(d, 4)),
    underlyingToken: addr(d, 5),
    decimals: Number(uint(d, 7)),
    owner: addr(d, 8),
    address: addr(d, 9),
    feeManager: addr(d, 11),
    name: str(d, Number(uint(d, 2))),
    assetSymbol: str(d, Number(uint(d, 3))),
    symbol: str(d, Number(uint(d, 6))),
    block: parseInt(log.blockNumber, 16),
    tx: log.transactionHash,
  };
}

const pad32 = (v) => v.toString(16).padStart(64, '0');
const encHasRole = (roleId, account) =>
  SEL_HAS_ROLE + pad32(roleId) + account.replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function getJson(url, timeoutMs = 25000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function factoryFor(chain) {
  try {
    const j = await getJson(ABI_URL(chain.slug));
    const a = j.IporFusionFactoryProxy || j.IporFusionFactory || j.FusionFactory;
    if (a) return a;
  } catch {}
  return FACTORY_FALLBACK[chain.name] || null;
}

// ---------- main ----------
(async function main() {
  const CHAIN_BUDGET_MS = Number(process.env.CHAIN_BUDGET_MS || 240000);
  console.log('=== Tesseract vault discovery ===');
  console.log('FusionInstanceCreated topic:', FUSION_INSTANCE_CREATED);
  console.log('RoleGranted topic:', ROLE_GRANTED, '\n');

  // Seed names -> used ONLY to locate operator addresses, never to decide membership.
  let seedNames = new Set();
  try {
    const list = await getJson(VAULTS_API);
    (Array.isArray(list) ? list : list.vaults || []).forEach((v) => {
      if (/tess/i.test(v.name || '')) seedNames.add((v.address || '').toLowerCase());
    });
    console.log(`Seed (name-matched) vaults from API: ${seedNames.size}`);
  } catch (e) {
    console.log('WARN: vault API unavailable —', e.message);
  }

  const allByChain = {};
  for (const chain of CHAINS) {
    const factory = await factoryFor(chain);
    if (!factory) { console.log(`\n[${chain.name}] no factory address — skipped`); continue; }
    const deadline = Date.now() + CHAIN_BUDGET_MS;
    let head;
    try { head = parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16); }
    catch (e) { console.log(`\n[${chain.name}] RPC unreachable: ${e.message}`); continue; }

    console.log(`\n[${chain.name}] factory=${factory} head=${head}`);
    let logs = [];
    try {
      logs = await scanLogs(chain, factory, [FUSION_INSTANCE_CREATED], chain.fromBlock, head, deadline);
    } catch (e) {
      console.log(`  scan stopped early (${e.message}) — partial results kept`);
    }
    const vaults = [];
    for (const l of logs) {
      try { vaults.push(parseInstance(l)); }
      catch (e) { console.log('  undecodable log:', e.message); }
    }
    allByChain[chain.name] = { chain, vaults };
    console.log(`  ${vaults.length} Fusion vaults deployed`);
  }

  // ---- Build the Tesseract operator set from the seeds ----
  const operators = new Set();
  for (const { chain, vaults } of Object.values(allByChain)) {
    for (const v of vaults) {
      if (!seedNames.has(v.address)) continue;
      operators.add(v.owner);                       // owner straight from the event
      try {                                          // atomists granted on the AccessManager
        const am = await ethCall(chain, v.address, SEL_ACCESS_MANAGER);
        if (am && am !== '0x') {
          const mgr = '0x' + am.slice(-40);
          const head = parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16);
          const grants = await scanLogs(
            chain, mgr,
            [ROLE_GRANTED, ['0x' + pad32(OWNER_ROLE), '0x' + pad32(ATOMIST_ROLE)]],
            v.block, head, Date.now() + 60000
          );
          grants.forEach((g) => { if (g.topics[2]) operators.add('0x' + g.topics[2].slice(-40).toLowerCase()); });
        }
      } catch (e) { console.log(`  atomist scan failed for ${v.address}: ${e.message}`); }
    }
  }
  console.log(`\nTesseract operator addresses discovered: ${operators.size}`);
  [...operators].forEach((o) => console.log('  ', o));

  // ---- Select vaults by operator ----
  const selected = [];
  for (const { chain, vaults } of Object.values(allByChain)) {
    for (const v of vaults) {
      let match = operators.has(v.owner) ? 'owner' : null;
      if (!match && seedNames.has(v.address)) match = 'seed';
      if (!match && operators.size) {
        try {
          const am = await ethCall(chain, v.address, SEL_ACCESS_MANAGER);
          if (am && am !== '0x') {
            const mgr = '0x' + am.slice(-40);
            for (const op of operators) {
              for (const role of [OWNER_ROLE, ATOMIST_ROLE]) {
                const r = await ethCall(chain, mgr, encHasRole(role, op));
                if (r && r !== '0x' && BigInt('0x' + r.slice(2, 66)) === 1n) {
                  match = role === OWNER_ROLE ? 'owner-role' : 'atomist-role';
                  break;
                }
              }
              if (match) break;
            }
          }
        } catch {}
      }
      if (match) selected.push({ chainId: chain.id, chain: chain.name, matchedBy: match, ...v });
    }
  }

  const byChain = {};
  selected.forEach((v) => { byChain[v.chain] = (byChain[v.chain] || 0) + 1; });

  fs.writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    method: 'FusionInstanceCreated factory events filtered by Tesseract owner/atomist; keyed on chainId+address, never name',
    operators: [...operators],
    total: selected.length,
    byChain,
    vaults: selected.sort((a, b) => a.chain.localeCompare(b.chain) || a.block - b.block),
  }, null, 2) + '\n');

  console.log(`\n=== ${selected.length} Tesseract vaults ===`);
  console.log(JSON.stringify(byChain));
  const dupNames = {};
  selected.forEach((v) => { dupNames[v.name] = (dupNames[v.name] || 0) + 1; });
  Object.entries(dupNames).filter(([, n]) => n > 1)
    .forEach(([n, c]) => console.log(`  NOTE duplicate name x${c}: "${n}" — keyed on address, both kept`));
  console.log(`Wrote ${OUT}`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
