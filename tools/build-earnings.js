#!/usr/bin/env node
'use strict';
// build-earnings.js — what the IPOR DAO and the vaults' curators have earned
// in fees, day by day, for the Finances pages. Writes earnings-daily.json.
//
// A Fusion vault takes a performance fee on its profit and a management fee
// on its assets, both minted as shares, so its share price is what
// depositors keep. Each fee is split between the vault's own recipients
// (its curator or operator) and the DAO, at rates read on-chain
// (dao-fees.json, collect-dao-fees.js). Key Metrics shows the year ahead at
// today's TVL and APY; this is the same arithmetic run over every day of
// every vault's history (tvl-snapshots.json):
//
//   r      the day's rise in share price (after fees) above its high so far
//   gross  the yield before fees: (r + management fee for the days) /
//          (1 - performance fee), and none on a day without a new high
//   DAO      TVL × (its management share for the days + gross × its
//            performance share)
//   curator  TVL × (the rest of the management fee + gross × the rest of the
//            performance fee)
//
// The management fee accrues every day on the day's TVL; the performance
// fee on each rise of the share price to a new high (a recovery after a fall
// is not new profit), between prices read at most three days apart, on the
// TVL before it (a longer gap says nothing of when the yield came). TVL
// is in dollars and carried forward between snapshots as the TVL page reads
// it (tvl-series.js: glitches and impossible dates dropped), to the vault's
// own last snapshot. Share prices outside 0.1–100 are scaling errors, and a
// move over 5% a day is not a yield vault's: neither earns a fee. A vault
// without fee terms on file is left out, and counted, so the page can say
// so. The fee terms are today's for the whole history: the DAO's are fixed
// when a vault is made, and a vault's own rarely change.
//
//   node tools/build-earnings.js

const fs = require('fs');
const path = require('path');
const TvlSeries = require('../tvl-series.js');

const ROOT = path.join(__dirname, '..');
const MAX_DAILY_MOVE = 0.05;
const MAX_GAP = 3;
const SP_MIN = 0.1, SP_MAX = 100;

// Each vault's last share price per day, within the plausible range.
function dailySharePrices(snap) {
  const byDay = new Map();
  for (const s of (snap.snapshots || []).slice().sort((a, b) => a.timestamp - b.timestamp)) {
    const day = s.day != null ? s.day : Math.floor(s.timestamp / TvlSeries.DAY_SEC);
    if (day < TvlSeries.MIN_VALID_DAY || !(s.sharePrice >= SP_MIN && s.sharePrice <= SP_MAX)) continue;
    byDay.set(day, s.sharePrice);
  }
  return byDay;
}

function buildEarnings(snapshots, fees, opts = {}) {
  const terms = (fees && fees.vaults) || {};
  const dao = new Map(), cur = new Map();
  const add = (m, d, v) => { if (v) m.set(d, (m.get(d) || 0) + v); };
  let counted = 0, minDay = Infinity, maxDay = -Infinity;
  const without = [];
  for (const [addr, snap] of Object.entries((snapshots && snapshots.vaults) || {})) {
    const tvl = TvlSeries.vaultDailySnapshots(snap);
    if (!tvl) continue;
    const peak = Math.max(...tvl.values());
    const f = terms[addr.toLowerCase()];
    if (!f || f.perf == null || f.mgmt == null || f.daoPerf == null || f.daoMgmt == null) {
      if (peak > 0) without.push({ addr: addr.toLowerCase(), symbol: snap.symbol || null, chain: snap.chain || null, peak: Math.round(peak) });
      continue;
    }
    const sp = dailySharePrices(snap);
    const days = [...sp.keys()].sort((a, b) => a - b);
    const perf = f.perf / 100, mgmt = f.mgmt / 100;
    const daoPerf = f.daoPerf / 100, daoMgmt = f.daoMgmt / 100;
    const curPerf = Math.max(0, perf - daoPerf), curMgmt = Math.max(0, mgmt - daoMgmt);
    // TVL carried forward between snapshots, as the TVL page does, to the
    // vault's own last one (a closed vault stops earning).
    const tvlDays = [...tvl.keys()].sort((a, b) => a - b);
    const first = tvlDays[0], last = tvlDays[tvlDays.length - 1];
    const tvlOn = new Map();
    for (let d = first, i = 0, cur = 0; d <= last; d++) {
      while (i < tvlDays.length && tvlDays[i] <= d) cur = tvl.get(tvlDays[i++]);
      tvlOn.set(d, cur);
    }
    let any = false;
    // The management fee, every day on the day's assets.
    for (const [d, v] of tvlOn) {
      if (!(v > 0)) continue;
      add(dao, d, v * daoMgmt / 365);
      add(cur, d, v * curMgmt / 365);
      if (d < minDay) minDay = d;
      if (d > maxDay) maxDay = d;
      any = true;
    }
    // The performance fee, on each rise to a new high (a recovery after a
    // fall is not new profit), between share prices read at most MAX_GAP
    // days apart: a longer gap says nothing of when the yield came.
    let high = days.length ? sp.get(days[0]) : 0;
    for (let i = 1; i < days.length; i++) {
      const d0 = days[i - 1], d1 = days[i], span = d1 - d0;
      const p0 = sp.get(d0), p1 = sp.get(d1);
      const move = p1 / p0 - 1;
      const plausible = Math.abs(move) <= MAX_DAILY_MOVE * span;
      const r = plausible ? Math.max(0, p1 - Math.max(high, p0)) / p0 : 0;
      if (plausible) high = Math.max(high, p1);
      const base = tvlOn.get(d0);
      if (!(r > 0) || !(base > 0) || span <= 0 || span > MAX_GAP) continue;
      const gross = (r + mgmt * span / 365) / (1 - perf);
      add(dao, d1, base * gross * daoPerf);
      add(cur, d1, base * gross * curPerf);
    }
    if (any) counted++;
  }
  if (!Number.isFinite(minDay)) return null;
  const round = (v) => Math.round(v * 100) / 100;
  const series = (m) => Array.from({ length: maxDay - minDay + 1 }, (_, k) => round(m.get(minDay + k) || 0));
  without.sort((a, b) => b.peak - a.peak);
  return {
    updatedAt: opts.now || new Date().toISOString(),
    snapshotsUpdatedAt: (snapshots && snapshots.updatedAt) || null,
    feesReadAt: (fees && fees.readAt) || null,
    minDay, maxDay,
    dao: series(dao), curator: series(cur),
    vaults: { counted, without: without.length, withoutPeak: without.slice(0, 12) },
  };
}

function main() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const snapshots = read('tvl-snapshots.json'), fees = read('dao-fees.json');
  if (!snapshots || !fees) { console.log('earnings-daily.json: left as it was (' + (!snapshots ? 'tvl-snapshots' : 'dao-fees') + '.json unreadable)'); return; }
  const out = buildEarnings(snapshots, fees);
  if (!out) { console.log('earnings-daily.json: left as it was (no vault with both a history and fee terms)'); return; }
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'earnings-daily.json'), body + '\n');
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  console.log(`earnings-daily.json: ${out.maxDay - out.minDay + 1} days from ${new Date(out.minDay * 864e5).toISOString().slice(0, 10)}, `
    + `${out.vaults.counted} vaults (${out.vaults.without} without fee terms), DAO $${Math.round(sum(out.dao)).toLocaleString('en-US')}, `
    + `curators $${Math.round(sum(out.curator)).toLocaleString('en-US')}, ${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildEarnings, dailySharePrices };
