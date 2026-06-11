#!/usr/bin/env node
//
// Vault Holder Scanner — daily holder-count series per Fusion vault.
//
// What this fixes
//   The per-vault Holders chart on the address page can reconstruct holder
//   counts from activity-events.json (ERC-4626 Deposit / Withdraw), but that
//   misses every wallet→wallet ERC-20 transfer of vault shares (yield protos
//   distributing wrapped shares, LPs, custodians, etc.). For Base ETH Lending
//   Optimizer the event-only reconstruction shows 35 holders while basescan
//   shows 66 — a 47% under-count. This collector pulls the truth: every
//   Transfer log on the vault token, replayed into per-day end-of-day counts.
//
// Output: vault-holders.json
//   { updatedAt, vaults: [ {address, chain, symbol, fromBlock, toBlock,
//                          updatedAt, totalHolders, series: [{day, holders}],
//                          topHolders: [{rank, address, balance}] } ] }
//
// Incremental: a previous run's `bal` is not persisted (size grows fast), so
// each run does a full scan. Vaults are young enough (<6mo of Base history)
// that this stays cheap. If that changes, snapshot bal on disk and pick up
// from `toBlock + 1`.
//
// Usage:
//   node collect-vault-holders.js                    # all eligible vaults
//   node collect-vault-holders.js --chain=base       # all on one chain
//   node collect-vault-holders.js --vault=0x17d0...  # one vault
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'vault-holders.json');
// Sidecar — per-vault scan state (toBlock, balance map). Read+written by the
// collector only; the frontend never fetches it. Lets each cron run resume
// from the last persisted block instead of re-scanning the whole history.
const STATE_FILE = path.join(__dirname, 'vault-holders-state.json');
const IPOR_VAULTS_FILE = path.join(__dirname, 'ipor-vaults.json');
const DEPLOYMENTS_FILE = path.join(__dirname, 'vault-deployments.json');

// Checkpoint cadence — flush both output + state every N completed scan
// chunks. Bounds how much progress is lost if a vault hits its time budget
// mid-scan (the next run resumes from the last checkpoint, not from scratch).
const CHECKPOINT_CHUNKS = 50;

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Per-chain RPC endpoints — mirrors collect-activity.js. Public, no-auth only.
const CHAIN_RPCS = {
  ethereum: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://eth.llamarpc.com',
    'https://cloudflare-eth.com',
  ],
  base: [
    'https://base-rpc.publicnode.com',
    'https://base.drpc.org',
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
  ],
  arbitrum: [
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.drpc.org',
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.llamarpc.com',
  ],
  avalanche: [
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://avalanche.drpc.org',
    'https://api.avax.network/ext/bc/C/rpc',
  ],
  unichain: [
    'https://unichain-rpc.publicnode.com',
    'https://unichain.drpc.org',
    'https://mainnet.unichain.org',
  ],
  plasma: [
    'https://evm-rpc.plasma.io/api',
  ],
};

// Wall-clock budget per single RPC call. Node's fetch() doesn't time out by
// default, so a hanging endpoint would block the whole scan until the
// workflow's outer timeout fires. AbortController gives us bounded calls.
const RPC_CALL_TIMEOUT_MS = 25_000;

// Wall-clock budget per vault scan. Bounded so one slow chain can't burn the
// whole workflow budget. Mid-scan checkpoints (CHECKPOINT_CHUNKS) ensure that
// even a vault that hits the budget mid-backfill leaves usable resume state
// for the next run. Post-backfill runs are seconds, so this only constrains
// first-time scans of large vaults.
const VAULT_TIMEOUT_MS = 25 * 60 * 1000;

// Approx block time per chain (seconds). Used to estimate days back when we
// don't have a precise deployment block.
const CHAIN_BLOCK_SEC = {
  ethereum:  12,
  base:       2,
  arbitrum:   0.3,
  avalanche:  2,
  unichain:   4,
  plasma:    12,
};

// Initial scan chunk per chain. Public RPCs typically allow 10k blocks /
// getLogs; we split on failure.
const CHAIN_CHUNK = {
  ethereum: 10_000,
  base:     10_000,
  arbitrum: 10_000,
  avalanche:10_000,
  unichain: 10_000,
  plasma:   10_000,
};

// Top-N holders to keep in the output.
const TOP_N = 25;

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
    else if (arg.startsWith('--')) out[arg.slice(2)] = true;
  }
  return out;
}

function rpcFactory(chain) {
  const eps = CHAIN_RPCS[chain];
  if (!eps || !eps.length) throw new Error(`no RPCs configured for chain ${chain}`);
  let active = 0;
  let id = 0;
  return async function rpc(method, params) {
    const order = [active, ...eps.map((_, i) => i).filter(i => i !== active)];
    let lastErr;
    for (const idx of order) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), RPC_CALL_TIMEOUT_MS);
      try {
        const res = await fetch(eps[idx], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        active = idx;
        return json.result;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(t);
      }
    }
    throw new Error(`all ${chain} RPCs failed for ${method}: ${lastErr && lastErr.message}`);
  };
}

async function getBlock(rpc, blockNum) {
  return await rpc('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
}

async function getLogs(rpc, addr, fromBlock, toBlock) {
  return await rpc('eth_getLogs', [{
    address: addr,
    topics: [TRANSFER_TOPIC],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
}

// Recursive halving scan — same shape as collect-spark-holders.js but returns
// the raw logs instead of just addresses so we can replay balances.
async function scanRange(rpc, addr, from, to, out) {
  try {
    const logs = await getLogs(rpc, addr, from, to);
    for (const lg of logs) out.push(lg);
  } catch (e) {
    if (to - from <= 1000) {
      console.log(`  skipping ${from}-${to}: ${e.message}`);
      return;
    }
    const mid = from + Math.floor((to - from) / 2);
    await scanRange(rpc, addr, from, mid, out);
    await scanRange(rpc, addr, mid + 1, to, out);
  }
}

// Replay one chunk's logs into the running balance/byDay/count state.
function replayLogs(logs, bal, byDay, segments, countRef) {
  const DAY = 86400;
  function tsForBlock(blk) {
    for (const s of segments) {
      if (blk >= s.from && blk <= s.to && s.fromTs != null && s.toTs != null) {
        if (s.to === s.from) return s.fromTs;
        const frac = (blk - s.from) / (s.to - s.from);
        return Math.round(s.fromTs + frac * (s.toTs - s.fromTs));
      }
    }
    return null;
  }
  // Sort: eth_getLogs returns ordered within a single request, but halving
  // can interleave segments.
  logs.sort((a, b) =>
    parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
    parseInt(a.logIndex,   16) - parseInt(b.logIndex,   16)
  );
  for (const lg of logs) {
    const blk = parseInt(lg.blockNumber, 16);
    const ts = tsForBlock(blk);
    const day = ts != null ? Math.floor(ts / DAY) : null;
    const from = ('0x' + lg.topics[1].slice(26)).toLowerCase();
    const to   = ('0x' + lg.topics[2].slice(26)).toLowerCase();
    const val = BigInt(lg.data);
    if (from !== ZERO_ADDR) {
      const before = bal.get(from) || 0n;
      const after = before - val;
      if (before > 0n && !(after > 0n)) countRef.count--;
      if (after === 0n) bal.delete(from); else bal.set(from, after);
    }
    if (to !== ZERO_ADDR) {
      const before = bal.get(to) || 0n;
      const after = before + val;
      if (!(before > 0n) && after > 0n) countRef.count++;
      bal.set(to, after);
    }
    if (day != null) byDay.set(day, countRef.count);
  }
}

// Build per-day end-of-day holder counts.
//
// We don't fetch per-block timestamps (too many RPC calls). Instead we sample
// the timestamp at the first and last block of each scan chunk and linearly
// interpolate. Block time is ~constant on a chain over the scan window, so the
// error is well under one day — fine for daily buckets.
//
// opts.resumeBal / opts.resumeByDay carry forward prior state for incremental
// runs. opts.onCheckpoint is called every CHECKPOINT_CHUNKS chunks with the
// last successfully-scanned block + a serializable view of (bal, byDay, count)
// — caller persists, so a timed-out scan still leaves measurable progress.
async function buildHolderSeries(rpc, vault, fromBlock, toBlock, chunkSize, opts = {}) {
  const bal = new Map();
  const byDay = new Map();
  const countRef = { count: 0 };
  if (opts.resumeBal) {
    for (const [a, hex] of Object.entries(opts.resumeBal)) {
      const v = BigInt(hex);
      if (v > 0n) { bal.set(a.toLowerCase(), v); countRef.count++; }
    }
  }
  if (opts.resumeByDay) {
    for (const [d, c] of Object.entries(opts.resumeByDay)) byDay.set(+d, c);
  }

  let chunksDone = 0;
  let lastSuccessfulBlock = fromBlock - 1; // nothing scanned yet
  const totalBlocks = Math.max(1, toBlock - fromBlock);

  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const to = Math.min(toBlock, from + chunkSize - 1);
    const start = Date.now();
    const logs = [];
    await scanRange(rpc, vault, from, to, logs);
    const segments = [];
    try {
      const [bFrom, bTo] = await Promise.all([getBlock(rpc, from), getBlock(rpc, to)]);
      segments.push({
        from, to,
        fromTs: bFrom ? parseInt(bFrom.timestamp, 16) : null,
        toTs:   bTo   ? parseInt(bTo.timestamp,   16) : null,
      });
    } catch {
      segments.push({ from, to, fromTs: null, toTs: null });
    }
    replayLogs(logs, bal, byDay, segments, countRef);
    lastSuccessfulBlock = to;
    chunksDone++;
    const pct = Math.round(((to - fromBlock) / totalBlocks) * 100);
    process.stdout.write(`\r  blocks ${from}–${to} (${pct}%, ${countRef.count} holders, ${Date.now() - start}ms)   `);
    if (opts.onCheckpoint && chunksDone % CHECKPOINT_CHUNKS === 0) {
      await opts.onCheckpoint(snapshot(bal, byDay, countRef.count, lastSuccessfulBlock));
    }
  }
  process.stdout.write('\n');

  return snapshot(bal, byDay, countRef.count, lastSuccessfulBlock);
}

// Pack the running state into a serializable snapshot. Caller picks what to
// persist (output vs sidecar).
function snapshot(bal, byDay, count, lastBlock) {
  const balOut = {};
  for (const [a, v] of bal.entries()) if (v > 0n) balOut[a] = '0x' + v.toString(16);
  const byDayOut = {};
  for (const [d, c] of byDay.entries()) byDayOut[d] = c;
  // Series rebuild — forward-fill from first known day to today so the right
  // edge of the chart always reads as "now" even on idle days.
  const DAY = 86400;
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const series = [];
  if (days.length) {
    const today = Math.floor(Date.now() / 1000 / DAY);
    let last = 0;
    for (let d = days[0]; d <= today; d++) {
      if (byDay.has(d)) last = byDay.get(d);
      series.push({ day: d, holders: last });
    }
  }
  const top = [...bal.entries()]
    .filter(([_, v]) => v > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, TOP_N);
  return { series, byDay: byDayOut, bal: balOut, totalHolders: count, top, lastBlock };
}

async function scanVault(vault, args, persistedState, checkpoint) {
  const chain = vault.chain;
  const addr = vault.address.toLowerCase();
  if (!CHAIN_RPCS[chain]) {
    console.log(`skip ${addr} (${chain}): chain not configured`);
    return null;
  }
  const rpc = rpcFactory(chain);
  const head = parseInt(await rpc('eth_blockNumber', []), 16);

  // Deploy block from vault-deployments.json when present; otherwise estimate
  // a lookback window from head using the chain's average block time.
  const deps = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8')).deployments || {};
  const dep = deps[addr];
  const blockSec = CHAIN_BLOCK_SEC[chain] || 12;
  const lookbackDays = parseInt(args['lookback-days'] || '180', 10);
  const deployBlock = dep && dep.block
    ? dep.block
    : Math.max(1, head - Math.floor((lookbackDays * 86400) / blockSec));

  // Resume from the last persisted block if state is present. Forces a full
  // rescan when --force is passed (useful if the per-vault decimals or some
  // other field changed).
  const force = !!args.force;
  const prior = !force ? persistedState : null;
  const fromBlock = (prior && Number.isFinite(prior.lastBlock))
    ? prior.lastBlock + 1
    : deployBlock;

  if (fromBlock > head) {
    // Up to date — rebuild Maps from sidecar state and snapshot so the
    // series's right edge gets forward-filled to today.
    const balMap = new Map();
    if (prior?.bal) {
      for (const [a, hex] of Object.entries(prior.bal)) {
        const v = BigInt(hex);
        if (v > 0n) balMap.set(a.toLowerCase(), v);
      }
    }
    const byDayMap = new Map();
    if (prior?.byDay) {
      for (const [d, c] of Object.entries(prior.byDay)) byDayMap.set(+d, c);
    }
    const snap = snapshot(balMap, byDayMap, prior?.totalHolders || 0, head);
    return packResult(vault, deployBlock, head, snap);
  }

  const decimals = Number.isFinite(vault.decimals) ? vault.decimals : 18;
  const chunk = CHAIN_CHUNK[chain] || 10_000;
  console.log(`\n[${chain}] ${addr} (${vault.name || ''})`);
  console.log(`  scanning ${fromBlock}–${head} (${(head - fromBlock).toLocaleString()} blocks, ${prior ? 'incremental' : 'fresh'})`);

  let lastSnap = null;
  const snap = await buildHolderSeries(rpc, addr, fromBlock, head, chunk, {
    resumeBal: prior?.bal,
    resumeByDay: prior?.byDay,
    onCheckpoint: async (s) => {
      lastSnap = s;
      // Persist mid-scan: even if the per-vault timeout fires before the
      // final return, the next run resumes from the last checkpointed block.
      await checkpoint(packResult(vault, deployBlock, s.lastBlock, s));
    },
  });
  return packResult(vault, deployBlock, head, snap);
}

// Split the scan snapshot into the public output (frontend reads this) and
// the sidecar state (only the collector reads this).
function packResult(vault, deployBlock, head, snap) {
  const decimals = Number.isFinite(vault.decimals) ? vault.decimals : 18;
  return {
    public: {
      address: vault.address.toLowerCase(),
      chain: vault.chain,
      symbol: vault.symbol || vault.token || null,
      name: vault.name || null,
      decimals,
      fromBlock: deployBlock,
      toBlock: head,
      updatedAt: new Date().toISOString(),
      totalHolders: snap.totalHolders,
      series: snap.series,
      topHolders: snap.top.map(([address, balUnits], i) => ({
        rank: i + 1,
        address,
        balance: Number(balUnits) / Math.pow(10, decimals),
      })),
    },
    state: {
      lastBlock: snap.lastBlock,
      totalHolders: snap.totalHolders,
      bal: snap.bal,
      byDay: snap.byDay,
    },
  };
}

function loadEligibleVaults(args) {
  const j = JSON.parse(fs.readFileSync(IPOR_VAULTS_FILE, 'utf8'));
  let vaults = j.vaults || [];
  if (args.vault) {
    const v = args.vault.toLowerCase();
    vaults = vaults.filter(x => x.address.toLowerCase() === v);
  }
  if (args.chain) {
    vaults = vaults.filter(x => x.chain === args.chain);
  }
  // Only chains we have RPCs for.
  vaults = vaults.filter(x => CHAIN_RPCS[x.chain]);
  // Skip dust vaults unless explicitly targeted. The fleet has ~360 vaults
  // under $1K TVL (test/abandoned) that aren't worth a Transfer scan; the
  // sub-$1K tier rounds to 1-2 holders anyway and the event-derived fallback
  // covers them. $1K captures every vault with real activity (58 across the
  // 6 supported chains as of ship date).
  if (!args.vault) {
    const floor = parseFloat(args['min-tvl'] || '1000');
    vaults = vaults.filter(x => (x.tvl || 0) >= floor);
  }
  return vaults;
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function persist(outByAddr, stateByAddr) {
  const out = {
    updatedAt: new Date().toISOString(),
    vaults: [...outByAddr.values()].sort((a, b) => (b.totalHolders || 0) - (a.totalHolders || 0)),
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
  // Sidecar — bal map + byDay map per vault, keyed by lowercase address.
  const state = {
    version: 1,
    updatedAt: new Date().toISOString(),
    vaults: Object.fromEntries(stateByAddr.entries()),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state) + '\n');
}

async function main() {
  const args = parseArgs();
  const vaults = loadEligibleVaults(args);
  console.log(`Scanning ${vaults.length} vault(s)`);
  if (!vaults.length) {
    console.log('No vaults matched. Exiting.');
    return;
  }

  // Merge with prior output / state so a single-vault run doesn't drop data
  // for the rest of the fleet.
  const existingOut = loadJson(OUTPUT_FILE, { vaults: [] });
  const existingState = loadJson(STATE_FILE, { vaults: {} });
  const outByAddr = new Map((existingOut.vaults || []).map(v => [v.address.toLowerCase(), v]));
  const stateByAddr = new Map(Object.entries(existingState.vaults || {}));

  for (const v of vaults) {
    const addr = v.address.toLowerCase();
    const persistedState = stateByAddr.get(addr) || null;

    // Mid-scan checkpoint: updates both files so a timed-out scan still
    // leaves the next run with usable resume state.
    const checkpoint = async (packed) => {
      outByAddr.set(addr, packed.public);
      stateByAddr.set(addr, packed.state);
      persist(outByAddr, stateByAddr);
    };

    try {
      const packed = await Promise.race([
        scanVault(v, args, persistedState, checkpoint),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error(`vault scan exceeded ${Math.round(VAULT_TIMEOUT_MS / 1000)}s budget`)),
          VAULT_TIMEOUT_MS,
        )),
      ]);
      if (packed) {
        outByAddr.set(addr, packed.public);
        stateByAddr.set(addr, packed.state);
        persist(outByAddr, stateByAddr);
        console.log(`  → ${outByAddr.size} vaults total (this: ${packed.public.totalHolders} holders, lastBlock ${packed.state.lastBlock})`);
      }
    } catch (e) {
      // Timeout / fatal — log and move on. Last checkpoint persists, so
      // partial progress isn't lost.
      console.error(`failed for ${addr}:`, e.message);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
