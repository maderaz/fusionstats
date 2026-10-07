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
//   holders     the number of holders a day, and the largest ones
//               (vault-holders.json)
//   markets     where its assets are now, market by market, with each
//               lending position and its rate, and its capacity
//               (vault-markets.json)
//   allocation  each market's dollars a day (vault-markets-history.json)
//   fees        its fee terms and the DAO's share (dao-fees.json)
//   deployedAt  when it was made (vault-deployments.json)
// The vault's name, asset, TVL and APY now are the vault list's
// (ipor-vaults.json), which the page reads anyway to search.
//
//   node tools/build-explorer.js

const fs = require('fs');
const path = require('path');
const TvlSeries = require('../tvl-series.js');
const { dailySharePrices } = require('./build-earnings.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'explorer', 'vaults');

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
const fileOf = (chain, addr) => `${String(chain).toLowerCase()}-${String(addr).toLowerCase()}.json`;

function buildExplorer({ snapshots, holders, markets, history, fees, deployments }, opts = {}) {
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

function main() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const files = buildExplorer({ snapshots: read('tvl-snapshots.json'), holders: read('vault-holders.json'), markets: read('vault-markets.json'),
    history: read('vault-markets-history.json'), fees: read('dao-fees.json'), deployments: read('vault-deployments.json') });
  fs.mkdirSync(DIR, { recursive: true });
  let bytes = 0, written = 0;
  for (const [name, v] of Object.entries(files)) {
    const body = JSON.stringify(v) + '\n';
    const p = path.join(DIR, name);
    let old = null;
    try { old = fs.readFileSync(p, 'utf8'); } catch {}
    // builtAt alone is no change: leave the file as it was.
    if (old && old.replace(/"builtAt":"[^"]*"/, '') === body.replace(/"builtAt":"[^"]*"/, '')) continue;
    fs.writeFileSync(p, body);
    bytes += body.length; written++;
  }
  console.log(`explorer/vaults: ${Object.keys(files).length} vaults, ${written} rewritten (${(bytes / 1024).toFixed(0)} KB)`);
}

if (require.main === module) main();
module.exports = { buildExplorer, fileOf, dense };
