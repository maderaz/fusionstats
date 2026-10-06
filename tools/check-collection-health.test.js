#!/usr/bin/env node
'use strict';
// Tests for the health check's verdicts. Run: node tools/check-collection-health.test.js

const assert = require('assert');
const { evaluate } = require('./check-collection-health.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const NOW = Date.parse('2026-10-06T13:36:47Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3.6e6).toISOString();
const run = (verdict, tvl = 42_278_201) => evaluate({ base: { checkedAt: iso(0.01), ...verdict } }, { base: tvl }, NOW)[0];
const priv = (extra) => ({ name: 'Private ETH Lending Optimizer', tvl: 297_961, lagHours: 100.9, moved: true, stuck: false, ...extra });

console.log('\nhealth check');

// Oct 6, verbatim: one vault back from 8 days below the floor, catching up.
test('a vault catching up since this run does not fail the chain, however far back it is', () => {
  const r = run({ status: 'behind', lagHours: 100.9, behindSince: iso(0.01), laggards: [priv()] });
  assert.strictEqual(r.failing, false);
});

test('behind for longer than a day fails: catching up for too long', () => {
  assert.strictEqual(run({ status: 'behind', lagHours: 8, behindSince: iso(30), laggards: [priv({ lagHours: 8 })] }).failing, true);
  assert.strictEqual(run({ status: 'behind', lagHours: 8, behindSince: iso(20), laggards: [priv({ lagHours: 8 })] }).failing, false);
});

test('a vault holding money that this run asked about and could not move fails at once', () => {
  const r = run({ status: 'behind', lagHours: 48, behindSince: iso(0.01), laggards: [priv({ moved: false, stuck: true })] });
  assert.strictEqual(r.failing, true);
  assert.strictEqual(r.stuck.length, 1);
});

test('stuck dust waits for the day like any other catch-up', () => {
  const dust = { name: 'Dust', tvl: 738, lagHours: 48, moved: false, stuck: true };
  assert.strictEqual(run({ status: 'behind', lagHours: 48, behindSince: iso(2), laggards: [dust] }).failing, false);
  assert.strictEqual(run({ status: 'behind', lagHours: 48, behindSince: iso(25), laggards: [dust] }).failing, true);
});

test('stalled and unreachable still fail at once', () => {
  assert.strictEqual(run({ status: 'stalled', lagHours: 48, behindSince: iso(0.01) }).failing, true);
  assert.strictEqual(run({ status: 'unreachable', lagHours: null }).failing, true);
});

test('a verdict without behindSince (an older collector) is judged by its lag, as before', () => {
  assert.strictEqual(run({ status: 'behind', lagHours: 100.9 }).failing, true);
  assert.strictEqual(run({ status: 'behind', lagHours: 10 }).failing, false);
});

test('a chain below the TVL floor never fails', () => {
  assert.strictEqual(run({ status: 'stalled', lagHours: 500 }, 900).failing, false);
});

test('no verdict from this run still fails', () => {
  const r = evaluate({ base: { status: 'ok', checkedAt: iso(5) } }, { base: 42e6 }, NOW)[0];
  assert.strictEqual(r.status, 'unreported');
  assert.strictEqual(r.failing, true);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
