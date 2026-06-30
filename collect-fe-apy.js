#!/usr/bin/env node
//
// FE APY collector — "front-end APY" per IPOR Plasma Vault.
//
// What it produces (fe-apy.json):
//   For each vault we take the APR the IPOR app shows
//   (https://api.ipor.io/dapp/plasma-vaults-list, field `apr`) and deduct the
//   vault's on-chain fees so the number reflects what a depositor actually
//   keeps:
//
//       feApy = apr * (1 - performanceFee) - managementFee
//
//   Fees are read straight from the PlasmaVault contract:
//     getPerformanceFeeData() -> (feeAccount, feeInPercentage)
//     getManagementFeeData()  -> (feeAccount, feeInPercentage, lastUpdate)
//   feeInPercentage is bps with 2 decimals (10000 = 100%, 100 = 1%), so the
//   fraction is value / 10000.
//
// Output shape:
//   { updatedAt, source, aprScale, vaults: {
//       "0xabc…": { chain, chainId, aprPct, perfPct, mgmtPct, feApyPct } } }
//   perfPct / mgmtPct / feApyPct are null when fees can't be read (e.g. a chain
//   we have no RPC for) — the front end then shows gross APR with a note.
//
// Usage:
//   node collect-fe-apy.js                       # all vaults from the API
//   node collect-fe-apy.js --apr-scale=percent   # force apr interpretation
//   node collect-fe-apy.js --apr-scale=fraction
//
// No dependencies — keccak256 (for the function selectors) is implemented
// inline and self-tested at startup against a known selector.

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'fe-apy.json');
const API_URL = 'https://api.ipor.io/dapp/plasma-vaults-list';
const RPC_TIMEOUT_MS = 20000;

// Per-chainId RPC endpoints — mirrors collect-activity.js. Public, no-auth.
const CHAIN_RPCS = {
  1:     { name: 'ethereum',  rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'] },
  8453:  { name: 'base',      rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org', 'https://base.llamarpc.com'] },
  42161: { name: 'arbitrum',  rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'] },
  43114: { name: 'avalanche', rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org', 'https://api.avax.network/ext/bc/C/rpc'] },
  130:   { name: 'unichain',  rpcs: ['https://unichain-rpc.publicnode.com', 'https://unichain.drpc.org', 'https://mainnet.unichain.org'] },
  9745:  { name: 'plasma',    rpcs: ['https://evm-rpc.plasma.io/api'] },
};

// ───────────────────────── keccak-256 (inline) ─────────────────────────
// Minimal Keccak-f[1600] over BigInt lanes. Inputs are tiny (function
// signatures) so performance is irrelevant; correctness is asserted at
// startup. Keccak padding (0x01 … 0x80), NOT NIST SHA3 (0x06).
function keccak256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const MASK = (1n << 64n) - 1n;
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  // rotation offsets r[x][y]
  const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];
  const rotl = (x, n) => { const b = BigInt(n); return ((x << b) | (x >> (64n - b))) & MASK; };

  const S = new Array(25).fill(0n);
  function keccakF() {
    for (let round = 0; round < 24; round++) {
      const C = [0n, 0n, 0n, 0n, 0n];
      for (let x = 0; x < 5; x++) C[x] = S[x] ^ S[x + 5] ^ S[x + 10] ^ S[x + 15] ^ S[x + 20];
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
        for (let y = 0; y < 5; y++) S[x + 5 * y] ^= D;
      }
      const B = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(S[x + 5 * y], ROT[x][y]);
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        S[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
      }
      S[0] ^= RC[round];
    }
  }

  const RATE = 136; // bytes (1088 bits)
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let k = 0; k < 8; k++) lane |= BigInt(padded[off + i * 8 + k]) << BigInt(8 * k);
      S[i] ^= lane;
    }
    keccakF();
  }

  let out = '';
  for (let i = 0; i < 4; i++) { // 4 lanes = 32 bytes
    let lane = S[i];
    for (let k = 0; k < 8; k++) { out += Number(lane & 0xffn).toString(16).padStart(2, '0'); lane >>= 8n; }
  }
  return out;
}
function selector(sig) { return '0x' + keccak256Hex(sig).slice(0, 8); }

// Assert keccak is correct before trusting any computed selector. balanceOf's
// selector (0x70a08231) is already relied on elsewhere in this repo.
(function selfTest() {
  const empty = keccak256Hex('');
  const bal = selector('balanceOf(address)');
  if (empty !== 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' || bal !== '0x70a08231') {
    console.error('keccak256 self-test FAILED:', { empty, bal });
    process.exit(1);
  }
})();

const SEL_PERF = selector('getPerformanceFeeData()');
const SEL_MGMT = selector('getManagementFeeData()');

// ───────────────────────── helpers ─────────────────────────
function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2]; else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

async function rpcCall(rpcs, method, params) {
  let lastErr;
  for (const url of rpcs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; }
    finally { clearTimeout(t); }
  }
  throw new Error('all RPCs failed: ' + (lastErr && lastErr.message));
}

// 2nd ABI word of a returned static struct = feeInPercentage (bps, 2 decimals).
function decodeFeeBps(hex) {
  if (!hex || hex === '0x' || hex.length < 2 + 128) return null;
  const word = hex.slice(2 + 64, 2 + 128);
  const v = parseInt(word, 16);
  return Number.isFinite(v) ? v : null;
}

async function readFeeBps(rpcs, vault, sel) {
  const res = await rpcCall(rpcs, 'eth_call', [{ to: vault, data: sel }, 'latest']);
  return decodeFeeBps(res);
}

// Pull a usable APR number out of whatever the API hands back (number, or a
// string like "8.14%" / "0.0814").
function parseApr(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const n = parseFloat(String(raw).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

function firstField(obj, keys) {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return null;
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const args = parseArgs();

  console.log('Fetching', API_URL);
  const apiRes = await fetch(API_URL, { headers: { 'accept': 'application/json' } });
  if (!apiRes.ok) throw new Error('API HTTP ' + apiRes.status);
  const body = await apiRes.json();
  const list = Array.isArray(body) ? body : (body.vaults || body.data || body.results || body.plasmaVaults || []);
  console.log('API entries:', list.length);
  if (list.length) console.log('First raw entry:', JSON.stringify(list[0]));

  // Normalize entries.
  const entries = [];
  for (const it of list) {
    const addr = firstField(it, ['address', 'vaultAddress', 'plasmaVault', 'vault', 'plasmaVaultAddress']);
    const chainId = Number(firstField(it, ['chainId', 'chain_id', 'chainID', 'network', 'chain']));
    const apr = parseApr(firstField(it, ['apr', 'apy', 'aprNet', 'netApr']));
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    entries.push({ addr: addr.toLowerCase(), chainId: Number.isFinite(chainId) ? chainId : null, apr });
  }
  console.log('Normalized vaults:', entries.length);

  // Detect APR scale across the dataset (fraction vs percent) unless overridden.
  // Median > 1.5 ⇒ values are percents (e.g. 8.1); else fractions (e.g. 0.081).
  let scale = args['apr-scale'];
  if (scale !== 'fraction' && scale !== 'percent') {
    const vals = entries.map(e => e.apr).filter(v => v != null && v > 0).sort((a, b) => a - b);
    const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    scale = median > 1.5 ? 'percent' : 'fraction';
    console.log(`APR scale auto-detected: ${scale} (median apr=${median})`);
  } else {
    console.log('APR scale (forced):', scale);
  }
  const toFrac = (apr) => apr == null ? null : (scale === 'percent' ? apr / 100 : apr);

  const vaults = {};
  let withFees = 0, noRpc = 0, feeErr = 0;

  for (const e of entries) {
    const aprFrac = toFrac(e.apr);
    const chainCfg = e.chainId != null ? CHAIN_RPCS[e.chainId] : null;
    let perfBps = null, mgmtBps = null;

    if (chainCfg) {
      try {
        [perfBps, mgmtBps] = await Promise.all([
          readFeeBps(chainCfg.rpcs, e.addr, SEL_PERF).catch(() => null),
          readFeeBps(chainCfg.rpcs, e.addr, SEL_MGMT).catch(() => null),
        ]);
        if (perfBps != null || mgmtBps != null) withFees++; else feeErr++;
      } catch { feeErr++; }
    } else {
      noRpc++;
    }

    const perfFrac = perfBps != null ? perfBps / 10000 : null;
    const mgmtFrac = mgmtBps != null ? mgmtBps / 10000 : null;

    let feApyPct = null;
    if (aprFrac != null && perfFrac != null && mgmtFrac != null) {
      feApyPct = (aprFrac * (1 - perfFrac) - mgmtFrac) * 100;
    }

    vaults[e.addr] = {
      chain: chainCfg ? chainCfg.name : null,
      chainId: e.chainId,
      aprPct: aprFrac != null ? +(aprFrac * 100).toFixed(4) : null,
      perfPct: perfFrac != null ? +(perfFrac * 100).toFixed(4) : null,
      mgmtPct: mgmtFrac != null ? +(mgmtFrac * 100).toFixed(4) : null,
      feApyPct: feApyPct != null ? +feApyPct.toFixed(4) : null,
    };
  }

  const out = {
    updatedAt: new Date().toISOString(),
    source: API_URL,
    aprScale: scale,
    vaults,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(vaults).length} vaults to ${OUTPUT_FILE}`);
  console.log(`  fees read: ${withFees} · no RPC for chain: ${noRpc} · fee read error: ${feeErr}`);
  // Sample of the computed result for log verification.
  Object.entries(vaults).slice(0, 8).forEach(([a, v]) =>
    console.log(`  ${a} ${v.chain || '?'}  apr=${v.aprPct}%  perf=${v.perfPct}%  mgmt=${v.mgmtPct}%  feApy=${v.feApyPct}%`));
}

// Exported for the keccak/selector self-test; main only runs as a CLI so the
// module can be required in a test without hitting the network.
module.exports = { keccak256Hex, selector, SEL_PERF, SEL_MGMT, decodeFeeBps, parseApr };

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
