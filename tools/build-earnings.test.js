#!/usr/bin/env node
'use strict';
// Tests for the Finances pages' file. Run: node tools/build-earnings.test.js

const assert = require('assert');
const TvlSeries = require('../tvl-series.js');
const { buildEarnings } = require('./build-earnings.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg || ''} ${a} ≠ ${b}`);

const D = TvlSeries.MIN_VALID_DAY + 2000;
// One snapshot a day: [day offset, tvlUsd, sharePrice].
const vault = (rows, extra) => Object.assign({ chain: 'base', symbol: 'USDC', snapshots: rows.map(([k, tvl, sp]) => ({ day: D + k, timestamp: (D + k) * 86400 + 3600, tvlUsd: tvl, sharePrice: sp })) }, extra);
// 10% performance fee of which the DAO takes 2; 1% management of which 0.3.
const TERMS = { perf: 10, mgmt: 1, daoPerf: 2, daoMgmt: 0.3 };
const run = (vaults, terms) => buildEarnings({ vaults }, { vaults: terms });

console.log('\nEarnings');

test('the management fee accrues every day on the day\'s TVL, split between the DAO and the curator', () => {
  const e = run({ '0xa': vault([[0, 365000, 1], [1, 365000, 1], [2, 365000, 1]]) }, { '0xa': TERMS });
  assert.strictEqual(e.minDay, D);
  // $365K × 0.3% / 365 = $3 a day to the DAO, × 0.7% / 365 = $7 to the curator.
  assert.deepStrictEqual(e.dao, [3, 3, 3]);
  assert.deepStrictEqual(e.curator, [7, 7, 7]);
});

test('the performance fee on a rise to a new high: gross = (rise + management) / (1 - fee)', () => {
  const e = run({ '0xa': vault([[0, 1e6, 1], [1, 1e6, 1.001]]) }, { '0xa': Object.assign({}, TERMS, { mgmt: 0, daoMgmt: 0 }) });
  // 0.1% net is 0.1111% gross; the DAO's 2% of that on $1M is $22.22, the curator's 8% $88.89.
  near(e.dao[1], 1e6 * (0.001 / 0.9) * 0.02);
  near(e.curator[1], 1e6 * (0.001 / 0.9) * 0.08);
});

test('a recovery after a fall is not new profit: only the rise above the high so far counts', () => {
  const e = run({ '0xa': vault([[0, 1e6, 1.00], [1, 1e6, 0.99], [2, 1e6, 1.005]]) }, { '0xa': Object.assign({}, TERMS, { mgmt: 0, daoMgmt: 0 }) });
  assert.strictEqual(e.dao[1], 0);
  near(e.dao[2], 1e6 * ((1.005 - 1.0) / 0.99 / 0.9) * 0.02);
});

test('no performance fee across a gap of more than three days, nor on a move a yield vault does not make', () => {
  const terms = { '0xa': Object.assign({}, TERMS, { mgmt: 0, daoMgmt: 0 }), '0xb': Object.assign({}, TERMS, { mgmt: 0, daoMgmt: 0 }) };
  const e = run({ '0xa': vault([[0, 1e6, 1], [5, 1e6, 1.01]]), '0xb': vault([[0, 1e6, 1], [1, 1e6, 1.2], [2, 1e6, 0.009]]) }, terms);
  assert.ok(e.dao.every(v => v === 0), e.dao.join(','));
});

test('a vault paying the DAO\'s treasury in full leaves its curator nothing', () => {
  const e = run({ '0xa': vault([[0, 365000, 1], [1, 365000, 1]]) }, { '0xa': { perf: 10, mgmt: 1, daoPerf: 10, daoMgmt: 1, daoVia: 'treasury' } });
  assert.deepStrictEqual(e.dao, [10, 10]);
  assert.deepStrictEqual(e.curator, [0, 0]);
});

test('a vault without fee terms is left out and counted, with its peak; its days do not reach the series', () => {
  const e = run({ '0xa': vault([[0, 365000, 1], [1, 365000, 1]]), '0xb': vault([[0, 2e6, 1], [3, 2e6, 1]], { symbol: 'DAI', chain: 'ethereum' }) }, { '0xa': TERMS });
  assert.strictEqual(e.vaults.counted, 1);
  assert.strictEqual(e.vaults.without, 1);
  assert.deepStrictEqual(e.vaults.withoutPeak, [{ addr: '0xb', symbol: 'DAI', chain: 'ethereum', peak: 2000000 }]);
  assert.strictEqual(e.dao.length, 2);
});

test('a closed vault stops earning at its own last snapshot', () => {
  const e = run({ '0xa': vault([[0, 365000, 1], [1, 365000, 1]]), '0xb': vault([[0, 365000, 1], [3, 365000, 1]]) }, { '0xa': TERMS, '0xb': TERMS });
  assert.deepStrictEqual(e.dao, [6, 6, 3, 3]);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
