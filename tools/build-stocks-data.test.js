#!/usr/bin/env node
'use strict';
// Tests for the Stocks page's data file. Run: node tools/build-stocks-data.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildStocks, STOCK_RE, KEEP, OPTIONAL } = require('./build-stocks-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const AAPL = '0xb200000000000000000000c2e324d24d7eecd1fb';
const NVDA = '0xb20000000000000000000037b1d0e5a07c3a6e6c';
const ipor = {
  updatedAt: '2026-10-06T08:00:00Z',
  vaults: [
    { address: '0xAAA1', name: 'Apple Carry Trade', token: 'AAPLc', assetAddress: AAPL, chain: 'base', tvl: 10, apy: 1 },
    { address: '0xccc3', name: 'USDC Carry Trade', token: 'USDC', assetAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chain: 'base', tvl: 99 },
    { address: '0xbbb2', name: 'Nvidia Carry Trade', token: 'NVDAc', assetAddress: NVDA.toUpperCase().replace('0X', '0x'), chain: 'base', tvl: 5 },
  ],
};
const tvl = {
  updatedAt: '2026-10-06T06:00:00Z',
  vaults: {
    '0xaaa1': { chain: 'base', snapshots: [{ timestamp: 2, tvlUsd: 2 }, { timestamp: 1, tvlUsd: 1 }] },
    '0xccc3': { chain: 'base', snapshots: [{ timestamp: 1, tvlUsd: 9 }] },
    '0xBBB2': { chain: 'base', snapshots: [] },
  },
};
const ev = (vault, extra = {}) => ({
  type: 'deposit', vault, vaultName: 'x', symbol: 'AAPLc', chain: 'base', underlyingToken: AAPL,
  sender: '0xrouter', owner: '0xwallet', assets: 1, shares: 100, tx: '0xt', block: 7, logIdx: 3,
  timestamp: 100, usdPrice: 250, usdValue: 250, ...extra,
});
const activity = {
  updatedAt: '2026-10-06T07:55:00Z', lastBlock: 1, vaults: [], chainHealth: {},
  events: [
    ev('0xaaa1', { tx: '0x1' }),
    ev('0xccc3', { tx: '0x2', sender: '0xusdcrouter' }),
    ev('0xbbb2', { tx: '0x3', type: 'withdraw', sender: '0xWallet2', owner: '0xWallet2' }),
    ev('0xAAA1', { tx: '0x4', synthetic: true, syntheticReason: 'same-tx', sender: '0xbot' }),
    ev('0xaaa1', { tx: '0x5', sender: '0xharvest1', owner: '0xharvest1' }),
  ],
};
const identity = {
  _meta: { minSelfDeposits: 3 },
  '0xother': { protocol: 'Harvest', via: 'deployer' },
  '0xrouter': { protocol: 'LI.FI', via: 'source' },
  '0xunrelated': { protocol: 'Portals', via: 'source' },
  '0xharvest1': { protocol: 'Harvest', via: 'source' },
  '0xwallet2': { verified: false },
  '0xbot': { protocol: 'Bot' },
  '0xusdcrouter': { protocol: 'Odos' },
};
const out = buildStocks({ ipor, tvl, activity, identity });

console.log('\nstocks data');

test('keeps the stock vaults, by underlying token, entries as they are', () => {
  assert.deepStrictEqual(out.ipor.vaults.map(v => v.address), ['0xAAA1', '0xbbb2']);
  assert.deepStrictEqual(out.ipor.vaults[0], ipor.vaults[0]);
  assert.strictEqual(out.ipor.updatedAt, ipor.updatedAt);
});

test("keeps those vaults' snapshot series, keyed and ordered as in the file", () => {
  assert.deepStrictEqual(Object.keys(out.tvl.vaults), ['0xaaa1', '0xBBB2']);
  assert.deepStrictEqual(out.tvl.vaults['0xaaa1'], tvl.vaults['0xaaa1']);
  assert.strictEqual(out.tvl.updatedAt, tvl.updatedAt);
});

test("keeps those vaults' real events in file order, synthetic flow out", () => {
  assert.deepStrictEqual(out.activity.events.map(e => e.block + ':' + e.vault + ':' + e.type),
    ['7:0xaaa1:deposit', '7:0xbbb2:withdraw', '7:0xaaa1:deposit']);
  assert.deepStrictEqual(out.activity.events.map(e => e.sender), ['0xrouter', '0xWallet2', '0xharvest1']);
  assert.strictEqual(out.activity.updatedAt, activity.updatedAt);
});

test('carries only the event fields the page reads', () => {
  const [e] = out.activity.events;
  assert.deepStrictEqual(Object.keys(e).sort(), KEEP.slice().sort());
  for (const k of ['tx', 'logIdx', 'chain', 'vaultName', 'underlyingToken', 'usdPrice']) assert.ok(!(k in e), k);
});

test("names every sender and owner the events have, and every contract of those protocols, in file order", () => {
  // 0xrouter and 0xharvest1 sent; 0xwallet2 owned (looked up lower-cased);
  // 0xother shares Harvest's name, so a Harvest row describes both. Portals,
  // the bot (synthetic only) and the USDC vault's router are not this page's.
  assert.deepStrictEqual(Object.keys(out.identity), ['_meta', '0xother', '0xrouter', '0xharvest1', '0xwallet2']);
  assert.deepStrictEqual(out.identity._meta, identity._meta);
});

test('a relay hop: both legs marked, found while the receiver is still there', () => {
  const hop = buildStocks({ ipor, activity: { events: [
    ev('0xaaa1', { tx: '0xa', type: 'withdraw', owner: '0xw1', sender: '0xw1', receiver: '0xw2', timestamp: 500 }),
    ev('0xaaa1', { tx: '0xb', owner: '0xw2', sender: '0xw2', timestamp: 516 }),
    ev('0xaaa1', { tx: '0xc', owner: '0xw3', sender: '0xw3', timestamp: 600 }),
  ] } });
  assert.deepStrictEqual(hop.activity.events.map(e => e.relay || '-'), ['out', 'in', '-']);
  for (const e of hop.activity.events) for (const k of Object.keys(e)) assert.ok(KEEP.includes(k) || OPTIONAL.includes(k), k);
  assert.ok(!('receiver' in hop.activity.events[0]));
});

test('a deposit carries where its tokens came from, when a route can use it', () => {
  const funding = { deposits: { '0x1:3': { via: 'lifi', integrator: 'jumperrwa', tx: '0xswap', block: 5 },
                                '0x5:3': { via: 'other', from: '0xpool' } } };
  const b = buildStocks({ ipor, activity, funding });
  assert.deepStrictEqual(b.activity.events.map(e => e.funded || null), [{ via: 'lifi', integrator: 'jumperrwa' }, null, null]);
});

test("each vault's holders as fractions of its shares, largest first, the vault and the zero address aside", () => {
  const holderState = { vaults: { '0xaaa1': { lastBlock: 42, bal: { '0xW1': '0x3', '0xw2': '0x1', '0x0000000000000000000000000000000000000000': '0x5', '0xaaa1': '0x9', '0xw3': '0x0' } } } };
  const b = buildStocks({ ipor, activity, holderState });
  assert.deepStrictEqual(b.holders, { '0xaaa1': { block: 42, share: [['0xw1', 0.75], ['0xw2', 0.25]] } });
});

test('matches the Stocks page on what a stock vault is', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'stocks', 'index.html'), 'utf8');
  const m = page.match(/const STOCK_RE = (\/[^\n;]+\/[a-z]*);/);
  assert.ok(m, 'STOCK_RE not found in stocks/index.html');
  assert.strictEqual(m[1], String(STOCK_RE));
});

test('an absent snapshot or router file leaves those parts empty, not the build', () => {
  const o = buildStocks({ ipor, activity, tvl: null, identity: null });
  assert.deepStrictEqual(o.tvl.vaults, {});
  assert.deepStrictEqual(o.identity, {});
  assert.strictEqual(o.activity.events.length, 3);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
