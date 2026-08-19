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

const BLOCKS_PER_DAY = {
  ethereum: 7200, base: 43200, arbitrum: 345600, avalanche: 43200,
  unichain: 21600, plasma: 43200, optimism: 43200, sonic: 86400,
  ink: 43200, katana: 43200, tac: 28800, _default: 7200,
};

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
const SCAN_CONCURRENCY = 4;
async function scanLogs(chain, address, topics, fromBlock, toBlock, deadline) {
  const name = typeof chain === 'string' ? chain : chain.name;
  const out = [];
  let chunk = chunkPref[name] || 5000000;
  let from = fromBlock;
  // Once the chunk size has settled, fire several windows at once — a wide
  // range at a 5-10k RPC cap is hundreds of sequential round-trips otherwise.
  while (from <= toBlock) {
    if (chunkPref[name] && chunk === chunkPref[name] && toBlock - from > chunk * SCAN_CONCURRENCY) {
      const windows = [];
      for (let k = 0; k < SCAN_CONCURRENCY && from <= toBlock; k++) {
        const a = from, b = Math.min(from + chunk - 1, toBlock);
        windows.push([a, b]); from = b + 1;
      }
      if (Date.now() > deadline) throw new Error('deadline');
      try {
        const batches = await Promise.all(windows.map(([a, b]) => rpcCall(chain, 'eth_getLogs', [{
          ...(address ? { address } : {}), topics,
          fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16),
        }])));
        batches.forEach((lg) => out.push(...lg));
        continue;
      } catch {
        from = windows[0][0];              // rewind and fall through to serial
        chunk = Math.max(5000, Math.floor(chunk / 4));
        chunkPref[name] = chunk;
        continue;
      }
    }
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

// Binary-search the block a contract first has code at. ~30 eth_getCode calls
// replaces scanning tens of millions of empty blocks before the factory existed
// — on Arbitrum that is the difference between ~30k eth_getLogs and a few dozen.
async function deployBlockOf(chain, address, lo, hi) {
  const hasCode = async (b) => {
    try {
      const c = await rpcCall(chain, 'eth_getCode', [address, '0x' + b.toString(16)]);
      return !!c && c !== '0x' && c !== '0x0';
    } catch { return null; }
  };
  if ((await hasCode(lo)) === true) return lo;
  if ((await hasCode(hi)) !== true) return null; // no code even at head
  let a = lo, b = hi;
  while (b - a > 1) {
    const mid = a + Math.floor((b - a) / 2);
    const r = await hasCode(mid);
    if (r === null) return a; // RPC lacks archive depth — fall back to lower bound
    if (r) b = mid; else a = mid;
  }
  return b;
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
  const chainStart = {};
  const chainStatus = {};

  // Chains run concurrently. Sequentially, 11 chains x a 4-minute budget is
  // 44 minutes before anything else happens — longer than the job allows.
  await Promise.all(CHAINS.map(async (chain) => {
    const factory = await factoryFor(chain);
    if (!factory) { chainStatus[chain.name] = 'no-factory'; return; }
    const deadline = Date.now() + CHAIN_BUDGET_MS;
    let head;
    try { head = parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16); }
    catch (e) { chainStatus[chain.name] = 'rpc-unreachable'; console.log(`[${chain.name}] RPC unreachable: ${e.message}`); return; }

    // The current proxy's deploy block is only a hint; earlier factories are
    // older, so back off well before it rather than starting at it.
    let startBlock = chain.fromBlock;
    try {
      const dep = await deployBlockOf(chain, factory, chain.fromBlock, head);
      if (dep) {
        const bpd = BLOCKS_PER_DAY[chain.name] || BLOCKS_PER_DAY._default;
        const backoff = Math.max(0, dep - bpd * 400);   // ~400 days earlier
        startBlock = Math.max(chain.fromBlock, backoff);
      }
    } catch {}

    let logs = [], complete = true;
    try {
      // Scan by TOPIC, not by a single factory address. IPOR has deployed more
      // than one factory version per chain, and filtering on the current
      // IporFusionFactoryProxy makes every vault from an earlier factory
      // invisible — which is why ethereum (41 known Tesseract vaults) returned
      // nothing. log.address records which factory actually emitted each event.
      logs = await scanLogs(chain, null, [FUSION_INSTANCE_CREATED], startBlock, head, deadline);
    } catch (e) {
      complete = false;
      console.log(`[${chain.name}] scan INCOMPLETE (${e.message}) — results for this chain are partial`);
    }
    const vaults = [];
    for (const l of logs) {
      try { vaults.push({ ...parseInstance(l), factory: (l.address || '').toLowerCase() }); } catch {}
    }
    chainStart[chain.name] = startBlock;
    chainStatus[chain.name] = complete ? 'ok' : 'incomplete';
    allByChain[chain.name] = { chain, vaults, complete };
    console.log(`[${chain.name}] factory=${factory} scanFrom=${startBlock} `
      + `(${((head - startBlock) / 1e6).toFixed(1)}M blocks) -> ${vaults.length} vaults ${complete ? '' : '(INCOMPLETE)'}`);
  }));

  // ---- Build the Tesseract operator set from the seeds ----
  // initialOwner rides in the factory event, so the owner half of the operator
  // set costs nothing. For atomists we resolve each seed's AccessManager (one
  // cheap eth_call each) and then issue ONE RoleGranted scan per chain with all
  // those managers in the address filter — previously this was a separate
  // full-range log scan per seed vault, which alone could exceed the job budget.
  const operators = new Set();
  await Promise.all(Object.values(allByChain).map(async ({ chain, vaults }) => {
    const seeds = vaults.filter((v) => seedNames.has(v.address));
    if (!seeds.length) return;
    seeds.forEach((v) => operators.add(v.owner));

    const managers = [];
    await Promise.all(seeds.map(async (v) => {
      try {
        const am = await ethCall(chain, v.address, SEL_ACCESS_MANAGER);
        if (am && am !== '0x') managers.push(('0x' + am.slice(-40)).toLowerCase());
      } catch {}
    }));
    if (!managers.length) return;

    try {
      const head = parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16);
      const grants = await scanLogs(
        chain, [...new Set(managers)],
        [ROLE_GRANTED, ['0x' + pad32(OWNER_ROLE), '0x' + pad32(ATOMIST_ROLE)]],
        chainStart[chain.name] || chain.fromBlock, head, Date.now() + 90000
      );
      grants.forEach((g) => { if (g.topics[2]) operators.add('0x' + g.topics[2].slice(-40).toLowerCase()); });
      console.log(`[${chain.name}] ${seeds.length} seeds -> ${managers.length} managers -> ${grants.length} role grants`);
    } catch (e) {
      console.log(`[${chain.name}] atomist scan incomplete: ${e.message}`);
    }
  }));
  console.log(`\nTesseract operator addresses discovered: ${operators.size}`);
  [...operators].forEach((o) => console.log('  ', o));

  // ---- Select vaults by operator ----
  // The owner filter is free (initialOwner rides in the factory event). For
  // ownership handed over after deployment we do NOT probe hasRole per vault
  // per operator — that is thousands of eth_calls. Instead one RoleGranted
  // scan per chain, filtered on the indexed account topic, finds every
  // AccessManager that ever granted OWNER/ATOMIST to a Tesseract operator;
  // we then intersect that against each vault's own AccessManager.
  const opTopics = [...operators].map((o) => '0x' + o.replace(/^0x/, '').toLowerCase().padStart(64, '0'));
  const selected = [];

  for (const { chain, vaults } of Object.values(allByChain)) {
    const byOwner = vaults.filter((v) => operators.has(v.owner));
    byOwner.forEach((v) => selected.push({ chainId: chain.id, chain: chain.name, matchedBy: 'owner', ...v }));

    const rest = vaults.filter((v) => !operators.has(v.owner));
    if (!rest.length || !opTopics.length) continue;

    let grantedManagers = new Set();
    try {
      const head = parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16);
      const logs = await scanLogs(
        chain, null,
        [ROLE_GRANTED, ['0x' + pad32(OWNER_ROLE), '0x' + pad32(ATOMIST_ROLE)], opTopics],
        chainStart[chain.name] || chain.fromBlock, head, Date.now() + 120000
      );
      logs.forEach((l) => grantedManagers.add(l.address.toLowerCase()));
      console.log(`  [${chain.name}] ${logs.length} operator role grants across ${grantedManagers.size} access managers`);
    } catch (e) {
      console.log(`  [${chain.name}] role-grant scan skipped: ${e.message}`);
      continue;
    }
    if (!grantedManagers.size) continue;

    const selDeadline = Date.now() + 120000;
    for (const v of rest) {
      if (Date.now() > selDeadline) { console.log(`  [${chain.name}] selection budget reached, ${rest.length} candidates not all probed`); break; }
      try {
        const am = await ethCall(chain, v.address, SEL_ACCESS_MANAGER);
        if (!am || am === '0x') continue;
        const mgr = ('0x' + am.slice(-40)).toLowerCase();
        if (grantedManagers.has(mgr)) {
          selected.push({ chainId: chain.id, chain: chain.name, matchedBy: 'role-grant', ...v });
        }
      } catch { /* unreadable vault: skip */ }
    }
  }

  // Seeds must never be silently dropped, even if their operator moved.
  const have = new Set(selected.map((v) => v.chainId + ':' + v.address));
  for (const { chain, vaults } of Object.values(allByChain)) {
    for (const v of vaults) {
      if (seedNames.has(v.address) && !have.has(chain.id + ':' + v.address)) {
        selected.push({ chainId: chain.id, chain: chain.name, matchedBy: 'seed-name', ...v });
      }
    }
  }

  const byChain = {};
  selected.forEach((v) => { byChain[v.chain] = (byChain[v.chain] || 0) + 1; });

  // ---- Completeness gate ----
  // A partial scan that exits 0 is worse than a failure: it commits a
  // confident-looking file. Any chain that did not finish, or that holds
  // name-matched seeds yet yielded nothing, makes the whole result suspect.
  const seedsByChain = {};
  Object.values(allByChain).forEach(({ chain, vaults }) => {
    seedsByChain[chain.name] = vaults.filter((v) => seedNames.has(v.address)).length;
  });

  const problems = [];
  for (const [name, status] of Object.entries(chainStatus)) {
    if (status !== 'ok') problems.push(`${name}: ${status}`);
  }
  for (const c of CHAINS) {
    if (!(c.name in chainStatus)) problems.push(`${c.name}: never ran`);
  }
  if (seedNames.size && !operators.size) {
    problems.push(`${seedNames.size} seed vaults known but no operators resolved`);
  }
  // Coverage check. The public vault list is not the source of truth — it only
  // tells us a floor. If discovery cannot even see the vaults we already know
  // exist, the scan is broken and the result must not be published as good.
  const seedsSeen = Object.values(seedsByChain).reduce((a, b) => a + b, 0);
  if (seedNames.size && seedsSeen < seedNames.size * 0.9) {
    problems.push(`coverage: only ${seedsSeen} of ${seedNames.size} known Tesseract-named vaults were seen by the factory scan`);
  }
  if (seedNames.size && selected.length < seedsSeen) {
    problems.push(`selection dropped vaults: saw ${seedsSeen} seeds but selected ${selected.length}`);
  }

  const complete = problems.length === 0;

  const payload = {
    updatedAt: new Date().toISOString(),
    method: 'FusionInstanceCreated factory events filtered by Tesseract owner/atomist; keyed on chainId+address, never name',
    complete,
    problems,
    chainStatus,
    seedsSeenByChain: seedsByChain,
    seedsKnown: seedNames.size,
    operators: [...operators],
    total: selected.length,
    byChain,
    vaults: selected.sort((a, b) => a.chain.localeCompare(b.chain) || a.block - b.block),
  };

  // Never replace a good, larger result with a degraded one.
  let prior = null;
  try { prior = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  if (prior && prior.complete && !complete && (prior.total || 0) > selected.length) {
    console.error(`\nREFUSING TO WRITE: previous result was complete with ${prior.total} vaults; `
      + `this run is incomplete with ${selected.length}. Keeping the good file.`);
    console.error('Problems: ' + problems.join('; '));
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');

  console.log(`\n=== ${selected.length} Tesseract vaults ===`);
  console.log(JSON.stringify(byChain));
  console.log('seeds known: ' + seedNames.size + ' · seeds seen per chain: ' + JSON.stringify(seedsByChain));
  const dupNames = {};
  selected.forEach((v) => { dupNames[v.name] = (dupNames[v.name] || 0) + 1; });
  Object.entries(dupNames).filter(([, n]) => n > 1)
    .forEach(([n, c]) => console.log(`  NOTE duplicate name x${c}: "${n}" — keyed on address, both kept`));
  console.log(`Wrote ${OUT}`);

  if (!complete) {
    console.error('\nINCOMPLETE RESULT — failing the job so this is not mistaken for a good run:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
