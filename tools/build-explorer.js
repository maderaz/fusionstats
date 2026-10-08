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

// The Parameters tab: what the markets collector read of a vault's set-up
// (its contracts, entry and exit contributions, limits, each market's fuses
// and substrates) and who holds each role now, replayed from its governance
// history. The technical roles (a contract of the vault's own, the DAO, the
// whitelist) are left out, as the IPOR app leaves them.
const TECH_ROLES = new Set(['0', '3', '4', '5', '6', '7', '400', '500', '601', '800', '18446744073709551615']);
function buildParams(p, m, st) {
  if (!p || p.error) return null;
  const { roleName, currentWithdraw } = require('./describe-changes.js');
  const kind = (k) => (st && st.contracts ? (Object.entries(st.contracts).find(([, c]) => c.kind === k) || [])[0] || null : null);
  const contracts = { access: p.access || kind('access'), withdraw: p.withdraw || (st ? currentWithdraw(st) : null), oracle: p.oracle || kind('oracle'),
    rewards: p.rewards || kind('rewards'), fee: p.feeManager || kind('fee') };
  const out = { readAt: m.readAt || null, cap: m.cap != null ? m.cap : null, depositFee: p.depositFee, requestFee: p.requestFee, withdrawFee: p.withdrawFee,
    withdrawWindow: p.withdrawWindow, redemptionDelay: p.redemptionDelay != null ? p.redemptionDelay : null, instantFuses: p.instantFuses || 0,
    contracts: Object.fromEntries(Object.entries(contracts).filter(([, a]) => a)),
    permissions: (p.permissions || []).map(x => ({ id: x.id, key: x.key, name: x.name, fuses: (x.fuses || []).length,
      subs: (x.subs || []).map(s => (s.a ? [s.a, s.sym || null] : [s.raw, null])), more: x.more || 0 })) };
  // The withdraw manager's settings, as its last change set them, where the
  // chain wasn't asked (or didn't answer).
  if (st && Array.isArray(st.changes) && contracts.withdraw) {
    const last = (ev) => { for (let i = st.changes.length - 1; i >= 0; i--) { const c = st.changes[i]; if (c.event === ev && c.contract === contracts.withdraw) return c.args; } return null; };
    const fee = (a) => (a && a.fee != null ? Math.round(Number(BigInt(a.fee)) / 1e12) / 1e4 : null);
    const w = last('WithdrawWindowLengthUpdated');
    if (out.withdrawWindow == null && w) out.withdrawWindow = Number(w.withdrawWindowLength);
    if (out.requestFee == null) out.requestFee = fee(last('RequestFeeUpdated'));
    if (out.withdrawFee == null) out.withdrawFee = fee(last('WithdrawFeeUpdated'));
  }
  if (st && Array.isArray(st.changes) && contracts.access) {
    const held = new Map();
    for (const ch of st.changes) {
      if (ch.contract !== contracts.access || !ch.args || ch.args.roleId == null) continue;
      const id = String(ch.args.roleId), who = String(ch.args.account || '').toLowerCase();
      if (!held.has(id)) held.set(id, new Set());
      if (ch.event === 'RoleGranted') held.get(id).add(who);
      else if (ch.event === 'RoleRevoked' || ch.event === 'RoleRenounced') held.get(id).delete(who);
    }
    out.roles = [...held.entries()].filter(([id, s]) => s.size && !TECH_ROLES.has(id))
      .sort((a, b) => Number(a[0]) - Number(b[0])).map(([id, s]) => [roleName(id), [...s]]);
    out.rolesComplete = st.complete === true;
  }
  return out;
}

function buildExplorer({ snapshots, holders, holderState, markets, history, fees, deployments, changes }, opts = {}) {
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
    // The same days' TVL in the vault's asset (the page's TVL in $ / in the asset).
    const assets = new Map();
    for (const s of snap.snapshots || []) {
      const day = s.day != null ? s.day : Math.floor(s.timestamp / 86400);
      if (tvl.has(day) && typeof s.assets === 'number' && s.assets >= 0) assets.set(day, s.assets);
    }
    if (assets.size) v.days.assets = dense(assets, sig, true);
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
    const params = buildParams(m.params, m, changes && changes.vaults && changes.vaults[addr.toLowerCase()]);
    if (params) v.params = params;
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
  return { readAt: state.readAt || null, deployBlock: state.deployBlock || null, complete: state.complete === true, count: rows.length, rows };
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
    markets: read('vault-markets.json'), history: read('vault-markets-history.json'), fees: read('dao-fees.json'), deployments: read('vault-deployments.json'), changes: read('vault-changes.json') });
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
  // The start page's list: each vault's total value managed (what its markets
  // hold, borrowing included), in one small file rather than every vault's.
  const tvm = {};
  for (const [name, v] of Object.entries(files)) {
    const ms = (v.markets && v.markets.markets) || [];
    if (!ms.length) continue;
    tvm[name.replace(/\.json$/, '')] = Math.round(ms.reduce((a, m) => a + (m.positions && m.positions.length ? m.supplyUsd || 0 : Math.max(0, m.netUsd || 0)), 0));
  }
  // And who runs each vault (operators.js): by its name, its owner's other
  // vaults (the atomist, from the governance history), or IPOR's alpha.
  const Operators = require('../operators.js');
  const govern = (read('vault-changes.json') || {}).vaults || {};
  const mk = (read('vault-markets.json') || {}).vaults || {};
  const { currentAtomist } = require('./describe-changes.js');
  // Its atomist: its history's, else the one the markets collector found by
  // asking its access manager (a vault read without its history: Base).
  const ownerOf = (a) => (govern[a] && currentAtomist(govern[a])) || ((mk[a] || {}).params || {}).atomist || null;
  const list = ((read('ipor-vaults.json') || {}).vaults || []).map(v => ({ address: String(v.address).toLowerCase(), chain: String(v.chain).toLowerCase(), name: v.name, shareSymbol: v.shareSymbol || null, iporAlpha: v.iporAlpha === true, owner: ownerOf(String(v.address).toLowerCase()) }));
  const ops = Operators.assign(list), op = {};
  for (const v of list) if (ops[v.address]) op[v.chain + '-' + v.address] = ops[v.address];
  // Who may deposit: gated where deposit() asks a role other than the public
  // one (a whitelist), closed where the access manager has shut the vault.
  const gate = {};
  for (const v of list) {
    const p = (mk[v.address] || {}).params || {};
    if (p.closed) gate[v.chain + '-' + v.address] = 'closed';
    else if (p.depositRole && p.depositRole !== 'public') gate[v.chain + '-' + v.address] = 'gated';
  }
  files['index.json'] = { tvm, op, gate };
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
module.exports = { buildParams, buildExplorer, buildActions, buildAdmin, buildActivity, fileOf, dense, shares };
