#!/usr/bin/env node
'use strict';
// build-share-prices.js — the Share-Price Monitor's rows, every window, ready.
//
// The Monitor shows each vault's share price over 7, 30 or 90 days or all of
// it: where it started and ended, the change, its annualised rate, whether
// the data can be trusted, and a sparkline. It downloaded every snapshot of
// every vault for that (tvl-snapshots.json, 11 MB, 1.5 MB over the wire).
// This works the rows out with the page's own code (share-price.js) for the
// four windows and writes them to share-prices.json:
//
//   updatedAt  tvl-snapshots.json's
//   windows    { "7": rows, "30": rows, "90": rows, "0": rows }, each row in
//              share-price.js's packed form: the numbers exactly, the
//              sparkline as its shape
//
// The page falls back to tvl-snapshots.json while this file does not exist.
//
//   node tools/build-share-prices.js

const fs = require('fs');
const path = require('path');
const SharePrice = require('../share-price.js');

const ROOT = path.join(__dirname, '..');

function buildSharePrices(snapshots) {
  const vaults = (snapshots && snapshots.vaults) || {};
  const windows = {};
  for (const w of SharePrice.WINDOWS) windows[String(w)] = SharePrice.rows(vaults, w).map(SharePrice.pack);
  return { updatedAt: (snapshots && snapshots.updatedAt) || null, windows };
}

function main() {
  let snapshots;
  try { snapshots = JSON.parse(fs.readFileSync(path.join(ROOT, 'tvl-snapshots.json'), 'utf8')); }
  catch { console.log('share-prices.json: left as it was (tvl-snapshots.json unreadable)'); return; }
  const out = buildSharePrices(snapshots);
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'share-prices.json'), body + '\n');
  console.log(`share-prices.json: ${out.windows['0'].length} vaults x ${Object.keys(out.windows).length} windows, ${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildSharePrices };
