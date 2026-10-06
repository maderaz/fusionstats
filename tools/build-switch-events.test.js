#!/usr/bin/env node
'use strict';
// Tests for the Switchers events file. Run: node tools/build-switch-events.test.js

const assert = require('assert');
const { buildSwitchEvents: build, unpackSwitchEvents } = require('./build-switch-events.js');
const buildSwitchEvents = (f) => { const o = build(f); return Object.assign({}, o.events, { tx: o.tx }); };

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const ev = (o) => Object.assign({ type: 'deposit', vault: '0xa', owner: '0xw1', usdValue: 100, timestamp: 1000, assets: 100, symbol: 'USDC', chain: 'base', tx: '0xt' }, o);

console.log('\nswitch events');

test('keeps a wallet that deposited and withdrew in two vaults, all of its events', () => {
  const out = buildSwitchEvents({ updatedAt: 'T', events: [
    ev({ type: 'withdraw', vault: '0xa', timestamp: 1, tx: '0x1' }),
    ev({ vault: '0xb', timestamp: 2, tx: '0x2' }),
    ev({ vault: '0xb', timestamp: 3, tx: '0x3' }),
  ] });
  assert.strictEqual(out.updatedAt, 'T');
  assert.deepStrictEqual(out.owners, ['0xw1']);
  assert.deepStrictEqual(out.tx.tx, ['0x1', '0x2', '0x3']);
  assert.strictEqual(out.tx.updatedAt, 'T');
});

test('drops wallets that cannot switch: one event, one vault, or one direction', () => {
  const out = buildSwitchEvents({ events: [
    ev({ owner: '0xone' }),                                                  // a single event
    ev({ owner: '0xsame', type: 'withdraw' }), ev({ owner: '0xsame' }),      // in and out of the same vault
    ev({ owner: '0xin' }), ev({ owner: '0xin', vault: '0xb' }),              // deposits only
  ] });
  assert.deepStrictEqual(out.owners, []);
  assert.deepStrictEqual(out.events, []);
});

test("skips what the page skips: synthetic, no owner, no USD value, no time", () => {
  const out = buildSwitchEvents({ events: [
    ev({ type: 'withdraw', tx: 'w' }), ev({ vault: '0xb', tx: 'd' }),
    ev({ vault: '0xb', synthetic: true, tx: 's' }), ev({ vault: '0xb', usdValue: 0, tx: 'z' }),
    ev({ vault: '0xb', usdValue: null, tx: 'n' }), ev({ vault: '0xb', timestamp: 0, tx: 't' }),
  ] });
  assert.deepStrictEqual(out.tx.tx, ['w', 'd']);
});

test('every vault is listed, named and placed by its first event, synthetic or not', () => {
  const out = buildSwitchEvents({ events: [
    ev({ vault: '0xc', vaultName: undefined, chain: undefined, synthetic: true }),
    ev({ vault: '0xa', vaultName: 'A', chain: 'base' }),
    ev({ vault: '0xc', vaultName: 'C later', chain: 'ethereum' }),
  ] });
  assert.deepStrictEqual(out.vaults, [['0xc', null, null], ['0xa', 'A', 'base']]);
});

test('unpacks to the events the page read, owners lower-cased', () => {
  const src = { events: [
    ev({ type: 'withdraw', owner: '0xW1', vault: '0xa', timestamp: 5, usdValue: 99.5, assets: 99.4, symbol: null, chain: null, tx: '0x9' }),
    ev({ owner: '0xw1', vault: '0xb', timestamp: 6 }),
  ] };
  const o = build(src);
  const back = unpackSwitchEvents(o.events, o.tx);
  assert.deepStrictEqual(back[0], { vault: '0xa', owner: '0xw1', type: 'withdraw', timestamp: 5, usdValue: 99.5, assets: 99.4, symbol: null, chain: null, tx: '0x9' });
  assert.strictEqual(back[1].type, 'deposit');
});

test('hashes from another build are not attached', () => {
  const o = build({ updatedAt: 'A', events: [ev({ type: 'withdraw' }), ev({ vault: '0xb' })] });
  assert.strictEqual(unpackSwitchEvents(o.events, { updatedAt: 'B', tx: o.tx.tx })[0].tx, undefined);
  assert.strictEqual(unpackSwitchEvents(o.events, null)[0].tx, undefined);
  assert.strictEqual(unpackSwitchEvents(o.events, o.tx)[0].tx, '0xt');
});

test('an empty or missing file gives nothing', () => {
  assert.deepStrictEqual(build(null), { events: { updatedAt: null, vaults: [], owners: [], events: [] }, tx: { updatedAt: null, tx: [] } });
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
