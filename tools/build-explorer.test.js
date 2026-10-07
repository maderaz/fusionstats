#!/usr/bin/env node
'use strict';
// Tests for the Explorer's per-vault files. Run: node tools/build-explorer.test.js

const assert = require('assert');
const TvlSeries = require('../tvl-series.js');
const { buildExplorer, fileOf, dense } = require('./build-explorer.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const D = TvlSeries.MIN_VALID_DAY + 2000;
const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb';
const snap = (rows) => ({ chain: 'base', symbol: 'WETH', snapshots: rows.map(([k, tvl, sp]) => ({ day: D + k, timestamp: (D + k) * 86400 + 3600, tvlUsd: tvl, sharePrice: sp })) });
const files = buildExplorer({
  snapshots: { vaults: { [A]: snap([[0, 1000, 1.0], [1, 1100, 1.001], [3, 1300, 1.003]]) } },
  holders: { vaults: [{ address: A, chain: 'base', totalHolders: 7, series: [{ day: D, holders: 5 }, { day: D + 2, holders: 7 }], topHolders: [{ rank: 1, address: B, balance: 12.3456 }] }] },
  markets: { readAt: 'r', vaults: { [A]: { chain: 'base', totalAssets: 1, cap: 10, priceUsd: 1300, markets: [{ id: 1, name: 'Aave V3', netUsd: 1300 }] } } },
  history: { vaults: { [A]: { chain: 'base', markets: { 1: 'Aave V3' }, days: { [D + 3]: { 1: 1300 }, [D + 1]: { 1: 1100 } } } } },
  fees: { vaults: { [A]: { chainId: 8453, perf: 10, mgmt: 1, daoPerf: 2, daoMgmt: 0.3 } } },
  deployments: { deployments: { [A]: { chain: 'base', deployedAt: '2025-01-01T00:00:00.000Z' } } },
}, { now: 'now' });
const f = files[fileOf('base', A)];

console.log('\nExplorer files');
test('one file a vault, named by its network and address', () => {
  assert.deepStrictEqual(Object.keys(files), ['base-' + A + '.json']);
  assert.strictEqual(f.address, A);
  assert.strictEqual(f.builtAt, 'now');
});
test('TVL and share price a day from the first snapshot, a gap left empty', () => {
  assert.deepStrictEqual(f.days.tvl, { from: D, v: [1000, 1100, 1100, 1300] });   // the TVL page carries TVL forward
  assert.deepStrictEqual(f.days.sharePrice, { from: D, v: [1, 1.001, null, 1.003] });
});
test('holders a day, the total and the largest', () => {
  assert.deepStrictEqual(f.holders.days, { from: D, v: [5, null, 7] });
  assert.strictEqual(f.holders.total, 7);
  assert.deepStrictEqual(f.holders.top, [{ address: B, balance: 12.35 }]);
});
test('the markets now, the allocation a day in order, the fee terms and the deployment date', () => {
  assert.strictEqual(f.markets.cap, 10);
  assert.strictEqual(f.markets.markets[0].name, 'Aave V3');
  assert.deepStrictEqual(f.allocation.days, [[D + 1, { 1: 1100 }], [D + 3, { 1: 1300 }]]);
  assert.deepStrictEqual(f.fees, { perf: 10, mgmt: 1, daoPerf: 2, daoMgmt: 0.3, daoVia: null });
  assert.strictEqual(f.deployedAt, '2025-01-01T00:00:00.000Z');
});
test('dense: an empty map is nothing', () => {
  assert.strictEqual(dense(new Map(), (v) => v), null);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
