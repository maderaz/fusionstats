#!/usr/bin/env node
'use strict';
// Tests for the TVL page's daily file. Run: node tools/build-tvl-daily.test.js

const assert = require('assert');
const TvlSeries = require('../tvl-series.js');
const { buildDaily } = require('./build-tvl-daily.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const D = TvlSeries.MIN_VALID_DAY + 2000;           // some day well after 2021
const iso = (day) => new Date(day * 86400000 + 3600000).toISOString();
const ipor = { updatedAt: iso(D + 3), vaults: [
  { address: '0xA', chain: 'base', tvl: 999 },
  { address: '0xB', chain: 'ethereum', tvl: 50 },     // no snapshots yet: held flat
  { address: '0xC', chain: 'base', tvl: 0 },
] };
const snapshots = { updatedAt: iso(D + 2), vaults: {
  '0xa': { snapshots: [{ day: D, tvlUsd: 100 }, { day: D + 2, tvlUsd: 200 }, { day: D + 1, tvlUsd: 5e12 }] },   // a decimals error mid-way
  '0xc': { snapshots: [{ day: 0, tvlUsd: 7 }] },                                                        // day 0: never resolved
} };

console.log('\nTVL daily');

test('forward-fills each vault to the right edge, per network, dropping impossible points', () => {
  const s = TvlSeries.unpack(buildDaily(ipor, snapshots));
  assert.deepStrictEqual(s.perChain.base.map(p => [p.day - D, p.tvl]), [[0, 100], [1, 100], [2, 200], [3, 200]]);
  assert.deepStrictEqual(s.currentByChain, { base: 200, ethereum: 50 });
});

test('a vault not snapshotted yet is held flat at its API value across the window', () => {
  const s = TvlSeries.unpack(buildDaily(ipor, snapshots));
  assert.deepStrictEqual(s.perChain.ethereum.map(p => p.tvl), [50, 50, 50, 50]);
});

test('pack and unpack give back exactly what buildSeries made', () => {
  const series = TvlSeries.buildSeries({ vaults: ipor.vaults, snapshots: snapshots.vaults, anchorTs: Date.parse(ipor.updatedAt) / 1000 });
  assert.deepStrictEqual(TvlSeries.unpack(TvlSeries.pack(series)), series);
});

test('carries the date of each source', () => {
  const f = buildDaily(ipor, snapshots);
  assert.strictEqual(f.updatedAt, ipor.updatedAt);
  assert.strictEqual(f.snapshotsUpdatedAt, snapshots.updatedAt);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
