#!/usr/bin/env node
'use strict';
// Tests for collect-vault-markets.js against a node that answers as a Fusion
// vault, Aave V3, Morpho and Euler V2 do. Run: node collect-vault-markets.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./collect-vault-markets.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);

// ---- A small chain ------------------------------------------------------------
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const VAULT = A(0xabc), DOWN = A(0xdead), ORACLE = A(0x0c);
const WETH = A(0x1), CBETH = A(0x2), USDC = A(0x3);
const F = { aave: A(0xf1), morpho: A(0xf2), euler: A(0xf3), swap: A(0xf4), zero: A(0xf5), erc4626: A(0xf6) };
const PROV = A(0xa0), DP = A(0xa1), aWETH = A(0xa2), vWETH = A(0xa3), aCB = A(0xa4), vCB = A(0xa5), sNone = A(0);
const MORPHO = A(0xb0), IRM = A(0xb1), MID = 'aa'.repeat(32);
const EV = A(0xc0), METAV = A(0xd0);
const SUB = '0x' + (BigInt(VAULT) ^ 3n).toString(16).padStart(40, '0');   // sub-account 3
const E18 = 10n ** 18n;
const w = (x) => (typeof x === 'string' ? x.replace(/^0x/, '').padStart(64, '0') : BigInt(x).toString(16).padStart(64, '0'));
const arr = (items) => '0x' + w(32) + w(items.length) + items.map(w).join('');
const str = (s) => '0x' + w(32) + w(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');
const PRICE = { [WETH]: 2500n * 10n ** 8n, [CBETH]: 2700n * 10n ** 8n, [USDC]: 10n ** 8n };
// Market balances by block: the latest, and two earlier days.
const IN_MARKET = { latest: { 1: 30n * E18, 14: 10n * E18, 11: 5n * E18, 7: 2n * E18, 12: 0n, 100001: 1n * E18 },
  '0x64': { 1: 20n * E18, 14: 8n * E18, 11: 4n * E18, 7: 1n * E18 }, '0x32': { 1: 10n * E18, 7: 1n * E18 } };
// Euler: substrate word = vault address << 96 | isCollateral << 88 | canBorrow << 80 | subAccount << 72.
const EULER_SUB = '0x' + EV.slice(2) + '01' + '00' + '03' + '0'.repeat(18);
const SEC = C.SEL;
const ACCESS = A(0xac), WM = A(0xe1), FEEACC = A(0xfa), FM = A(0xfb);
const calls = [];

global.fetch = async (url, init) => {
  const { id, params: [{ to, data }, block] } = JSON.parse(init.body);
  calls.push([to, data.slice(0, 10), block]);
  const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id, result }) });
  const sel = data.slice(0, 10), arg = (i) => '0x' + data.slice(10 + 64 * i, 74 + 64 * i);
  const argAddr = (i) => '0x' + data.slice(10 + 64 * i + 24, 74 + 64 * i);
  if (to === DOWN) return { ok: false, status: 503 };
  if (to === VAULT) {
    if (sel === SEC.totalAssets) return ok('0x' + w(47n * E18));
    if (sel === SEC.asset) return ok('0x' + w(WETH));
    if (sel === SEC.supplyCap) return ok('0x' + w(6000n * 10n ** 20n));          // in shares (20 decimals)
    if (sel === SEC.toAssets) return ok('0x' + w(BigInt(arg(0)) / 100n));       // a share is 1/100 of an asset unit
    if (sel === SEC.getFuses) return ok(arr(Object.values(F)));
    if (sel === SEC.oracle) return ok('0x' + w(ORACLE));
    if (sel === SEC.accessManager) return ok('0x' + w(ACCESS));

    if (sel === SEC.perfData) return ok('0x' + w(FEEACC) + w(1000));
    if (sel === SEC.instantFuses) return ok(arr([F.aave]));
    if (sel === SEC.inMarket) { const m = Number(BigInt(arg(0))); const v = (IN_MARKET[block] || {})[m]; return ok('0x' + w(v || 0n)); }
    if (sel === SEC.substrates) {
      const m = Number(BigInt(arg(0)));
      if (m === 1) return ok(arr([WETH, CBETH]));
      if (m === 14) return ok(arr([MID]));
      if (m === 11) return ok(arr([EULER_SUB]));
      if (m === 100001) return ok(arr([METAV]));
      if (m === 12) return ok(arr(['0x01' + '0'.repeat(22) + USDC.slice(2)]));   // a token behind a type tag
      return ok(arr([]));
    }
  }
  if (to === WM && sel === SEC.withdrawWindow) return ok('0x' + w(86400));
  if (to === WM && sel === SEC.requestFee) return ok('0x' + w(2n * 10n ** 15n));
  if (to === WM && sel === SEC.withdrawFee) return ok('0x' + w(10n ** 15n));
  if (to === FEEACC && sel === SEC.feeManager) return ok('0x' + w(FM));
  if (to === FM && sel === SEC.depositFee) return ok('0x' + w(2n * 10n ** 15n));
  if (sel === SEC.marketId) {
    const ids = { [F.aave]: 1, [F.morpho]: 14, [F.euler]: 11, [F.swap]: 12, [F.erc4626]: 100001 };
    if (to === F.zero) return ok('0x' + 'f'.repeat(64));                          // ZERO_BALANCE_MARKET
    if (ids[to]) return ok('0x' + w(ids[to]));
  }
  if (to === F.aave && sel === SEC.aaveProvider) return ok('0x' + w(PROV));
  if (to === F.morpho && sel === SEC.morpho) return ok('0x' + w(MORPHO));
  if (to === PROV && sel === SEC.dataProvider) return ok('0x' + w(DP));
  if (to === DP && sel === SEC.reserveTokens) {
    const a = argAddr(0);
    if (a === WETH) return ok('0x' + w(aWETH) + w(sNone) + w(vWETH));
    if (a === CBETH) return ok('0x' + w(aCB) + w(sNone) + w(vCB));
  }
  if (to === DP && sel === SEC.reserveData) {
    // word 5: liquidity rate, word 6: variable borrow rate (ray, yearly).
    const a = argAddr(0), rates = a === WETH ? [2n, 3n] : [1n, 2n];
    return ok('0x' + [0, 0, 0, 0, 0].map(w).join('') + w(rates[0] * 10n ** 25n) + w(rates[1] * 10n ** 25n) + [0, 0, 0, 0, 0].map(w).join(''));
  }
  if (sel === SEC.balanceOf) {
    const who = argAddr(0);
    if (who === VAULT && to === aCB) return ok('0x' + w(40n * E18));           // 40 cbETH supplied
    if (who === VAULT && to === vWETH) return ok('0x' + w(10n * E18));         // 10 WETH borrowed
    if (who === VAULT && (to === aWETH || to === vCB)) return ok('0x' + w(0));
    if (to === EV) { assert.strictEqual(who, SUB, 'Euler is read for the vault\'s sub-account'); return ok('0x' + w(4n * E18)); }
  }
  if (to === MORPHO && sel === SEC.position) return ok('0x' + w(0) + w(9n * 10n ** 24n) + w(12n * E18));   // borrow shares, 12 cbETH collateral
  if (to === MORPHO && sel === SEC.market) return ok('0x' + w(100n * E18) + w(100n * 10n ** 24n) + w(50n * E18) + w(50n * 10n ** 24n) + w(1791000000) + w(10n ** 17n));
  if (to === MORPHO && sel === SEC.params) return ok('0x' + w(WETH) + w(CBETH) + w(A(0xb2)) + w(IRM) + w(945n * 10n ** 15n));
  if (to === IRM && sel === SEC.borrowRate) {
    assert.strictEqual(data.length, 10 + 64 * 11, 'the IRM takes the market\'s params and its state');
    return ok('0x' + w(1268391679n));                                           // ≈ 4% a year
  }
  if (to === EV) {
    if (sel === SEC.asset) return ok('0x' + w(CBETH));
    if (sel === SEC.toAssets) return ok('0x' + w(BigInt(arg(0)) * 11n / 10n));  // a share is 1.1 cbETH
    if (sel === SEC.debtOf) return ok('0x' + w(0));
    if (sel === SEC.interestRate) return ok('0x' + w(951293759n * 10n ** 9n));  // ≈ 3% a year, 1e27 a second
    if (sel === SEC.interestFee) return ok('0x' + w(1000));
    if (sel === SEC.totalBorrows) return ok('0x' + w(80n * E18));
    if (sel === SEC.cash) return ok('0x' + w(20n * E18));
  }
  if (to === METAV && sel === SEC.name) return ok(str('Gauntlet WETH Prime'));
  if (to === ORACLE && sel === SEC.price) {
    // A month back (block 0x46), cbETH stood 0.2% lower against WETH.
    const p = block === '0x46' && argAddr(0) === CBETH ? 269460000000n : PRICE[argAddr(0)];
    if (p) return ok('0x' + w(p) + w(8));
  }
  if (sel === SEC.decimals) return ok('0x' + w(18));
  if (sel === SEC.symbol) return ok(str({ [WETH]: 'WETH', [CBETH]: 'cbETH', [USDC]: 'USDC' }[to] || 'TKN'));
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } }) };
};

(async () => {
  console.log('\nvault markets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-markets-'));
  const files = { out: path.join(dir, 'out.json'), history: path.join(dir, 'hist.json'), ipor: path.join(dir, 'ipor.json'), snapshots: path.join(dir, 'snaps.json'), changes: path.join(dir, 'changes.json') };
  // No getter names the withdraw manager: the governance history does.
  fs.writeFileSync(files.changes, JSON.stringify({ vaults: { [VAULT]: { contracts: { [WM]: { kind: 'withdraw' } } } } }));
  const now = Date.UTC(2026, 9, 7, 12);
  const today = Math.floor(now / 864e5);
  fs.writeFileSync(files.ipor, JSON.stringify({ vaults: [
    { chainId: 8453, address: VAULT, name: 'Test Looping', tvl: 117500 },
    { chainId: 8453, address: DOWN, name: 'Unreachable', tvl: 50000 },
    { chainId: 8453, address: A(0x5), name: 'Small', tvl: 900 },
  ] }));
  // Snapshots: yesterday (block 100), 30 days ago (block 70), 200 days ago on a
  // week boundary and off it (block 50 and 49).
  const old = today - 200 - ((today - 200) % 7);
  fs.writeFileSync(files.snapshots, JSON.stringify({ vaults: { [VAULT]: { chain: 'base', snapshots: [
    { day: today - 1, timestamp: (today - 1) * 86400 + 3600, block: 100, priceUsd: 2400 },
    { day: today - 30, timestamp: (today - 30) * 86400 + 3600, block: 70, priceUsd: 2300 },
    { day: old, timestamp: old * 86400 + 3600, block: 50, priceUsd: 2000 },
    { day: old + 1, timestamp: (old + 1) * 86400 + 3600, block: 49, priceUsd: 2000 },
  ] } } }));
  fs.writeFileSync(files.out, JSON.stringify({ vaults: { [DOWN]: { chain: 'base', name: 'Unreachable', markets: [{ id: 1, net: 1 }] } } }));
  const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
  await C.main(Object.assign({ now }, files));
  console.log = log;
  const j = JSON.parse(fs.readFileSync(files.out, 'utf8'));
  const v = j.vaults[VAULT];
  const m = (id) => v.markets.find(x => x.id === id);

  await test('the markets are the fuses\' and the tokens held; empty and bookkeeping ones left out', () => {
    assert.deepStrictEqual(v.markets.map(x => x.id), [1, 7, 11, 14, 100001]);
    assert.deepStrictEqual([m(1).name, m(7).name, m(11).name, m(14).name], ['Aave V3', 'Tokens held', 'Euler V2', 'Morpho']);
    assert.strictEqual(m(1).net, 30);
    assert.strictEqual(m(1).netUsd, 75000);
  });
  await test('parameters: managers, entry and exit contributions, the withdraw window, each market\'s fuses and substrates', () => {
    const p = v.params;
    assert.deepStrictEqual([p.access, p.withdraw, p.oracle, p.feeManager], [ACCESS, WM, ORACLE, FM]);
    assert.deepStrictEqual([p.withdrawWindow, p.requestFee, p.withdrawFee, p.depositFee, p.instantFuses], [86400, 0.2, 0.1, 0.2, 1]);
    const aave = p.permissions.find(x => x.id === 1);
    assert.deepStrictEqual(aave.fuses, [F.aave]);
    assert.deepStrictEqual(aave.subs, [{ a: WETH, sym: 'WETH' }, { a: CBETH, sym: 'cbETH' }]);
    assert.deepStrictEqual(p.permissions.find(x => x.id === 14).subs, [{ raw: '0x' + MID }]);
    assert.ok(p.permissions.some(x => x.id === 7), 'the tokens it may hold');
    assert.deepStrictEqual(p.permissions.find(x => x.id === 12).subs, [{ a: USDC, sym: 'USDC' }]);
    assert.strictEqual(p.permissions.find(x => x.id === 11).subs[0].a, EV);   // Euler's: the vault, ahead of its flags
  });
  await test('an ERC-4626 market takes its vault\'s own name', () => {
    assert.strictEqual(m(100001).name, 'Gauntlet WETH Prime');
  });
  await test('Aave: each asset supplied and borrowed, in dollars, at the reserve\'s rates compounded', () => {
    const p = m(1).positions;
    // In the vault's substrate order: WETH, then cbETH.
    assert.deepStrictEqual(p.map(x => [x.asset, x.side, x.usd]), [['WETH', 'borrow', 25000], ['cbETH', 'supply', 108000]]);
    near(p[0].apy, (Math.exp(0.03) - 1) * 100, 0.01, 'WETH borrow');
    // cbETH supplied against WETH borrowed: Aave's rate, and cbETH's own yield.
    near(p[1].apy, (Math.exp(0.01) - 1) * 100 + ((Math.pow((2700 / 2500) / (2694.6 / 2500), 365 / 30) - 1) * 100), 0.02, 'cbETH supply');
    assert.strictEqual(m(1).supplyUsd, 108000);
    assert.strictEqual(m(1).borrowUsd, 25000);
  });
  await test('Morpho: collateral and borrow through its virtual shares, at the rate its IRM quotes', () => {
    const p = m(14).positions;
    const coll = p.find(x => x.side === 'collateral'), bor = p.find(x => x.side === 'borrow');
    assert.strictEqual(coll.usd, 12 * 2700);
    assert.strictEqual(coll.market, 'cbETH/WETH');
    // 9e24 shares of 50e24 for 50 WETH: 9 WETH (less a wei of virtual asset).
    near(bor.usd, 9 * 2500, 0.01);
    near(bor.apy, (Math.exp(1268391679 / 1e18 * 365 * 86400) - 1) * 100, 0.01);
  });
  await test('a loop\'s collateral earns its own yield: its price against the borrowed token, a month apart, a year\'s worth', () => {
    const coll = m(14).positions.find(x => x.side === 'collateral');
    near(coll.ownApy, ((Math.pow((2700 / 2500) / (2694.6 / 2500), 365 / 30) - 1) * 100), 0.01);
    near(coll.apy, coll.ownApy, 0.001);
    near(m(14).supplyApy, coll.ownApy, 0.01);
    // Euler holds collateral and borrows nothing there: nothing to measure it by.
    assert.strictEqual(m(11).positions[0].apy, null);
  });
  await test('Euler: shares in assets for the vault\'s sub-account, as collateral', () => {
    const p = m(11).positions;
    assert.deepStrictEqual(p.map(x => [x.asset, x.side, x.usd]), [['cbETH', 'collateral', 11880]]);
  });
  await test('the supply cap, in shares on-chain, in the vault\'s assets', () => {
    assert.strictEqual(v.cap, 6000);
    assert.strictEqual(v.totalAssets, 47);
  });
  await test('an unreachable vault keeps its last reading; a small one is not read', () => {
    assert.deepStrictEqual(j.vaults[DOWN].markets, [{ id: 1, net: 1 }]);
    assert.ok(!j.vaults[A(0x5)]);
    assert.ok(lines.some(l => /::warning::vault-markets: Unreachable/.test(l)));
  });
  await test('history: today, then the snapshot days at their blocks and prices — the last 120 daily, a week apart before', () => {
    const h = JSON.parse(fs.readFileSync(files.history, 'utf8')).vaults[VAULT];
    assert.deepStrictEqual(Object.keys(h.days).map(Number).sort((a, b) => a - b), [old, today - 30, today - 1, today]);
    assert.deepStrictEqual(h.days[today - 1], { 1: 48000, 14: 19200, 11: 9600, 7: 2400 });
    assert.deepStrictEqual(h.days[old], { 1: 20000, 7: 2000 });
    assert.strictEqual(h.markets[14], 'Morpho');
    assert.ok(calls.some(c => c[2] === '0x64') && calls.some(c => c[2] === '0x32') && !calls.some(c => c[2] === '0x31'));
  });
  await test('a second run reads only the days still missing', async () => {
    calls.length = 0;
    console.log = () => {};
    await C.main(Object.assign({ now }, files));
    console.log = log;
    // Only the oracle's month-back prices, which every run measures again.
    const past = calls.filter(c => c[2] !== 'latest' && c[0] !== ORACLE);
    assert.ok(!past.length, past.map(c => c[2]).join(','));
  });
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
