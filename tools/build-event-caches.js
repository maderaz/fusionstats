#!/usr/bin/env node
'use strict';
// build-event-caches.js — every page file cut from activity-events.json,
// rebuilt in one go:
//
//   activity-recent(-tx).json   Activity       tools/build-activity-recent.js
//   stocks-data.json            Stocks         tools/build-stocks-data.js
//   switch-events(-tx).json     Switchers      tools/build-switch-events.js
//   dust-events(-tx).json       Dust Tracker   tools/build-dust-events.js
//   flows-daily.json            Key Metrics    tools/build-flows-daily.js
//
// The pages read these instead of the whole history, so every workflow that
// writes the events (the backfills, the rescans) runs this before it commits:
// a page never shows less than the history holds. collect.yml runs the five
// builders as steps of their own. One builder failing does not stop the
// others, nor the run.
//
//   node tools/build-event-caches.js           rebuild them all
//   node tools/build-event-caches.js --list    the files they write, one a line

const path = require('path');
const { spawnSync } = require('child_process');

const BUILDERS = [
  ['build-activity-recent.js', ['activity-recent.json', 'activity-recent-tx.json']],
  ['build-stocks-data.js', ['stocks-data.json']],
  ['build-switch-events.js', ['switch-events.json', 'switch-events-tx.json']],
  ['build-dust-events.js', ['dust-events.json', 'dust-events-tx.json']],
  ['build-flows-daily.js', ['flows-daily.json']],
];
const FILES = BUILDERS.flatMap(([, files]) => files);

function main() {
  if (process.argv.includes('--list')) { console.log(FILES.join('\n')); return; }
  const failed = [];
  for (const [script] of BUILDERS) {
    const r = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
    if (r.status !== 0) failed.push(script);
  }
  if (failed.length) console.log(`::warning::event caches: ${failed.join(', ')} failed; the others were rebuilt`);
}

if (require.main === module) main();
module.exports = { BUILDERS, FILES };
