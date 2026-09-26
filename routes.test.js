#!/usr/bin/env node
'use strict';
// Tests for routes.js — where a deposit came from.
//
// Each case is a mistake this attribution has actually made, on real vaults,
// written as the smallest fixture that reproduces it. Run: node routes.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {};
// routes.js is a browser script that sets window.FusionRoutes.
new Function(fs.readFileSync(path.join(__dirname, 'routes.js'), 'utf8'))();
const { create, DIRECT } = window.FusionRoutes;

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const USER = '0x1111111111111111111111111111111111111111';
const USER2 = '0x2222222222222222222222222222222222222222';
const HARVEST = '0x7e0a0900a2d5d1678ce671d266fb43179bbeee39';
const ZYFI = '0xaffd3c3cd06cf499deddf78b26868018a93f2c31';
const ZAP = '0xecd2bf892e2ee99cf2cbbc81f6877132e25e34db';
const ACCT = '0x5b1628f8f1a015ff8b86808d1089e056989dfa4b';
const MYSTERY = '0x3b0749bf6dd7721583323f9e196d8e85cbe529f5';

const identity = {
  [HARVEST]: { protocol: 'Harvest', via: 'deployer', isContract: true },
  [ZYFI]: { protocol: 'Zyfi', via: 'source', isContract: true, contractNames: ['AdapterProxy'] },
  [ZAP]: { protocol: 'IPOR', via: 'source', isContract: true, contractNames: ['ReferralPlasmaVault'] },
  [ACCT]: { protocol: null, isContract: true, creatorAddress: USER2, interactsWith: ['LI.FI'] },
  [MYSTERY]: { protocol: null, isContract: true, verified: false, reason: 'source not verified on Basescan' },
  _meta: { minSelfDeposits: 5 },
};

let t = 1000;
const dep = (sender, owner, usd) => ({ type: 'deposit', sender, owner, usdValue: usd, timestamp: t++ });
const wd = (sender, owner, usd) => ({ type: 'withdraw', sender, owner, usdValue: usd, timestamp: t++ });
const label = (R, route) => R.routeInfo(route).protocol;
const netOf = (R, F, name) => (F.list.find(r => label(R, r.route) === name) || { net: 0 }).net;

console.log('\ndeposits');

test('a wallet depositing for itself is Direct', () => {
  const R = create({ identity, events: [] });
  assert.strictEqual(R.depositRoute(dep(USER, USER, 100)), DIRECT);
});

test('a contract depositing for someone else is that contract\'s protocol', () => {
  const R = create({ identity, events: [] });
  assert.strictEqual(label(R, R.depositRoute(dep(ZYFI, USER, 100))), 'Zyfi');
});

// Harvest was filed under Direct on the stock vaults: its strategy deposits
// under its own address, so sender == owner looked like a person.
test('a protocol depositing for ITSELF is that protocol, not Direct', () => {
  const R = create({ identity, events: [] });
  assert.strictEqual(label(R, R.depositRoute(dep(HARVEST, HARVEST, 100))), 'Harvest');
});

test('IPOR\'s own zap reads as the front door, not a third party', () => {
  const R = create({ identity, events: [] });
  assert.strictEqual(label(R, R.depositRoute(dep(ZAP, USER, 100))), 'Direct Zap');
});

test('an unverified contract deployed by the wallet it deposits for is a smart account', () => {
  const events = [dep(ACCT, USER2, 5), dep(ACCT, ACCT, 1)];
  const R = create({ identity, events });
  const info = R.routeInfo(R.depositRoute(events[0]));
  assert.strictEqual(info.kind, 'account');
  assert.ok(/LI\.FI/.test(info.detail), 'says how funds arrived');
});

test('an unidentified contract keeps its address and its reason', () => {
  const R = create({ identity, events: [] });
  const info = R.routeInfo(R.depositRoute(dep(MYSTERY, USER, 90)));
  assert.strictEqual(info.kind, 'unknown');
  assert.ok(info.protocol.startsWith('0x3b07'));
  assert.ok(/not verified/.test(info.detail));
});

console.log('\nexits and net');

// Rebalancers deposit and withdraw in the same transaction. Their gross is
// churn; net is what they added.
test('a rebalancer\'s churn nets out: huge gross, small net', () => {
  const ev = [dep(HARVEST, HARVEST, 1000), wd(HARVEST, HARVEST, 950), dep(HARVEST, HARVEST, 1000), wd(HARVEST, HARVEST, 1000)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: ev.filter(e => e.type === 'deposit'), withdrawals: ev.filter(e => e.type !== 'deposit') });
  const h = F.list[0];
  assert.strictEqual(h.in, 2000);
  assert.strictEqual(h.net, 50);
  assert.ok(h.selfOwned, 'custodial: its "wallets" are its own contracts');
});

// A wallet that came in through Zyfi and left directly is Zyfi money
// leaving; charging the exit to Direct overstates Zyfi and understates Direct.
test('an exit is charged to the route its owner came in through', () => {
  const ev = [dep(ZYFI, USER, 100), wd(USER, USER, 40)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: [ev[0]], withdrawals: [ev[1]] });
  assert.strictEqual(netOf(R, F, 'Zyfi'), 60);
  assert.strictEqual(netOf(R, F, 'Direct'), 0);
});

test('a mixed owner\'s exit is split across the routes they used', () => {
  const ev = [dep(ZYFI, USER, 300), dep(USER, USER, 100), wd(USER, USER, 200)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: ev.slice(0, 2), withdrawals: [ev[2]] });
  assert.strictEqual(netOf(R, F, 'Zyfi'), 150);   // 300 − 200 × 3/4
  assert.strictEqual(netOf(R, F, 'Direct'), 50);  // 100 − 200 × 1/4
});

// Zyfi's adapter deposits FOR users but withdraws AS itself, after pulling
// their shares. Its exits have an owner with no deposit here at all; filing
// them as unattributed overstated Zyfi's net by $850K over thirty days.
test('a protocol withdrawing as itself is charged to that protocol', () => {
  const ev = [dep(ZYFI, USER, 1000), wd(ZYFI, ZYFI, 700)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: [ev[0]], withdrawals: [ev[1]] });
  assert.strictEqual(netOf(R, F, 'Zyfi'), 300);
  assert.strictEqual(F.unattributedOut, 0);
});

test('an exit pushed by a protocol for a holder with no deposits is that protocol', () => {
  const ev = [wd(ZYFI, USER2, 50)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: [], withdrawals: ev });
  assert.strictEqual(netOf(R, F, 'Zyfi'), -50);
  assert.strictEqual(F.unattributedOut, 0);
});

test('a holder with no deposits and no protocol behind the exit is unattributed', () => {
  const ev = [wd(USER2, USER2, 50)];
  const R = create({ identity, events: ev });
  const F = R.flows({ deposits: [], withdrawals: ev });
  assert.strictEqual(F.unattributedOut, 50);
  assert.strictEqual(F.net, -50);
});

// The owner mix is read from the whole history: an exit this week can belong
// to a deposit made months before the window opened.
test('a windowed exit is charged using the owner\'s history outside the window', () => {
  const old = dep(ZYFI, USER, 100), recent = wd(USER, USER, 30);
  const R = create({ identity, events: [old, recent] });
  const F = R.flows({ deposits: [], withdrawals: [recent], mixDeposits: [old] });
  assert.strictEqual(netOf(R, F, 'Zyfi'), -30);
  assert.strictEqual(F.unattributedOut, 0);
});

test('in − out = net, and every dollar lands somewhere', () => {
  const ev = [dep(USER, USER, 500), dep(ZYFI, USER2, 200), dep(HARVEST, HARVEST, 900),
              wd(HARVEST, HARVEST, 850), wd(ZYFI, ZYFI, 120), wd(USER, USER, 60), wd(MYSTERY, MYSTERY, 5)];
  const R = create({ identity, events: ev });
  const deps = ev.filter(e => e.type === 'deposit'), wds = ev.filter(e => e.type !== 'deposit');
  const F = R.flows({ deposits: deps, withdrawals: wds });
  const rawIn = deps.reduce((a, e) => a + e.usdValue, 0), rawOut = wds.reduce((a, e) => a + e.usdValue, 0);
  assert.strictEqual(F.in, rawIn);
  assert.ok(Math.abs(F.out - rawOut) < 1e-9);
  assert.ok(Math.abs(F.net - (rawIn - rawOut)) < 1e-9);
});

test('the time series sums to the same net as the table', () => {
  const ev = [dep(USER, USER, 500), dep(ZYFI, USER2, 200), wd(ZYFI, ZYFI, 120), wd(USER, USER, 60)];
  const R = create({ identity, events: ev });
  const deps = ev.filter(e => e.type === 'deposit'), wds = ev.filter(e => e.type !== 'deposit');
  const F = R.flows({ deposits: deps, withdrawals: wds });
  const S = R.netSeries({ deposits: deps, withdrawals: wds, bucketOf: ts => Math.floor(ts / 2) * 2 });
  const sum = Object.values(S.net).flat().reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - F.net) < 1e-9);
});

console.log('\ntop depositors');

test('a wave is one wallet: the largest net depositor comes first, with its route', () => {
  const ev = [dep(USER, USER, 840000), dep(ZYFI, USER2, 600), wd(USER2, USER2, 100)];
  const R = create({ identity, events: ev });
  const T = R.topNet({ deposits: ev.slice(0, 2), withdrawals: [ev[2]], limit: 2 });
  assert.strictEqual(T[0].wallet, USER);
  assert.strictEqual(T[0].net, 840000);
  assert.strictEqual(label(R, T[1].route), 'Zyfi');
  assert.strictEqual(T[1].net, 500);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
