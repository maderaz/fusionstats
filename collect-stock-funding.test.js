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
const hex = (n) => '0x' + n.toString(16);
// LiFiGenericSwapCompleted's data: two strings, three addresses, two amounts.
function swapData(integrator) {
  const s1 = str(integrator), s2 = str('');
  return '0x' + word(7 * 32) + word(7 * 32 + s1.length / 2) + word(USER) + word(0) + word(AAPL) + word(1) + word(1) + s1 + s2;
}
const transfer = (from, to, amount, tx, block, logIndex = 3) => ({ address: AAPL, topics: [F.TRANSFER, pad(from), pad(to)], data: raw(amount), transactionHash: tx, blockNumber: hex(block), logIndex: hex(logIndex) });
const swapLog = (tx, block, integrator) => ({ address: F.LIFI_DIAMOND, topics: [F.LIFI_SWAP, pad('0xab')], data: swapData(integrator), transactionHash: tx, blockNumber: hex(block), logIndex: '0x1' });
const arrivedLog = (tx, block) => ({ address: F.LIFI_EXECUTOR, topics: [F.LIFI_ARRIVED, pad('0xcd')], data: '0x', transactionHash: tx, blockNumber: hex(block), logIndex: '0x1' });

// A fake node: getLogs filtered as a node would (one address or several, a
// topic or a choice of them); `fail` holds the blocks whose LI.FI read fails.
function node({ logs = [], fail = new Set() } = {}) {
  const calls = [];
  const rpc = async (method, [p]) => {
    calls.push(method);
    if (method !== 'eth_getLogs') throw new Error('unexpected ' + method);
    const from = parseInt(p.fromBlock, 16), to = parseInt(p.toBlock, 16);
    const addrs = [].concat(p.address).map(a => a.toLowerCase());
    const match = (want, got) => want == null || [].concat(want).map(t => t.toLowerCase()).includes(got);
    if (addrs.length > 1 && fail.has(from)) throw new Error('HTTP 429');
    return logs.filter(l => addrs.includes(l.address) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to
      && p.topics.every((t, i) => match(t, l.topics[i])));
  };
  rpc.calls = calls;
  return rpc;
}
const dep = (extra = {}) => ({ type: 'deposit', vault: VAULT, owner: USER, sender: USER, assets: 0.94056415, block: 1000, logIdx: 9, tx: '0xdeposit', ...extra });

(async () => {
  console.log('\nfunding of one deposit');

  await test('a swap through LI.FI on Jumper a minute before: lifi, and its integrator', async () => {
    const rpc = node({ logs: [transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xswap', 970), swapLog('0xswap', 970, 'jumperrwa')] });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'lifi', integrator: 'jumperrwa', tx: '0xswap', block: 970 });
    assert.deepStrictEqual(rpc.calls, ['eth_getLogs', 'eth_getLogs']);   // the transfers, then LI.FI's events of that block: no receipt
  });

  await test('an arrival through LI.FI\'s Executor: a LI.FI bridge, no integrator on this chain', async () => {
    const EXECUTOR = '0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110';
    const rpc = node({ logs: [transfer(EXECUTOR, USER, 0.94056415, '0xbridge', 990), arrivedLog('0xbridge', 990)] });
    assert.strictEqual((await F.fundingOf(rpc, dep(), AAPL, DEC)).via, 'lifi-bridge');
  });

  await test('the tokens of a withdrawal from a vault (a relay hop): vault, and which, without another call', async () => {
    const rpc = node({ logs: [transfer(OTHER_VAULT, USER, 0.94056415, '0xexit', 995)] });
    const out = await F.fundingOf(rpc, dep(), AAPL, DEC, new Map([['0xexit', OTHER_VAULT]]));
    assert.deepStrictEqual(out, { via: 'vault', from: OTHER_VAULT, tx: '0xexit', block: 995 });
    assert.strictEqual(rpc.calls.length, 1);
  });

  await test('a withdrawal passed on by a router in the same transaction: still the vault', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 0.94056415, '0xexit2', 995)] });
    const out = await F.fundingOf(rpc, dep(), AAPL, DEC, new Map([['0xexit2', OTHER_VAULT]]));
    assert.deepStrictEqual([out.via, out.from], ['vault', OTHER_VAULT]);
  });

  await test('a deposit through the user\'s own proxy: the move into the proxy is passed over for the swap before it', async () => {
    const rpc = node({ logs: [transfer(USER, PROXY, 0.94056415, '0xdeposit', 1000, 4), transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xswap2', 980),
      swapLog('0xswap2', 980, 'jumper.exchange.earn')] });
    const out = await F.fundingOf(rpc, dep({ sender: PROXY }), AAPL, DEC);
    assert.strictEqual(out.via, 'lifi'); assert.strictEqual(out.integrator, 'jumper.exchange.earn');
  });

  await test('the latest transfer of the same amount wins over an older or a different one', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 5, '0xbig', 999), transfer(POOL, USER, 0.94056415, '0xold', 900), transfer(F.LIFI_DIAMOND, USER, 0.94056415, '0xnew', 960)] });
    const out = await F.fundingOf(rpc, dep(), AAPL, DEC);
    assert.deepStrictEqual([out.tx, out.via], ['0xnew', 'lifi']);
  });

  await test('nothing came in within the hour: none', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 0.94056415, '0xlong-ago', 1000 - F.LOOKBACK - 5)] });
    assert.deepStrictEqual(await F.fundingOf(rpc, dep(), AAPL, DEC), { via: 'none' });
  });

  await test('another exchange or wallet: other, with who sent it; a LI.FI swap of someone else in that block does not count', async () => {
    const rpc = node({ logs: [transfer(POOL, USER, 0.94056415, '0xdex', 990), swapLog('0xsomeone-else', 990, 'jumperrwa')] });
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

  await test('what is read stays read; what failed is tried again, then left for the next run', async () => {
    const OTHER = '0x2222222222222222222222222222222222222222';
    const act = { events: activity.events.map(e => (e.tx === '0xa' ? { ...e, owner: OTHER, sender: OTHER } : e)) };
    const rpc = node({ logs: [transfer(POOL, OTHER, 0.94056415, '0xslow', 990)], fail: new Set([990]) });
    const state = await quiet(() => F.main({ rpc, files: { ipor, activity: act, decimals, state: { deposits: { '0xc:9': { via: 'none' } } } } }));
    assert.deepStrictEqual(Object.keys(state.deposits).sort(), ['0xb:9', '0xc:9']);   // 0xa's LI.FI read failed
    assert.strictEqual(rpc.calls.filter(c => c === 'eth_getLogs').length, 1 + 2 * 2);   // 0xb; 0xa twice, two reads each
  });

  await test('a run of failures stops the run instead of emptying the queue', async () => {
    const many = { events: Array.from({ length: 40 }, (_, i) => dep({ tx: '0xd' + i, block: 1000 + i * 10 })) };
    const rpc = async () => { rpc.n = (rpc.n || 0) + 1; throw new Error('HTTP 429'); };
    const state = await quiet(() => F.main({ rpc, files: { ipor, activity: many, decimals, state: { deposits: {} } } }));
    assert.strictEqual(Object.keys(state.deposits).length, 0);
    assert.ok(rpc.n < 20, 'calls ' + rpc.n);
  });

  console.log('\nthe endpoints');

  const clock = () => { const c = { t: 1_000_000 }; c.now = () => c.t; c.sleep = async (ms) => { c.t += ms; }; return c; };
  const answers = (refuse = () => false) => {
    const asked = [];
    const fetchFn = async (url) => { asked.push(url); const r = refuse(url, asked.length);
      if (r instanceof Error) throw r;
      return r ? { ok: false, status: r } : { ok: true, json: async () => ({ result: '0x1' }) }; };
    return { asked, fetchFn };
  };

  await test('calls take turns across the endpoints, each at most once every GAP_MS', async () => {
    const c = clock(), f = answers();
    const rpc = F.rpcFor('base', { urls: ['https://a', 'https://b', 'https://c'], keyed: 0, ...c, fetchFn: f.fetchFn });
    const t0 = c.t;
    for (let i = 0; i < 6; i++) await rpc('eth_blockNumber', []);
    assert.deepStrictEqual(f.asked, ['https://a', 'https://b', 'https://c', 'https://a', 'https://b', 'https://c']);
    assert.ok(c.t - t0 >= F.GAP_MS, 'waited ' + (c.t - t0));
  });

  await test('one that refuses rests, and the others answer meanwhile; why is counted, never the URL', async () => {
    const c = clock(), f = answers((url) => (url === 'https://b' ? 429 : 0));
    const rpc = F.rpcFor('base', { urls: ['https://a', 'https://b', 'https://c'], keyed: 0, ...c, fetchFn: f.fetchFn });
    for (let i = 0; i < 6; i++) assert.strictEqual(await rpc('eth_blockNumber', []), '0x1');
    assert.strictEqual(f.asked.filter(u => u === 'https://b').length, 1);
    assert.deepStrictEqual(rpc.errors, { 'HTTP 429': 1 });
  });

  await test('all refusing: the call fails after its rounds, backing off between them', async () => {
    const c = clock(), f = answers(() => new Error('request to https://key.example/v2/SECRET failed'));
    const rpc = F.rpcFor('base', { urls: ['https://a', 'https://b'], keyed: 0, ...c, fetchFn: f.fetchFn });
    const t0 = c.t;
    await assert.rejects(rpc('eth_blockNumber', []));
    assert.strictEqual(f.asked.length, 2 * 3);
    assert.ok(c.t - t0 >= 3000, 'waited ' + (c.t - t0));
    assert.ok(Object.keys(rpc.errors).every(k => !/SECRET|https?:/.test(k)), JSON.stringify(rpc.errors));
  });

  await test('two callers: when its endpoint refuses, a caller moves to one still free, not to one the other caller just saw refuse', async () => {
    const c = clock();
    let release;
    const gate = new Promise(r => { release = r; });
    const asked = [];
    const fetchFn = async (url) => {
      asked.push(url);
      if (url === 'https://a') { await gate; return { ok: false, status: 429 }; }
      if (url === 'https://b') { release(); return { ok: false, status: 429 }; }
      return { ok: true, json: async () => ({ result: 'c' }) };
    };
    const rpc = F.rpcFor('base', { urls: ['https://a', 'https://b', 'https://c'], keyed: 0, ...c, fetchFn });
    const t0 = c.t;
    const [x, y] = await Promise.all([rpc('eth_blockNumber', []), rpc('eth_blockNumber', [])]);
    assert.deepStrictEqual([x, y], ['c', 'c']);
    assert.deepStrictEqual(asked.slice(0, 3), ['https://a', 'https://b', 'https://c']);
    assert.ok(!asked.slice(3).includes('https://b'), asked.join(' '));
    assert.ok(c.t - t0 < F.COOL_MS, 'waited ' + (c.t - t0));
  });

  await test('a keyed endpoint is asked first when free', async () => {
    const c = clock(), f = answers();
    const rpc = F.rpcFor('base', { urls: ['https://keyed', 'https://a'], keyed: 1, ...c, fetchFn: f.fetchFn });
    await rpc('eth_blockNumber', []);
    assert.strictEqual(f.asked[0], 'https://keyed');
  });

  await test('an event\'s strings, read from its data', () => {
    assert.strictEqual(F.abiString(swapData('jumperrwa'), 0), 'jumperrwa');
    assert.strictEqual(F.abiString(swapData('jumperrwa'), 1), '');
    assert.strictEqual(F.abiString('0x', 0), null);
  });

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
})();
