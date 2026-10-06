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
const { nextCursors, chainHealth, scanCohorts, HEALTHY_LAG_HOURS } = require('./collect-activity.js');

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

console.log('\nchainHealth');

// Both outages were printed as warnings every run, in a step that could not
// fail, under a page reading "updated 2 minutes ago". Health is recorded so a
// workflow and a page can act on it.
test('a chain at the head is ok', () => {
  const h = chainHealth({ chain: 'base', head: 1000, cursors: [1000, 999], progressed: true });
  assert.strictEqual(h.status, 'ok');
  assert.strictEqual(h.lagBlocks, 1);
});

test('the slowest vault sets the lag, because a block is covered only once every vault is', () => {
  const h = chainHealth({ chain: 'ethereum', head: 26113324, cursors: [26113324, 25953295], progressed: true });
  assert.strictEqual(h.cursor, 25953295);
  assert.strictEqual(h.lagBlocks, 160029);
  assert.ok(h.lagHours > 500, `${h.lagHours}h`);
});

// The Ethereum freeze, verbatim: three weeks behind and no progress this run.
test('far behind with no progress is stalled', () => {
  const h = chainHealth({ chain: 'ethereum', head: 26113324, cursors: [25953295], progressed: false });
  assert.strictEqual(h.status, 'stalled');
});

test('far behind but moving is behind, not stalled', () => {
  const h = chainHealth({ chain: 'ethereum', head: 26113324, cursors: [25953295], progressed: true });
  assert.strictEqual(h.status, 'behind');
});

test(`within ${HEALTHY_LAG_HOURS}h of the head is ok even on a run that moved nothing`, () => {
  // 7,200 Ethereum blocks a day: 1,000 blocks is ~3.3h.
  const h = chainHealth({ chain: 'ethereum', head: 101000, cursors: [100000], progressed: false });
  assert.strictEqual(h.status, 'ok');
});

// Plasma: the only endpoint stopped resolving and the chain was never scanned.
test('no endpoint answering is unreachable, with the reason', () => {
  const h = chainHealth({ chain: 'plasma', unreachable: true, reason: 'All RPCs failed for plasma:eth_blockNumber' });
  assert.strictEqual(h.status, 'unreachable');
  assert.ok(/plasma/.test(h.reason));
});

console.log('\nscanCohorts');

const at = (addr, fromBlock) => ({ vault: { address: addr }, fromBlock });
const names = (cohorts) => cohorts.map(c => c.map(v => v.vault.address));

test('vaults at the same cursor are one pass', () => {
  assert.deepStrictEqual(names(scanCohorts([at(A, 100), at(B, 100)], 2000)), [[A, B]]);
});

test('a vault within one chunk of the rest stays with them', () => {
  assert.deepStrictEqual(names(scanCohorts([at(A, 52206926), at(B, 52205000)], 2000)), [[A, B]]);
});

// Oct 5: two new Base vaults 48h back held 28 current ones still.
test('vaults far behind get their own pass, after the current ones', () => {
  const out = scanCohorts([at(C, 52133980), at(A, 52206926), at(B, 52206926)], 2000);
  assert.deepStrictEqual(names(out), [[A, B], [C]]);
});

test('a vault a little behind is not lumped in with ones far behind it', () => {
  const D = '0xddd', E = '0xeee';
  const out = scanCohorts([at(D, 52133980), at(A, 52206926), at(C, 52202286), at(E, 52133980), at(B, 52206926)], 2000);
  assert.deepStrictEqual(names(out), [[A, B], [C], [D, E]]);
});

test('a pass spans at most one gap from its most advanced vault', () => {
  // 1000 apart each: A and B fit together, C would stretch the pass to 2000.
  assert.deepStrictEqual(names(scanCohorts([at(A, 10000), at(B, 9000), at(C, 8000)], 1500)), [[A, B], [C]]);
});

test('nothing to scan is no passes', () => {
  assert.deepStrictEqual(scanCohorts([], 2000), []);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
