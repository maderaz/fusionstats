#!/usr/bin/env node
'use strict';
// Tests for the coverage audit and the health check that runs it.
//
// Each case is a shape found in the real data on 2026-10-03, reduced to the
// smallest fixture that shows it. Run: node tools/audit-activity.test.js

const assert = require('assert');
const { audit, SHARE_SCALE } = require('./audit-activity.js');
const { evaluate } = require('./check-collection-health.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const V = '0xaaaa';
const vault = { address: V, name: 'Test Vault', chain: 'ethereum', tvl: 1e6 };
// A deposit of `units` normalised shares at `block`, stored the way the collector stores them.
const dep = (block, units) => ({ vault: V, type: 'deposit', block, shares: units * SHARE_SCALE, timestamp: block });
const wd = (block, units) => ({ vault: V, type: 'withdraw', block, shares: units * SHARE_SCALE, timestamp: block });
// A snapshot whose chain-read supply is `supply` at share price `sp` and $1 per asset.
const snap = (block, supply, sp = 1) => ({ block, timestamp: block, sharePrice: sp, assets: supply * sp, tvlUsd: supply * sp });
const one = (events, snaps) => audit({ events, snapshots: { [V]: snaps }, vaults: [vault], lastBlock: {} })[0];

console.log('\naudit');

test('a vault whose events explain its supply is clean', () => {
  const r = one([dep(10, 1000), dep(20, 500), wd(30, 200)],
                [snap(15, 1000), snap(25, 1500), snap(35, 1300)]);
  assert.strictEqual(r.missing, null);
  assert.ok(!r.missedWhileScanning && !r.missingHistory);
});

// Bitcoin Dollar USDC: reconciled to the dollar through May, then deposits
// stopped arriving in the events while the snapshots kept seeing them.
test('deposits lost while collecting are reported, with when it stopped agreeing', () => {
  const r = one([dep(10, 1000)],
                [snap(15, 1000), snap(25, 1000), snap(35, 1600)]);
  assert.ok(r.missedWhileScanning);
  assert.strictEqual(r.missing, 'deposits');
  assert.strictEqual(Math.round(r.coverageGapUsd), 600);
  assert.strictEqual(r.lastReconciledAt, 25);
  assert.strictEqual(r.divergedBy, 35);
});

test('lost withdrawals are reported as withdrawals', () => {
  const r = one([dep(10, 1000)], [snap(15, 1000), snap(25, 400)]);
  assert.ok(r.missedWhileScanning);
  assert.strictEqual(r.missing, 'withdrawals');
});

// rETH Liquity LP Carry: $11M deposited before the collector first saw it.
// That is history to backfill, not something lost while it was watching.
test('a gap already there at the first event is history, not a collector fault', () => {
  const r = one([dep(100, 10)],
                [snap(50, 5000), snap(110, 5010), snap(200, 5010)]);
  assert.ok(r.missingHistory, 'history');
  assert.ok(!r.missedWhileScanning, 'not missed while scanning');
  assert.strictEqual(Math.round(r.historyGapUsd), 5000);
});

test('a vault with no events at all is all history', () => {
  const r = one([], [snap(50, 800), snap(60, 800)]);
  assert.ok(r.missingHistory);
  assert.ok(!r.missedWhileScanning);
});

// IPOR USDC Lending Optimizer Base: snapshots flip between share price 1.09
// and 0.0109 — the same price, un-normalised. Read as-is that is a 100x
// supply jump and tens of millions of phantom deposits.
test('a share price recorded un-normalised is not read as a 100x supply jump', () => {
  // The flipped snapshot is the baseline, as it was in the real vault: there
  // it inflated the history gap by $39M and set every later comparison off.
  const r = one([dep(10, 1000)],
                [{ block: 15, timestamp: 15, sharePrice: 0.0105, assets: 1050, tvlUsd: 1050 },
                 snap(25, 1000, 1.05), snap(35, 1000, 1.06)]);
  assert.strictEqual(r.missing, null, JSON.stringify(r));
});

// A vault that shrank 20x accrued its fee shares while it was large; judged
// against what is left, its own old fees read as missing deposits.
test('fee drift is judged against the size the vault has been, not what is left', () => {
  const r = one([dep(10, 100000), wd(30, 95000)],
                [snap(15, 100000), snap(25, 101000), snap(35, 6000)]);
  assert.ok(!r.missedWhileScanning, JSON.stringify(r));
});

console.log('\nhealth check');

const health = (status, lagHours) => ({ status, lagHours, head: 1, cursor: 1, lagBlocks: 1, checkedAt: 'x' });

test('a stalled chain holding real money fails the run', () => {
  const rows = evaluate({ ethereum: health('stalled', 520) }, { ethereum: 36_500_000 });
  assert.ok(rows[0].failing);
});

test('an unreachable chain holding real money fails the run', () => {
  const rows = evaluate({ ethereum: health('unreachable', null) }, { ethereum: 50_000 });
  assert.ok(rows[0].failing);
});

test('a chain with only dust on it is reported but never fails the run', () => {
  const rows = evaluate({ plasma: health('unreachable', null) }, { plasma: 120 });
  assert.ok(!rows[0].failing);
});

test('catching up for a while is fine; catching up for days is not', () => {
  assert.ok(!evaluate({ base: health('behind', 9) }, { base: 4e7 })[0].failing);
  assert.ok(evaluate({ base: health('behind', 40) }, { base: 4e7 })[0].failing);
});

test('a healthy chain never fails the run', () => {
  assert.ok(!evaluate({ base: health('ok', 0.2) }, { base: 4e7 })[0].failing);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
