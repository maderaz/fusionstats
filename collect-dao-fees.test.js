#!/usr/bin/env node
'use strict';
// Tests for collect-dao-fees.js against a node that answers as Fusion's fee
// contracts do. Run: node collect-dao-fees.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./collect-dao-fees.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const w = (x) => BigInt(x).toString(16).padStart(64, '0');
const V = { apple: '0x31744e44d6af88225c1dbefbe5df8308faea641b', tezos: '0xde09e16675b667b6abb6d7910d6e009f630bcb96', old: '0x00000000000000000000000000000000000000c1', ethNew: '0x00000000000000000000000000000000000000c5', legacy: '0x00000000000000000000000000000000000000c6', stranger: '0x00000000000000000000000000000000000000c7', down: '0x00000000000000000000000000000000000000c2',
  small: '0x00000000000000000000000000000000000000c3', gone: '0x00000000000000000000000000000000000000c8' };
const ACC = { perf: '0x00000000000000000000000000000000000000a1', mgmt: '0x00000000000000000000000000000000000000a2', oldAcc: '0x00000000000000000000000000000000000000a3' };
const MGR = { apple: '0x00000000000000000000000000000000000000b1', tezos: '0x00000000000000000000000000000000000000b2', ethNew: '0x00000000000000000000000000000000000000b3' };
// The DAO's fee recipient, and an older treasury Safe with the same signers.
const DAO = '0x00000000000000000000000000000000000000d1', TREASURY = '0x00000000000000000000000000000000000000d2', STRANGER = '0x00000000000000000000000000000000000000d3';
const SIGNERS = ['0x00000000000000000000000000000000000000e2', '0x00000000000000000000000000000000000000e1'];
const SAFES = { [DAO]: [4, SIGNERS], [TREASURY]: [4, SIGNERS.slice().reverse()], [STRANGER]: [2, SIGNERS] };
// vault → [perf account, perf bps, mgmt bps, fee manager, dao perf bps, dao mgmt bps]
const CHAIN = {
  [V.apple]: [ACC.perf, 700, 40, MGR.apple, 200, 30],
  [V.tezos]: ['0x00000000000000000000000000000000000000a4', 200, 30, MGR.tezos, 200, 30],
  [V.old]: [ACC.oldAcc, 1000, 100, null],
  [V.ethNew]: ['0x00000000000000000000000000000000000000a5', 1000, 50, MGR.ethNew, 200, 30],
  [V.legacy]: [TREASURY, 1000, 100, null],
  [V.stranger]: [STRANGER, 1000, 100, null],
  [V.small]: ['0x00000000000000000000000000000000000000a6', 1000, 50, MGR.ethNew, 200, 30],
  [V.gone]: ['0x00000000000000000000000000000000000000a7', 500, 25, MGR.apple, 200, 30],
};
const accounts = {}; const managers = {};
for (const [v, c] of Object.entries(CHAIN)) { if (c[3]) { accounts[c[0]] = c[3]; managers[c[3]] = [c[4], c[5]]; } }
global.fetch = async (url, init) => {
  const { id, params: [{ to, data }] } = JSON.parse(init.body);
  const sel = data.slice(0, 10);
  const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id, result }) });
  if (to === V.down) return { ok: false, status: 503 };
  const c = CHAIN[to];
  if (c && sel === F.SEL.perfData) return ok('0x' + w(c[0]) + w(c[1]));
  if (c && sel === F.SEL.mgmtData) return ok('0x' + w(c[3] ? ACC.mgmt : c[0]) + w(c[2]) + w(1791000000));
  if (accounts[to] && sel === F.SEL.feeManager) return ok('0x' + w(accounts[to]));
  if (to === ACC.oldAcc) return ok('0x');   // a plain account: no code
  if (managers[to] && sel === F.SEL.daoPerf) return ok('0x' + w(managers[to][0]));
  if (managers[to] && sel === F.SEL.daoMgmt) return ok('0x' + w(managers[to][1]));
  if (managers[to] && sel === F.SEL.daoRecipient) return ok('0x' + w(DAO));
  if (SAFES[to] && sel === F.SEL.threshold) return ok('0x' + w(SAFES[to][0]));
  if (SAFES[to] && sel === F.SEL.owners) return ok('0x' + w(32) + w(SAFES[to][1].length) + SAFES[to][1].map(w).join(''));
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } }) };
};

const IPOR = { vaults: [
  { chainId: 8453, address: V.apple, name: 'Apple Carry Trade', tvl: 45503 },
  { chainId: 8453, address: V.tezos, name: 'Nvidia Carry Trade Tezos', tvl: 1018790 },
  { chainId: 1, address: V.old, name: 'Old vault', tvl: 20000 },
  { chainId: 1, address: V.down, name: 'Unreachable', tvl: 50000 },
  { chainId: 1, address: V.ethNew, name: 'New Ethereum vault', tvl: 30000 },
  { chainId: 1, address: V.legacy, name: 'IPOR legacy vault', tvl: 260000 },
  { chainId: 1, address: V.stranger, name: 'Another vault', tvl: 40000 },
  { chainId: 1, address: '0x00000000000000000000000000000000000000c3', name: 'Small', tvl: 900 },
  { chainId: 747474, address: '0x00000000000000000000000000000000000000c4', name: 'Katana', tvl: 12288 },
] };

(async () => {
  console.log('\ndao fees');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dao-fees-'));
  const ipor = path.join(dir, 'ipor.json'), out = path.join(dir, 'out.json'), snapshots = path.join(dir, 'snaps.json');
  fs.writeFileSync(ipor, JSON.stringify(IPOR));
  // History: "Small" held $50K once; a vault IPOR no longer lists held $80K
  // on Base; another unlisted one never passed the floor.
  const D = 20000;
  fs.writeFileSync(snapshots, JSON.stringify({ vaults: {
    [V.small]: { chain: 'ethereum', symbol: 'USDC', snapshots: [{ day: D, tvlUsd: 50000 }, { day: D + 5, tvlUsd: 900 }] },
    [V.gone]: { chain: 'base', symbol: 'WETH', snapshots: [{ day: D, tvlUsd: 80000 }, { day: D + 9, tvlUsd: 0 }] },
    '0x00000000000000000000000000000000000000c9': { chain: 'base', symbol: 'DAI', snapshots: [{ day: D, tvlUsd: 4000 }] },
  } }));
  const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
  await F.main({ out, ipor, snapshots });
  console.log = log;
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  await test("a vault's own rates and the DAO's share of each, as percents", () => {
    assert.deepStrictEqual([j.vaults[V.apple].perf, j.vaults[V.apple].daoPerf, j.vaults[V.apple].mgmt, j.vaults[V.apple].daoMgmt], [7, 2, 0.4, 0.3]);
    assert.strictEqual(j.vaults[V.apple].feeManager, MGR.apple);
  });
  await test('a vault whose fee account is no FeeManager keeps its rates and no DAO share', () => {
    assert.deepStrictEqual([j.vaults[V.old].perf, j.vaults[V.old].daoPerf, j.vaults[V.old].daoMgmt], [10, null, null]);
  });
  await test('vaults above $10K now or ever, listed or not, on chains with endpoints; an unreachable one is warned and left out', () => {
    assert.deepStrictEqual(Object.keys(j.vaults).sort(), [V.apple, V.tezos, V.old, V.ethNew, V.legacy, V.stranger, V.small, V.gone].sort());
    assert.ok(lines.some(l => /::warning::dao-fees: Unreachable/.test(l)));
    assert.deepStrictEqual([j.vaults[V.gone].chainId, j.vaults[V.gone].name, j.vaults[V.gone].daoPerf], [8453, 'WETH vault, base', 2]);
  });
  await test('an older vault paying a Safe signed by the DAO’s own signers counts in full', () => {
    assert.deepStrictEqual([j.vaults[V.legacy].daoPerf, j.vaults[V.legacy].daoMgmt, j.vaults[V.legacy].daoVia], [10, 1, 'treasury']);
  });
  await test('one paying a Safe with other signers or threshold stays out', () => {
    assert.deepStrictEqual([j.vaults[V.stranger].daoPerf, j.vaults[V.stranger].daoVia], [null, undefined]);
  });
  await test('a vault unread this run keeps its last reading', async () => {
    const prev = { readAt: 'x', vaults: { [V.down]: { chainId: 1, name: 'Unreachable', perf: 5, daoPerf: 2, mgmt: 0.5, daoMgmt: 0.3 } } };
    fs.writeFileSync(out, JSON.stringify(prev));
    console.log = () => {};
    await F.main({ out, ipor, snapshots });
    console.log = log;
    assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).vaults[V.down].daoPerf, 2);
  });
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
