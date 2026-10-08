#!/usr/bin/env node
'use strict';
// Tests for describe-changes.js: a vault's governance changes as the Curator
// Action History words them. Run: node tools/describe-changes.test.js

const assert = require('assert');
const { describeVault, roleName, fnName, currentWithdraw } = require('./describe-changes.js');
const { buildAdmin, buildActivity } = require('./build-explorer.js');
const { selector } = require('../keccak.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const V = '0x31744e44d6af88225c1dbefbe5df8308faea641b', A = '0xaaaa00000000000000000000000000000000aaaa', F = '0xfee0000000000000000000000000000000000fee';
const FUSE = '0xf05e000000000000000000000000000000000001', FACTORY = '0xfac0000000000000000000000000000000000fac';
const SAFE = '0x5afe00000000000000000000000000000005afe0', SIGNER = '0x5190000000000000000000000000000000005190', ALPHA = '0xa1fa000000000000000000000000000000000a1f';
const PUBLIC = '18446744073709551615';
let i = 0;
const ch = (block, contract, event, args, ts, from, to, tx) => ({ block, index: i++, tx: tx || '0x' + block, contract, event, args, ts, from, to });
const vault = { deployBlock: 100, assetDecimals: 18, fuses: { [FUSE]: 14 },
  contracts: { [V]: { kind: 'vault' }, [A]: { kind: 'access' }, [F]: { kind: 'fee' } },
  changes: [
    ch(100, A, 'RoleGranted', { roleId: '100', account: SAFE, delay: '0' }, 1000, FACTORY, FACTORY, '0xd'),
    ch(100, A, 'RoleGranted', { roleId: '1', account: SAFE, delay: '0' }, 1000, FACTORY, FACTORY, '0xd'),
    ch(100, A, 'RoleGranted', { roleId: '200', account: ALPHA, delay: '86400' }, 1000, FACTORY, FACTORY, '0xd'),
    ch(100, A, 'TargetFunctionRoleUpdated', { target: V, selector: selector('deposit(uint256,address)'), roleId: PUBLIC }, 1000, FACTORY, FACTORY, '0xd'),
    ch(100, V, 'FuseAdded', { fuse: FUSE }, 1000, FACTORY, FACTORY, '0xd'),
    ch(300, V, 'TotalSupplyCapChanged', { newTotalSupplyCap: String(10n ** 24n), capInAssets: String(25n * 10n ** 20n) }, 5000, SIGNER, SAFE),
    ch(400, V, 'MarketLimitUpdated', { marketId: '14', newLimit: String(6n * 10n ** 17n) }, 6000, ALPHA, V),
    ch(500, F, 'PerformanceFeeUpdated', { totalFee: '1000', recipients: [SAFE, F], fees: ['700', '300'] }, 7000, SIGNER, SAFE),
    ch(600, A, 'RoleRevoked', { roleId: '200', account: ALPHA }, 8000, SIGNER, SAFE),
    ch(700, V, 'MarketLimitUpdated', { marketId: '14', newLimit: String(5n * 10n ** 17n) }, 9000, ALPHA, V),
  ] };
const rows = describeVault(vault, { deployedAt: 999, symbol: 'AAPLc' });

console.log('\ngovernance changes, worded');

test('newest first; the set-up made at deployment carries that moment and says so', () => {
  assert.deepStrictEqual(rows.map(r => r.t), [9000, 8000, 7000, 6000, 5000, 999, 999, 999]);
  assert.deepStrictEqual(rows.map(r => r.d), [0, 0, 0, 0, 0, 1, 1, 1]);
});

test('a transaction\'s changes of one kind are one row, counted', () => {
  const grants = rows.find(r => r.what === 'Roles granted');
  assert.strictEqual(grants.n, 3);
  assert.strictEqual(grants.detail, 'Atomist to 0x5afe…afe0; Owner to 0x5afe…afe0; Alpha to 0xa1fa…0a1f (1 day delay)');
  assert.strictEqual(grants.on, 'Access manager');
  assert.strictEqual(grants.role, 'Deployer');
});

test('what each says: a function by its name, a market by its name, a cap in the asset, a limit and fees in percent', () => {
  const by = (what) => rows.find(r => r.what === what);
  assert.strictEqual(by('Function access set').detail, 'deposit → Public');
  assert.strictEqual(by('Fuse added').detail, 'Morpho · 0xf05e…0001');
  assert.strictEqual(by('Supply cap set').detail, '2,500 AAPLc');
  assert.strictEqual(rows[3].detail, 'Morpho: 60% of the vault');
  assert.strictEqual(by('Performance fee split').detail, '10% in all, 2 recipients');
});

test('executed by: the Safe with the role, its signer via; a role held then, not now', () => {
  const cap = rows.find(r => r.what === 'Supply cap set');
  assert.deepStrictEqual([cap.by, cap.role, cap.also, cap.via], [SAFE, 'Atomist', ['Owner'], SIGNER]);
  const before = rows[3], after = rows[0];   // the same alpha, before and after its role was revoked
  assert.deepStrictEqual([before.by, before.role], [ALPHA, 'Alpha']);
  assert.deepStrictEqual([after.by, after.role], [ALPHA, '']);
});

test('roles and functions by name, the unknown ones as they are', () => {
  assert.strictEqual(roleName(100), 'Atomist');
  assert.strictEqual(roleName(PUBLIC), 'Public');
  assert.strictEqual(roleName(4242), 'Role 4242');
  assert.strictEqual(fnName(selector('execute((address,bytes)[])')), 'execute');
  assert.strictEqual(fnName('0x12345678'), '0x12345678');
});

test('the withdraw manager now: a replaced one is passed over', () => {
  const OLD = '0x8138000000000000000000000000000000004e10', NEW = '0xa901000000000000000000000000000000000077';
  const st = { contracts: { [OLD]: { kind: 'withdraw' }, [NEW]: { kind: 'withdraw' } }, changes: [
    { event: 'RoleGranted', args: { roleId: '6', account: OLD } },
    { event: 'RoleGranted', args: { roleId: '6', account: NEW } },
    { event: 'RoleRevoked', args: { roleId: '6', account: OLD } }] };
  assert.strictEqual(currentWithdraw(st), NEW);
  assert.strictEqual(currentWithdraw({ contracts: { [OLD]: { kind: 'withdraw' } }, changes: [] }), OLD);
});

console.log('\nthe Explorer\'s files');

test('admin: the rows, how many, when read', () => {
  const a = buildAdmin({ ...vault, readAt: '2026-10-07T12:00:00Z' }, { deployedAt: 999 });
  assert.strictEqual(a.count, rows.length);
  assert.strictEqual(a.readAt, '2026-10-07T12:00:00Z');
  assert.strictEqual(buildAdmin(null), null);
});

test('activity: each vault\'s real deposits and withdrawals, newest first, the newest kept', () => {
  const e = (vault, ts, type, extra = {}) => ({ vault, chain: 'base', type, timestamp: ts, block: ts, logIdx: 0, assets: 1.5, usdValue: 400.123, owner: '0xOwner', sender: '0xowner', tx: '0xt' + ts, symbol: 'AAPLc', ...extra });
  const out = buildActivity([e(V, 10, 'deposit'), e(V, 30, 'withdraw'), e(V, 20, 'deposit', { synthetic: true }), e(V, 40, 'deposit'), e('0xother', 5, 'deposit')], { kept: 2, updatedAt: 'now' });
  const mine = out['base-' + V + '.json'];
  assert.strictEqual(mine.count, 3);
  assert.deepStrictEqual(mine.rows, [[40, 1, 1.5, 400.12, '0xowner', '0xt40'], [30, 0, 1.5, 400.12, '0xowner', '0xt30']]);
  assert.strictEqual(mine.symbol, 'AAPLc');
  assert.ok(out['base-0xother.json']);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
