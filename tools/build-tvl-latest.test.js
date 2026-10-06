#!/usr/bin/env node
'use strict';
// Tests for the latest-TVL file. Run: node tools/build-tvl-latest.test.js

const assert = require('assert');
const { buildLatest } = require('./build-tvl-latest.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

console.log('\nlatest TVL');

test("each vault's last sane snapshot, keyed lower-case", () => {
  const out = buildLatest({ updatedAt: 'T', vaults: {
    '0xAbC': { snapshots: [{ tvlUsd: 1 }, { tvlUsd: 2 }] },
    '0xdef': { snapshots: [{ tvlUsd: 5 }, { tvlUsd: 4.9e12 }, { tvlUsd: null }] },   // a decimals error, then nothing
    '0x123': { snapshots: [{ tvlUsd: -3 }] },
    '0x456': { snapshots: [] },
  } });
  assert.deepStrictEqual(out, { updatedAt: 'T', vaults: { '0xabc': 2, '0xdef': 5 } });
});

test('an empty or missing file gives no vaults', () => {
  assert.deepStrictEqual(buildLatest(null).vaults, {});
  assert.deepStrictEqual(buildLatest({}).vaults, {});
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
