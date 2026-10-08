#!/usr/bin/env node
'use strict';
// Tests for build-flows-daily.js. Run: node tools/build-flows-daily.test.js
const assert = require('assert');
const { buildFlowsDaily } = require('./build-flows-daily.js');
let passed = 0;
const test = (name, fn) => { try { fn(); console.log('  PASS  ' + name); passed++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; } };
const D = 86400;

console.log('\nflows daily');
test('sums deposits and withdrawals by UTC day, every day from the first to the last', () => {
  const out = buildFlowsDaily({ updatedAt: 'x', events: [
    { type: 'deposit', timestamp: 10 * D + 5, usdValue: 100.4 },
    { type: 'deposit', timestamp: 10 * D + 9, usdValue: 50 },
    { type: 'withdraw', timestamp: 10 * D + 99, usdValue: 30 },
    { type: 'withdraw', timestamp: 12 * D, usdValue: 7 },
  ] });
  assert.deepStrictEqual(out, { updatedAt: 'x', firstDay: 10, lastDay: 12, inflow: [150, 0, 0], outflow: [30, 0, 7] });
});
test('leaves out synthetic flows, events without a USD value, and other kinds', () => {
  const out = buildFlowsDaily({ events: [
    { type: 'deposit', timestamp: 3 * D, usdValue: 10 },
    { type: 'deposit', timestamp: 3 * D, usdValue: 999, synthetic: true },
    { type: 'withdraw', timestamp: 3 * D, usdValue: null },
    { type: 'transfer', timestamp: 3 * D, usdValue: 5 },
  ] });
  assert.deepStrictEqual([out.inflow, out.outflow], [[10], [0]]);
});
test('no events: empty series', () => {
  assert.deepStrictEqual(buildFlowsDaily({ events: [] }).inflow, []);
});
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
