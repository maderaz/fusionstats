#!/usr/bin/env node
'use strict';
// audit-activity.js — are we missing deposits or withdrawals, and since when?
//
// Every recorded Deposit and Withdraw moves a vault's share supply. The TVL
// snapshot job reads each vault's totalAssets and share price straight from
// the chain, on its own schedule, with its own RPC calls — so it knows the
// supply independently of the event collector:
//
//     supply from snapshots = totalAssets / sharePrice
//     supply from events    = sum of deposit shares - sum of withdraw shares
//
// Those two should agree at every snapshot. When they stop agreeing, events
// went missing between the last snapshot that reconciled and the first that
// did not. This is the check that would have caught Ethereum collection
// freezing for three weeks, and Base for five days before it — both reported
// success on every run.
//
// Fee shares are minted without a Deposit event, so a slow drift of a percent
// or two is expected; missing events show as a step.
//
//   node tools/audit-activity.js                # every vault, worst first
//   node tools/audit-activity.js --json         # machine-readable
//   node tools/audit-activity.js --fail-over 10000   # exit 1 if any gap > $10K
//
// Read-only; uses only the committed data files.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// Stored share amounts are 100x the asset-normalised supply: vault shares carry
// two more decimals than their asset (IPOR Fusion's decimals offset) and the
// collector scales them by the asset's decimals. Measured across every vault
// with data — all 92 agree.
const SHARE_SCALE = 100;
// A gap is real when it is both a meaningful fraction of the vault and a
// meaningful amount of money. Fees alone drift by a percent or two.
const TOL_FRAC = 0.02, TOL_USD = 500;

// The snapshot job records some vaults' share price un-normalised for that
// same decimals offset — 0.0109 where it means 1.09 — and flips between the
// two forms over a vault's history (IPOR USDC Lending Optimizer Base does so
// five times since 2024). Read as-is, every flip shows up as a supply jump of
// 100x and reads as tens of millions of missing deposits. A vault's share
// price starts at 1, so below 0.1 is the un-normalised form, not a 90% loss.
const normalisedSharePrice = (sp) => (sp > 0 && sp < 0.1 ? sp * SHARE_SCALE : sp);

// Two different failures look alike in a single number, so each vault gets
// two:
//
//   history never collected   the gap already there when the collector first
//                             saw the vault — it starts 48 hours back, so a
//                             vault tracked late has every older deposit
//                             missing (rETH Liquity LP Carry: $13M from March)
//   missed while collecting   any change in the gap since then — events lost
//                             while the vault was supposedly being watched:
//                             a frozen chain, a skipped range
//
// They have different causes and different fixes: a backfill for the first,
// a collector bug for the second.
function audit({ events, snapshots, vaults, lastBlock }) {
  const evBy = {};
  for (const e of events) {
    const a = (e.vault || '').toLowerCase();
    if (!a || e.block == null || e.shares == null) continue;
    (evBy[a] = evBy[a] || []).push(e);
  }
  const rows = [];
  for (const v of vaults) {
    const a = (v.address || '').toLowerCase();
    const snaps = (snapshots[a] || [])
      .filter(s => s.block != null && s.sharePrice > 0 && s.assets != null)
      .sort((x, y) => x.block - y.block);
    if (!snaps.length) continue;
    const evs = (evBy[a] || []).slice().sort((x, y) => x.block - y.block || (x.logIdx || 0) - (y.logIdx || 0));
    const firstEventBlock = evs.length ? evs[0].block : Infinity;

    let i = 0, supply = 0, base = null, lastGood = null, peak = 0;
    const series = [];
    for (const s of snaps) {
      while (i < evs.length && evs[i].block <= s.block) {
        const sh = (evs[i].shares || 0) / SHARE_SCALE;
        supply += evs[i].type === 'deposit' ? sh : -sh;
        i++;
      }
      const sp = normalisedSharePrice(s.sharePrice);
      const snapSupply = s.assets / sp;
      const gap = snapSupply - supply;                        // >0: deposits missing; <0: exits missing
      // The baseline is the first snapshot once the collector had seen the
      // vault. Before it, the gap is history; after it, any change is a miss.
      if (!base && s.block >= firstEventBlock) base = { gap, snapshot: s };
      const drift = base ? gap - base.gap : 0;
      // Fee shares accrue in proportion to how big the vault has BEEN, so the
      // allowance scales with its peak since the baseline, not with what is
      // left — a vault that shrank 20x otherwise flags its own old fees.
      if (base) peak = Math.max(peak, snapSupply);
      const scale = Math.max(snapSupply, supply, peak);
      const unitUsd = s.assets > 0 && s.tvlUsd > 0 ? s.tvlUsd / s.assets : (s.priceUsd || 0);
      const off = Math.abs(drift) > TOL_FRAC * scale && Math.abs(drift * sp * unitUsd) > TOL_USD;
      if (base && !off) lastGood = s;
      series.push({ s, sp, gap, drift, off, unitUsd, snapSupply, supply });
    }
    const last = series[series.length - 1];
    const usdPerUnit = last.sp * last.unitUsd;
    const historyGap = base ? base.gap : last.gap;              // no events at all: all of it is history
    const tolHit = (g) => Math.abs(g) > TOL_FRAC * Math.max(last.snapSupply, last.supply) && Math.abs(g * usdPerUnit) > TOL_USD;
    const missedWhileScanning = base ? last.off : false;
    const missingHistory = tolHit(historyGap);
    const divergedAt = missedWhileScanning
      ? series.find(r => r.s.block > (lastGood ? lastGood.block : -1) && r.off) : null;
    const lastEvent = evs.length ? evs[evs.length - 1] : null;
    rows.push({
      address: a, name: v.name, chain: v.chain, tvl: v.tvl || 0,
      events: evs.length,
      cursor: lastBlock ? lastBlock[a] : undefined,
      snapshotBlock: last.s.block,
      lastEventAt: lastEvent ? lastEvent.timestamp : null,
      supplyFromSnapshots: last.snapSupply,
      supplyFromEvents: last.supply,
      historyGapUsd: historyGap * usdPerUnit,
      coverageGapUsd: base ? last.drift * usdPerUnit : 0,
      gapUsd: last.gap * usdPerUnit,
      missingHistory, missedWhileScanning,
      missing: !(missingHistory || missedWhileScanning) ? null
        : (missedWhileScanning ? last.drift : historyGap) > 0 ? 'deposits' : 'withdrawals',
      coverageBegan: base ? base.snapshot.timestamp : null,
      lastReconciledAt: lastGood ? lastGood.timestamp : null,
      divergedBy: divergedAt ? divergedAt.s.timestamp : null,
    });
  }
  return rows.sort((x, y) => Math.abs(y.coverageGapUsd) + Math.abs(y.historyGapUsd)
                           - Math.abs(x.coverageGapUsd) - Math.abs(x.historyGapUsd));
}

function main() {
  const ae = read('activity-events.json');
  const tv = read('tvl-snapshots.json');
  const iv = read('ipor-vaults.json');
  const snapshots = {};
  for (const [k, v] of Object.entries(tv.vaults || {})) snapshots[k.toLowerCase()] = v.snapshots || [];
  // Audit what the collector is supposed to cover: the vaults it tracks.
  const tracked = new Set((ae.vaults || []).map(v => (v.address || '').toLowerCase()));
  const vaults = (iv.vaults || []).filter(v => tracked.has((v.address || '').toLowerCase()));
  const rows = audit({ events: ae.events || [], snapshots, vaults, lastBlock: ae.lastBlock || {} });

  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); }
  else {
    const fmt = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
    const day = (t) => t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
    const scanning = rows.filter(r => r.missedWhileScanning);
    const history = rows.filter(r => r.missingHistory);
    console.log(`${rows.length} tracked vaults with snapshots`);
    console.log(`\nMISSED WHILE COLLECTING — ${scanning.length} vaults (a collector fault; the fix is in the collector)\n`);
    for (const r of scanning.sort((a, b) => Math.abs(b.coverageGapUsd) - Math.abs(a.coverageGapUsd))) {
      console.log(`  ${r.chain.padEnd(9)} ${r.name.slice(0, 38).padEnd(38)} ${(r.coverageGapUsd > 0 ? 'deposits' : 'withdrawals').padEnd(11)}`
        + ` ${fmt(r.coverageGapUsd).padStart(12)}   agreed until ${day(r.lastReconciledAt)}   last event ${day(r.lastEventAt)}`);
    }
    console.log(`\nHISTORY NEVER COLLECTED — ${history.length} vaults (older than the collector's first look; the fix is a backfill)\n`);
    for (const r of history.sort((a, b) => Math.abs(b.historyGapUsd) - Math.abs(a.historyGapUsd))) {
      console.log(`  ${r.chain.padEnd(9)} ${r.name.slice(0, 38).padEnd(38)} ${(r.historyGapUsd > 0 ? 'deposits' : 'withdrawals').padEnd(11)}`
        + ` ${fmt(r.historyGapUsd).padStart(12)}   first event ${day(r.coverageBegan)}`);
    }
  }
  const failOver = process.argv.indexOf('--fail-over');
  if (failOver > 0) {
    const limit = Number(process.argv[failOver + 1]);
    const over = rows.filter(r => r.missedWhileScanning && Math.abs(r.coverageGapUsd) > limit);
    if (over.length) {
      console.error(`\n${over.length} vault(s) missing more than $${limit.toLocaleString('en-US')} of events`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main();
module.exports = { audit, SHARE_SCALE, normalisedSharePrice };
