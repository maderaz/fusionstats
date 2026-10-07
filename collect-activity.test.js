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
const { nextCursors, chainHealth, scanCohorts, tagSyntheticEvents, HEALTHY_LAG_HOURS } = require('./collect-activity.js');

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

// Oct 6: Private ETH Lending Optimizer went back above the TVL floor and
// resumed from its cursor of 8 days before, while the 30 other Base vaults
// were at the head. Verbatim blocks from that run.
const HEAD6 = 52252149;
const base30 = Array.from({ length: 30 }, (_, i) => ({ address: '0xb' + i, name: 'Base ' + i, tvl: 1e6, start: 52241915, cursor: HEAD6 }));
const priv = { address: '0xd757', name: 'Private ETH Lending Optimizer', tvl: 297961, start: 51894615, cursor: 52070615 };
const T0 = Date.parse('2026-10-06T13:36:36Z');

test('a vault catching up while the rest are at the head: behind, named, since this run', () => {
  const h = chainHealth({ chain: 'base', head: HEAD6, vaults: [...base30, priv], prev: { status: 'ok', checkedAt: '2026-10-06T07:53:00Z' }, now: T0 });
  assert.strictEqual(h.status, 'behind');
  assert.strictEqual(h.lagHours, 100.9);
  assert.strictEqual(h.behindSince, new Date(T0).toISOString());
  assert.deepStrictEqual(h.laggards.map(l => [l.name, l.lagHours, l.moved, l.stuck]), [['Private ETH Lending Optimizer', 100.9, true, false]]);
});

test('behindSince carries over while the chain stays behind, and clears at the head', () => {
  const was = { status: 'behind', behindSince: '2026-10-05T20:00:00.000Z', checkedAt: '2026-10-06T07:53:00Z' };
  assert.strictEqual(chainHealth({ chain: 'base', head: HEAD6, vaults: [...base30, priv], prev: was, now: T0 }).behindSince, was.behindSince);
  const back = chainHealth({ chain: 'base', head: HEAD6, vaults: [...base30, { ...priv, cursor: HEAD6 }], prev: was, now: T0 });
  assert.strictEqual(back.status, 'ok');
  assert.strictEqual(back.behindSince, null);
  assert.deepStrictEqual(back.laggards, []);
});

test("a verdict from before behindSince counts from its own time", () => {
  const h = chainHealth({ chain: 'base', head: HEAD6, vaults: [priv], prev: { status: 'stalled', checkedAt: '2026-10-05T19:55:00.000Z' }, now: T0 });
  assert.strictEqual(h.behindSince, '2026-10-05T19:55:00.000Z');
});

test('a vault whose pass ran and did not move is stuck; one the time ran out before is not', () => {
  const asked = { ...priv, address: '0xa', cursor: priv.start };
  const notReached = { ...priv, address: '0xb', cursor: priv.start, reached: false };
  const h = chainHealth({ chain: 'base', head: HEAD6, vaults: [...base30, asked, notReached], now: T0 });
  assert.strictEqual(h.status, 'behind');           // the chain moved
  assert.deepStrictEqual(h.laggards.map(l => [l.address, l.stuck]), [['0xa', true], ['0xb', false]]);
});

test('nothing on the chain moved while a vault is behind: stalled', () => {
  const still = base30.map(v => ({ ...v, start: v.cursor }));
  const h = chainHealth({ chain: 'base', head: HEAD6, vaults: [...still, { ...priv, cursor: priv.start }], now: T0 });
  assert.strictEqual(h.status, 'stalled');
});

test('unreachable keeps the time a chain already behind fell behind', () => {
  const h = chainHealth({ chain: 'base', unreachable: true, reason: 'x', prev: { status: 'behind', behindSince: '2026-10-05T00:00:00.000Z' }, now: T0 });
  assert.strictEqual(h.behindSince, '2026-10-05T00:00:00.000Z');
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

console.log('\ntagSyntheticEvents');

{
  const V = '0xvault', U1 = '0xu1', U2 = '0xu2', ROUTER = '0xrouter';
  const e = (type, owner, block, assets, extra = {}) => ({ type, vault: V, owner, sender: owner, block, timestamp: 1000 + block * 2, assets, usdValue: assets * 250, tx: '0x' + type + owner + block, ...extra });
  const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
  const tagged = (events, vaults = [{ address: V, tvl: 1e6 }], snaps) => { quiet(() => tagSyntheticEvents(events, vaults, snaps)); return events.map(x => x.syntheticReason || '-'); };

  test('one holder in and out in the same block is a round trip', () => {
    assert.deepStrictEqual(tagged([e('deposit', U1, 10, 1), e('withdraw', U1, 10, 1)]), ['same-block-pair', 'same-block-pair']);
  });
  test('two strangers moving the same ~$250 in one block are not', () => {
    assert.deepStrictEqual(tagged([e('deposit', U1, 10, 1), e('withdraw', U2, 10, 1)]), ['-', '-']);
  });
  test('a keeper repeating itself is recurring; a router depositing for five users is not', () => {
    const self = [1, 2, 3, 4, 5].map(i => e('deposit', U1, i * 100, 1));
    assert.deepStrictEqual(tagged(self), ['recurring-keeper', 'recurring-keeper', 'recurring-keeper', 'recurring-keeper', 'recurring-keeper']);
    const routed = [1, 2, 3, 4, 5].map(i => e('deposit', '0xuser' + i, i * 100, 1, { sender: ROUTER }));
    assert.deepStrictEqual(tagged(routed), ['-', '-', '-', '-', '-']);
  });
  test('a big deposit into a vault that has since drained is measured against its TVL then', () => {
    const big = () => [e('deposit', U1, 10, 4000)];   // $1M
    assert.deepStrictEqual(tagged(big(), [{ address: V, tvl: 60000 }]), ['tvl-ratio']);
    const snaps = { vaults: { [V]: { snapshots: [{ timestamp: 1000, tvlUsd: 15e6 }] } } };
    assert.deepStrictEqual(tagged(big(), [{ address: V, tvl: 60000 }], snaps), ['-']);
    // …but one far beyond the vault both then and now still is.
    assert.deepStrictEqual(tagged([e('deposit', U1, 10, 400000)], [{ address: V, tvl: 60000 }], snaps), ['tvl-ratio']);
  });
}

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}\n`);
