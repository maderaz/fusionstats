#!/usr/bin/env node
'use strict';
// Tests for the activity collector's cursor rule.
//
// These exist because of a real outage: Base event collection silently froze
// for five days. Deposits and withdrawals were scanned as two separate passes
// sharing one deadline; the first pass ate the whole budget, the second never
// ran and reported `reachedBlock = fromBlock - 1`, and the write guard then
// rejected that as "no progress" — forever, since the range only grew. The
// events that were found got `timestamp: 0` and became invisible to every page.
//
// Each case below is one of the ways that went wrong.

const assert = require('assert');
const { nextCursors } = require('./collect-activity.js');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}

const A = '0xaaa', B = '0xbbb', C = '0xccc';

console.log('\nnextCursors');

test('a completed scan advances every vault to the head', () => {
  const out = nextCursors({
    addresses: [A, B], prevCursors: { [A]: 100, [B]: 100 },
    reachedBlock: 200, currentBlock: 200,
  });
  assert.deepStrictEqual(out, { [A]: 200, [B]: 200 });
});

test('a partial scan advances to where it actually reached', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: { [A]: 100 },
    reachedBlock: 150, currentBlock: 200,
  });
  assert.strictEqual(out[A], 150);
});

test('reachedBlock never passes currentBlock', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: { [A]: 100 },
    reachedBlock: 999, currentBlock: 200,
  });
  assert.strictEqual(out[A], 200);
});

// The outage, exactly: the second topic never ran, so reachedBlock came back
// one below where the scan started. That must not move anything.
test('a scan that made no progress leaves the cursor untouched', () => {
  const out = nextCursors({
    addresses: [A, B], prevCursors: { [A]: 51088890, [B]: 51088890 },
    reachedBlock: 51088890, currentBlock: 51296644,
  });
  assert.deepStrictEqual(out, { [A]: 51088890, [B]: 51088890 });
});

// The latent second half of the bug: had the guard let that low block through,
// it would have been written to every vault in the batch.
test('a vault lagging the batch cannot rewind the healthy ones', () => {
  const out = nextCursors({
    addresses: [A, B, C],
    prevCursors: { [A]: 51088890, [B]: 51088890, [C]: 24856173 },
    reachedBlock: 24900000, currentBlock: 51296644,
  });
  assert.strictEqual(out[A], 51088890, 'A must not rewind');
  assert.strictEqual(out[B], 51088890, 'B must not rewind');
  assert.strictEqual(out[C], 24900000, 'C, genuinely behind, still advances');
});

test('a vault with no prior cursor starts from the scan result', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: {}, reachedBlock: 150, currentBlock: 200,
  });
  assert.strictEqual(out[A], 150);
});

test('the cursor is held below the lowest block we could not date', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: { [A]: 100 },
    reachedBlock: 200, currentBlock: 200, undatedBlocks: [180, 190],
  });
  assert.strictEqual(out[A], 179, 'undated blocks must be re-scanned, not banked');
});

test('undated blocks cannot drag the cursor backwards either', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: { [A]: 500 },
    reachedBlock: 600, currentBlock: 600, undatedBlocks: [300],
  });
  assert.strictEqual(out[A], 500, 'holding for undated data must not undo banked progress');
});

test('dating everything lets the cursor reach the head', () => {
  const out = nextCursors({
    addresses: [A], prevCursors: { [A]: 100 },
    reachedBlock: 200, currentBlock: 200, undatedBlocks: [],
  });
  assert.strictEqual(out[A], 200);
});

// Repeated runs against a stalled chain must be idempotent, not corrosive.
test('re-running a stalled scan is idempotent', () => {
  let cursors = { [A]: 51088890 };
  for (let i = 0; i < 5; i++) {
    cursors = nextCursors({
      addresses: [A], prevCursors: cursors,
      reachedBlock: 51088890, currentBlock: 51296644 + i,
    });
  }
  assert.strictEqual(cursors[A], 51088890);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
