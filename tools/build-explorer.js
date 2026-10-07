#!/usr/bin/env node
'use strict';
// build-explorer.js — a file a vault for the Explorer page, so the page reads
// one vault's history without the whole history of every vault:
// explorer/vaults/<chain>-<address>.json.
//
// Each holds, from files the collectors already keep:
//   days        TVL in dollars and the share price, a value a day from the
//               vault's first snapshot (tvl-snapshots.json, as the TVL page
//               reads it: tvl-series.js; share prices as the Finances pages
//               read them: build-earnings.js)
//   holders     the number of holders a day (vault-holders.json), and every
//               holder with its balance in shares, largest first
//               (vault-holders-state.json, the holders collector's own state)
//   markets     where its assets are now, market by market, with each
//               lending position and its rate, and its capacity
//               (vault-markets.json)
//   allocation  each market's dollars a day (vault-markets-history.json)
//   fees        its fee terms and the DAO's share (dao-fees.json)
//   deployedAt  when it was made (vault-deployments.json)
// The vault's name, asset, TVL and APY now are the vault list's
// (ipor-vaults.json), which the page reads anyway to search.
//
// And a file a vault for its Curator Action History,
// explorer/actions/<chain>-<address>.json, read only when that tab opens:
//   admin       every change made to the vault and the contracts that run it
//               (vault-changes.json, collect-vault-changes.js), as
//               tools/describe-changes.js words them, newest first; the
//               set-up made at its deployment carries that moment
//   actions     each rebalance the curator made (rebalance-events-<address>.json,
//               the rebalance scan's), newest first, with what it moved,
//               protocol by protocol (rebalance-flows.js, as the Address page
//               counts it). The newest ACTIONS_KEPT of them; the count says how
//               many there are in all.
//
// And a file a vault for its Activity tab, explorer/activity/<chain>-<address>.json:
// its deposits and withdrawals (activity-events.json, the real ones), newest
// first, the newest ACTIVITY_KEPT: [time, 1 deposit / 0 withdrawal, amount in
// its asset, dollars, wallet, transaction].
//
//   node tools/build-explorer.js              every file
//   node tools/build-explorer.js --activity   the activity files only

const fs = require('fs');
const path = require('path');
const TvlSeries = require('../tvl-series.js');
const RebalanceFlows = require('../rebalance-flows.js');
const { dailySharePrices } = require('./build-earnings.js');
const { describeVault } = require('./describe-changes.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'explorer', 'vaults');
const ACTIONS_DIR = path.join(ROOT, 'explorer', 'actions');
const ACTIONS_KEPT = 1000;
const ACTIVITY_DIR = path.join(ROOT, 'explorer', 'activity');
const ACTIVITY_KEPT = 5000;

// A day-indexed map as one array from its first day: a day without a value
// is null, or the last value before it (carry), as the TVL page carries TVL.
function dense(map, round, carry) {
  const days = [...map.keys()].sort((a, b) => a - b);
  if (!days.length) return null;
  const from = days[0], out = [];
  let last = null;
  for (let d = from; d <= days[days.length - 1]; d++) {
    if (map.has(d)) last = round(map.get(d));
    out.push(map.has(d) || carry ? last : null);
  }
  return { from, v: out };
}
const r0 = (v) => Math.round(v);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const sig = (v) => Number(v.toPrecision(7));
// A raw balance (hex or decimal string) in whole shares.
function shares(raw, decimals) {
  try {
    const n = BigInt(raw);
    const d = 10n ** BigInt(decimals);
    return Number(n / d) + Number(n % d) / Number(d);
  } catch { return null; }
}
const fileOf = (chain, addr) => `${String(chain).toLowerCase()}-${String(addr).toLowerCase()}.json`;

function buildExplorer({ snapshots, holders, holderState, markets, history, fees, deployments }, opts = {}) {
  const out = {};
  const at = (chain, addr) => {
    const k = fileOf(chain, addr);
    return out[k] = out[k] || { address: addr.toLowerCase(), chain: String(chain).toLowerCase() };
  };
  for (const [addr, snap] of Object.entries((snapshots && snapshots.vaults) || {})) {
    const tvl = TvlSeries.vaultDailySnapshots(snap);
    if (!tvl || !snap.chain) continue;
    const v = at(snap.chain, addr);
    const t = dense(tvl, r0, true), sp = dense(dailySharePrices(snap), r6);
    v.days = { tvl: t, sharePrice: sp };
    v.symbol = snap.symbol || null;
  }
  for (const h of (holders && holders.vaults) || []) {
    if (!h.address || !h.chain) continue;
    const v = at(h.chain, h.address);
    const m = new Map((h.series || []).map(p => [p.day, p.holders]));
    v.holders = { total: h.totalHolders != null ? h.totalHolders : null, days: dense(m, r0),
      top: (h.topHolders || []).slice(0, 10).map(x => ({ address: x.address, balance: Math.round(x.balance * 100) / 100 })) };
    // Every holder, largest first: [address, shares].
    const st = holderState && holderState.vaults && holderState.vaults[h.address.toLowerCase()];
    if (st && st.bal && h.decimals != null) {
      v.holders.all = Object.entries(st.bal)
        .map(([a, raw]) => [a.toLowerCase(), shares(raw, h.decimals)])
        .filter(([a, b]) => b > 0 && a !== '0x0000000000000000000000000000000000000000')
        .sort((x, y) => y[1] - x[1])
        .map(([a, b]) => [a, sig(b)]);
    }
  }
  for (const [addr, m] of Object.entries((markets && markets.vaults) || {})) {
    if (!m.chain) continue;
    const v = at(m.chain, addr);
    v.markets = { readAt: m.readAt || (markets && markets.readAt) || null, totalAssets: m.totalAssets, cap: m.cap, priceUsd: m.priceUsd, markets: m.markets || [] };
  }
  for (const [addr, h] of Object.entries((history && history.vaults) || {})) {
    if (!h.chain) continue;
    const days = Object.keys(h.days || {}).map(Number).sort((a, b) => a - b);
    if (!days.length) continue;
    at(h.chain, addr).allocation = { names: h.markets || {}, days: days.map(d => [d, h.days[d]]) };
  }
  for (const [addr, f] of Object.entries((fees && fees.vaults) || {})) {
    const chain = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum' }[f.chainId];
    if (!chain || !out[fileOf(chain, addr)]) continue;
    out[fileOf(chain, addr)].fees = { perf: f.perf, mgmt: f.mgmt, daoPerf: f.daoPerf, daoMgmt: f.daoMgmt, daoVia: f.daoVia || null };
  }
  for (const [addr, d] of Object.entries((deployments && deployments.deployments) || {})) {
    const v = out[fileOf(d.chain, addr)];
    if (v && d.deployedAt) v.deployedAt = d.deployedAt;
  }
  const builtAt = opts.now || new Date().toISOString();
  for (const v of Object.values(out)) v.builtAt = builtAt;
  return out;
}

// One vault's Curator Action History from its rebalance scan: the moves of
// each rebalance, newest first. protocols is the list of what the moves name
// (a market's protocol, a token's symbol): [its index, 1 out of the vault or
// 0 into it, dollars].
function buildActions(scan, opts = {}) {
  if (!scan || !scan.vault || !scan.chain) return null;
  const kept = opts.kept || ACTIONS_KEPT;
  const protocols = [], index = new Map();
  const pi = (p) => { if (!index.has(p)) { index.set(p, protocols.length); protocols.push(p); } return index.get(p); };
  const all = RebalanceFlows.prepare(JSON.parse(JSON.stringify(scan.rebalances || [])))
    .map(r => ({ r, s: RebalanceFlows.summarize(r) }))
    .filter(x => x.s.volume >= 1 && x.r.tx)   // dust (under a dollar) is no action
    .sort((a, b) => (b.r.timestamp || 0) - (a.r.timestamp || 0) || (b.r.block || 0) - (a.r.block || 0));
  const actions = all.slice(0, kept).map(({ r, s }) => [r.timestamp || null, r.tx, r0(s.volume),
    s.moves.filter(m => m.usd >= 1).map(m => [pi(m.label), m.direction === 'out' ? 1 : 0, r0(m.usd)])]);
  return {
    address: scan.vault.toLowerCase(), chain: String(scan.chain).toLowerCase(),
    scannedAt: scan.updatedAt || null, fromBlock: (scan.blockRange && scan.blockRange.from) || null,
    count: all.length, protocols, actions,
  };
}

// A vault's governance changes, worded (tools/describe-changes.js).
function buildAdmin(state, opts = {}) {
  if (!state || !Array.isArray(state.changes)) return null;
  const rows = describeVault(state, opts);
  return { readAt: state.readAt || null, deployBlock: state.deployBlock || null, count: rows.length, rows };
}

// Every vault's deposits and withdrawals, newest first: one entry a vault.
function buildActivity(events, opts = {}) {
  const kept = opts.kept || ACTIVITY_KEPT;
  const by = new Map();
  for (const e of events || []) {
    if (!e || e.synthetic === true || !e.vault || !e.chain || (e.type !== 'deposit' && e.type !== 'withdraw')) continue;
    const k = fileOf(e.chain, e.vault);
    if (!by.has(k)) by.set(k, { address: e.vault.toLowerCase(), chain: String(e.chain).toLowerCase(), symbol: e.symbol || null, list: [] });
    by.get(k).list.push(e);
  }
  const out = {};
  for (const [k, v] of by) {
    const list = v.list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || (b.block || 0) - (a.block || 0) || (b.logIdx || 0) - (a.logIdx || 0));
    out[k] = { address: v.address, chain: v.chain, symbol: v.symbol, updatedAt: opts.updatedAt || null, count: list.length,
      rows: list.slice(0, kept).map(e => [e.timestamp || null, e.type === 'deposit' ? 1 : 0, sig(e.assets || 0),
        e.usdValue != null ? Math.round(e.usdValue * 100) / 100 : null, String(e.owner || e.sender || '').toLowerCase(), e.tx || null]) };
  }
  return out;
}

function main() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const files = buildExplorer({ snapshots: read('tvl-snapshots.json'), holders: read('vault-holders.json'), holderState: read('vault-holders-state.json'),
    markets: read('vault-markets.json'), history: read('vault-markets-history.json'), fees: read('dao-fees.json'), deployments: read('vault-deployments.json') });
  // A file is rewritten only when it changed (builtAt alone is no change).
  const write = (dir, name, v) => {
    const body = JSON.stringify(v) + '\n';
    const p = path.join(dir, name);
    let old = null;
    try { old = fs.readFileSync(p, 'utf8'); } catch {}
    if (old && old.replace(/"builtAt":"[^"]*"/, '') === body.replace(/"builtAt":"[^"]*"/, '')) return 0;
    fs.writeFileSync(p, body);
    return body.length;
  };
  fs.mkdirSync(DIR, { recursive: true });
  let bytes = 0, written = 0;
  for (const [name, v] of Object.entries(files)) { const b = write(DIR, name, v); if (b) { bytes += b; written++; } }
  console.log(`explorer/vaults: ${Object.keys(files).length} vaults, ${written} rewritten (${(bytes / 1024).toFixed(0)} KB)`);

  // Curator Action History: the rebalances a vault has been scanned for, and
  // the governance changes read for it, in one file.
  fs.mkdirSync(ACTIONS_DIR, { recursive: true });
  const actions = {};
  for (const f of fs.readdirSync(ROOT).filter(n => /^rebalance-events-0x[0-9a-f]{40}\.json$/i.test(n))) {
    const a = buildActions(read(f));
    if (a) actions[fileOf(a.chain, a.address)] = a;
  }
  const changes = read('vault-changes.json'), deps = (read('vault-deployments.json') || {}).deployments || {};
  const symbols = Object.fromEntries(((read('ipor-vaults.json') || {}).vaults || []).map(v => [String(v.address).toLowerCase(), v.token || null]));
  for (const [addr, st] of Object.entries((changes && changes.vaults) || {})) {
    if (!st.chain) continue;
    const dep = deps[addr.toLowerCase()];
    const admin = buildAdmin(st, { deployedAt: dep && dep.deployedAt ? Math.floor(Date.parse(dep.deployedAt) / 1000) : null, symbol: symbols[addr.toLowerCase()] });
    if (!admin) continue;
    const k = fileOf(st.chain, addr);
    actions[k] = Object.assign(actions[k] || { address: addr.toLowerCase(), chain: String(st.chain).toLowerCase(), count: 0, protocols: [], actions: [] }, { admin });
  }
  let aBytes = 0, aWritten = 0;
  for (const [name, a] of Object.entries(actions)) { const b = write(ACTIONS_DIR, name, a); if (b) { aBytes += b; aWritten++; } }
  console.log(`explorer/actions: ${Object.keys(actions).length} vaults, ${aWritten} rewritten (${(aBytes / 1024).toFixed(0)} KB)`);
  activity(write, read);
}

// The Activity tab's files, from activity-events.json.
function activity(write, read) {
  const act = read('activity-events.json');
  if (!act) { console.log('explorer/activity: activity-events.json unreadable; left as it was'); return; }
  const files = buildActivity(act.events, { updatedAt: act.updatedAt || null });
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  let bytes = 0, written = 0;
  for (const [name, v] of Object.entries(files)) { const b = write(ACTIVITY_DIR, name, v); if (b) { bytes += b; written++; } }
  console.log(`explorer/activity: ${Object.keys(files).length} vaults, ${written} rewritten (${(bytes / 1024).toFixed(0)} KB)`);
}

if (require.main === module) {
  if (process.argv.includes('--activity')) {
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
    const write = (dir, name, v) => {
      const body = JSON.stringify(v) + '\n', p = path.join(dir, name);
      let old = null; try { old = fs.readFileSync(p, 'utf8'); } catch {}
      if (old === body) return 0;
      fs.writeFileSync(p, body); return body.length;
    };
    activity(write, read);
  } else main();
}
module.exports = { buildExplorer, buildActions, buildAdmin, buildActivity, fileOf, dense, shares };
