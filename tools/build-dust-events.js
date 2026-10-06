#!/usr/bin/env node
'use strict';
// build-dust-events.js — what the Dust Tracker counts, and nothing else.
//
// The page counts small deposits: every deposit under a threshold of at most
// $20K. For that it downloaded every event ever collected (activity-events
// .json, 19.7 MB, 2.9 MB over the wire) and then ZyfAI's wallet list
// (zyfai-wallets.json, 1.7 MB) to mark which deposits ZyfAI made. This
// writes the deposits it can count, with that mark already made, to
// dust-events.json:
//
//   updatedAt      activity-events.json's
//   maxUsd         20000: deposits at or above it are only counted, below
//   totalDeposits  every deposit with a USD value (the page's "of all")
//   vaults         [address, name, chain, deposits] for every vault with an
//                  event, in the order of its first event, named and placed
//                  by that event, with its count of deposits (any value)
//   owners         the wallets of the deposits kept, lower-cased
//   events         [vault index, owner index or null, ZyfAI (0/1), timestamp,
//                   usdValue, assets, symbol, chain]: every deposit with a
//                   USD value under maxUsd, in file order
//
// and their transaction hashes, in the same order, to dust-events-tx.json
// (with the same updatedAt), which the page fetches when its transaction
// list is first opened. Synthetic flows (wrappers, rebalances) are left out
// throughout, as the page leaves them out. A deposit is ZyfAI's when its
// sender or owner is one of ZyfAI's routers below or a wallet in
// zyfai-wallets.json. The page falls back to the whole files while these do
// not exist.
//
//   node tools/build-dust-events.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_USD = 20000;
// ZyfAI's ERC-4337 routers and executors, as the page lists them.
const ZYFAI_ROUTERS = ['0xaffd3c3cd06cf499deddf78b26868018a93f2c31', '0x677251190c0cccc6e7e71c385b3ea660dfd89c00',
  '0xea49d02c248b357b99670d9e9741f54f72df9cb3', '0x9af838b8bb05269dac4f30a127f171d3cf76dac3',
  '0x399502b8dc8a38e2cd2d670f4f40cc168c063585', '0xecd2bf892e2ee99cf2cbbc81f6877132e25e34db'];

function buildDustEvents(file, zyfai) {
  const events = (file && Array.isArray(file.events)) ? file.events : [];
  const Z = new Set(ZYFAI_ROUTERS);
  ((zyfai && Array.isArray(zyfai.addresses)) ? zyfai.addresses : []).forEach(a => Z.add(String(a || '').toLowerCase()));
  const isZ = (e) => Z.has(String(e.sender || '').toLowerCase()) || Z.has(String(e.owner || '').toLowerCase());

  const vaults = [], vaultIdx = new Map();
  let totalDeposits = 0;
  for (const e of events) {
    if (!e || !e.vault) continue;
    if (!vaultIdx.has(e.vault)) { vaultIdx.set(e.vault, vaults.length); vaults.push([e.vault, e.vaultName || null, e.chain || null, 0]); }
    if (e.type === 'deposit' && e.synthetic !== true) {
      vaults[vaultIdx.get(e.vault)][3]++;
      if (e.usdValue > 0) totalDeposits++;
    }
  }
  const owners = [], ownerIdx = new Map();
  const rows = [], tx = [];
  for (const e of events) {
    if (!e || e.type !== 'deposit' || e.synthetic === true || !(e.usdValue > 0) || !(e.usdValue < MAX_USD)) continue;
    let o = null;
    if (e.owner) {
      const w = String(e.owner).toLowerCase();
      if (!ownerIdx.has(w)) { ownerIdx.set(w, owners.length); owners.push(w); }
      o = ownerIdx.get(w);
    }
    rows.push([vaultIdx.get(e.vault), o, isZ(e) ? 1 : 0, e.timestamp || 0, e.usdValue,
      e.assets == null ? null : e.assets, e.symbol || null, e.chain || null]);
    tx.push(e.tx || null);
  }
  const updatedAt = (file && file.updatedAt) || null;
  return { events: { updatedAt, maxUsd: MAX_USD, totalDeposits, vaults, owners, events: rows }, tx: { updatedAt, tx } };
}

function main() {
  let file, zyfai = null;
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8')); }
  catch { console.log('dust-events.json: left as it was (activity-events.json unreadable)'); return; }
  try { zyfai = JSON.parse(fs.readFileSync(path.join(ROOT, 'zyfai-wallets.json'), 'utf8')); }
  catch { console.log('dust-events.json: zyfai-wallets.json unreadable, ZyfAI marked by its routers only'); }
  const out = buildDustEvents(file, zyfai);
  const body = JSON.stringify(out.events), txBody = JSON.stringify(out.tx);
  fs.writeFileSync(path.join(ROOT, 'dust-events.json'), body + '\n');
  fs.writeFileSync(path.join(ROOT, 'dust-events-tx.json'), txBody + '\n');
  console.log(`dust-events.json: ${out.events.events.length} deposits under $${MAX_USD} of ${out.events.totalDeposits}, ${out.events.vaults.length} vaults, ${(body.length / 1024).toFixed(0)} KB`
    + ` (+ ${(txBody.length / 1024).toFixed(0)} KB of hashes in dust-events-tx.json)`);
}

if (require.main === module) main();
module.exports = { buildDustEvents, MAX_USD, ZYFAI_ROUTERS };
