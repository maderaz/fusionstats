#!/usr/bin/env node
'use strict';
// build-tvl-daily.js — what the TVL page draws, without the 11 MB it drew it from.
//
// The TVL page built its charts from tvl-snapshots.json, every snapshot of
// every vault: 11 MB, 1.5 MB over the wire, before the first bar. What it
// draws is total value locked per network per day. This runs the page's own
// code for that (tvl-series.js) over the same two files and writes the
// result to tvl-daily.json: each network's daily values and today's, plus
// the date of each source. The page falls back to the two files while this
// one does not exist.
//
//   node tools/build-tvl-daily.js

const fs = require('fs');
const path = require('path');
const TvlSeries = require('../tvl-series.js');

const ROOT = path.join(__dirname, '..');

function buildDaily(ipor, snapshots) {
  const anchorTs = new Date((ipor && ipor.updatedAt) || Date.now()).getTime() / 1000;
  const series = TvlSeries.buildSeries({ vaults: (ipor && ipor.vaults) || [], snapshots: (snapshots && snapshots.vaults) || {}, anchorTs });
  return TvlSeries.pack(series, { updatedAt: ipor && ipor.updatedAt, snapshotsUpdatedAt: snapshots && snapshots.updatedAt });
}

function main() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const ipor = read('ipor-vaults.json'), snapshots = read('tvl-snapshots.json');
  if (!ipor || !snapshots) { console.log('tvl-daily.json: left as it was (' + (!ipor ? 'ipor-vaults' : 'tvl-snapshots') + '.json unreadable)'); return; }
  const out = buildDaily(ipor, snapshots);
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'tvl-daily.json'), body + '\n');
  console.log(`tvl-daily.json: ${Object.keys(out.perChain).length} networks, ${out.anchorDay - out.minDay + 1} days, ${(body.length / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();
module.exports = { buildDaily };
