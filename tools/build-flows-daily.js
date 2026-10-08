#!/usr/bin/env node
'use strict';
// build-flows-daily.js — what Key Metrics' flow bars draw, all time, without
// the 20 MB it is cut from.
//
// Key Metrics loads only the last five weeks of events (activity-recent.json),
// which drew the last thirty days of net flow. Its chart now runs the whole
// history beside the TVL line, so this sums every deposit and withdrawal in
// activity-events.json by UTC day:
//
//   updatedAt   activity-events.json's
//   firstDay    the first day with an event (days since the epoch, UTC)
//   lastDay     the last
//   inflow      dollars deposited each day, from firstDay to lastDay
//   outflow     dollars withdrawn each day, the same days
//
// in USD at each event's own time (its usdValue), synthetic flows (wrappers,
// rebalances) left out, as the page leaves them out. A few KB. The page falls
// back to its recent events while this does not exist.
//
//   node tools/build-flows-daily.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DAY = 86400;

function buildFlowsDaily(file) {
  const events = (file && Array.isArray(file.events)) ? file.events : [];
  const by = new Map();
  let lo = Infinity, hi = -Infinity;
  for (const e of events) {
    if (!e || e.synthetic === true || !(e.timestamp > 0) || !(e.usdValue >= 0)) continue;
    if (e.type !== 'deposit' && e.type !== 'withdraw') continue;
    const d = Math.floor(e.timestamp / DAY);
    const r = by.get(d) || [0, 0];
    r[e.type === 'deposit' ? 0 : 1] += e.usdValue;
    by.set(d, r);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  if (!by.size) return { updatedAt: (file && file.updatedAt) || null, firstDay: null, lastDay: null, inflow: [], outflow: [] };
  const inflow = [], outflow = [];
  for (let d = lo; d <= hi; d++) {
    const r = by.get(d) || [0, 0];
    inflow.push(Math.round(r[0]));
    outflow.push(Math.round(r[1]));
  }
  return { updatedAt: (file && file.updatedAt) || null, firstDay: lo, lastDay: hi, inflow, outflow };
}

function main() {
  let file;
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8')); }
  catch { console.log('flows-daily.json: left as it was (activity-events.json unreadable)'); return; }
  const out = buildFlowsDaily(file);
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'flows-daily.json'), body + '\n');
  console.log(`flows-daily.json: ${out.inflow.length} days, ${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildFlowsDaily };
