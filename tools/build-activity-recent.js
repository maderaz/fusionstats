#!/usr/bin/env node
'use strict';
// build-activity-recent.js — what the Activity page opens with.
//
// activity-events.json holds every deposit and withdrawal ever collected:
// 28K+ events, 19 MB, 2.9 MB over the wire, all downloaded and parsed before
// the page could show anything. The page needs a fraction of that to open:
// the last 30 days for its net-inflow figures and chart, and the newest
// events for the first pages of the list. This writes that fraction to
// activity-recent.json, plus the few facts the page derives from the whole
// history, so that what it shows is the same either way:
//
//   events       every event from the last WINDOW_DAYS (at least MIN_EVENTS),
//                in the full file's order, with only the fields the page reads
//   coveredFrom  unix time: every event at or after it is in `events`, so a
//                filtered list is exact down to that point
//   prices       the latest priced event per symbol, over all history: what
//                the page values an unpriced event with
//   eventVaults  every vault with at least one event, and the names its events
//                were stored under: the Product filter
//   eventChains  chains with at least one event: the Chain filter's labels
//   total        events in the full file
//
// The page reaches for the full file only when a page or a filter goes past
// coveredFrom.
//
//   node tools/build-activity-recent.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WINDOW_DAYS = 35;      // the page's 30-day figures, with five days' slack
const MIN_EVENTS = 2000;     // and never fewer than this, however quiet a month
// Fields the page reads. sender, shares, logIdx and usdPrice it does not.
const KEEP = ['type', 'vault', 'vaultName', 'symbol', 'chain', 'underlyingToken', 'owner', 'assets',
              'tx', 'block', 'timestamp', 'usdValue', 'synthetic', 'syntheticReason'];

// Symbols as the page assigns them: a vault it knows lends its symbol to every
// event; any other event keeps the symbol it was stored with. The page knows
// the vaults in activity-events.json, plus IPOR's list above $1K TVL.
function pageVaults(data, ipor) {
  const known = {};
  for (const v of data.vaults || []) known[v.address] = v;
  const tracked = new Set(Object.keys(known));
  for (const v of (ipor && ipor.vaults) || []) {
    if (v.tvl >= 1000 && !tracked.has(v.address)) known[v.address] = { symbol: v.token, name: v.name };
  }
  return known;
}

function buildRecent(data, ipor, { windowDays = WINDOW_DAYS, minEvents = MIN_EVENTS } = {}) {
  const events = data.events || [];
  const known = pageVaults(data, ipor);

  const prices = {};
  const eventVaults = {};
  const eventChains = new Set();
  for (const e of events) {
    const v = known[e.vault];
    const sym = v ? v.symbol : e.symbol;
    if (e.usdValue != null && e.assets > 0 && sym) {
      const ts = e.timestamp || 0;
      if (!prices[sym] || ts > prices[sym][0]) prices[sym] = [ts, e.usdValue / e.assets];
    }
    if (e.vaultName) {
      const names = eventVaults[e.vault] || (eventVaults[e.vault] = []);
      if (!names.includes(e.vaultName)) names.push(e.vaultName);
    } else if (!eventVaults[e.vault]) eventVaults[e.vault] = [];
    eventChains.add(e.chain || 'ethereum');
  }

  const asOf = Math.floor(Date.parse(data.updatedAt || new Date().toISOString()) / 1000);
  let coveredFrom = asOf - windowDays * 86400;
  const stamps = events.map(e => e.timestamp || 0).filter(t => t > 0).sort((a, b) => b - a);
  if (stamps.length > minEvents && stamps[minEvents - 1] < coveredFrom) coveredFrom = stamps[minEvents - 1];
  if (stamps.length <= minEvents) coveredFrom = stamps.length ? stamps[stamps.length - 1] : 0;

  // File order, not sorted: the page sorts with a stable sort, so ties land
  // exactly where they would among all events.
  const recent = [];
  for (const e of events) {
    if (!((e.timestamp || 0) >= coveredFrom) || !(e.timestamp > 0)) continue;
    const out = {};
    for (const k of KEEP) if (e[k] !== undefined) out[k] = e[k];
    recent.push(out);
  }

  return {
    updatedAt: data.updatedAt,
    minTvlUsd: data.minTvlUsd,
    vaults: data.vaults || [],
    total: events.length,
    coveredFrom,
    prices,
    eventVaults,
    eventChains: [...eventChains].sort(),
    events: recent,
  };
}

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8'));
  let ipor = null;
  try { ipor = JSON.parse(fs.readFileSync(path.join(ROOT, 'ipor-vaults.json'), 'utf8')); } catch {}
  const out = buildRecent(data, ipor);
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'activity-recent.json'), body + '\n');
  const days = ((Date.parse(out.updatedAt) / 1000 - out.coveredFrom) / 86400).toFixed(1);
  console.log(`activity-recent.json: ${out.events.length} of ${out.total} events (last ${days} days), `
    + `${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildRecent, WINDOW_DAYS, MIN_EVENTS };
