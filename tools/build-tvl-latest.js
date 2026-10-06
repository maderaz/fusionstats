#!/usr/bin/env node
'use strict';
// build-tvl-latest.js — each vault's latest on-chain TVL, without its history.
//
// The All Vaults page shows one TVL per vault: its latest on-chain snapshot
// (totalAssets × price), preferred over ipor-vaults.json's API figure, which
// can be stale. It downloaded tvl-snapshots.json for that — every snapshot
// of every vault, 11 MB — to keep one number from each. This writes those
// numbers to tvl-latest.json, picked by the page's own rule:
//
//   the last snapshot whose tvlUsd is a number, at least 0 and under $2B
//   (no Fusion vault is near $2B: a reading above it is a decimals error)
//
// Keys are the vault addresses lower-cased. The page falls back to
// tvl-snapshots.json while this file does not exist.
//
//   node tools/build-tvl-latest.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_SANE_TVL = 2e9;

function buildLatest(snapshots) {
  const vaults = {};
  for (const [addr, v] of Object.entries((snapshots && snapshots.vaults) || {})) {
    const series = (v.snapshots || []).filter(s => typeof s.tvlUsd === 'number' && s.tvlUsd >= 0 && s.tvlUsd < MAX_SANE_TVL);
    if (series.length) vaults[addr.toLowerCase()] = series[series.length - 1].tvlUsd;
  }
  return { updatedAt: snapshots && snapshots.updatedAt, vaults };
}

function main() {
  let snapshots;
  try { snapshots = JSON.parse(fs.readFileSync(path.join(ROOT, 'tvl-snapshots.json'), 'utf8')); }
  catch { console.log('tvl-latest.json: left as it was (tvl-snapshots.json unreadable)'); return; }
  const out = buildLatest(snapshots);
  const body = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'tvl-latest.json'), body + '\n');
  console.log(`tvl-latest.json: ${Object.keys(out.vaults).length} vaults, ${(body.length / 1024).toFixed(1)} KB`);
}

if (require.main === module) main();
module.exports = { buildLatest, MAX_SANE_TVL };
