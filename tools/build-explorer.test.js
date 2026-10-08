#!/usr/bin/env node
'use strict';
// Tests for the Explorer's per-vault files. Run: node tools/build-explorer.test.js

const assert = require('assert');
const TvlSeries = require('../tvl-series.js');
const { buildExplorer, buildActions, buildParams, fileOf, dense, shares } = require('./build-explorer.js');
const RebalanceFlows = require('../rebalance-flows.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const D = TvlSeries.MIN_VALID_DAY + 2000;
const A = '0x00000000000000000000000000000000000000aa', B = '0x00000000000000000000000000000000000000bb';
const snap = (rows) => ({ chain: 'base', symbol: 'WETH', snapshots: rows.map(([k, tvl, sp]) => ({ day: D + k, timestamp: (D + k) * 86400 + 3600, tvlUsd: tvl, sharePrice: sp })) });
const files = buildExplorer({
  snapshots: { vaults: { [A]: snap([[0, 1000, 1.0], [1, 1100, 1.001], [3, 1300, 1.003]]) } },
  holders: { vaults: [{ address: A, chain: 'base', decimals: 18, totalHolders: 7, series: [{ day: D, holders: 5 }, { day: D + 2, holders: 7 }], topHolders: [{ rank: 1, address: B, balance: 12.3456 }] }] },
  holderState: { vaults: { [A]: { bal: { [B]: '0x' + (12345678n * 10n ** 12n).toString(16), '0x00000000000000000000000000000000000000cc': '0x' + (5n * 10n ** 18n).toString(16), '0x0000000000000000000000000000000000000000': '0x1' } } } },
  markets: { readAt: 'r', vaults: { [A]: { chain: 'base', totalAssets: 1, cap: 10, priceUsd: 1300, markets: [{ id: 1, name: 'Aave V3', netUsd: 1300 }] } } },
  history: { vaults: { [A]: { chain: 'base', markets: { 1: 'Aave V3' }, days: { [D + 3]: { 1: 1300 }, [D + 1]: { 1: 1100 } } } } },
  fees: { vaults: { [A]: { chainId: 8453, perf: 10, mgmt: 1, daoPerf: 2, daoMgmt: 0.3 } } },
  deployments: { deployments: { [A]: { chain: 'base', deployedAt: '2025-01-01T00:00:00.000Z' } } },
}, { now: 'now' });
const f = files[fileOf('base', A)];

console.log('\nExplorer files');
test('one file a vault, named by its network and address', () => {
  assert.deepStrictEqual(Object.keys(files), ['base-' + A + '.json']);
  assert.strictEqual(f.address, A);
  assert.strictEqual(f.builtAt, 'now');
});
test('TVL and share price a day from the first snapshot, a gap left empty', () => {
  assert.deepStrictEqual(f.days.tvl, { from: D, v: [1000, 1100, 1100, 1300] });   // the TVL page carries TVL forward
  assert.deepStrictEqual(f.days.sharePrice, { from: D, v: [1, 1.001, null, 1.003] });
});
test('holders a day, the total and the largest', () => {
  assert.deepStrictEqual(f.holders.days, { from: D, v: [5, null, 7] });
  assert.strictEqual(f.holders.total, 7);
  assert.deepStrictEqual(f.holders.top, [{ address: B, balance: 12.35 }]);
});
test('the markets now, the allocation a day in order, the fee terms and the deployment date', () => {
  assert.strictEqual(f.markets.cap, 10);
  assert.strictEqual(f.markets.markets[0].name, 'Aave V3');
  assert.deepStrictEqual(f.allocation.days, [[D + 1, { 1: 1100 }], [D + 3, { 1: 1300 }]]);
  assert.deepStrictEqual(f.fees, { perf: 10, mgmt: 1, daoPerf: 2, daoMgmt: 0.3, daoVia: null });
  assert.strictEqual(f.deployedAt, '2025-01-01T00:00:00.000Z');
});
test('every holder, largest first, in whole shares; the zero address left out', () => {
  assert.deepStrictEqual(f.holders.all, [[B, 12.34568], ['0x00000000000000000000000000000000000000cc', 5]]);
  assert.strictEqual(shares('0x' + (15n * 10n ** 17n).toString(16), 18), 1.5);
  assert.strictEqual(shares('nonsense', 18), null);
});
test('dense: an empty map is nothing', () => {
  assert.strictEqual(dense(new Map(), (v) => v), null);
});

console.log('\nCurator actions');
const scan = { vault: A.toUpperCase().replace('0X', '0x'), chain: 'Base', updatedAt: 'u', blockRange: { from: 9, to: 99 }, rebalances: [
  { tx: '0x01', block: 10, timestamp: 1000, flows: [
    { symbol: 'aBasUSDC', direction: 'out', usdValue: 500 }, { symbol: 'ecbETH-1', direction: 'in', usdValue: null }, { symbol: 'WETH', direction: 'in', usdValue: 9e9 }] },
  { tx: '0x02', block: 12, timestamp: 2000, flows: [{ symbol: 'cbETH', direction: 'out', usdValue: 300 }, { symbol: 'aBascbETH', direction: 'in', usdValue: 290 }] },
  { tx: '0x03', block: 13, timestamp: 3000, flows: [{ symbol: 'WETH', direction: 'out', usdValue: 50 }] },   // nothing a market: no action
  { tx: '0x04', block: 14, timestamp: 4000, flows: [{ symbol: 'aBasUSDC', direction: 'out', usdValue: 0.4 }] },   // dust: no action
] };
const acts = buildActions(scan);
test('each rebalance with a market\'s move, newest first, the moves by market or token and side', () => {
  assert.strictEqual(acts.address, A); assert.strictEqual(acts.chain, 'base'); assert.strictEqual(acts.count, 2);
  assert.deepStrictEqual(acts.actions.map(a => a[1]), ['0x02', '0x01']);
  const name = (m) => [acts.protocols[m[0]], m[1] ? 'out' : 'in', m[2]];
  assert.deepStrictEqual(acts.actions[0][3].map(name), [['cbETH', 'out', 300], ['Aave', 'in', 290]]);
  assert.strictEqual(acts.actions[0][2], 300);   // the larger side, counted once
});
test('an unpriced market token is valued at the other side; WETH alone is not a move', () => {
  const name = (m) => [acts.protocols[m[0]], m[1] ? 'out' : 'in', m[2]];
  assert.deepStrictEqual(acts.actions[1][3].map(name), [['Aave', 'out', 500], ['Euler', 'in', 500]]);
});
test('the newest kept, the count of all', () => {
  const two = buildActions(scan, { kept: 1 });
  assert.strictEqual(two.count, 2); assert.strictEqual(two.actions.length, 1);
  assert.strictEqual(buildActions(null), null);
});
test('classify: Euler V2 vault tokens, Aave receipts and debt, stables', () => {
  assert.strictEqual(RebalanceFlows.classify({ symbol: 'ecbETH-1' }).protocol, 'Euler');
  assert.strictEqual(RebalanceFlows.classify({ symbol: 'eUSDC-3' }).protocol, 'Euler');
  assert.strictEqual(RebalanceFlows.classify({ symbol: 'variableDebtBasWETH' }).protocol, 'Aave');
  assert.deepStrictEqual(RebalanceFlows.classify({ symbol: 'USDC' }), { protocol: 'Stable', kind: 'collateral' });
  assert.strictEqual(RebalanceFlows.classify({ symbol: 'eETH' }).protocol, 'LST');
});

test('parameters: the readings, and who holds each role now from the history, technical roles left out', () => {
  const AC = '0x00000000000000000000000000000000000000ac', WM = '0x00000000000000000000000000000000000000e1';
  const S = '0x00000000000000000000000000000000000005af', K = '0x000000000000000000000000000000000000000b';
  const grant = (roleId, account, block) => ({ block, index: 0, contract: AC, event: 'RoleGranted', args: { roleId, account } });
  const st = { complete: true, contracts: { [AC]: { kind: 'access' }, [WM]: { kind: 'withdraw' } }, changes: [
    grant('1', S, 1), grant('100', S, 1), grant('200', K, 1), grant('200', S, 2), grant('3', A, 1), grant('800', B, 1),
    { block: 3, index: 0, contract: AC, event: 'RoleRevoked', args: { roleId: '200', account: K } }] };
  const p = buildParams({ access: AC, oracle: B, feeManager: null, depositFee: 0.2, requestFee: 0.2, withdrawFee: 0.1, withdrawWindow: 86400, instantFuses: 0,
    permissions: [{ id: 7, key: 'ERC20_VAULT_BALANCE', name: 'Tokens held', fuses: [], subs: [{ a: A, sym: 'WETH' }, { raw: '0x' + 'ab'.repeat(32) }] }] },
    { cap: 6022.48, readAt: 'r' }, st);
  assert.deepStrictEqual(p.roles, [['Owner', [S]], ['Atomist', [S]], ['Alpha', [S]]]);
  assert.strictEqual(p.rolesComplete, true);
  assert.deepStrictEqual(p.contracts, { access: AC, withdraw: WM, oracle: B });
  assert.deepStrictEqual(p.permissions[0].subs, [[A, 'WETH'], ['0x' + 'ab'.repeat(32), null]]);
  assert.deepStrictEqual([p.cap, p.depositFee, p.withdrawWindow], [6022.48, 0.2, 86400]);
  assert.strictEqual(buildParams({ error: 'x' }, {}, null), null);
  // Not read from the chain: the withdraw manager's last changes say.
  const st2 = { contracts: { [WM]: { kind: 'withdraw' } }, changes: [
    { contract: WM, event: 'WithdrawWindowLengthUpdated', args: { withdrawWindowLength: '86400' } },
    { contract: WM, event: 'RequestFeeUpdated', args: { fee: '2000000000000000' } },
    { contract: WM, event: 'WithdrawFeeUpdated', args: { fee: '1000000000000000' } }] };
  const q = buildParams({ permissions: [] }, {}, st2);
  assert.deepStrictEqual([q.withdrawWindow, q.requestFee, q.withdrawFee, q.contracts.withdraw], [86400, 0.2, 0.1, WM]);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
