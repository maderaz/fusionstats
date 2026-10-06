#!/usr/bin/env node
'use strict';
// Tests for the Activity page's recent cache. Run: node tools/build-activity-recent.test.js

const assert = require('assert');
const { buildRecent } = require('./build-activity-recent.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const DAY = 86400;
const NOW = Date.parse('2026-10-03T20:00:00Z') / 1000;
const ev = (daysAgo, extra = {}) => ({
  type: 'deposit', vault: '0xv1', vaultName: 'Vault One', symbol: 'USDC', chain: 'base', underlyingToken: '0xt',
  sender: '0xs', owner: '0xo', assets: 100, shares: 10000, tx: '0x' + daysAgo, block: 1, logIdx: 0,
  timestamp: NOW - daysAgo * DAY, usdPrice: 1, usdValue: 100, ...extra,
});
const data = (events, vaults = [{ address: '0xv1', name: 'Vault One', symbol: 'USDC', chain: 'base' }]) =>
  ({ updatedAt: new Date(NOW * 1000).toISOString(), minTvlUsd: 50, vaults, events });

console.log('\nrecent cache');

test('keeps every event of the window, and only those', () => {
  const r = buildRecent(data([ev(1), ev(20), ev(34.9), ev(36), ev(200)]), null, { windowDays: 35, minEvents: 2 });
  assert.deepStrictEqual(r.events.map(e => e.tx), ['0x1', '0x20', '0x34.9']);
  assert.strictEqual(r.coveredFrom, NOW - 35 * DAY);
  assert.strictEqual(r.total, 5);
});

test('a quiet month still carries at least minEvents, down to a whole timestamp', () => {
  const r = buildRecent(data([ev(1), ev(40), ev(50), ev(50, { tx: '0x50b' }), ev(90)]), null, { windowDays: 35, minEvents: 3 });
  // The third-newest is 50 days old; its twin at the same moment comes too.
  assert.strictEqual(r.coveredFrom, NOW - 50 * DAY);
  assert.deepStrictEqual(r.events.map(e => e.tx).sort(), ['0x1', '0x40', '0x50', '0x50b']);
});

test('drops the fields the page never reads', () => {
  const [e] = buildRecent(data([ev(1)]), null, { minEvents: 1 }).events;
  for (const k of ['sender', 'shares', 'logIdx', 'usdPrice']) assert.ok(!(k in e), k);
  for (const k of ['type', 'vault', 'owner', 'tx', 'assets', 'usdValue', 'timestamp', 'underlyingToken', 'chain']) assert.ok(k in e, k);
});

test('keeps the full file order, so the page sorts ties the same way', () => {
  const r = buildRecent(data([ev(2, { tx: '0xa' }), ev(1, { tx: '0xb' }), ev(2, { tx: '0xc' })]), null, { minEvents: 1 });
  assert.deepStrictEqual(r.events.map(e => e.tx), ['0xa', '0xb', '0xc']);
});

test('prices come from all history, keyed by the symbol the page assigns', () => {
  // The vault list renames the token; an old priced event outside the window still sets the price.
  const r = buildRecent(data(
    [ev(1, { usdValue: null }), ev(100, { assets: 2, usdValue: 3 }), ev(200, { assets: 1, usdValue: 9 })],
    [{ address: '0xv1', name: 'Vault One', symbol: 'USDC.e', chain: 'base' }]), null, { minEvents: 1 });
  assert.deepStrictEqual(Object.keys(r.prices), ['USDC.e']);
  assert.strictEqual(r.prices['USDC.e'][1], 1.5);
});

test('an event whose vault the page does not know keeps its own symbol', () => {
  const r = buildRecent(data([ev(1, { vault: '0xgone', symbol: 'DAI', usdValue: 50, assets: 50 })]), null, { minEvents: 1 });
  assert.ok(r.prices.DAI);
});

test("IPOR's list above $1K counts as known, as on the page", () => {
  const ipor = { vaults: [{ address: '0xother', tvl: 5000, token: 'WETH', name: 'Other' }] };
  const r = buildRecent(data([ev(1, { vault: '0xother', symbol: 'ETH', assets: 1, usdValue: 2000 })]), ipor, { minEvents: 1 });
  assert.deepStrictEqual(Object.keys(r.prices), ['WETH']);
});

test('lists every vault and chain that has ever had an event, with every stored name', () => {
  const r = buildRecent(data([ev(1), ev(400, { vaultName: 'Vault One (old name)' }),
    ev(500, { vault: '0xv2', vaultName: 'Two', chain: undefined })]), null, { windowDays: 35, minEvents: 1 });
  assert.deepStrictEqual(r.eventVaults['0xv1'], ['Vault One', 'Vault One (old name)']);
  assert.deepStrictEqual(r.eventVaults['0xv2'], ['Two']);
  assert.deepStrictEqual(r.eventChains, ['base', 'ethereum']);   // no chain stored = Ethereum
});

test('only the newest events keep their hash in the main file; every hash is in the second, in order', () => {
  const evs = [ev(5, { tx: '0xe' }), ev(1, { tx: '0xa' }), ev(3, { tx: '0xc' }), ev(2, { tx: '0xb' }), ev(4, { tx: '0xd' })];
  const r = buildRecent(data(evs), null, { minEvents: 1, txInline: 2 });
  assert.deepStrictEqual(r.events.map(e => e.tx), [undefined, '0xa', undefined, '0xb', undefined]);
  assert.deepStrictEqual(r.tx, ['0xe', '0xa', '0xc', '0xb', '0xd']);
  assert.strictEqual(r.txSplit, true);
});

test('a same-transaction deposit and withdrawal on one vault is tagged atomic here; the other untagged events false', () => {
  const r = buildRecent(data([
    ev(1, { tx: '0x1', type: 'deposit' }), ev(1, { tx: '0x1', type: 'withdraw' }),            // round trip
    ev(2, { tx: '0x2', type: 'deposit' }), ev(2, { tx: '0x2', type: 'withdraw', vault: '0xv2' }), // two vaults: not one
    ev(3, { tx: '0x3', type: 'withdraw', synthetic: true, syntheticReason: 'keeper' }),           // the collector's tag stays
    ev(3, { tx: '0x3', type: 'deposit' }),
  ]), null, { minEvents: 1 });
  assert.deepStrictEqual(r.events.map(e => [e.synthetic, e.syntheticReason]),
    [[true, 'atomic'], [true, 'atomic'], [false, undefined], [false, undefined], [true, 'keeper'], [false, undefined]]);
});

test("the page's own fallback tagger, run without hashes, tags exactly as it did with them", () => {
  // Lifted from index.html, so the two cannot drift apart unnoticed.
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const src = html.match(/function reclassifySyntheticFallback\(events, vaultsByAddr\) \{[\s\S]*?\n    \}\n/);
  assert.ok(src, 'reclassifySyntheticFallback not found in index.html');
  const reclassify = new Function(src[0] + '; return reclassifySyntheticFallback;')();
  const vaults = { '0xv1': { tvl: 1000 }, '0xv2': { tvl: 1e6 } };
  const fixture = () => [
    ev(1, { tx: '0x1', type: 'deposit' }), ev(1, { tx: '0x1', type: 'withdraw' }),
    ev(2, { tx: '0x2', type: 'deposit', usdValue: 5000 }),                  // over 3x its vault's TVL
    ev(3, { tx: '0x3', type: 'deposit', vault: '0xv2' }), ev(4, { tx: '0x4', type: 'withdraw', vault: '0xv2' }),
    ev(5, { tx: '0x5', type: 'deposit', synthetic: true, syntheticReason: 'keeper' }),
  ];
  const before = fixture();
  reclassify(before, vaults);
  const after = buildRecent(data(fixture()), null, { minEvents: 1, txInline: 1 }).events;
  reclassify(after, vaults);
  assert.deepStrictEqual(after.map(e => [!!e.synthetic, e.syntheticReason]), before.map(e => [!!e.synthetic, e.syntheticReason]));
  assert.ok(after.filter(e => !e.tx).length >= 4, 'the hashes really were gone');
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
