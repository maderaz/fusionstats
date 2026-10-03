// Integration test for collect-activity.js against a fake Base chain.
//
// Drives the REAL collector by stubbing global.fetch, in a temp directory, so
// nothing here touches the repo's data files or the network.
//
// It reproduces a five-day production outage. Deposits and withdrawals were
// scanned as two passes sharing one deadline; when the first pass consumed it,
// the second never ran and reported reachedBlock = fromBlock - 1, so the cursor
// could never advance and the same range was rescanned forever. The events that
// were found were stored with timestamp 0, invisible to every page.
//
// Scenario 2 recreates exactly that condition, scaled down: in production 21
// chunks at ~7.2s each ran against a 150s deadline; here 21 chunks at 0.4s run
// against a 6s deadline (set CHAIN_TIMEOUT_OVERRIDE=6000 MS_PER_GETLOGS=400).
// Against the pre-fix collector the cursor stays frozen across seven runs and
// banks three undated events; against this one it advances and converges.
//
// Usage:
//   node collect-activity.integration.test.mjs
//   COLLECTOR=/path/to/old.js CHAIN_TIMEOUT_OVERRIDE=6000 MS_PER_GETLOGS=400 \
//     node collect-activity.integration.test.mjs     # reproduce the outage

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = HERE;
// Fixtures and output live in a temp dir — the repo's own data files are never
// read or written by this test.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-harness-'));

const VAULT_A = '0x1111111111111111111111111111111111111111';
const VAULT_B = '0x2222222222222222222222222222222222222222';
const TOKEN   = '0x9999999999999999999999999999999999999999';
const HEAD    = 51296644;
const START   = 51088890;          // the wedged cursor, verbatim from prod

// Events spread across the stuck range, including one in the last chunk so a
// partial scan genuinely cannot reach all of them.
const EVENTS = [
  { block: 51101665, vault: VAULT_A, kind: 'deposit'  },
  { block: 51138338, vault: VAULT_A, kind: 'deposit'  },
  { block: 51269479, vault: VAULT_A, kind: 'withdraw' },   // the withdraw that was never scanned
  { block: 51284027, vault: VAULT_A, kind: 'deposit'  },
  { block: 51135251, vault: VAULT_B, kind: 'deposit'  },
  { block: 51290000, vault: VAULT_B, kind: 'withdraw' },
];

const DEPOSIT_TOPIC  = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
const WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';

function writeFixtures(dir, cursors, { vaults = [VAULT_A, VAULT_B], timeoutMs } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let src = fs.readFileSync(process.env.COLLECTOR || path.join(REPO, 'collect-activity.js'), 'utf8');
  const t = timeoutMs || process.env.CHAIN_TIMEOUT_OVERRIDE;
  if (t) {
    const before = src;
    src = src.replace(/const CHAIN_TIMEOUT_MS = [0-9_]+;/, `const CHAIN_TIMEOUT_MS = ${t};`);
    if (src === before) throw new Error('could not scale CHAIN_TIMEOUT_MS');
  }
  fs.writeFileSync(path.join(dir, 'collect-activity.js'), src);
  // The collector requires its endpoint list helper; an older collector under
  // test (COLLECTOR=...) does not, and a stray copy does it no harm.
  fs.copyFileSync(path.join(REPO, 'rpc-endpoints.js'), path.join(dir, 'rpc-endpoints.js'));

  const vault = (address, name) => ({
    address, name, chain: 'base', token: 'FAKE', symbol: 'FAKE',
    assetAddress: TOKEN, underlyingToken: TOKEN, decimals: 8, tvl: 100000, isPublic: true,
  });
  const w = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2));

  w('ipor-vaults.json', { vaults: vaults.map((a, i) => vault(a, 'Fake Vault ' + i)) });
  w('vaults.json', { vaults: [] });
  w('vault-deployments.json', { deployments: Object.fromEntries(vaults.map(a =>
    [a, { chain: 'base', block: 50000000, deployedAt: '2026-01-01T00:00:00Z' }])) });
  w('tvl-snapshots.json', { vaults: {} });
  // Pre-seeded so the decimals pass needs no chain access. Shape must match
  // loadDecimalsCache(): { updatedAt, decimals: { <token>: n } }.
  w('vault-decimals.json', { updatedAt: '2026-09-01T00:00:00Z', decimals: { [TOKEN]: 8 } });
  // One pre-existing event per vault, so the "0 events, needs deeper backfill"
  // reset does not wipe the cursors we are testing.
  w('activity-events.json', {
    updatedAt: '2026-09-09T00:00:00Z',
    lastBlock: cursors,
    events: vaults.map((a, i) => ({ type: 'deposit', vault: a, symbol: 'FAKE', chain: 'base', assets: 1, shares: 1,
      owner: '0xdead', sender: '0xdead', tx: '0xseed_' + i, block: 50000001, logIdx: 0, timestamp: 1757000000, usdValue: 1 })),
  });
}

// `msPerGetLogs` is the knob that reproduces the outage: make eth_getLogs slow
// enough and the chain deadline is exhausted part-way through the range.
function writeStub(dir, { msPerGetLogs, events = EVENTS }) {
  fs.writeFileSync(path.join(dir, 'stub.cjs'), `
const HEAD = ${HEAD};
const EVENTS = ${JSON.stringify(events)};
// A range no endpoint will serve, for as long as the run is told so.
const FAIL_LO = Number(process.env.FAIL_LO || 0), FAIL_HI = Number(process.env.FAIL_HI || 0);
const DEPOSIT_TOPIC = ${JSON.stringify(DEPOSIT_TOPIC)};
const WITHDRAW_TOPIC = ${JSON.stringify(WITHDRAW_TOPIC)};
const MS = ${msPerGetLogs};
const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let getLogsCalls = 0, blockCalls = 0;

globalThis.__stats = () => ({ getLogsCalls, blockCalls });

const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init) => {
  const u = String(url);
  // Anything that isn't our chain RPC (price APIs) answers empty.
  if (!/base|rpc|drpc|llama\\.|publicnode|infura|alchemy|tenderly|blockpi|mevblocker/.test(u) || !init || !init.body) {
    return new Response(JSON.stringify({ coins: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  let req;
  try { req = JSON.parse(init.body); } catch { return new Response('{}', { status: 200 }); }
  const { method, params } = req;

  if (method === 'eth_blockNumber') return ok('0x' + HEAD.toString(16));

  if (method === 'eth_getLogs') {
    getLogsCalls++;
    if (MS) await sleep(MS);
    const p = params[0];
    const from = parseInt(p.fromBlock, 16), to = parseInt(p.toBlock, 16);
    if (FAIL_HI && from <= FAIL_HI && to >= FAIL_LO) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'range unavailable' } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const addrs = (Array.isArray(p.address) ? p.address : [p.address]).map(a => a.toLowerCase());
    const t0 = p.topics && p.topics[0];
    const wanted = new Set(Array.isArray(t0) ? t0 : [t0]);
    const logs = EVENTS.filter(e =>
      e.block >= from && e.block <= to && addrs.includes(e.vault) &&
      wanted.has(e.kind === 'deposit' ? DEPOSIT_TOPIC : WITHDRAW_TOPIC)
    ).map((e, i) => {
      const isDep = e.kind === 'deposit';
      const who = '0x' + pad('0xabc');
      return {
        address: e.vault,
        topics: isDep ? [DEPOSIT_TOPIC, who, who] : [WITHDRAW_TOPIC, who, who, who],
        data: '0x' + pad('0x' + (100000000).toString(16)) + pad('0x' + (100000000).toString(16)),
        blockNumber: '0x' + e.block.toString(16),
        transactionHash: '0xtx' + e.block + '_' + i,
        logIndex: '0x' + i.toString(16),
      };
    });
    return ok(logs);
  }

  if (method === 'eth_getBlockByNumber') {
    blockCalls++;
    const n = parseInt(params[0], 16);
    // Base: 2s blocks. Any monotonic mapping works for the assertions.
    return ok({ number: params[0], timestamp: '0x' + (1757000000 + (n - ${START}) * 2).toString(16) });
  }

  if (method === 'eth_call') return ok('0x' + pad('0x8'));      // decimals() = 8
  if (method === 'eth_getCode') return ok('0x60006000');
  return ok(null);
};
`);
}

function run(dir, env = {}) {
  return execFileSync(process.execPath, ['--require', './stub.cjs', 'collect-activity.js'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 240000,
  });
}

function state(dir) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'activity-events.json'), 'utf8'));
  const real = d.events.filter(e => !String(e.tx).startsWith('0xseed'));
  return {
    cursorA: d.lastBlock[VAULT_A], cursorB: d.lastBlock[VAULT_B],
    cursors: d.lastBlock,
    events: real.length,
    undated: real.filter(e => !e.timestamp).length,
    blocks: [...new Set(real.map(e => e.block))].sort((a, b) => a - b),
  };
}

let failures = 0;
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '\n           ' + detail : ''));
  if (!cond) failures++;
};

// ---------------------------------------------------------------- scenario 1
console.log('\nScenario 1 — healthy RPC: one pass must reach the head and date everything');
{
  const dir = path.join(WORK, 'run-fast');
  writeFixtures(dir, { [VAULT_A]: START, [VAULT_B]: START });
  writeStub(dir, { msPerGetLogs: 0 });
  run(dir);
  const s = state(dir);
  console.log('           ' + JSON.stringify(s));
  check('cursor reaches chain head', s.cursorA === HEAD && s.cursorB === HEAD, `A=${s.cursorA} B=${s.cursorB} head=${HEAD}`);
  check('all 6 events collected, deposits AND withdrawals', s.events === 6, `got ${s.events}`);
  check('no event stored without a timestamp', s.undated === 0, `${s.undated} undated`);
}

// ---------------------------------------------------------------- scenario 2
// The outage: eth_getLogs slow enough that the deadline dies mid-range.
console.log('\nScenario 2 — RPC too slow to finish: must make partial progress, never wedge');
{
  const dir = path.join(WORK, 'run-slow');
  writeFixtures(dir, { [VAULT_A]: START, [VAULT_B]: START });
  writeStub(dir, { msPerGetLogs: Number(process.env.MS_PER_GETLOGS || 1500) });
  run(dir, { ACTIVITY_RUN_BUDGET_MS: process.env.ACTIVITY_RUN_BUDGET_MS || '25000' });
  const s1 = state(dir);
  console.log('           after run 1: ' + JSON.stringify(s1));
  check('cursor moved forward despite the timeout', s1.cursorA > START, `${START} -> ${s1.cursorA}`);
  check('cursor did not overshoot the head', s1.cursorA <= HEAD, `${s1.cursorA}`);
  check('no undated events were banked', s1.undated === 0, `${s1.undated} undated`);

  // Successive runs must converge rather than repeat the same range forever.
  let prev = s1.cursorA, advanced = 0;
  // Generous: the point is that it converges, not how few passes it takes.
  for (let i = 0; i < 14; i++) {
    run(dir, { ACTIVITY_RUN_BUDGET_MS: process.env.ACTIVITY_RUN_BUDGET_MS || '25000' });
    const s = state(dir);
    if (s.cursorA > prev) advanced++;
    check(`run ${i + 2} never rewinds the cursor`, s.cursorA >= prev, `${prev} -> ${s.cursorA}`);
    prev = s.cursorA;
    if (prev >= HEAD) break;
  }
  console.log('           converged to ' + prev + ' after repeated runs (advanced on ' + advanced + ' of them)');
  check('repeated runs converge on the head', prev === HEAD, `stopped at ${prev}`);
  const sf = state(dir);
  check('every event eventually collected', sf.events === 6, `got ${sf.events}: blocks ${sf.blocks.join(',')}`);
  check('including the withdrawal at 51269479', sf.blocks.includes(51269479), sf.blocks.join(','));
}

// ---------------------------------------------------------------- scenario 3
// The Ethereum freeze. Enough vaults to need three address groups (Base serves
// 8 addresses per request). The pre-fix collector scanned group 1 over the
// whole range, then group 2, then group 3, all against one deadline: group 1
// spent it, groups 2 and 3 reported no progress, and progress — the worst of
// the three — stayed at the start on every run. Scanned chunk by chunk, every
// run must move all three forward together.
console.log('\nScenario 3 — three address groups, slow RPC: all must advance together, never wedge');
{
  const dir = path.join(WORK, 'run-groups');
  const many = Array.from({ length: 20 }, (_, i) => '0x' + (0xa000 + i).toString(16).padStart(40, '0'));
  const from3 = HEAD - 30000;
  // One event in each address group, spread through the range.
  const ev3 = [
    { block: from3 + 4000,  vault: many[1],  kind: 'deposit'  },   // group 1
    { block: from3 + 15000, vault: many[10], kind: 'deposit'  },   // group 2
    { block: from3 + 26000, vault: many[18], kind: 'withdraw' },   // group 3
  ];
  writeFixtures(dir, Object.fromEntries(many.map(a => [a, from3])), { vaults: many, timeoutMs: 4000 });
  writeStub(dir, { msPerGetLogs: 150, events: ev3 });
  const envs = { ACTIVITY_RUN_BUDGET_MS: '20000' };
  run(dir, envs);
  const first = state(dir);
  const c1 = Math.min(...many.map(a => first.cursors[a]));
  check('the first run moves every vault forward', c1 > from3, `${from3} -> ${c1}`);
  let prev = c1, runs = 1;
  while (prev < HEAD && runs < 12) {
    run(dir, envs); runs++;
    const c = Math.min(...many.map(a => state(dir).cursors[a]));
    check(`run ${runs} never rewinds any vault`, c >= prev, `${prev} -> ${c}`);
    prev = c;
  }
  const s3 = state(dir);
  check('all three groups reach the head', many.every(a => s3.cursors[a] === HEAD), `slowest at ${Math.min(...many.map(a => s3.cursors[a]))}`);
  check('the event in each group is collected', s3.events === 3, `got ${s3.events}: blocks ${s3.blocks.join(',')}`);
}

// ---------------------------------------------------------------- scenario 4
// A range no endpoint will serve. The pre-fix collector split it down to 500
// blocks and then returned as if it had succeeded — the cursor moved past
// blocks nobody had read, and the deposit inside was lost for good, even after
// the endpoint recovered. It must stop before the range instead, and collect
// the deposit once the range can be read.
console.log('\nScenario 4 — a range the endpoint refuses: stop before it, never skip it');
{
  const dir = path.join(WORK, 'run-refused');
  const from4 = HEAD - 20000;
  const BAD_LO = from4 + 9000, BAD_HI = from4 + 9300, inside = from4 + 9100;
  writeFixtures(dir, { [VAULT_A]: from4, [VAULT_B]: from4 });
  writeStub(dir, { msPerGetLogs: 0, events: [
    { block: from4 + 3000, vault: VAULT_A, kind: 'deposit' },
    { block: inside,       vault: VAULT_B, kind: 'deposit' },     // the one that used to vanish
    { block: from4 + 15000, vault: VAULT_A, kind: 'withdraw' },
  ] });
  run(dir, { FAIL_LO: String(BAD_LO), FAIL_HI: String(BAD_HI) });
  const r1 = state(dir);
  check('the cursor stops before the refused range', r1.cursorA < BAD_LO && r1.cursorB < BAD_LO, `A=${r1.cursorA} B=${r1.cursorB} refused from ${BAD_LO}`);
  check('the event before it is kept', r1.blocks.includes(from4 + 3000), r1.blocks.join(','));
  check('nothing past the refused range is claimed', !r1.blocks.includes(from4 + 15000), r1.blocks.join(','));
  run(dir, {});                                                     // the endpoint recovers
  const r2 = state(dir);
  check('once readable, the deposit inside the range is collected', r2.blocks.includes(inside), r2.blocks.join(','));
  check('and the scan carries on to the head', r2.cursorA === HEAD && r2.cursorB === HEAD, `A=${r2.cursorA} B=${r2.cursorB}`);
}

console.log(failures ? `\n${failures} FAILURES\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
