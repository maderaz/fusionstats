#!/usr/bin/env node
'use strict';
// collect-stock-funding.js — where the tokens of a stock-vault deposit came
// from, read on-chain, for the Stocks page's routes.
//
// A deposit's own event names only its caller and the shares' owner. The
// Jumper campaign's deposits are made from the user's own wallet a minute or
// so after a swap into the stock through LI.FI, so they read as "Direct"; the
// swap, a transaction earlier, carries LI.FI's event with the integrator that
// sent it ("jumperrwa", "jumper.exchange.earn", …). This finds that swap.
//
// For each stock-vault deposit not yet read, newest first, within a budget:
//   1. the stock token's Transfer logs into the depositor (the shares' owner,
//      and the caller too when that is another contract: a per-user proxy)
//      over the LOOKBACK blocks up to the deposit;
//   2. the transfer that funded it: the latest one within TOL of the deposit's
//      amount, else the latest one at least as large (a move between the
//      user and their own proxy is passed over for the one before it);
//   3. that transaction's receipt, read for what it was:
//        lifi         a swap through LI.FI's Diamond (LiFiGenericSwapCompleted),
//                     with its integrator
//        lifi-bridge  an arrival through LI.FI's Executor (LiFiTransferCompleted);
//                     the integrator is on the chain it came from
//        vault        a withdrawal from a vault (a relay hop's other leg)
//        other        anything else (a DEX, an exchange, another wallet), with
//                     the address that sent the tokens
//        none         no transfer in the window: the tokens were already there
//
// Writes stock-funding.json: { updatedAt, deposits: { "<tx>:<logIdx>":
// { via, integrator?, from?, tx?, block? } } }, read by
// tools/build-stocks-data.js. A deposit whose reads fail is left for a later run.
//
//   node collect-stock-funding.js [--max 150]

const fs = require('fs');
const path = require('path');
const { rpcEndpoints } = require('./rpc-endpoints.js');
const { STOCK_RE } = require('./tools/build-stocks-data.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'stock-funding.json');
const LOOKBACK = 1800;           // blocks: an hour on Base
const TOL = 0.005;               // a transfer this close to the deposit is the one
const MAX = 150;                 // deposits a run
const DEADLINE_MS = 75_000;
const PARALLEL = 4;

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WITHDRAW = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';
// LI.FI (lifinance/contracts, deployments/base.json).
const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';
const LIFI_EXECUTOR = '0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110';
const LIFI_PERMIT2_PROXY = '0x89c6340b1a1f4b25d36cd8b063d49045caf3f818';
const LIFI = new Set([LIFI_DIAMOND, LIFI_EXECUTOR, LIFI_PERMIT2_PROXY]);
// LiFiGenericSwapCompleted(bytes32 indexed transactionId, string integrator,
//   string referrer, address receiver, address fromAssetId, address toAssetId,
//   uint256 fromAmount, uint256 toAmount)
const LIFI_SWAP = '0x38eee76fd911eabac79da7af16053e809be0e12c8637f156e77e1af309b99537';
// LiFiTransferCompleted(bytes32 indexed transactionId, address receivingAssetId,
//   address receiver, uint256 amount, uint256 timestamp)
const LIFI_ARRIVED = '0xb8c86983f929c6b770461983d1bbde1870408120f07123e9c12d49f35a0b4c4b';

const PUBLIC_RPCS = { base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'] };

const lc = (a) => String(a || '').toLowerCase();
const hex = (n) => '0x' + Number(n).toString(16);
const pad = (a) => '0x' + lc(a).replace(/^0x/, '').padStart(64, '0');
const addrOf = (topic) => '0x' + lc(topic).slice(-40);
const num = (h) => parseInt(h, 16);

// A string argument of an event's data, the i-th head word pointing at it.
function abiString(data, i) {
  const d = String(data || '').replace(/^0x/, '');
  const at = parseInt(d.slice(i * 64, (i + 1) * 64), 16) * 2;
  if (!Number.isFinite(at) || at + 64 > d.length) return null;
  const len = parseInt(d.slice(at, at + 64), 16);
  if (!Number.isFinite(len) || len > 256) return null;
  const bytes = d.slice(at + 64, at + 64 + len * 2);
  return Buffer.from(bytes, 'hex').toString('utf8');
}

// What a funding transaction was, from its receipt and the transfer in it.
function classify(receipt, transfer) {
  const logs = (receipt && receipt.logs) || [];
  const swap = logs.find(l => lc(l.address) === LIFI_DIAMOND && lc(l.topics && l.topics[0]) === LIFI_SWAP);
  if (swap) return { via: 'lifi', integrator: abiString(swap.data, 0) || null };
  if (logs.some(l => lc(l.topics && l.topics[0]) === LIFI_ARRIVED && LIFI.has(lc(l.address)))) return { via: 'lifi-bridge' };
  const from = addrOf(transfer.topics[1]);
  if (LIFI.has(from)) return { via: 'lifi' };
  const out = logs.find(l => lc(l.topics && l.topics[0]) === WITHDRAW && (l.topics || []).length === 4);
  if (out) return { via: 'vault', from: lc(out.address) };
  return { via: 'other', from };
}

// The transfers that may have funded a deposit, best first: those within TOL
// of its amount, latest first, then those at least as large.
function fundingTransfers(logs, dep, decimals) {
  const before = (logs || []).filter(l => {
    const b = num(l.blockNumber);
    return b < dep.block || (b === dep.block && num(l.logIndex) < (dep.logIdx == null ? Infinity : dep.logIdx));
  }).sort((a, b) => num(b.blockNumber) - num(a.blockNumber) || num(b.logIndex) - num(a.logIndex));
  const amount = (l) => { try { return Number(BigInt(l.data)) / 10 ** decimals; } catch { return 0; } };
  const want = dep.assets || 0;
  if (!(want > 0)) return [];
  const exact = before.filter(l => Math.abs(amount(l) - want) <= TOL * want);
  const larger = before.filter(l => !exact.includes(l) && amount(l) >= want * (1 - TOL));
  return exact.concat(larger);
}

async function fundingOf(rpc, dep, token, decimals) {
  const who = [lc(dep.owner)];
  if (dep.sender && lc(dep.sender) !== lc(dep.owner)) who.push(lc(dep.sender));
  const logs = await rpc('eth_getLogs', [{ address: token, fromBlock: hex(Math.max(0, dep.block - LOOKBACK)), toBlock: hex(dep.block),
    topics: [TRANSFER, null, who.map(pad)] }]);
  for (const t of fundingTransfers(logs, dep, decimals).slice(0, 3)) {
    const receipt = await rpc('eth_getTransactionReceipt', [t.transactionHash]);
    if (!receipt) throw new Error('no receipt for ' + t.transactionHash);
    const kind = classify(receipt, t);
    // The user handing the tokens to their own proxy: where did they get them?
    if (kind.via === 'other' && who.includes(kind.from)) continue;
    return { ...kind, tx: lc(t.transactionHash), block: num(t.blockNumber) };
  }
  return { via: 'none' };
}

// JSON-RPC over the chain's endpoints, keyed first: the first that answers.
function rpcFor(chain) {
  const urls = rpcEndpoints(chain, PUBLIC_RPCS[chain] || []);
  let id = 0;
  return async (method, params) => {
    let last;
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
        if (!res.ok) { last = new Error('HTTP ' + res.status); continue; }
        const j = await res.json();
        if (j.error) { last = new Error(j.error.message || 'RPC error'); continue; }
        return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error('no endpoint');
  };
}

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return fb; } };

async function main({ max = MAX, deadlineMs = DEADLINE_MS, rpc = null, now = Date.now(), files = {} } = {}) {
  const ipor = files.ipor || readJson('ipor-vaults.json', null);
  const activity = files.activity || readJson('activity-events.json', null);
  const decimalsCache = files.decimals || readJson('vault-decimals.json', { decimals: {} });
  const state = files.state || readJson('stock-funding.json', { deposits: {} });
  if (!ipor || !activity) { console.log('stock-funding.json: left as it was (no vault list or events)'); return state; }
  state.deposits = state.deposits || {};

  const stock = new Map((ipor.vaults || []).filter(v => STOCK_RE.test(lc(v.assetAddress)))
    .map(v => [lc(v.address), { chain: lc(v.chain || 'base'), token: lc(v.assetAddress) }]));
  const key = (e) => lc(e.tx) + ':' + e.logIdx;
  const todo = (activity.events || [])
    .filter(e => e.type === 'deposit' && stock.has(lc(e.vault)) && e.tx && e.logIdx != null && e.block && !state.deposits[key(e)])
    .sort((a, b) => b.block - a.block)
    .slice(0, max);
  const deadline = now + deadlineMs;
  const rpcs = {};
  let done = 0, failed = 0;
  const work = todo.slice();
  await Promise.all(Array.from({ length: Math.min(PARALLEL, work.length) }, async () => {
    while (work.length && Date.now() < deadline) {
      const dep = work.shift();
      const v = stock.get(lc(dep.vault));
      const call = rpc || (rpcs[v.chain] = rpcs[v.chain] || rpcFor(v.chain));
      const decimals = (decimalsCache.decimals || {})[v.token];
      if (decimals == null) { failed++; continue; }
      try { state.deposits[key(dep)] = await fundingOf(call, dep, v.token, decimals); done++; }
      catch { failed++; }
    }
  }));
  state.updatedAt = new Date(now).toISOString();
  const left = (activity.events || []).filter(e => e.type === 'deposit' && stock.has(lc(e.vault)) && e.tx && e.logIdx != null && !state.deposits[key(e)]).length;
  const by = {};
  Object.values(state.deposits).forEach(d => { const k = d.via === 'lifi' && d.integrator ? 'lifi:' + d.integrator : d.via; by[k] = (by[k] || 0) + 1; });
  console.log(`stock-funding.json: read ${done} deposit${done === 1 ? '' : 's'}, ${failed} to retry, ${left} not yet read · `
    + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', '));
  if (!files.state) fs.writeFileSync(OUT, JSON.stringify(state) + '\n');
  return state;
}

if (require.main === module) {
  const i = process.argv.indexOf('--max');
  main({ max: i > 0 ? Number(process.argv[i + 1]) : MAX }).catch(e => { console.error('stock funding: ' + e.message); process.exit(0); });
}

module.exports = { main, classify, fundingTransfers, fundingOf, abiString, LIFI_DIAMOND, LIFI_SWAP, LIFI_ARRIVED, TRANSFER, WITHDRAW, LOOKBACK };
