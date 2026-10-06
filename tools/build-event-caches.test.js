#!/usr/bin/env node
'use strict';
// Tests for the event-cache rebuild. Run: node tools/build-event-caches.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BUILDERS, FILES } = require('./build-event-caches.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

console.log('\nevent caches');

test('each builder exists and writes the files listed for it', () => {
  for (const [script, files] of BUILDERS) {
    const src = fs.readFileSync(path.join(__dirname, script), 'utf8');
    for (const f of files) assert.ok(src.includes(`'${f}'`), `${script} does not write ${f}`);
  }
});

test('every page file cut from the events is listed', () => {
  // Any builder that reads activity-events.json has its outputs here.
  for (const script of fs.readdirSync(__dirname).filter(f => /^build-.*\.js$/.test(f) && !f.endsWith('.test.js') && f !== 'build-event-caches.js')) {
    const src = fs.readFileSync(path.join(__dirname, script), 'utf8');
    if (!/activity-events\.json/.test(src)) continue;
    const writes = [...src.matchAll(/writeFileSync\(path\.join\(ROOT, '([^']+)'/g)].map(m => m[1]);
    for (const f of writes) assert.ok(FILES.includes(f), `${script} writes ${f}, which is not rebuilt`);
  }
});

test('--list prints the files, one a line, and builds nothing', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'build-event-caches.js'), '--list'], { encoding: 'utf8' });
  assert.deepStrictEqual(out.trim().split('\n'), FILES);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
