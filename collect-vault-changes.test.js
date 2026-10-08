#!/usr/bin/env node
'use strict';
// Tests for collect-vault-changes.js on a fake node: a vault, its access
// manager, a fee manager found through the role it is granted, fuses, a
// supply cap, read from its deployment, then again with something new.
// Run: node collect-vault-changes.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./collect-vault-changes.js');
const { topic, selector } = require('./keccak.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); process.exitCode = 1; }
}

const word = (v) => (typeof v === 'string' && v.startsWith('0x') ? v.slice(2).padStart(64, '0') : BigInt(v).toString(16).padStart(64, '0'));
const pad = (v) => '0x' + word(v);
const VAULT = '0x31744e44d6af88225c1dbefbe5df8308faea641b';
const ACCESS = '0xaaaa00000000000000000000000000000000aaaa';
const FEES = '0xfee0000000000000000000000000000000000fee';
const ORACLE = '0x0c1e00000000000000000000000000000000c1e0';
const FUSE = '0xf05e000000000000000000000000000000000001';
const ATOMIST = '0xa70000000000000000000000000000000000a700';
const FACTORY = '0xfac0000000000000000000000000000000000fac';
const T = (sig) => topic(sig);
const log = (address, block, index, sig, topics, data, tx) => ({ address, blockNumber: '0x' + block.toString(16), logIndex: '0x' + index.toString(16),
  transactionHash: tx || '0x' + block.toString(16).padStart(4, '0') + index.toString(16).padStart(60, '0'), topics: [T(sig), ...topics], data: '0x' + (data || '') });

function fakeChain(logs, { head = 1000, refuseAbove = Infinity, maxTopics = Infinity } = {}) {
  const calls = { getLogs: 0, refused: 0 };
  const connect = () => async (method, params) => {
    if (method === 'eth_blockNumber') return '0x' + (head + 3).toString(16);
    if (method === 'eth_call') {
      const [{ to, data }] = params, sel = data.slice(0, 10);
      if (to === VAULT && sel === selector('getAccessManagerAddress()')) return pad(ACCESS);
      if (to === VAULT && sel === selector('getPriceOracleMiddleware()')) return pad(ORACLE);
      if (to === VAULT && sel === selector('getRewardsClaimManagerAddress()')) return pad(0);
      if (to === VAULT && sel === selector('asset()')) return pad('0xb200000000000000000000c2e324d24d7eecd1fb');
      if (sel === selector('decimals()')) return pad(18);
      if (to === VAULT && sel === selector('convertToAssets(uint256)')) return pad(BigInt('0x' + data.slice(10)) / 100n);
      if (to === FUSE && sel === selector('MARKET_ID()')) return pad(1);
      return null;
    }
    if (method === 'eth_getLogs') {
      const [{ address, topics, fromBlock, toBlock }] = params;
      const from = parseInt(fromBlock, 16), to = parseInt(toBlock, 16);
      calls.getLogs++;
      if (to - from + 1 > refuseAbove) { calls.refused++; throw new Error('range too large'); }
      if (topics[0].length > maxTopics) { calls.refused++; throw new Error('HTTP 400'); }
      const want = new Set([].concat(address)), ev = new Set(topics[0]);
      return logs.filter(l => want.has(l.address) && ev.has(l.topics[0]) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
    }
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x' + (1_790_000_000 + parseInt(params[0], 16) * 2).toString(16) };
    if (method === 'eth_getTransactionByHash') return { from: parseInt(params[0].slice(2, 6), 16) === 100 ? FACTORY : ATOMIST, to: VAULT };
    throw new Error('unexpected ' + method);
  };
  return { connect, calls };
}

const at100 = [
  log(ACCESS, 100, 1, 'RoleGranted(uint64,address,uint32,uint48,bool)', [pad(100), pad(ATOMIST)], word(0) + word(0) + word(1)),
  log(ACCESS, 100, 2, 'RoleGranted(uint64,address,uint32,uint48,bool)', [pad(400), pad(FEES)], word(0) + word(0) + word(1)),
  log(ACCESS, 100, 3, 'TargetFunctionRoleUpdated(address,bytes4,uint64)', [pad(VAULT), pad(BigInt('0xffffffffffffffff'))], selector('deposit(uint256,address)').slice(2).padEnd(64, '0')),
  log(VAULT, 100, 4, 'FuseAdded(address)', [], word(FUSE)),
  log(VAULT, 100, 5, 'MarketSubstratesGranted(uint256,bytes32[])', [], word(1) + word(64) + word(2) + word('0x01') + word('0x02')),
];
const later = [
  log(FEES, 200, 1, 'PerformanceFeeUpdated(uint256,address[],uint256[])', [], word(1000) + word(96) + word(160) + word(1) + word(ATOMIST) + word(1) + word(500)),
  log(VAULT, 300, 1, 'TotalSupplyCapChanged(uint256)', [], word(10n ** 24n)),
  log(VAULT, 300, 2, 'MarketLimitUpdated(uint256,uint256)', [], word(1) + word(5n * 10n ** 17n)),
];
const ipor = { vaults: [{ address: VAULT, name: 'Apple Carry Trade', chainId: 8453, tvl: 47000 }] };
const deployments = { deployments: { [VAULT]: { chain: 'base', block: 100 } } };

(async () => {
  console.log('\ndecoding');

  await test('every event this file reads has a topic, and the ones with arrays and tuples decode', () => {
    assert.ok(C.EVENTS.length >= 40);
    const d = C.decodeLog(at100[4]);
    assert.deepStrictEqual(d, { event: 'MarketSubstratesGranted', args: { marketId: '1', substrates: ['0x' + word('0x01'), '0x' + word('0x02')] } });
    const f = C.decodeLog(later[0]);
    assert.strictEqual(f.event, 'PerformanceFeeUpdated');
    assert.deepStrictEqual(f.args, { totalFee: '1000', recipients: [ATOMIST], fees: ['500'] });
    const r = C.decodeLog(at100[2]);
    assert.strictEqual(r.args.selector, selector('deposit(uint256,address)'));
    assert.strictEqual(r.args.roleId, '18446744073709551615');
  });

  console.log('\na vault, read from its deployment');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-changes-'));
  const files = { out: path.join(dir, 'vault-changes.json'), ipor: path.join(dir, 'ipor.json'), deployments: path.join(dir, 'deps.json') };
  fs.writeFileSync(files.ipor, JSON.stringify(ipor)); fs.writeFileSync(files.deployments, JSON.stringify(deployments));
  const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

  const chain1 = fakeChain([...at100, ...later], { head: 1000 });
  await quiet(() => C.main({ ...files, connect: chain1.connect, now: Date.parse('2026-10-07T12:00:00Z') }));
  const s1 = JSON.parse(fs.readFileSync(files.out, 'utf8')).vaults[VAULT];

  await test('the vault, its access manager and oracle found; the fee manager learnt from its role and read from the start', () => {
    assert.deepStrictEqual(Object.fromEntries(Object.entries(s1.contracts).map(([a, c]) => [a, c.kind])),
      { [VAULT]: 'vault', [ACCESS]: 'access', [ORACLE]: 'oracle', [FEES]: 'fee' });
    assert.ok(Object.values(s1.contracts).every(c => c.scanned === 1000));
    assert.deepStrictEqual(s1.changes.map(c => c.event), ['RoleGranted', 'RoleGranted', 'TargetFunctionRoleUpdated', 'FuseAdded',
      'MarketSubstratesGranted', 'PerformanceFeeUpdated', 'TotalSupplyCapChanged', 'MarketLimitUpdated']);
  });

  await test('each change has its time, who sent it and to what', () => {
    assert.ok(s1.changes.every(c => c.ts > 1_790_000_000 && c.from && c.to));
    assert.strictEqual(s1.changes[0].from, FACTORY);
    assert.strictEqual(s1.changes[6].from, ATOMIST);
  });

  await test('a supply cap in the vault\'s asset at its block; a fuse named by its market', () => {
    assert.strictEqual(s1.changes[6].args.capInAssets, String(10n ** 22n));
    assert.deepStrictEqual(s1.fuses, { [FUSE]: 1 });
    assert.strictEqual(s1.deployBlock, 100);
    assert.strictEqual(s1.assetDecimals, 18);
  });

  await test('the next run reads only what is new, and keeps what it had', async () => {
    const more = log(VAULT, 1100, 1, 'FuseRemoved(address)', [], word(FUSE));
    const chain2 = fakeChain([...at100, ...later, more], { head: 1200 });
    await quiet(() => C.main({ ...files, connect: chain2.connect }));
    const s2 = JSON.parse(fs.readFileSync(files.out, 'utf8')).vaults[VAULT];
    assert.strictEqual(s2.changes.length, 9);
    assert.strictEqual(s2.changes[8].event, 'FuseRemoved');
    assert.ok(Object.values(s2.contracts).every(c => c.scanned === 1200));
    assert.ok(chain2.calls.getLogs <= 2, 'getLogs ' + chain2.calls.getLogs);
  });

  await test('a node that refuses wide ranges: the span narrows and every change is still found', async () => {
    fs.unlinkSync(files.out);
    const far = log(VAULT, 40_000, 1, 'FuseRemoved(address)', [], word(FUSE));
    const chain3 = fakeChain([...at100, ...later, far], { head: 50_000, refuseAbove: 20_000 });
    await quiet(() => C.main({ ...files, connect: chain3.connect }));
    const s3 = JSON.parse(fs.readFileSync(files.out, 'utf8')).vaults[VAULT];
    assert.ok(chain3.calls.refused >= 1, 'refused ' + chain3.calls.refused);
    assert.strictEqual(s3.changes.length, 9);
    assert.ok(Object.values(s3.contracts).every(c => c.scanned === 50_000));
  });

  await test('a node that caps the topics a call may name: the events are asked for in groups, every change still found', async () => {
    fs.unlinkSync(files.out);
    const chain4 = fakeChain([...at100, ...later], { head: 1000, maxTopics: 12 });
    await quiet(() => C.main({ ...files, connect: chain4.connect }));
    const s4 = JSON.parse(fs.readFileSync(files.out, 'utf8')).vaults[VAULT];
    assert.ok(chain4.calls.refused >= 1, 'refused ' + chain4.calls.refused);
    assert.strictEqual(s4.changes.length, 8);
    assert.ok(Object.values(s4.contracts).every(c => c.scanned === 1000));
    assert.strictEqual(s4.complete, true);
  });

  await test('a vault not yet read to the head says so', async () => {
    const s = JSON.parse(fs.readFileSync(files.out, 'utf8'));
    s.vaults[VAULT].complete = false;
    const { buildAdmin } = require('./tools/build-explorer.js');
    assert.strictEqual(buildAdmin(s.vaults[VAULT]).complete, false);
    assert.strictEqual(buildAdmin({ ...s.vaults[VAULT], complete: true }).complete, true);
  });

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
})();
