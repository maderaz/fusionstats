#!/usr/bin/env node
'use strict';
// Tests for the Monitor's rows. Run: node tools/build-share-prices.test.js

const assert = require('assert');
const SharePrice = require('../share-price.js');
const { buildSharePrices } = require('./build-share-prices.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}
const DAY = 86400;
const snap = (day, sp, extra) => Object.assign({ day, timestamp: day * DAY + 3600, sharePrice: sp }, extra);

console.log('\nshare prices');

test('a window is the last N calendar days of the vault\'s own series', () => {
  const v = { '0xa': { symbol: 'USDC', chain: 'base', snapshots: [snap(100, 1.0), snap(105, 1.01), snap(110, 1.02), snap(111, 1.03)] } };
  const r7 = SharePrice.rows(v, 7)[0], rAll = SharePrice.rows(v, 0)[0];
  assert.deepStrictEqual(r7.vals, [1.01, 1.02, 1.03]);
  assert.strictEqual(rAll.winFirst, 1.0);
  assert.strictEqual(r7.name, 'USDC vault');
  assert.ok(Math.abs(r7.deltaPct - (1.03 / 1.01 - 1) * 100) < 1e-12);
});

test('off-scale points are dropped; all of them off-scale is a glitch, a jump an anomaly', () => {
  const v = {
    '0xa': { snapshots: [snap(1, 1.0), snap(2, 0.0101), snap(3, 1.01)] },
    '0xb': { snapshots: [snap(1, 1e12), snap(2, 2e12)] },
    '0xc': { snapshots: [snap(1, 1.0), snap(2, 4.0)] },
  };
  const [a, b, c] = SharePrice.rows(v, 0);
  assert.deepStrictEqual(a.vals, [1.0, 1.01]); assert.strictEqual(a.dataFlag, null);
  assert.strictEqual(b.dataFlag, 'glitch'); assert.strictEqual(b.deltaPct, null);
  assert.strictEqual(c.dataFlag, 'anomaly');
});

test('annualised only past half a day of data', () => {
  const v = { '0xa': { snapshots: [snap(1, 1.0, { timestamp: DAY }), snap(1, 1.001, { timestamp: DAY + 3600 })] } };
  assert.strictEqual(SharePrice.rows(v, 0)[0].apyPct, null);
});

test('packed rows keep every number exactly, and the last move', () => {
  const v = { '0xa': { symbol: 'WETH', chain: 'ethereum', snapshots: [snap(1, 1.000123456789), snap(2, 1.0003), snap(3, 1.0002)] } };
  const row = SharePrice.rows(v, 0)[0];
  const back = SharePrice.unpack(SharePrice.pack(row));
  for (const k of ['addr', 'symbol', 'chain', 'name', 'winFirst', 'latest', 'deltaPct', 'apyPct', 'dataFlag', 'firstTs', 'lastTs']) assert.strictEqual(back[k], row[k], k);
  assert.strictEqual(back.mom, -1);
  assert.deepStrictEqual(back.vals, [0, 1000, 434]);
});

test('a long sparkline keeps its shape: at most 120 heights, the spike, the last point', () => {
  const vals = Array.from({ length: 3000 }, (_, i) => 1 + i * 1e-6);
  vals[1234] = 1.5;
  const s = SharePrice.sparkShape(vals);
  assert.ok(s.length <= SharePrice.SPARK_MAX + 1, String(s.length));
  assert.ok(s.includes(1000), 'the spike');
  assert.strictEqual(s[s.length - 1], Math.round((vals[2999] - 1) / 0.5 * 1000));
});

test('four windows, built from the file; an empty file gives empty windows', () => {
  const out = buildSharePrices({ updatedAt: 'T', vaults: { '0xa': { snapshots: [snap(1, 1), snap(2, 1.1)] } } });
  assert.deepStrictEqual(Object.keys(out.windows).sort(), ['0', '30', '7', '90']);
  assert.strictEqual(out.updatedAt, 'T');
  assert.strictEqual(out.windows['7'].length, 1);
  assert.deepStrictEqual(buildSharePrices(null).windows['30'], []);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
