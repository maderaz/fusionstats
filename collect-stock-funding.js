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
//   3. what that transaction was, from LI.FI's events in its block, read as
//      logs (no receipts: the activity collector's scans show these public
//      nodes serving logs back to the vaults' deployments), and from the
//      withdrawals already collected:
//        lifi         a swap through LI.FI's Diamond (LiFiGenericSwapCompleted),
//                     with its integrator
//        lifi-bridge  an arrival through LI.FI's Executor (LiFiTransferCompleted);
//                     the integrator is on the chain it came from
//        vault        a withdrawal from a tracked vault (a relay hop's other leg)
//        other        anything else (a DEX, an exchange, another wallet), with
//                     the address that sent the tokens
//        none         no transfer in the window: the tokens were already there
//
// Writes stock-funding.json: { updatedAt, deposits: { "<tx>:<logIdx>":
// { via, integrator?, from?, tx?, block? } } }, read by
// tools/build-stocks-data.js. A deposit whose reads fail is tried again later in
// the run, then left for a later run.
//
// The endpoints are free ones: calls are spaced, spread across them, and backed
// off when refused, so that a burst of refusals does not empty the queue.
//
//   node collect-stock-funding.js [--max 300]

const fs = require('fs');
const path = require('path');
const { rpcEndpoints, keyedEndpoints } = require('./rpc-endpoints.js');
const { STOCK_RE } = require('./tools/build-stocks-data.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'stock-funding.json');
const LOOKBACK = 1800;           // blocks: an hour on Base
const TOL = 0.005;               // a transfer this close to the deposit is the one
const MAX = 300;                 // deposits a run
const DEADLINE_MS = 90_000;
const PARALLEL = 2;
const GAP_MS = 150;              // between two calls to one endpoint
const COOL_MS = 5_000;           // an endpoint that refused rests this long
const PASSES = 3;                // rounds of the endpoints before a call fails
const BACKOFF_MS = 1_000;        // the wait before the second round, doubled after
const GIVE_UP = 12;              // failed deposits in a row: the endpoints are down

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
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

// As collect-activity.js, whose scans read these back to the vaults' deployments.
const PUBLIC_RPCS = { base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.llamarpc.com'] };

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

// What a funding transaction was: LI.FI's events in it (`lifiLogs`, those of
// its block), else a withdrawal from a tracked vault in it (`withdrawals`, tx →
// vault), else whoever sent the tokens.
function classify(lifiLogs, transfer, withdrawals = new Map()) {
  const tx = lc(transfer.transactionHash);
  const logs = (lifiLogs || []).filter(l => lc(l.transactionHash) === tx);
  const swap = logs.find(l => lc(l.address) === LIFI_DIAMOND && lc(l.topics && l.topics[0]) === LIFI_SWAP);
  if (swap) return { via: 'lifi', integrator: abiString(swap.data, 0) || null };
  if (logs.some(l => lc(l.topics && l.topics[0]) === LIFI_ARRIVED && LIFI.has(lc(l.address)))) return { via: 'lifi-bridge' };
  const from = addrOf(transfer.topics[1]);
  if (LIFI.has(from)) return { via: 'lifi' };
  if (withdrawals.has(tx)) return { via: 'vault', from: withdrawals.get(tx) };
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

async function fundingOf(rpc, dep, token, decimals, withdrawals = new Map()) {
  const who = [lc(dep.owner)];
  if (dep.sender && lc(dep.sender) !== lc(dep.owner)) who.push(lc(dep.sender));
  const logs = await rpc('eth_getLogs', [{ address: token, fromBlock: hex(Math.max(0, dep.block - LOOKBACK)), toBlock: hex(dep.block),
    topics: [TRANSFER, null, who.map(pad)] }]);
  for (const t of fundingTransfers(logs, dep, decimals).slice(0, 3)) {
    const from = addrOf(t.topics[1]), tx = lc(t.transactionHash);
    // The user handing the tokens to their own proxy: where did they get them?
    if (who.includes(from)) continue;
    // A vault's own withdrawal transfer: no call needed.
    if (withdrawals.get(tx) === from) return { via: 'vault', from, tx, block: num(t.blockNumber) };
    const b = hex(num(t.blockNumber));
    const lifi = await rpc('eth_getLogs', [{ address: [...LIFI], fromBlock: b, toBlock: b, topics: [[LIFI_SWAP, LIFI_ARRIVED]] }]);
    return { ...classify(lifi, t, withdrawals), tx, block: num(t.blockNumber) };
  }
  return { via: 'none' };
}

// JSON-RPC over the chain's endpoints, spread across them: each call goes to
// the one free soonest (a keyed one when there is a tie, then the one least
// recently asked), each is asked at most once every GAP_MS, and one that
// refuses rests COOL_MS, so the others are asked first. A call fails only after
// PASSES rounds of them all, waiting longer before each, and none starts after
// `until`. `errors` counts why calls were refused, never with an endpoint's URL
// (a keyed one carries its key).
function rpcFor(chain, { urls = rpcEndpoints(chain, PUBLIC_RPCS[chain] || []), keyed = keyedEndpoints(chain).length, until = Infinity,
  fetchFn = (...a) => fetch(...a), sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const free = urls.map(() => 0), errors = {};
  let id = 0;
  const order = () => {
    const t = now(), at = (i) => Math.max(free[i], t);
    return urls.map((_, i) => i).sort((a, b) => at(a) - at(b) || (b < keyed) - (a < keyed) || free[a] - free[b]);
  };
  const why = (e) => String((e && e.message) || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 60);
  const call = async (method, params) => {
    let last;
    for (let pass = 0; pass < PASSES; pass++) {
      if (pass) await sleep(BACKOFF_MS * 2 ** (pass - 1));
      for (const i of order()) {
        const wait = free[i] - now();
        if (wait > 0) await sleep(wait);
        if (now() >= until) throw new Error('out of time');
        free[i] = now() + GAP_MS;
        try {
          const res = await fetchFn(urls[i], { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(12_000) });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const j = await res.json();
          if (j.error) throw new Error(j.error.message || 'RPC error');
          return j.result;
        } catch (e) {
          last = e; free[i] = now() + COOL_MS;
          const k = why(e); errors[k] = (errors[k] || 0) + 1;
        }
      }
    }
    throw last || new Error('no endpoint');
  };
  call.errors = errors;
  return call;
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
  // The withdrawals already collected, by transaction: a relay hop's other leg.
  const withdrawals = new Map();
  for (const e of activity.events || []) if (e.type === 'withdraw' && e.tx && !withdrawals.has(lc(e.tx))) withdrawals.set(lc(e.tx), lc(e.vault));
  const deadline = now + deadlineMs;
  const rpcs = {};
  let done = 0, failed = 0, inRow = 0;
  // A deposit whose reads failed goes to the back of the queue once; a run of
  // failures means the endpoints are refusing, and the rest wait for a later run.
  const work = todo.map(dep => ({ dep, tries: 0 }));
  await Promise.all(Array.from({ length: Math.min(PARALLEL, work.length) }, async () => {
    while (work.length && Date.now() < deadline && inRow < GIVE_UP) {
      const job = work.shift(), dep = job.dep;
      const v = stock.get(lc(dep.vault));
      const call = rpc || (rpcs[v.chain] = rpcs[v.chain] || rpcFor(v.chain, { until: deadline }));
      const decimals = (decimalsCache.decimals || {})[v.token];
      if (decimals == null) { failed++; continue; }
      try {
        state.deposits[key(dep)] = await fundingOf(call, dep, v.token, decimals, withdrawals); done++; inRow = 0;
        if (done % 25 === 0 && !files.state) fs.writeFileSync(OUT, JSON.stringify(state) + '\n');   // kept if the step is cut short
      }
      catch { inRow++; if (++job.tries < 2) work.push(job); else failed++; }
    }
  }));
  failed += work.filter(j => j.tries).length;
  state.updatedAt = new Date(now).toISOString();
  const left = (activity.events || []).filter(e => e.type === 'deposit' && stock.has(lc(e.vault)) && e.tx && e.logIdx != null && !state.deposits[key(e)]).length;
  const by = {};
  Object.values(state.deposits).forEach(d => { const k = d.via === 'lifi' && d.integrator ? 'lifi:' + d.integrator : d.via; by[k] = (by[k] || 0) + 1; });
  console.log(`stock-funding.json: read ${done} deposit${done === 1 ? '' : 's'}, ${failed} to retry, ${left} not yet read · `
    + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', '));
  const errors = {};
  for (const c of Object.values(rpcs)) for (const [k, n] of Object.entries(c.errors || {})) errors[k] = (errors[k] || 0) + n;
  if (Object.keys(errors).length) console.log('  refused: ' + Object.entries(errors).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ×' + n).join(', ')
    + (inRow >= GIVE_UP ? ' — stopped after ' + GIVE_UP + ' failures in a row' : ''));
  if (!files.state) fs.writeFileSync(OUT, JSON.stringify(state) + '\n');
  return state;
}

if (require.main === module) {
  const i = process.argv.indexOf('--max');
  main({ max: i > 0 ? Number(process.argv[i + 1]) : MAX }).catch(e => { console.error('stock funding: ' + e.message); process.exit(0); });
}

module.exports = { main, classify, fundingTransfers, fundingOf, rpcFor, abiString, LIFI_DIAMOND, LIFI_EXECUTOR, LIFI_SWAP, LIFI_ARRIVED, TRANSFER, LOOKBACK, COOL_MS, GAP_MS };
