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
const IPOR_VAULTS_FILE = path.join(__dirname, 'ipor-vaults.json');
const DEPLOYMENTS_FILE = path.join(__dirname, 'vault-deployments.json');

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
    'https://mainnet.unichain.org',
  ],
  plasma: [
    'https://evm-rpc.plasma.io/api',
  ],
};

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
      try {
        const res = await fetch(eps[idx], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        active = idx;
        return json.result;
      } catch (e) {
        lastErr = e;
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

// Build per-day end-of-day holder counts.
//
// We don't fetch per-block timestamps (too many RPC calls). Instead we sample
// the timestamp at the first and last block of each scan chunk and linearly
// interpolate. Block time is ~constant on a chain over the scan window, so the
// error is well under one day — fine for daily buckets.
async function buildHolderSeries(rpc, vault, fromBlock, toBlock, chunkSize) {
  const allLogs = [];
  const segments = []; // [{from, to, fromTs, toTs}]
  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    const to = Math.min(toBlock, from + chunkSize - 1);
    const start = Date.now();
    await scanRange(rpc, vault, from, to, allLogs);
    // Two timestamps per segment for linear interpolation. We accept that a
    // block range with no logs still costs us 2 eth_getBlockByNumber calls;
    // they're cheap compared to the eth_getLogs above.
    try {
      const [bFrom, bTo] = await Promise.all([getBlock(rpc, from), getBlock(rpc, to)]);
      segments.push({
        from, to,
        fromTs: bFrom ? parseInt(bFrom.timestamp, 16) : null,
        toTs:   bTo   ? parseInt(bTo.timestamp,   16) : null,
      });
    } catch (e) {
      segments.push({ from, to, fromTs: null, toTs: null });
    }
    const pct = Math.round(((to - fromBlock) / Math.max(1, toBlock - fromBlock)) * 100);
    process.stdout.write(`\r  blocks ${from}–${to} (${pct}%, ${allLogs.length} logs, ${Date.now()-start}ms)   `);
  }
  process.stdout.write('\n');

  // Sort logs in block order. eth_getLogs returns ordered within a request but
  // our halving may interleave segments.
  allLogs.sort((a, b) =>
    parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
    parseInt(a.logIndex,   16) - parseInt(b.logIndex,   16)
  );

  // Replay: track balance per address (BigInt) and a running holder count.
  const bal = new Map();
  let count = 0;
  const byDay = new Map(); // day → count at end of day
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

  for (const lg of allLogs) {
    const blk = parseInt(lg.blockNumber, 16);
    const ts = tsForBlock(blk);
    const day = ts != null ? Math.floor(ts / DAY) : null;
    const from = ('0x' + lg.topics[1].slice(26)).toLowerCase();
    const to   = ('0x' + lg.topics[2].slice(26)).toLowerCase();
    const val = BigInt(lg.data);
    if (from !== ZERO_ADDR) {
      const before = bal.get(from) || 0n;
      const after = before - val;
      const wasHolder = before > 0n;
      const isHolder = after > 0n;
      if (wasHolder && !isHolder) count--;
      if (after === 0n) bal.delete(from); else bal.set(from, after);
    }
    if (to !== ZERO_ADDR) {
      const before = bal.get(to) || 0n;
      const after = before + val;
      const wasHolder = before > 0n;
      const isHolder = after > 0n;
      if (!wasHolder && isHolder) count++;
      bal.set(to, after);
    }
    if (day != null) byDay.set(day, count);
  }

  // Forward-fill: emit one (day, holders) per day from first to today, so the
  // chart never shows gaps even on days with zero activity.
  const days = [...byDay.keys()].sort((a, b) => a - b);
  let series = [];
  if (days.length) {
    const today = Math.floor(Date.now() / 1000 / DAY);
    let last = 0;
    for (let d = days[0]; d <= today; d++) {
      if (byDay.has(d)) last = byDay.get(d);
      series.push({ day: d, holders: last });
    }
  }

  // Top holders (current state, BigInt → human via decimals on caller).
  const top = [...bal.entries()]
    .filter(([_, v]) => v > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, TOP_N);

  return { series, totalHolders: count, top };
}

async function scanVault(vault, args) {
  const chain = vault.chain;
  const addr = vault.address.toLowerCase();
  if (!CHAIN_RPCS[chain]) {
    console.log(`skip ${addr} (${chain}): chain not configured`);
    return null;
  }
  const rpc = rpcFactory(chain);
  const head = parseInt(await rpc('eth_blockNumber', []), 16);

  // Deploy block from vault-deployments.json when present; otherwise estimate
  // 14d back from head using the chain's average block time (Fusion vaults
  // are uniformly young).
  const deps = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8')).deployments || {};
  const dep = deps[addr];
  const blockSec = CHAIN_BLOCK_SEC[chain] || 12;
  const lookbackDays = parseInt(args['lookback-days'] || '180', 10);
  const fromBlock = dep && dep.block
    ? dep.block
    : Math.max(1, head - Math.floor((lookbackDays * 86400) / blockSec));

  const decimals = Number.isFinite(vault.decimals) ? vault.decimals : 18;
  const chunk = CHAIN_CHUNK[chain] || 10_000;
  console.log(`\n[${chain}] ${addr} (${vault.name || ''})`);
  console.log(`  scanning ${fromBlock}–${head} (${(head - fromBlock).toLocaleString()} blocks, chunk=${chunk})`);

  const { series, totalHolders, top } = await buildHolderSeries(rpc, addr, fromBlock, head, chunk);

  const topHolders = top.map(([address, balUnits], i) => ({
    rank: i + 1,
    address,
    balance: Number(balUnits) / Math.pow(10, decimals),
  }));

  return {
    address: addr,
    chain,
    symbol: vault.symbol || vault.token || null,
    name: vault.name || null,
    decimals,
    fromBlock,
    toBlock: head,
    updatedAt: new Date().toISOString(),
    totalHolders,
    series,
    topHolders,
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
  // Skip very small vaults unless explicitly targeted.
  if (!args.vault) {
    vaults = vaults.filter(x => (x.tvl || 0) >= 100_000);
  }
  return vaults;
}

async function main() {
  const args = parseArgs();
  const vaults = loadEligibleVaults(args);
  console.log(`Scanning ${vaults.length} vault(s)`);
  if (!vaults.length) {
    console.log('No vaults matched. Exiting.');
    return;
  }

  // Merge with prior output so a single-vault run doesn't drop data for the
  // rest of the catalog.
  let existing = { vaults: [] };
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}
  const byAddr = new Map((existing.vaults || []).map(v => [v.address.toLowerCase(), v]));

  for (const v of vaults) {
    try {
      const result = await scanVault(v, args);
      if (result) byAddr.set(result.address, result);
      // Persist after each vault so a later failure doesn't lose earlier work.
      const out = {
        updatedAt: new Date().toISOString(),
        vaults: [...byAddr.values()].sort((a, b) => (b.totalHolders || 0) - (a.totalHolders || 0)),
      };
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
      console.log(`  → wrote ${out.vaults.length} vaults (this one: ${result?.totalHolders} holders)`);
    } catch (e) {
      console.error(`failed for ${v.address}:`, e.message);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
