#!/usr/bin/env node
'use strict';
// erc4626-probe.js — decide whether a contract implements EIP-4626.
//
// Two independent passes, because either alone can lie:
//   1. STATIC  — derive every selector from its signature (keccak256, self-tested
//      below) and look for it in the deployed bytecode. Proves the dispatcher
//      can route the call. Blind to proxies, so proxies are resolved first.
//   2. LIVE    — eth_call every view function and decode the answer. Proves the
//      function actually returns something sane, and works through proxies.
//
// Nothing here sends a transaction; every call is read-only.

const ADDR = (process.argv[2] || '').toLowerCase();
const CHAIN = process.argv[3] || 'base';
const RPCS = {
  base: ['https://mainnet.base.org', 'https://base.llamarpc.com', 'https://base-rpc.publicnode.com',
         'https://base.drpc.org', 'https://1rpc.io/base'],
  ethereum: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com', 'https://rpc.ankr.com/eth'],
};

/* ------------------------------------------------------------------ keccak */
const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => { const b = BigInt(n) % 64n; return b === 0n ? x : ((x << b) | (x >> (64n - b))) & MASK; };
const RC = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n,
];
const ROT = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];
function keccakF(A) {
  for (let r = 0; r < 24; r++) {
    const C = new Array(5), D = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x+5] ^ A[x+10] ^ A[x+15] ^ A[x+20];
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rotl(C[(x+1)%5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x+5*y] ^= D[x];
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5*((2*x+3*y)%5)] = rotl(A[x+5*y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      A[x+5*y] = B[x+5*y] ^ ((~B[(x+1)%5 + 5*y] & MASK) & B[(x+2)%5 + 5*y]);
    A[0] ^= RC[r];
  }
  return A;
}
function keccak256(buf) {
  const RATE = 136, p = Array.from(buf);
  p.push(0x01);
  while (p.length % RATE !== 0) p.push(0x00);
  p[p.length - 1] |= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(p[off + i*8 + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }
  const out = [];
  for (let i = 0; i < 4; i++) { let l = A[i]; for (let b = 0; b < 8; b++) { out.push(Number(l & 0xffn)); l >>= 8n; } }
  return Buffer.from(out);
}
const hash = (s) => keccak256(Buffer.from(s, 'utf8')).toString('hex');
const sel  = (s) => hash(s).slice(0, 8);

// Self-test. A wrong keccak would silently turn every "missing" into a lie.
(function selfTest() {
  const kat = [['', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
               ['abc', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45']];
  const known = { 'transfer(address,uint256)': 'a9059cbb', 'totalSupply()': '18160ddd',
                  'balanceOf(address)': '70a08231', 'decimals()': '313ce567' };
  for (const [m, h] of kat) if (hash(m) !== h) throw new Error('keccak KAT failed for ' + JSON.stringify(m));
  for (const [s, e] of Object.entries(known)) if (sel(s) !== e) throw new Error('selector mismatch: ' + s);
  console.log('keccak256 self-test: PASS (2 digest vectors + 4 known selectors)\n');
})();

/* --------------------------------------------------------------------- rpc */
let RPC_OK = null;
async function rpc(method, params) {
  const urls = RPC_OK ? [RPC_OK] : RPCS[CHAIN];
  let lastErr;
  for (const url of urls) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) { lastErr = new Error(url + ' HTTP ' + res.status); continue; }
      const j = await res.json();
      if (j.error) return { error: j.error };          // a revert is an answer, not a transport failure
      RPC_OK = url;
      return { result: j.result };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPCs failed');
}

const pad32 = (h) => h.replace(/^0x/, '').padStart(64, '0');
const encAddr = (a) => pad32(a.toLowerCase());
const encUint = (n) => pad32(BigInt(n).toString(16));
const ZERO = '0x0000000000000000000000000000000000000000';

async function call(to, data) {
  const r = await rpc('eth_call', [{ to, data: '0x' + data }, 'latest']);
  if (r.error) return { revert: r.error.message || JSON.stringify(r.error) };
  if (!r.result || r.result === '0x') return { empty: true };
  return { data: r.result.replace(/^0x/, '') };
}

const asUint = (w) => BigInt('0x' + w.slice(0, 64));
const asAddr = (w) => '0x' + w.slice(24, 64);
function asString(w) {
  // ABI-encoded dynamic string: offset, length, bytes.
  try {
    const off = Number(BigInt('0x' + w.slice(0, 64))) * 2;
    const len = Number(BigInt('0x' + w.slice(off, off + 64)));
    return Buffer.from(w.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8');
  } catch { return '<undecodable>'; }
}

/* ------------------------------------------------------------ the interface */
const V = [ // EIP-4626 view surface — probed live
  ['asset()',                   'addr'],
  ['totalAssets()',             'uint'],
  ['convertToShares(uint256)',  'uint', [encUint(10n ** 18n)]],
  ['convertToAssets(uint256)',  'uint', [encUint(10n ** 18n)]],
  ['maxDeposit(address)',       'uint', [encAddr(ZERO)]],
  ['previewDeposit(uint256)',   'uint', [encUint(10n ** 18n)]],
  ['maxMint(address)',          'uint', [encAddr(ZERO)]],
  ['previewMint(uint256)',      'uint', [encUint(10n ** 18n)]],
  ['maxWithdraw(address)',      'uint', [encAddr(ZERO)]],
  ['previewWithdraw(uint256)',  'uint', [encUint(10n ** 18n)]],
  ['maxRedeem(address)',        'uint', [encAddr(ZERO)]],
  ['previewRedeem(uint256)',    'uint', [encUint(10n ** 18n)]],
];
const MUT = [ // EIP-4626 state-changing surface — static check only
  'deposit(uint256,address)', 'mint(uint256,address)',
  'withdraw(uint256,address,address)', 'redeem(uint256,address,address)',
];
const ERC20_V = [
  ['name()', 'str'], ['symbol()', 'str'], ['decimals()', 'uint'], ['totalSupply()', 'uint'],
  ['balanceOf(address)', 'uint', [encAddr(ZERO)]], ['allowance(address,address)', 'uint', [encAddr(ZERO), encAddr(ZERO)]],
];
const ERC20_MUT = ['transfer(address,uint256)', 'transferFrom(address,address,uint256)', 'approve(address,uint256)'];
const EVENTS = ['Deposit(address,address,uint256,uint256)', 'Withdraw(address,address,address,uint256,uint256)'];

/* -------------------------------------------------------------------- main */
(async function main() {
  if (!/^0x[0-9a-f]{40}$/.test(ADDR)) { console.error('usage: erc4626-probe.js <address> [chain]'); process.exit(2); }
  console.log('Contract : ' + ADDR);
  console.log('Chain    : ' + CHAIN);

  const codeRes = await rpc('eth_getCode', [ADDR, 'latest']);
  const code = (codeRes.result || '0x').replace(/^0x/, '');
  console.log('RPC      : ' + RPC_OK);
  console.log('Bytecode : ' + (code.length / 2) + ' bytes\n');
  if (!code.length) { console.log('VERDICT: no code at this address — it is an EOA or nothing is deployed.'); return; }

  // ---- proxy resolution ----------------------------------------------------
  let scanCode = code, impl = null, proxyKind = null;
  const m1167 = code.match(/^363d3d373d3d3d363d(73|6f)([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/);
  if (m1167) { impl = '0x' + m1167[2]; proxyKind = 'EIP-1167 minimal proxy'; }
  if (!impl) {
    const SLOTS = {
      'EIP-1967 implementation': '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      'EIP-1967 beacon':         '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
      'OZ legacy implementation':'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
    };
    for (const [label, slot] of Object.entries(SLOTS)) {
      const r = await rpc('eth_getStorageAt', [ADDR, slot, 'latest']);
      const w = (r.result || '').replace(/^0x/, '');
      if (w && /[1-9a-f]/.test(w)) {
        const a = '0x' + w.slice(24);
        if (a !== ZERO) { impl = a; proxyKind = label; break; }
      }
    }
  }
  if (impl) {
    console.log('Proxy    : ' + proxyKind + ' -> ' + impl);
    const ic = await rpc('eth_getCode', [impl, 'latest']);
    scanCode = (ic.result || '0x').replace(/^0x/, '');
    console.log('           implementation bytecode ' + (scanCode.length / 2) + ' bytes');
    console.log('           (static scan runs against the implementation; live calls against the proxy)\n');
  } else {
    console.log('Proxy    : none detected (EIP-1167 / EIP-1967 / OZ legacy slots all empty)\n');
  }

  const inCode = (s) => scanCode.includes(s);

  // ---- static pass ---------------------------------------------------------
  console.log('=== STATIC: selector present in bytecode ===');
  const statRow = (sig) => { const s = sel(sig); const ok = inCode(s);
    console.log('  ' + (ok ? 'yes' : 'NO ') + '  0x' + s + '  ' + sig); return ok; };
  console.log('-- EIP-4626 views');           const sv = V.map(([sig]) => statRow(sig));
  console.log('-- EIP-4626 state-changing');  const sm = MUT.map(statRow);
  console.log('-- ERC-20 views');             const s2v = ERC20_V.map(([sig]) => statRow(sig));
  console.log('-- ERC-20 state-changing');    const s2m = ERC20_MUT.map(statRow);
  console.log('-- EIP-4626 event topics');
  const se = EVENTS.map((e) => { const h = hash(e); const ok = inCode(h);
    console.log('  ' + (ok ? 'yes' : 'NO ') + '  0x' + h.slice(0, 16) + '…  ' + e); return ok; });

  // ---- live pass -----------------------------------------------------------
  console.log('\n=== LIVE: eth_call and decode ===');
  const live = {};
  async function probe(sig, kind, args = []) {
    const r = await call(ADDR, sel(sig) + args.join(''));
    let shown, ok = false;
    if (r.revert)      shown = 'REVERT (' + String(r.revert).slice(0, 70) + ')';
    else if (r.empty)  shown = 'empty return — function not present';
    else {
      ok = true;
      shown = kind === 'addr' ? asAddr(r.data)
            : kind === 'str'  ? JSON.stringify(asString(r.data))
            : asUint(r.data).toString();
      if (kind !== 'str' && r.data.length < 64) { ok = false; shown = 'short return (' + r.data.length / 2 + ' bytes)'; }
    }
    live[sig] = ok ? shown : null;
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + sig.padEnd(28) + ' -> ' + shown);
    return ok;
  }
  console.log('-- EIP-4626 views');
  const lv = []; for (const [sig, kind, args] of V) lv.push(await probe(sig, kind, args));
  console.log('-- ERC-20 views');
  const l2 = []; for (const [sig, kind, args] of ERC20_V) l2.push(await probe(sig, kind, args));

  // Underlying asset sanity check — a real 4626 points at a real ERC-20.
  const assetAddr = live['asset()'];
  if (assetAddr && /^0x[0-9a-f]{40}$/.test(assetAddr) && assetAddr !== ZERO) {
    console.log('\n-- underlying asset ' + assetAddr);
    for (const [sig, kind] of [['symbol()', 'str'], ['decimals()', 'uint'], ['totalSupply()', 'uint']]) {
      const r = await call(assetAddr, sel(sig));
      const v = r.revert ? 'REVERT' : r.empty ? 'empty' : (kind === 'str' ? JSON.stringify(asString(r.data)) : asUint(r.data).toString());
      console.log('  ' + sig.padEnd(16) + ' -> ' + v);
    }
  }

  /* ------------------------------------------------------------- verdict */
  const count = (a) => a.filter(Boolean).length;
  console.log('\n=== VERDICT ===');
  console.log('EIP-4626 views          static ' + count(sv) + '/' + V.length + '   live ' + count(lv) + '/' + V.length);
  console.log('EIP-4626 mutative       static ' + count(sm) + '/' + MUT.length);
  console.log('EIP-4626 events         static ' + count(se) + '/' + EVENTS.length);
  console.log('ERC-20 views            static ' + count(s2v) + '/' + ERC20_V.length + '   live ' + count(l2) + '/' + ERC20_V.length);
  console.log('ERC-20 mutative         static ' + count(s2m) + '/' + ERC20_MUT.length);

  const viewsOk = count(lv) === V.length;
  const mutOk = count(sm) === MUT.length;
  const erc20Ok = count(l2) === ERC20_V.length && count(s2m) === ERC20_MUT.length;
  console.log('');
  if (viewsOk && mutOk && erc20Ok) console.log('=> ERC-4626 COMPATIBLE: full view surface answers live, all four mutative');
  else if (count(lv) === 0 && count(sm) === 0) console.log('=> NOT ERC-4626: none of the interface is present');
  else console.log('=> PARTIAL — see the per-function rows above; this is not a conforming ERC-4626 vault');

  const missingV = V.filter((_, i) => !lv[i]).map(([s]) => s);
  const missingM = MUT.filter((_, i) => !sm[i]);
  if (missingV.length) console.log('   missing/failing views     : ' + missingV.join(', '));
  if (missingM.length) console.log('   missing mutative functions: ' + missingM.join(', '));
})().catch((e) => { console.error('FATAL:', e && e.message || e); process.exit(1); });
