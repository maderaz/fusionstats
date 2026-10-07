#!/usr/bin/env node
'use strict';
// Tests for collect-stock-funding.js, on a fake node: the shapes the deep scan
// of the Jumper campaign found on Base. Run: node collect-stock-funding.test.js

const assert = require('assert');
const F = require('./collect-stock-funding.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const AAPL = '0xb200000000000000000000c2e324d24d7eecd1fb';
const VAULT = '0x31744e44d6af88225c1dbefbe5df8308faea641b', OTHER_VAULT = '0x01dbdb9748ecf71b1ffbb62f5cb41318531ba362';
const USER = '0x1111111111111111111111111111111111111111', PROXY = '0x744a28b0744a28b0744a28b0744a28b0744a28b0';
const POOL = '0x9999999999999999999999999999999999999999';
const pad = (a) => '0x' + a.replace(/^0x/, '').padStart(64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const str = (s) => { const b = Buffer.from(s, 'utf8').toString('hex'); return word(s.length) + b.padEnd(Math.ceil(b.length / 64) * 64 || 64, '0'); };
const DEC = 18;
const raw = (x) => '0x' + word(BigInt(Math.round(x * 1e6)) * 10n ** BigInt(DEC - 6));
// LiFiGenericSwapCompleted's data: two strings, three addresses, two amounts.
function swapData(integrator) {
  const s1 = str(integrator), s2 = str('');
  return '0x' + word(7 * 32) + word(7 * 32 + s1.length / 2) + word(USER) + word(0) + word(AAPL) + word(1) + word(1) + s1 + s2;
}
const transfer = (from, to, amount, tx, block, logIndex = 3) => ({ address: AAPL, topics: [F.TRANSFER, pad(from), pad(to)], data: raw(amount), transactionHash: tx, blockNumber: '0x' + block.toString(16), logIndex: '0x' + logIndex.toString(16) });

// A fake node: getLogs filtered as a node would, receipts by hash.
function node({ logs = [], receipts = {}, fail = new Set() } = {}) {
  const calls = [];
  const rpc = async (method, [p]) => {
    calls.push(method);
    if (method === 'eth_getLogs') {
      const from = parseInt(p.fromBlock, 16), to = parseInt(p.toBlock, 16), want = p.topics[2].map(t => t.toLowerCase());
      return logs.filter(l => l.address === p.address && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && want.includes(l.topics[2]));
    }
    if (method === 'eth_getTransactionReceipt') { if (fail.has(p)) throw new Error('timeout'); return receipts[p] || null; }
    throw new Error('unexpected ' + method);
  };
  rpc.calls = calls;
  return rpc;
}
const dep = (extra = {}) => ({ type: 'deposit', vault: VAULT, owner: USER, sender: USER, assets: 0.94056415, block: 1000, logIdx: 9, tx: '0xdeposit', ...extra });

(async () => {
  console.log('\nfunding of one deposit');

  await test('a swap through LI.FI on Jumper a minute before: lifi, and its integrator', async () => {
    const rpc = node({
      logs: [transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xswap', 970)],
      receipts: { '0xswap': { logs: [{ address: F.LIFI_DIAMOND, topics: [F.LIFI_SWAP, pad('0xab')], data: swapData('jumperrwa') }] } },
    });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'lifi', integrator: 'jumperrwa', tx: '0xswap', block: 970 });
  });

  await test('an arrival through LI.FI\'s Executor: a LI.FI bridge, no integrator on this chain', async () => {
    const EXECUTOR = '0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110';
    const rpc = node({
      logs: [transfer(EXECUTOR, USER, 0.94056415, '0xbridge', 990)],
      receipts: { '0xbridge': { logs: [{ address: EXECUTOR, topics: [F.LIFI_ARRIVED, pad('0xcd')], data: '0x' }] } },
    });
    assert.strictEqual((await F.fundingOf(rpc, dep(), AAPL, DEC)).via, 'lifi-bridge');
  });

  await test('the tokens of a withdrawal from a vault (a relay hop): vault, and which', async () => {
    const rpc = node({
      logs: [transfer(OTHER_VAULT, USER, 0.94056415, '0xexit', 995)],
      receipts: { '0xexit': { logs: [{ address: OTHER_VAULT, topics: [F.WITHDRAW, pad(POOL), pad(USER), pad(POOL)], data: '0x' }] } },
    });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'vault', from: OTHER_VAULT, tx: '0xexit', block: 995 });
  });

  await test('a deposit through the user\'s own proxy: the move into the proxy is passed over for the swap before it', async () => {
    const rpc = node({
      logs: [transfer(USER, PROXY, 0.94056415, '0xdeposit', 1000, 4), transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xswap2', 980)],
      receipts: {
        '0xdeposit': { logs: [] },
        '0xswap2': { logs: [{ address: F.LIFI_DIAMOND, topics: [F.LIFI_SWAP, pad('0xef')], data: swapData('jumper.exchange.earn') }] },
      },
    });
    const out = await F.fundingOf(rpc, dep({ sender: PROXY }), AAPL, DEC);
    assert.strictEqual(out.via, 'lifi'); assert.strictEqual(out.integrator, 'jumper.exchange.earn');
  });

  await test('the latest transfer of the same amount wins over an older or a different one', async () => {
    const rpc = node({
      logs: [transfer(POOL, USER, 5, '0xbig', 999), transfer(POOL, USER, 0.94056415, '0xold', 900), transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xnew', 960)],
      receipts: { '0xnew': { logs: [] }, '0xold': { logs: [] }, '0xbig': { logs: [] } },
    });
    assert.strictEqual((await F.fundingOf(rpc, dep(), AAPL, DEC)).tx, '0xnew');
  });

  await test('nothing came in within the hour: none', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 0.94056415, '0xlong-ago', 1000 - F.LOOKBACK - 5)] });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'none' });
  });

  await test('another exchange or wallet: other, with who sent it', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 0.94056415, '0xdex', 990)], receipts: { '0xdex': { logs: [] } } });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'other', from: POOL, tx: '0xdex', block: 990 });
  });

  console.log('\na run');

  const ipor = { vaults: [{ address: VAULT, chain: 'base', assetAddress: AAPL }, { address: '0xusdcvault', chain: 'base', assetAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }] };
  const activity = { events: [
    dep({ tx: '0xa', block: 1000 }), dep({ tx: '0xb', block: 2000 }), dep({ tx: '0xc', block: 3000 }),
    dep({ tx: '0xu', vault: '0xusdcvault', block: 4000 }),
    { type: 'withdraw', vault: VAULT, owner: USER, assets: 1, block: 3500, logIdx: 1, tx: '0xw' },
  ] };
  const decimals = { decimals: { [AAPL]: DEC } };
  const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

  await test('stock vaults\' deposits only, newest first, as many as the budget allows', async () => {
    const rpc = node();
    const state = await quiet(() => F.main({ rpc, max: 2, files: { ipor, activity, decimals, state: { deposits: {} } } }));
    assert.deepStrictEqual(Object.keys(state.deposits).sort(), ['0xb:9', '0xc:9']);
    assert.ok(Object.values(state.deposits).every(d => d.via === 'none'));
  });

  await test('what is read stays read; what failed is left for the next run', async () => {
    const OTHER = '0x2222222222222222222222222222222222222222';
    const act = { events: activity.events.map(e => (e.tx === '0xa' ? { ...e, owner: OTHER, sender: OTHER } : e)) };
    const rpc = node({ logs: [transfer(POOL, OTHER, 0.94056415, '0xslow', 990)], fail: new Set(['0xslow']) });
    const state = await quiet(() => F.main({ rpc, files: { ipor, activity: act, decimals, state: { deposits: { '0xc:9': { via: 'none' } } } } }));
    assert.deepStrictEqual(Object.keys(state.deposits).sort(), ['0xb:9', '0xc:9']);   // 0xa's receipt failed
    assert.ok(!rpc.calls.includes('eth_getLogs') || state.deposits['0xc:9'].via === 'none');
  });

  await test('an event\'s strings, read from its data', () => {
    assert.strictEqual(F.abiString(swapData('jumperrwa'), 0), 'jumperrwa');
    assert.strictEqual(F.abiString(swapData('jumperrwa'), 1), '');
    assert.strictEqual(F.abiString('0x', 0), null);
  });

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
})();
