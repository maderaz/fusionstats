#!/usr/bin/env node
'use strict';
// check-collection-health.js — fail the run when a chain is not being collected.
//
// The activity step runs with continue-on-error, so that one chain's bad day
// cannot cost every other chain its data. The price of that was that nothing
// ever failed: Base stopped for five days and Ethereum for three weeks, every
// run green, the problem printed as a warning nobody reads. This step runs
// AFTER the data is committed and fails the job when a chain that holds real
// money is stalled, unreachable, or has been catching up for too long — so a
// scheduled run goes red and GitHub sends its failure notice.
//
// Chains below the TVL floor are reported but never fail the run: a chain
// with only dust on it should not page anyone.
//
// Behind is not by itself a failure. A vault back above the collector's TVL
// floor resumes from the cursor it had when it dropped out: on Oct 6 that was
// 8 days back, and a run that was catching it up, with every other Base vault
// at the head, failed as "base not being collected". What fails now is a
// chain that has been behind for more than MAX_BEHIND_HOURS of clock time
// (catching up for too long), or one with a vault holding at least the floor
// that this run asked about and could not move at all (stuck).
//
// A verdict only counts if THIS run wrote it. If the activity step crashed,
// hit its timeout, or never ran the current code, the file still holds the
// last good run's verdicts, or none at all, and a check that read those
// passed a run that collected nothing. On 2026-10-03 a re-run of an older
// scheduled run did exactly that: GitHub re-runs reuse the original commit,
// so the fixed collector never ran and nothing said so. So: no verdict from
// this run fails the job, and so does a chain that held money and has had no
// verdict for a day. (A chain the run's time budget skipped once is shown
// but does not fail.)
//
//   node tools/check-collection-health.js
//   HEALTH_TVL_FLOOR=10000 MAX_BEHIND_HOURS=24 node tools/check-collection-health.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TVL_FLOOR = Number(process.env.HEALTH_TVL_FLOOR || 10_000);
const MAX_BEHIND_HOURS = Number(process.env.MAX_BEHIND_HOURS || 24);
// The collector runs minutes before this check; anything older is another run's.
const THIS_RUN_MINUTES = Number(process.env.THIS_RUN_MINUTES || 90);

// One row per chain that has either a verdict or tracked money. Rows the
// collector did not write this run come back as status 'unreported'.
function evaluate(chainHealth, tvlByChain, now = Date.now()) {
  const verdicts = chainHealth || {};
  const ageHours = (h) => {
    const t = h && Date.parse(h.checkedAt);
    return Number.isFinite(t) ? (now - t) / 3.6e6 : Infinity;
  };
  const fresh = (h) => ageHours(h) * 60 <= THIS_RUN_MINUTES;
  const collectorReported = Object.values(verdicts).some(fresh);
  const chains = new Set([...Object.keys(verdicts), ...Object.keys(tvlByChain)]);
  const rows = [...chains].map((chain) => {
    const h = verdicts[chain];
    const tvl = tvlByChain[chain] || 0;
    const matters = tvl >= TVL_FLOOR;
    if (!h || !fresh(h)) {
      const age = ageHours(h);
      return {
        chain, tvl, matters, ...(h || {}),
        status: 'unreported',
        reason: !h ? 'never reported' : `no verdict this run — last one ${Math.round(age)}h old`,
        failing: matters && (!collectorReported || !h || age > MAX_BEHIND_HOURS),
      };
    }
    // How long the chain has been behind, from the collector's behindSince;
    // a verdict without one (an older collector) is judged by its lag.
    const since = h.behindSince ? Date.parse(h.behindSince) : NaN;
    const behindHours = Number.isFinite(since) ? Math.max(0, (now - since) / 3.6e6) : null;
    const stuck = (h.laggards || []).filter(l => l.stuck && (l.tvl || 0) >= TVL_FLOOR);
    const tooLong = behindHours != null ? behindHours > MAX_BEHIND_HOURS : (h.lagHours || 0) > MAX_BEHIND_HOURS;
    const failing = matters && (h.status === 'stalled' || h.status === 'unreachable'
      || (h.status === 'behind' && (tooLong || stuck.length > 0)));
    return { chain, tvl, matters, failing, behindHours, stuck, ...h };
  });
  rows.collectorReported = collectorReported;
  return rows.sort((a, b) => b.tvl - a.tvl);
}

// Which vaults are behind, for how long the chain has been, and why.
function note(r) {
  const parts = [];
  if (r.status === 'behind' || r.status === 'stalled') {
    if (r.behindHours != null) parts.push(r.behindHours < 1 ? 'behind since this run' : `behind for ${Math.round(r.behindHours)}h`);
    const l = r.laggards || [];
    if (l.length) {
      parts.push(l.slice(0, 2).map(x => `${x.name || x.address} ${x.lagHours}h${x.stuck ? ' (stuck)' : ''}`).join(', ')
        + (l.length > 2 ? ` and ${l.length - 2} more` : ''));
    }
  }
  if (r.reason) parts.push(String(r.reason).slice(0, 80));
  return parts.join(' · ').replace(/\|/g, '/');
}

function main() {
  const ae = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8'));
  const tvlByChain = {};
  for (const v of ae.vaults || []) tvlByChain[v.chain] = (tvlByChain[v.chain] || 0) + (v.tvl || 0);
  const rows = evaluate(ae.chainHealth, tvlByChain);

  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const lines = ['| chain | tracked TVL | status | behind head | note |', '|---|---:|---|---:|---|'];
  for (const r of rows) {
    const status = r.status === 'behind' && !r.failing ? 'catching up' : r.status;
    lines.push(`| ${r.chain} | ${usd(r.tvl)} | ${r.failing ? '**' + status + '**' : status} | `
      + `${r.lagHours == null ? '—' : r.lagHours + 'h'} | ${note(r)} |`);
  }
  let audit = '';
  try {
    const { audit: run } = require('./audit-activity.js');
    const tv = JSON.parse(fs.readFileSync(path.join(ROOT, 'tvl-snapshots.json'), 'utf8'));
    const iv = JSON.parse(fs.readFileSync(path.join(ROOT, 'ipor-vaults.json'), 'utf8'));
    const snapshots = {};
    for (const [k, v] of Object.entries(tv.vaults || {})) snapshots[k.toLowerCase()] = v.snapshots || [];
    const tracked = new Set((ae.vaults || []).map(v => v.address.toLowerCase()));
    const found = run({ events: ae.events || [], snapshots, lastBlock: ae.lastBlock || {},
                        vaults: (iv.vaults || []).filter(v => tracked.has(v.address.toLowerCase())) })
      .filter(r => r.missedWhileScanning);
    if (found.length) {
      audit = `\n\n### Events missed while collecting (${found.length} vaults)\n\n`
        + '| vault | chain | missing | since | ~USD |\n|---|---|---|---|---:|\n'
        + found.slice(0, 15).map(r => `| ${r.name} | ${r.chain} | ${r.missing} | `
          + `${r.divergedBy ? new Date(r.divergedBy * 1000).toISOString().slice(0, 10) : '—'} | ${usd(Math.abs(r.coverageGapUsd))} |`).join('\n');
    }
  } catch (e) { audit = `\n\n(audit unavailable: ${e.message})`; }

  const failing = rows.filter(r => r.failing);
  const head = !rows.collectorReported
    ? '## ❌ The activity collector did not report this run\n\nIt crashed, hit its time limit, or this is an older '
      + 'commit being re-run (GitHub re-runs reuse the original commit; use **Run workflow** to run the current code).'
    : failing.length
      ? `## ❌ ${failing.length} chain${failing.length === 1 ? '' : 's'} not being collected`
      : '## ✅ Every chain with real TVL is being collected'
        + (rows.some(r => r.status === 'behind')
          ? `\n\nCatching up: ${rows.filter(r => r.status === 'behind').map(r => `${r.chain} (${(r.laggards || []).length} vault${(r.laggards || []).length === 1 ? '' : 's'})`).join(', ')}.`
          : '');
  const md = `${head}\n\n${lines.join('\n')}${audit}\n`;
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  for (const r of failing) {
    console.log(`::error::${r.chain} (${usd(r.tvl)} tracked) is ${r.status}`
      + (r.lagHours != null ? `, ${r.lagHours}h behind the head` : '') + (r.reason ? ` — ${r.reason}` : ''));
  }
  if (failing.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { evaluate };
