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
//   node tools/check-collection-health.js
//   HEALTH_TVL_FLOOR=10000 MAX_BEHIND_HOURS=24 node tools/check-collection-health.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TVL_FLOOR = Number(process.env.HEALTH_TVL_FLOOR || 10_000);
const MAX_BEHIND_HOURS = Number(process.env.MAX_BEHIND_HOURS || 24);

function evaluate(chainHealth, tvlByChain) {
  const rows = Object.entries(chainHealth || {}).map(([chain, h]) => {
    const tvl = tvlByChain[chain] || 0;
    const matters = tvl >= TVL_FLOOR;
    const failing = matters && (h.status === 'stalled' || h.status === 'unreachable'
      || (h.status === 'behind' && (h.lagHours || 0) > MAX_BEHIND_HOURS));
    return { chain, tvl, matters, failing, ...h };
  });
  return rows.sort((a, b) => b.tvl - a.tvl);
}

function main() {
  const ae = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8'));
  const tvlByChain = {};
  for (const v of ae.vaults || []) tvlByChain[v.chain] = (tvlByChain[v.chain] || 0) + (v.tvl || 0);
  const rows = evaluate(ae.chainHealth, tvlByChain);

  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const lines = ['| chain | tracked TVL | status | behind head | note |', '|---|---:|---|---:|---|'];
  for (const r of rows) {
    lines.push(`| ${r.chain} | ${usd(r.tvl)} | ${r.failing ? '**' + r.status + '**' : r.status} | `
      + `${r.lagHours == null ? '—' : r.lagHours + 'h'} | ${r.reason ? String(r.reason).slice(0, 80) : ''} |`);
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
  const head = failing.length
    ? `## ❌ ${failing.length} chain${failing.length === 1 ? '' : 's'} not being collected`
    : '## ✅ Every chain with real TVL is being collected';
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
