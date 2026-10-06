#!/usr/bin/env node
'use strict';
// Tests for the Dust Tracker file. Run: node tools/build-dust-events.test.js

const assert = require('assert');
const { buildDustEvents, MAX_USD, ZYFAI_ROUTERS } = require('./build-dust-events.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const ev = (o) => Object.assign({ type: 'deposit', vault: '0xa', owner: '0xw1', sender: '0xw1', usdValue: 50, timestamp: 1000, assets: 50, symbol: 'USDC', chain: 'base', tx: '0xt' }, o);

console.log('\ndust events');

test('keeps the deposits with a USD value under the largest threshold, in file order, hashes aside', () => {
  const o = buildDustEvents({ updatedAt: 'T', events: [
    ev({ tx: 'a', usdValue: 19999.99 }), ev({ tx: 'b', usdValue: MAX_USD }), ev({ tx: 'c', usdValue: 0 }),
    ev({ tx: 'd', usdValue: null }), ev({ tx: 'e', type: 'withdraw' }), ev({ tx: 'f', synthetic: true }), ev({ tx: 'g', usdValue: 0.5 }),
  ] });
  assert.deepStrictEqual(o.tx.tx, ['a', 'g']);
  assert.strictEqual(o.events.events.length, 2);
  assert.strictEqual(o.tx.updatedAt, 'T');
});

test('counts every deposit with a value as "all", and each vault\'s deposits of any value', () => {
  const o = buildDustEvents({ events: [
    ev({ usdValue: 50000 }), ev({ usdValue: 0 }), ev({ vault: '0xb', usdValue: 5 }), ev({ synthetic: true }), ev({ type: 'withdraw' }),
  ] });
  assert.strictEqual(o.events.totalDeposits, 2);
  assert.deepStrictEqual(o.events.vaults, [['0xa', null, 'base', 2], ['0xb', null, 'base', 1]]);
});

test("marks ZyfAI's deposits by sender or owner: its routers, and its wallet list", () => {
  const o = buildDustEvents({ events: [
    ev({ sender: ZYFAI_ROUTERS[0].toUpperCase().replace('0X', '0x') }),
    ev({ owner: '0xListed', sender: '0xother' }),
    ev({}),
  ] }, { addresses: ['0xLISTED'] });
  assert.deepStrictEqual(o.events.events.map(r => r[2]), [1, 1, 0]);
  assert.deepStrictEqual(buildDustEvents({ events: [ev({ owner: '0xlisted' })] }, null).events.events[0][2], 0);
});

test('owners lower-cased and shared; a deposit without one keeps null', () => {
  const o = buildDustEvents({ events: [ev({ owner: '0xAB' }), ev({ owner: '0xab' }), ev({ owner: null })] });
  assert.deepStrictEqual(o.events.owners, ['0xab']);
  assert.deepStrictEqual(o.events.events.map(r => r[1]), [0, 0, null]);
});

test('an empty or missing file gives nothing', () => {
  const o = buildDustEvents(null);
  assert.deepStrictEqual(o.events, { updatedAt: null, maxUsd: MAX_USD, totalDeposits: 0, vaults: [], owners: [], events: [] });
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
