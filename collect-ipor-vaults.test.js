#!/usr/bin/env node
'use strict';
// What IPOR's vault list doesn't say, filled in from our own readings.
// Run: node collect-ipor-vaults.test.js

const assert = require('assert');
const { reconcile, onchainLatest, FLOOR } = require('./collect-ipor-vaults.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const NOW = Date.parse('2026-10-07T12:00:00Z');
const day = 86400;
const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb', C = '0x00000000000000000000000000000000000000cc';
const list = (...vs) => vs.map(([address, tvl]) => ({ address, tvl, name: address.slice(-2) }));

console.log('\nThe TVL of a vault IPOR shows empty');
test('IPOR under the floor, ours at or above it and recent: ours, marked, IPOR\'s kept', () => {
  const [v] = reconcile(list([A, 0]), { onchain: { [A]: { usd: 287511, at: NOW / 1000 - 2 * day } }, now: NOW });
  assert.deepStrictEqual([v.tvl, v.tvlSource, v.tvlIpor], [287511, 'onchain', 0]);
});
test('IPOR at or above the floor: IPOR\'s, whatever ours says', () => {
  const [v] = reconcile(list([A, FLOOR]), { onchain: { [A]: { usd: 9e6, at: NOW / 1000 } }, now: NOW });
  assert.deepStrictEqual([v.tvl, v.tvlSource], [FLOOR, undefined]);
});
test('ours under the floor: IPOR\'s; ours older than 30 days: IPOR\'s, and the vault read again', () => {
  const [a, b] = reconcile(list([A, 3], [B, 3]), { onchain: { [A]: { usd: 49, at: NOW / 1000 }, [B]: { usd: 5000, at: NOW / 1000 - 31 * day } }, now: NOW });
  assert.deepStrictEqual([a.tvl, a.recheck, b.tvl, b.recheck], [3, undefined, 3, true]);
});
test('our readings: each vault\'s last sane snapshot, with its time', () => {
  const o = onchainLatest({ vaults: { [A.toUpperCase().replace('0X', '0x')]: { snapshots: [
    { tvlUsd: 10, timestamp: 1 }, { tvlUsd: 20, timestamp: 2 }, { tvlUsd: 5e9, timestamp: 3 }, { tvlUsd: null, timestamp: 4 }] } } });
  assert.deepStrictEqual(o, { [A]: { usd: 20, at: 2 } });
  assert.deepStrictEqual(onchainLatest(null), {});
});

console.log('\nNew to the list');
test('a vault the last list didn\'t have is stamped now; an old one carries its stamp', () => {
  const prev = { vaults: [{ address: A, firstSeen: '2026-10-01T00:00:00.000Z' }] };
  const [a, b] = reconcile(list([A, 0], [B, 0]), { prev, now: NOW });
  assert.strictEqual(a.firstSeen, '2026-10-01T00:00:00.000Z');
  assert.strictEqual(b.firstSeen, new Date(NOW).toISOString());
});
test('no stamps without a last list, or when either list came without IPOR\'s API', () => {
  assert.strictEqual(reconcile(list([B, 0]), { now: NOW })[0].firstSeen, undefined);
  assert.strictEqual(reconcile(list([B, 0]), { prev: { vaults: [] }, fromApi: false, now: NOW })[0].firstSeen, undefined);
});
test('a vault already on the last list, unstamped, stays unstamped', () => {
  assert.strictEqual(reconcile(list([C, 0]), { prev: { vaults: [{ address: C }] }, now: NOW })[0].firstSeen, undefined);
});
test('dozens new at once is a change of source: none stamped', () => {
  const many = Array.from({ length: 25 }, (_, i) => ['0x' + String(i).padStart(40, '0'), 0]);
  const out = reconcile(list(...many), { prev: { vaults: [] }, now: NOW });
  assert.ok(out.every(v => v.firstSeen === undefined));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
