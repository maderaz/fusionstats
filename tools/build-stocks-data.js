#!/usr/bin/env node
'use strict';
// build-stocks-data.js — everything the Stocks page reads, in one small file.
//
// The page covers the vaults backed by tokenised equities, nine of ~100, yet
// it opened by downloading four whole files — every deposit and withdrawal
// ever collected, every vault's TVL history, the full vault list and the
// router names: 4.7 MB over the wire, ~30 MB of JSON to parse, then thrown
// away bar the stock vaults' share. On a phone that was 8 seconds before the
// first number. This writes the stock vaults' share of those four files to
// stocks-data.json, in the same shapes, so the page reads it exactly as it
// read the originals:
//
//   ipor       ipor-vaults.json's stock vaults, entries as they are
//   tvl        tvl-snapshots.json's entries for those vaults, as they are
//   activity   activity-events.json's non-synthetic events on those vaults,
//              in file order, with only the fields the page reads, and the
//              file's updatedAt; a relay hop's two legs (routes.js
//              markRelays: one wallet's withdrawal deposited by the next) carry
//              relay: 'out' / 'in', found here where the receiver still is
//   identity   router-identity.json's entries for every address those events
//              were sent or owned by, plus every entry sharing a protocol name
//              with one of them (a route row describes its protocol from all
//              of that protocol's contracts), in file order, and its _meta
//
// The page falls back to the four files when this one is missing.
//
//   node tools/build-stocks-data.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// A stock vault's underlying token: the 0xb2 vanity prefix tokenised equities
// are minted under. Must match STOCK_RE in stocks/index.html (the test checks).
const STOCK_RE = /^0xb20{20}/;
// Event fields the page and routes.js read. tx, logIdx, chain, vaultName,
// underlyingToken and usdPrice they do not.
const KEEP = ['type', 'vault', 'symbol', 'sender', 'owner', 'assets', 'shares', 'block', 'timestamp', 'usdValue'];
// Set on a relay hop's legs only.
const OPTIONAL = ['relay'];

// routes.js is the page's script (window.FusionRoutes); its relay rule is read
// from there rather than copied, so the page and this file cannot disagree.
const ROUTES = (() => {
  const win = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'routes.js'), 'utf8'))(win);
  return win.FusionRoutes;
})();

const lc = (a) => (a || '').toLowerCase();

function buildStocks({ ipor, tvl, activity, identity }) {
  const vaults = ((ipor && ipor.vaults) || []).filter(v => STOCK_RE.test(lc(v.assetAddress)));
  const addrs = new Set(vaults.map(v => lc(v.address)));

  const snaps = {};
  for (const [k, entry] of Object.entries((tvl && tvl.vaults) || {})) {
    if (addrs.has(lc(k))) snaps[k] = entry;
  }

  const full = ((activity && activity.events) || [])
    .filter(e => addrs.has(lc(e.vault)) && e.synthetic !== true)
    .map(e => ({ ...e }));
  ROUTES.markRelays(full);
  const events = [];
  const seen = new Set();
  for (const e of full) {
    const out = {};
    for (const k of KEEP.concat(OPTIONAL)) if (e[k] !== undefined) out[k] = e[k];
    events.push(out);
    if (e.sender) seen.add(lc(e.sender));
    if (e.owner) seen.add(lc(e.owner));
  }

  const ids = {};
  const raw = identity || {};
  const protocols = new Set();
  for (const k of Object.keys(raw)) {
    if (k !== '_meta' && seen.has(lc(k)) && raw[k] && raw[k].protocol) protocols.add(raw[k].protocol);
  }
  if (raw._meta) ids._meta = raw._meta;
  for (const k of Object.keys(raw)) {
    if (k === '_meta') continue;
    const id = raw[k];
    if (seen.has(lc(k)) || (id && id.protocol && protocols.has(id.protocol))) ids[k] = id;
  }

  return {
    builtAt: new Date().toISOString(),
    ipor: { updatedAt: ipor && ipor.updatedAt, vaults },
    tvl: { updatedAt: tvl && tvl.updatedAt, vaults: snaps },
    activity: { updatedAt: activity && activity.updatedAt, events },
    identity: ids,
  };
}

function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); } catch { return null; }
}

function main() {
  const ipor = readJson('ipor-vaults.json');
  const activity = readJson('activity-events.json');
  // Without the vault list there is no telling which vaults are stocks, and
  // without the events the page would have nothing to count: keep the last
  // good file rather than write an empty one.
  if (!ipor || !activity) {
    console.log('stocks-data.json: left as it was (' + (!ipor ? 'ipor-vaults.json' : 'activity-events.json') + ' unreadable)');
    return;
  }
  const out = buildStocks({ ipor, activity, tvl: readJson('tvl-snapshots.json'), identity: readJson('router-identity.json') });
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'stocks-data.json'), body + '\n');
  console.log(`stocks-data.json: ${out.ipor.vaults.length} vaults, ${out.activity.events.length} events, `
    + `${Object.keys(out.tvl.vaults).length} snapshot series, ${Object.keys(out.identity).length} router entries, `
    + `${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildStocks, STOCK_RE, KEEP, OPTIONAL };
