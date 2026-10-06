#!/usr/bin/env node
'use strict';
// build-switch-events.js — the events the Switchers page matches, and no others.
//
// The page finds switch-ins: a wallet's deposit into one Fusion vault funded
// by a similar-size withdrawal from a different one. For that it downloaded
// every event ever collected (activity-events.json, 19 MB, 2.9 MB over the
// wire). Yet only a wallet that has both deposited and withdrawn, in two
// vaults or more, can switch: about 9,000 events of 29,000. This writes those
// wallets' events to switch-events.json, every one of them and in file order,
// so the page matches exactly as it did:
//
//   updatedAt  activity-events.json's
//   vaults     [address, name, chain] for every vault with an event, in the
//              order of its first event, named and placed by that event, as
//              the page lists them
//   owners     the wallets kept, lower-cased
//   events     [vault index, owner index, type (0 deposit, 1 withdraw),
//               timestamp, usdValue, assets, symbol, chain]
//
// and their transaction hashes, in the same order, to switch-events-tx.json
// (with the same updatedAt): more than half the bytes, and only the links
// need them, so the page draws first and fetches these after.
//
// The events kept are the ones the page considers: not synthetic, with an
// owner, a USD value above 0 and a timestamp. The page falls back to
// activity-events.json while these files do not exist.
//
//   node tools/build-switch-events.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function buildSwitchEvents(file) {
  const events = (file && Array.isArray(file.events)) ? file.events : [];
  // Every vault, from its first event, as the page's vault list has it.
  const vaults = [], vaultIdx = new Map();
  for (const e of events) {
    if (!e || !e.vault || vaultIdx.has(e.vault)) continue;
    vaultIdx.set(e.vault, vaults.length);
    vaults.push([e.vault, e.vaultName || null, e.chain || null]);
  }
  // The events the page matches, grouped by wallet as it groups them.
  const byOwner = new Map();
  for (const e of events) {
    if (!e || e.synthetic === true) continue;
    if (!e.owner || !(e.usdValue > 0) || !e.timestamp) continue;
    const w = String(e.owner).toLowerCase();
    if (!byOwner.has(w)) byOwner.set(w, []);
    byOwner.get(w).push(e);
  }
  // A wallet can switch only with a deposit, a withdrawal and two vaults.
  const keep = new Set();
  for (const [w, arr] of byOwner) {
    if (arr.length < 2) continue;
    let dep = false, wd = false;
    const vs = new Set();
    for (const e of arr) { if (e.type === 'deposit') dep = true; else if (e.type === 'withdraw') wd = true; vs.add(e.vault); }
    if (dep && wd && vs.size > 1) keep.add(w);
  }
  const owners = [], ownerIdx = new Map();
  const rows = [], tx = [];
  for (const e of events) {
    if (!e || e.synthetic === true || !e.owner || !(e.usdValue > 0) || !e.timestamp) continue;
    if (e.type !== 'deposit' && e.type !== 'withdraw') continue;
    const w = String(e.owner).toLowerCase();
    if (!keep.has(w)) continue;
    if (!ownerIdx.has(w)) { ownerIdx.set(w, owners.length); owners.push(w); }
    rows.push([vaultIdx.get(e.vault), ownerIdx.get(w), e.type === 'withdraw' ? 1 : 0, e.timestamp,
      e.usdValue, e.assets == null ? null : e.assets, e.symbol || null, e.chain || null]);
    tx.push(e.tx || null);
  }
  const updatedAt = (file && file.updatedAt) || null;
  return { events: { updatedAt, vaults, owners, events: rows }, tx: { updatedAt, tx } };
}

// The page's events from the files: the shape activity-events.json has. The
// hashes only when they belong to the same build.
function unpackSwitchEvents(d, t) {
  const tx = t && t.updatedAt === d.updatedAt && Array.isArray(t.tx) && t.tx.length === d.events.length ? t.tx : null;
  return d.events.map((r, i) => ({
    vault: d.vaults[r[0]][0], owner: d.owners[r[1]], type: r[2] ? 'withdraw' : 'deposit',
    timestamp: r[3], usdValue: r[4], assets: r[5], symbol: r[6], chain: r[7], tx: tx ? tx[i] : undefined,
  }));
}

function main() {
  let file;
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8')); }
  catch { console.log('switch-events.json: left as it was (activity-events.json unreadable)'); return; }
  const out = buildSwitchEvents(file);
  const body = JSON.stringify(out.events), txBody = JSON.stringify(out.tx);
  fs.writeFileSync(path.join(ROOT, 'switch-events.json'), body + '\n');
  fs.writeFileSync(path.join(ROOT, 'switch-events-tx.json'), txBody + '\n');
  console.log(`switch-events.json: ${out.events.events.length} events of ${out.events.owners.length} wallets, ${out.events.vaults.length} vaults, ${(body.length / 1024).toFixed(0)} KB`
    + ` (+ ${(txBody.length / 1024).toFixed(0)} KB of hashes in switch-events-tx.json)`);
}

if (require.main === module) main();
module.exports = { buildSwitchEvents, unpackSwitchEvents };
