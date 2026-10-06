#!/usr/bin/env node
'use strict';
// Tests for collect-aave-v4.js against a node that answers as Aave V4 on Base
// does. Run: node collect-aave-v4.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./collect-aave-v4.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); process.exitCode = 1; }
}

// ---- A chain -----------------------------------------------------------------
const HUB = '0x00000000000000000000000000000000000000aa';
const ORACLE = '0x00000000000000000000000000000000000000bb';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const tok = (n) => '0xb2' + '0'.repeat(20) + n.toString(16).padStart(18, '0');
// Reserve id → [symbol, underlying, decimals, price, whole reserve, cap]
const RESERVES = [
  ['AAPLc', tok(1), 8, 332.73, 1490, 20000],
  ['METAc', tok(2), 8, 700, 1800, 0],          // 0: no cap
  ['GOOGLc', tok(3), 8, 245, 2563.27, 30000],
  ['TSLAc', tok(4), 8, 435, 1400, 30000],
  ['AMZNc', tok(5), 8, 220, 1372.73, 30000],
  ['NVDAc', tok(6), 8, 240.58, 5025, 24000],
  ['MSFTc', tok(7), 8, 510, 464.71, 30000],
  ['USDC', USDC, 6, 1, 5_000_000, 0],
];
const V = {
  meta: '0xcd19f18884bf388b866d05cdd1ae351133821f01',
  nvda: '0xfb132f4c6d9dcf4f80483ea7d96c5a5dccfcfe83',
  tezos: '0xde09e16675b667b6abb6d7910d6e009f630bcb96',
  aapl: '0x31744e44d6af88225c1dbefbe5df8308faea641b',
};
// What each vault has supplied (by reserve id), owes in USDC, and holds.
const POS = {
  [V.meta]: { supplied: { 1: 41.14 }, debt: 14400, idle: { [tok(2)]: 0 } },
  [V.nvda]: { supplied: { 5: 97.3 }, debt: 11800, idle: { [tok(6)]: 1.99 } },
  [V.tezos]: { supplied: {}, debt: 0, idle: { [tok(6)]: 4223.18 } },
  [V.aapl]: { supplied: { 0: 137.35 }, debt: 24300, idle: { [tok(1)]: 2.34 } },
};
const IPOR_VAULTS = { vaults: [
  { chainId: 8453, name: 'Meta Carry Trade', address: V.meta, assetAddress: tok(2) },
  { chainId: 8453, name: 'Nvidia Carry Trade', address: V.nvda, assetAddress: tok(6) },
  { chainId: 8453, name: 'Nvidia Carry Trade Tezos', address: V.tezos, assetAddress: tok(6) },
  { chainId: 8453, name: 'Apple Carry Trade', address: V.aapl, assetAddress: tok(1) },
  { chainId: 8453, name: 'Base USDC', address: '0x0000000000000000000000000000000000000c01', assetAddress: USDC },
  { chainId: 1, name: 'Elsewhere', address: '0x0000000000000000000000000000000000000c02', assetAddress: tok(6) },
] };

const HEAD = 52_259_744, HEAD_TS = Date.UTC(2026, 9, 6, 17, 47, 15) / 1000;
const DEPLOYED = HEAD - 20 * 43200;   // the spoke: twenty days old
const hex = (n) => '0x' + (typeof n === 'bigint' ? n : BigInt(Math.round(n))).toString(16).padStart(64, '0');
const raw = (x, d) => BigInt(Math.round(x * 10 ** Math.min(d, 6))) * 10n ** BigInt(Math.max(0, d - 6));
const word = (b) => b.toString(16).padStart(64, '0');
const str = (s) => '0x' + word(32n) + word(BigInt(s.length)) + Buffer.from(s).toString('hex').padEnd(64, '0');

let seen = { batches: 0, singles: 0, blocks: new Set() };
let opts = {};
function answer(req) {
  const { method, params } = req;
  if (method === 'eth_getBlockByNumber') return { result: { number: '0x' + HEAD.toString(16), timestamp: '0x' + HEAD_TS.toString(16) } };
  if (method !== 'eth_call') return { error: { code: -32601, message: 'no such method' } };
  const [{ to, data }, tag] = params;
  const block = tag === 'latest' ? HEAD : parseInt(tag, 16);
  seen.blocks.add(block);
  const sel = data.slice(0, 10), args = A.words('0x' + data.slice(10));
  const n = (i) => Number(BigInt('0x' + args[i]));
  const a = (i) => '0x' + args[i].slice(24);
  // Before the spoke existed there is no code there: an empty answer.
  if (to === A.SPOKE && block < DEPLOYED) return { result: '0x' };
  // Grows from a third of its size, so the history is not flat.
  const grow = block >= HEAD ? 1 : 1 / 3 + (2 / 3) * (block - DEPLOYED) / (HEAD - DEPLOYED);
  if (to === A.SPOKE) {
    if (sel === A.SEL.reserveCount) return { result: hex(opts.noStocks ? 1 : RESERVES.length) };
    if (sel === A.SEL.reserve) {
      const r = opts.noStocks ? RESERVES[7] : RESERVES[n(0)];
      return { result: '0x' + word(BigInt(r[1])) + word(BigInt(HUB)) + word(BigInt(10 + n(0))) + word(BigInt(r[2])) + word(0n) + word(0n) + word(0n) };
    }
    if (sel === A.SEL.reserveSupplied) { const r = RESERVES[n(0)]; return { result: hex(raw(r[4] * grow, r[2])) }; }
    if (sel === A.SEL.userSupplied) { const p = POS[a(1)]; const r = RESERVES[n(0)]; return { result: hex(p && p.supplied[n(0)] ? raw(p.supplied[n(0)] * grow, r[2]) : 0) }; }
    if (sel === A.SEL.userTotalDebt) { const p = POS[a(1)]; return { result: hex(p ? raw(p.debt, 6) : 0) }; }
    if (sel === A.SEL.oracle) return { result: '0x' + word(BigInt(ORACLE)) };
  }
  if (to === ORACLE) {
    if (sel === A.SEL.decimals) return { result: hex(8) };
    if (sel === A.SEL.reservePrice) {
      if (opts.revertPrice === n(0)) return { error: { code: 3, message: 'execution reverted' } };
      return { result: hex(raw(RESERVES[n(0)][3], 8)) };
    }
  }
  if (to === HUB && sel === A.SEL.spokeConfig) {
    const r = RESERVES[n(0) - 10];
    const cap = r[5] ? BigInt(r[5]) : A.UNCAPPED;
    return { result: '0x' + word(cap) + word(0n) + word(0n) + word(1n) + word(0n) };
  }
  const r = RESERVES.find(x => x[1] === to);
  if (r && sel === A.SEL.symbol) return { result: str(r[0]) };
  if (r && sel === A.SEL.balanceOf) { const p = POS[a(0)]; return { result: hex(p && p.idle[to] ? raw(p.idle[to], r[2]) : 0) }; }
  return { error: { code: 3, message: 'execution reverted' } };
}
const old = (tag) => tag !== 'latest' && parseInt(tag, 16) < HEAD;
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (opts.archiveless && Array.isArray(body) && body.some(b => b.params && old(b.params[1]))) {
    return { ok: true, json: async () => body.map(b => ({ jsonrpc: '2.0', id: b.id, error: { code: -32000, message: 'missing trie node' } })) };
  }
  if (Array.isArray(body)) {
    seen.batches++;
    if (opts.noBatch) return { ok: true, json: async () => ({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch not supported' } }) };
    return { ok: true, json: async () => body.map(b => Object.assign({ jsonrpc: '2.0', id: b.id }, answer(b))) };
  }
  seen.singles++;
  if (opts.archiveless && body.method === 'eth_call' && old(body.params[1])) {
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'missing trie node' } }) };
  }
  const r = answer(body);
  return { ok: true, json: async () => Object.assign({ jsonrpc: '2.0', id: body.id }, r) };
};

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aave-v4-'));
  fs.writeFileSync(path.join(dir, 'ipor.json'), JSON.stringify(IPOR_VAULTS));
  return { dir, out: path.join(dir, 'aave-v4.json'), ipor: path.join(dir, 'ipor.json') };
};
const quiet = async (fn) => { const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { console.log = log; } };

(async () => {
  console.log('\nencoding');
  await test('a call: the selector, then each argument as a 32-byte word', () => {
    const d = A.enc(A.SEL.userSupplied, 5, '0xFB132F4C6D9DCF4F80483EA7D96C5A5DCCFCFE83');
    assert.strictEqual(d, '0xf1568a89' + '0'.repeat(63) + '5' + '0'.repeat(24) + 'fb132f4c6d9dcf4f80483ea7d96c5a5dccfcfe83');
  });
  await test('a symbol, as a string or as bytes32', () => {
    assert.strictEqual(A.str(str('NVDAc')), 'NVDAc');
    assert.strictEqual(A.str('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')), 'MKR');
  });
  await test('only the stock vaults on Base', () => {
    assert.deepStrictEqual(A.stockVaults(IPOR_VAULTS).map(v => v.name), ['Meta Carry Trade', 'Nvidia Carry Trade', 'Nvidia Carry Trade Tezos', 'Apple Carry Trade']);
  });

  console.log('\nthe market now');
  const vaults = A.stockVaults(IPOR_VAULTS);
  const m = await A.readMarket('latest', vaults);
  const by = Object.fromEntries(m.markets.map(x => [x.symbol, x]));
  await test('every stock reserve, USDC as the debt, none other', () => {
    assert.deepStrictEqual(m.markets.map(x => x.symbol), ['AAPLc', 'METAc', 'GOOGLc', 'TSLAc', 'AMZNc', 'NVDAc', 'MSFTc']);
    assert.deepStrictEqual(m.debt, { reserveId: 7, symbol: 'USDC', decimals: 6 });
  });
  await test('size, price and cap of a reserve; no cap reads as none', () => {
    assert.ok(Math.abs(by.NVDAc.supplied - 5025) < 1e-6);
    assert.ok(Math.abs(by.NVDAc.price - 240.58) < 1e-6);
    assert.strictEqual(by.NVDAc.cap, 24000);
    assert.strictEqual(by.METAc.cap, null);
  });
  await test("Fusion's supply, USDC debt and idle stock, summed over its vaults and listed by vault", () => {
    assert.ok(Math.abs(by.NVDAc.fusion - 97.3) < 1e-6);
    assert.ok(Math.abs(by.NVDAc.debt - 11800) < 1e-6);
    assert.ok(Math.abs(by.NVDAc.idle - (4223.18 + 1.99)) < 1e-6);
    assert.deepStrictEqual(by.NVDAc.vaults.map(v => v.name), ['Nvidia Carry Trade', 'Nvidia Carry Trade Tezos']);
    assert.strictEqual(by.TSLAc.fusion, 0);
    assert.deepStrictEqual(by.TSLAc.vaults, []);
  });
  await test('the dollar figures of the table this page reproduces', () => {
    const usd = (s) => by[s].fusion * by[s].price;
    assert.strictEqual(Math.round(usd('METAc') / 100) / 10, 28.8);
    assert.strictEqual(Math.round(usd('NVDAc') / 100) / 10, 23.4);
    assert.strictEqual(Math.round(by.NVDAc.supplied * by.NVDAc.price / 1e4) / 100, 1.21);
  });
  await test('a price the oracle refuses is left out, not zero', async () => {
    opts = { revertPrice: 3 };
    const x = await A.readMarket('latest', vaults);
    opts = {};
    assert.strictEqual(x.markets.find(k => k.symbol === 'TSLAc').price, null);
    assert.ok(x.markets.find(k => k.symbol === 'NVDAc').price > 0);
  });
  await test('an endpoint that takes no batch is asked one call at a time, same answer', async () => {
    opts = { noBatch: true }; seen.singles = 0;
    const x = await A.readMarket('latest', vaults);
    opts = {};
    assert.ok(seen.singles > 20);
    assert.deepStrictEqual(x, m);
  });

  console.log('\na run');
  await test('writes today, then the days back to the spoke’s first, newest first, at their last blocks', async () => {
    const f = tmp();
    const [, lines] = await quiet(() => A.main({ out: f.out, ipor: f.ipor }));
    const j = JSON.parse(fs.readFileSync(f.out, 'utf8'));
    const today = Math.floor(HEAD_TS / 86400);
    assert.strictEqual(j.history[j.history.length - 1].d, today);
    assert.ok(j.history.length >= 20 && j.history.length <= 22, j.history.length + ' days: ' + lines.join(' | '));
    assert.ok(j.historyFrom > today - 22 && j.historyFrom <= today - 19, String(j.historyFrom));
    // Sorted, one a day, and growing towards today.
    j.history.forEach((h, i) => { if (i) assert.strictEqual(h.d, j.history[i - 1].d + 1); });
    assert.ok(j.history[0].m.NVDAc[1] < j.history[j.history.length - 1].m.NVDAc[1]);
    assert.strictEqual(j.spoke, A.SPOKE);
    assert.deepStrictEqual(j.markets.map(x => x.symbol), ['AAPLc', 'METAc', 'GOOGLc', 'TSLAc', 'AMZNc', 'NVDAc', 'MSFTc']);
  });
  await test('the next run reads only what is new', async () => {
    const f = tmp();
    await quiet(() => A.main({ out: f.out, ipor: f.ipor }));
    seen.blocks = new Set();
    await quiet(() => A.main({ out: f.out, ipor: f.ipor }));
    assert.deepStrictEqual([...seen.blocks], [HEAD]);
  });
  await test('an endpoint without old state: today is written, the history waits', async () => {
    const f = tmp();
    opts = { archiveless: true };
    const [, lines] = await quiet(() => A.main({ out: f.out, ipor: f.ipor }));
    opts = {};
    const j = JSON.parse(fs.readFileSync(f.out, 'utf8'));
    assert.strictEqual(j.history.length, 1);
    assert.strictEqual(lines.filter(l => /::warning::/.test(l)).length, 3);
    assert.strictEqual(j.historyFrom, null);
  });
  await test('a spoke with no stock reserve writes nothing and fails the run', async () => {
    const f = tmp();
    fs.writeFileSync(f.out, '{"keep":1}');
    opts = { noStocks: true };
    process.exitCode = 0;
    await quiet(() => A.main({ out: f.out, ipor: f.ipor }));
    opts = {};
    const failed = process.exitCode === 1;
    process.exitCode = 0;
    assert.ok(failed);
    assert.strictEqual(fs.readFileSync(f.out, 'utf8'), '{"keep":1}');
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
