#!/usr/bin/env node
//
// Fusion vault rebalance detector
//
// Scans an individual Fusion vault for "rebalance" activity — i.e. movement
// of capital between underlying protocols (Aave ↔ Spark ↔ Morpho ↔ ...).
//
// Approach: every ERC20 Transfer event where the vault is `from` or `to` is
// either a (a) user deposit/withdrawal of the vault asset, or (b) the vault
// supplying/withdrawing capital from an integrated protocol via a "fuse".
// We keep (b) and discard (a) by cross-referencing the existing
// activity-events.json for that vault's tx hashes.
//
// Usage:
//   node collect-rebalances.js <vaultAddress> [chain] [backfillBlocks]
//   node collect-rebalances.js 0xb8a451107a9f87fde481d4d686247d6e43ed715e ethereum 50000
//
// Output: rebalance-events-<address>.json
//

const fs = require('fs');
const path = require('path');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Per-chain RPCs (mirrors collect-activity.js)
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
  ],
};

const LLAMA_CHAIN = { ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum' };

// Known protocol-receipt-token prefixes (token addresses or symbol prefixes).
// Resolved via DeFi Llama price API (returns symbol + name).
// Classification logic uses the resolved symbol/name.
// IMPORTANT: order matters — first match wins. Specific protocols before
// generic stable/LST so receipt tokens (e.g. sUSDe = Ethena, NOT Spark) classify right.
const PROTOCOL_RULES = [
  // Spark Lend (Aave V3 fork) — receipt tokens use `sp` prefix.
  // Also includes Sky/MakerDAO savings tokens (sDAI, sUSDS) and Spark debt tokens.
  { match: (s, n) => /^sp[A-Za-z]/.test(s) || /^(sDAI|sUSDS)$/i.test(s) || /spark/i.test(n) || /^variableDebtSp/i.test(s) || /^stableDebtSp/i.test(s), protocol: 'Spark', kind: 'lending' },
  // Aave V3 — aTokens with optional chain/market markers (Eth, Base, Arb, Prime, Avax)
  { match: (s, n) => /^a(?:Eth|Base|Arb|Prime|Avax|Opt|Pol|Sonic)?[A-Z]/.test(s) || /aave/i.test(n) || /^variableDebt[A-Z]/.test(s) || /^stableDebt[A-Z]/.test(s), protocol: 'Aave', kind: 'lending' },
  // Compound V3 — cToken pattern with V3 suffix
  { match: (s, n) => /^c[A-Z].*[Vv]3$/.test(s) || /compound/i.test(n), protocol: 'Compound', kind: 'lending' },
  // Pendle — Principal/Yield/Standardized-Yield wrappers
  { match: (s, n) => /^(PT|YT|SY|LP)-/i.test(s) || /pendle/i.test(n), protocol: 'Pendle', kind: 'yield' },
  // Euler V2 — eTokens (evk- prefix or e...V2/2 suffix or Euler in name)
  { match: (s, n) => /^evk-/i.test(s) || /^e[A-Z][a-zA-Z]+(V?2|Vault)$/.test(s) || /euler/i.test(n), protocol: 'Euler', kind: 'lending' },
  // Morpho (Blue & MetaMorpho) — vault shares from many curators.
  // Curator names (alphabetized): Apostro, Block Analitica, B.Protocol, Gauntlet, Hyperithm,
  // Index Coop, LlamaRisk, MEV Capital, Re7, Smokehouse, Steakhouse, Tulipa, Usual, Yearn,
  // 9Summits, Hakutora.
  { match: (s, n) => /morpho|metamorpho/i.test(n)
      || /steakhouse|gauntlet|re7\b|smokehouse|hyperithm|llamarisk|mev capital|block analitica|9summits|apostro|tulipa|hakutora|b\.protocol|index coop|usual\b/i.test(n)
      || /^(stk|gtl|re7|smk|hkt)[A-Z]/.test(s), protocol: 'Morpho', kind: 'lending' },
  // Ethena — sUSDe is staked USDe, NOT a Spark token (must come before generic LST/Stable rules)
  { match: (s, n) => /^(USDe|sUSDe|ENA)$/i.test(s) || /ethena/i.test(n), protocol: 'Ethena', kind: 'collateral' },
  // Liquid staking tokens (transit asset, not a destination protocol — filtered from chips)
  { match: (s, n) => /^(stETH|wstETH|weETH|eETH|ETHx|rETH|cbETH|swETH|frxETH|sfrxETH|mETH|osETH|rswETH|ezETH|pufETH)$/i.test(s), protocol: 'LST', kind: 'collateral' },
  // Liquid staked BTC variants
  { match: (s) => /^(WBTC|cbBTC|tBTC|LBTC|FBTC|solvBTC)$/i.test(s), protocol: 'BTC', kind: 'collateral' },
  // Stablecoins (transit asset)
  { match: (s) => /^(USDC|USDT|DAI|crvUSD|GHO|USDS|FRAX|LUSD|PYUSD|FDUSD|TUSD|USDP|sFRAX)$/i.test(s), protocol: 'Stable', kind: 'collateral' },
];

let callId = 0;
const activeRpcByChain = {};
const lastCallTimeByRpc = {}; // throttle per RPC endpoint
const RPC_MIN_INTERVAL_MS = parseInt(process.env.RPC_MIN_INTERVAL_MS || '150', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rpcCall(chain, method, params) {
  const rpcs = CHAIN_RPCS[chain];
  if (!rpcs) throw new Error(`No RPCs for chain ${chain}`);
  const active = activeRpcByChain[chain] || 0;
  const order = [active, ...rpcs.map((_, i) => i).filter(i => i !== active)];
  for (const idx of order) {
    const url = rpcs[idx];
    // Throttle per RPC endpoint
    const last = lastCallTimeByRpc[url] || 0;
    const wait = RPC_MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastCallTimeByRpc[url] = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      activeRpcByChain[chain] = idx;
      return json.result;
    } catch {}
  }
  throw new Error(`All RPCs failed for ${chain}:${method}`);
}

async function getBlockNumber(chain) {
  return parseInt(await rpcCall(chain, 'eth_blockNumber', []), 16);
}

async function getBlockTimestamp(chain, blockNum) {
  const block = await rpcCall(chain, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  return block ? parseInt(block.timestamp, 16) : 0;
}

// Scan logs in chunks, halve on RPC error. Logs progress every PROGRESS_EVERY chunks.
async function scanLogs(chain, params, fromBlock, toBlock, label = '') {
  const out = [];
  const CHUNK = 10_000;
  const PROGRESS_EVERY = 25; // log every 25 chunks (~250K blocks on ETH)
  const totalChunks = Math.ceil((toBlock - fromBlock + 1) / CHUNK);
  let chunkIdx = 0;
  const t0 = Date.now();

  async function scan(from, to) {
    try {
      const logs = await rpcCall(chain, 'eth_getLogs', [{
        ...params,
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      out.push(...logs);
    } catch (e) {
      if (to - from <= 500) return;
      const mid = from + Math.floor((to - from) / 2);
      await scan(from, mid);
      await scan(mid + 1, to);
    }
  }

  for (let s = fromBlock; s <= toBlock; s += CHUNK) {
    await scan(s, Math.min(s + CHUNK - 1, toBlock));
    chunkIdx++;
    if (totalChunks > PROGRESS_EVERY && chunkIdx % PROGRESS_EVERY === 0) {
      const pct = Math.round(100 * chunkIdx / totalChunks);
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const eta = Math.round(elapsed * (totalChunks - chunkIdx) / chunkIdx);
      console.log(`      ${label} progress: ${chunkIdx}/${totalChunks} chunks (${pct}%) · ${out.length} logs · ${elapsed}s elapsed · ~${eta}s ETA`);
    }
  }
  return out;
}

// Parse a Transfer log: returns { token, from, to, amount } (amount is BigInt)
function parseTransfer(log) {
  if (log.topics.length !== 3) return null; // Some non-standard ERC20s
  return {
    token: log.address.toLowerCase(),
    from: '0x' + log.topics[1].slice(26).toLowerCase(),
    to: '0x' + log.topics[2].slice(26).toLowerCase(),
    amount: BigInt(log.data || '0x0'),
    block: parseInt(log.blockNumber, 16),
    tx: log.transactionHash,
    logIdx: parseInt(log.logIndex, 16),
  };
}

// Resolve token metadata via DeFi Llama (symbol/name/decimals)
const tokenMetaCache = {};
async function getTokenMeta(chain, addr) {
  const llamaChain = LLAMA_CHAIN[chain] || 'ethereum';
  const key = `${llamaChain}:${addr.toLowerCase()}`;
  if (tokenMetaCache[key] !== undefined) return tokenMetaCache[key];
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${key}?searchWidth=4h`);
    const json = await res.json();
    const found = Object.values(json.coins || {})[0] || null;
    tokenMetaCache[key] = found ? {
      symbol: found.symbol || '?',
      decimals: found.decimals ?? 18,
      price: found.price ?? null,
    } : null;
    return tokenMetaCache[key];
  } catch {
    tokenMetaCache[key] = null;
    return null;
  }
}

function classifyToken(meta) {
  if (!meta) return { protocol: 'Unknown', kind: 'unknown' };
  const sym = meta.symbol || '';
  const name = meta.name || '';
  for (const r of PROTOCOL_RULES) {
    if (r.match(sym, name)) return { protocol: r.protocol, kind: r.kind };
  }
  return { protocol: 'Unknown', kind: 'unknown' };
}

// Initial backfill window (~7 days per chain block time) for first scan of a vault
const INITIAL_BACKFILL = {
  ethereum:  50_000,    // ~7d at 12s/block
  base:     300_000,    // ~7d at 2s/block
  arbitrum: 2_000_000,  // ~7d at 0.3s/block
  plasma:    50_000,
  avalanche: 300_000,
  unichain:  150_000,
  _default:  50_000,
};

// Hard ceiling on blocks scanned in one run per vault (prevents runaway scans)
const MAX_BLOCKS_PER_RUN = {
  ethereum:  100_000,
  base:     1_500_000,
  arbitrum: 5_000_000,
  _default:  100_000,
};

// Scan a single vault — uses incremental lastBlock if existing JSON found.
// opts.fromBlock — explicit override (e.g. for --deepest mode). Scans backward
//   to this block as well as forward from existing.blockRange.to.
// opts.maxBlocksOverride — bypass the per-run safety cap (use with caution).
// Returns { vault, chain, txCount, newTxCount, fileName }
async function scanVault(vaultAddr, chain, opts = {}) {
  const vault = vaultAddr.toLowerCase();
  const outFile = `rebalance-events-${vault}.json`;

  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  const currentBlock = await getBlockNumber(chain);
  const initialBackfill = INITIAL_BACKFILL[chain] || INITIAL_BACKFILL._default;
  const maxBlocks = opts.maxBlocksOverride || MAX_BLOCKS_PER_RUN[chain] || MAX_BLOCKS_PER_RUN._default;

  // Determine scan ranges. We may have two: backward fill + forward delta.
  const ranges = [];
  if (opts.fromBlock != null) {
    // Deepest mode: explicit fromBlock; scan everything from fromBlock to currentBlock
    // that isn't already covered by existing data.
    const start = Math.max(1, opts.fromBlock);
    if (existing && existing.blockRange) {
      // Backward fill: from `start` to existing.blockRange.from - 1
      if (start < existing.blockRange.from) {
        ranges.push({ from: start, to: existing.blockRange.from - 1, label: 'backward' });
      }
      // Forward delta: from existing.blockRange.to + 1 to currentBlock
      if (existing.blockRange.to + 1 <= currentBlock) {
        ranges.push({ from: existing.blockRange.to + 1, to: currentBlock, label: 'forward' });
      }
    } else {
      ranges.push({ from: start, to: currentBlock, label: 'full' });
    }
  } else {
    let fromBlock;
    if (existing && existing.blockRange?.to) {
      fromBlock = existing.blockRange.to + 1;
    } else {
      fromBlock = Math.max(1, currentBlock - initialBackfill);
    }
    if (currentBlock - fromBlock > maxBlocks && !opts.maxBlocksOverride) {
      fromBlock = currentBlock - maxBlocks;
    }
    if (fromBlock <= currentBlock) {
      ranges.push({ from: fromBlock, to: currentBlock, label: 'incremental' });
    }
  }

  if (ranges.length === 0) {
    console.log(`  ${vault} [${chain}]: up to date`);
    return { vault, chain, txCount: existing?.rebalances?.length || 0, newTxCount: 0, fileName: outFile };
  }

  const padded = '0x' + vault.slice(2).padStart(64, '0');
  const allOutflowLogs = [];
  const allInflowLogs = [];

  for (const r of ranges) {
    console.log(`  ${vault} [${chain}]: ${r.label} scan blocks ${r.from} → ${r.to} (${(r.to - r.from + 1).toLocaleString()} blocks)`);
    const outLogs = await scanLogs(chain, { topics: [TRANSFER_TOPIC, padded] }, r.from, r.to, `${r.label}/out`);
    const inLogs  = await scanLogs(chain, { topics: [TRANSFER_TOPIC, null, padded] }, r.from, r.to, `${r.label}/in`);
    console.log(`    ${r.label}: ${outLogs.length} out + ${inLogs.length} in`);
    allOutflowLogs.push(...outLogs);
    allInflowLogs.push(...inLogs);
  }

  const outflowLogs = allOutflowLogs;
  const inflowLogs  = allInflowLogs;

  const allTransfers = [...outflowLogs, ...inflowLogs].map(parseTransfer).filter(Boolean);

  // Cross-reference user deposit/withdraw tx hashes from activity-events.json
  let userTxs = opts.userTxs;
  if (!userTxs) {
    userTxs = new Set();
    try {
      const activity = JSON.parse(fs.readFileSync('activity-events.json', 'utf8'));
      activity.events.filter(e => e.vault.toLowerCase() === vault).forEach(e => userTxs.add(e.tx.toLowerCase()));
    } catch {}
  }

  const rebalanceTransfers = allTransfers.filter(t => !userTxs.has(t.tx.toLowerCase()));

  // Group by tx
  const txGroups = {};
  for (const t of rebalanceTransfers) {
    if (!txGroups[t.tx]) txGroups[t.tx] = [];
    txGroups[t.tx].push(t);
  }

  if (Object.keys(txGroups).length === 0) {
    // Still update blockRange so next run is incremental
    const newFrom = Math.min(...ranges.map(r => r.from), existing?.blockRange?.from ?? Infinity);
    const newTo   = Math.max(...ranges.map(r => r.to),   existing?.blockRange?.to   ?? 0);
    const out = {
      vault, chain,
      updatedAt: new Date().toISOString(),
      blockRange: { from: newFrom, to: newTo },
      txCount: existing?.rebalances?.length || 0,
      rebalances: existing?.rebalances || [],
    };
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
    return { vault, chain, txCount: out.txCount, newTxCount: 0, fileName: outFile };
  }

  // Resolve token metadata
  const uniqueTokens = [...new Set(allTransfers.map(t => t.token))];
  const tokenMeta = {};
  for (let i = 0; i < uniqueTokens.length; i += 5) {
    const batch = uniqueTokens.slice(i, i + 5);
    const results = await Promise.all(batch.map(t => getTokenMeta(chain, t)));
    batch.forEach((addr, j) => { tokenMeta[addr] = results[j]; });
  }

  // Build rebalance records (fetch timestamps in parallel batches)
  const txList = Object.entries(txGroups);
  const newRebalances = [];
  for (let i = 0; i < txList.length; i += 5) {
    const batch = txList.slice(i, i + 5);
    const blockNums = batch.map(([, transfers]) => transfers[0].block);
    const timestamps = await Promise.all(blockNums.map(b => getBlockTimestamp(chain, b).catch(() => 0)));
    batch.forEach(([tx, transfers], j) => {
      const flows = transfers.map(t => {
        const meta = tokenMeta[t.token];
        const cls = classifyToken(meta);
        const decimals = meta?.decimals ?? 18;
        const amount = Number(t.amount) / 10 ** decimals;
        const usdValue = meta?.price ? amount * meta.price : null;
        return {
          token: t.token,
          symbol: meta?.symbol || '?',
          protocol: cls.protocol,
          kind: cls.kind,
          direction: t.from === vault ? 'out' : 'in',
          amount: Math.round(amount * 1e6) / 1e6,
          usdValue: usdValue != null ? Math.round(usdValue * 100) / 100 : null,
        };
      });

      // Infer USD value for protocol-receipt-token flows missing prices.
      // Receipt tokens (e.g. spwstETH) often aren't on DeFi Llama. Their value
      // mirrors the underlying transferred in the opposite direction in the
      // same tx — so use the corresponding side's USD as a proxy.
      const knownOut = flows.filter(f => f.direction === 'out' && f.usdValue != null);
      const knownIn  = flows.filter(f => f.direction === 'in'  && f.usdValue != null);
      const sumKnownOut = knownOut.reduce((a, f) => a + f.usdValue, 0);
      const sumKnownIn  = knownIn.reduce((a, f) => a + f.usdValue, 0);
      flows.forEach(f => {
        if (f.usdValue != null) return;
        if (f.kind === 'unknown') return; // don't fabricate value for truly unknown tokens
        // Use the opposite-direction sum as proxy; fall back to same-direction if missing
        const proxy = f.direction === 'out' ? sumKnownIn : sumKnownOut;
        if (proxy > 0) {
          f.usdValue = Math.round(proxy * 100) / 100;
          f.usdInferred = true;
        }
      });

      newRebalances.push({ tx, block: transfers[0].block, timestamp: timestamps[j], flows });
    });
  }

  // Merge with existing, dedupe by tx hash, sort newest first
  const all = [...newRebalances, ...(existing?.rebalances || [])];
  const seen = new Set();
  const merged = all.filter(r => {
    if (seen.has(r.tx)) return false;
    seen.add(r.tx);
    return true;
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const newFrom = Math.min(...ranges.map(r => r.from), existing?.blockRange?.from ?? Infinity);
  const newTo   = Math.max(...ranges.map(r => r.to),   existing?.blockRange?.to   ?? 0);
  const out = {
    vault, chain,
    updatedAt: new Date().toISOString(),
    blockRange: { from: newFrom, to: newTo },
    txCount: merged.length,
    rebalances: merged,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`    +${newRebalances.length} new rebalances (${merged.length} total) → ${outFile}`);
  return { vault, chain, txCount: merged.length, newTxCount: newRebalances.length, fileName: outFile };
}

async function main() {
  const args = process.argv.slice(2);

  // Pre-load activity events once for cross-referencing
  const userTxsByVault = {};
  try {
    const activity = JSON.parse(fs.readFileSync('activity-events.json', 'utf8'));
    for (const e of activity.events) {
      const v = e.vault.toLowerCase();
      if (!userTxsByVault[v]) userTxsByVault[v] = new Set();
      userTxsByVault[v].add(e.tx.toLowerCase());
    }
  } catch {}

  if (args[0] === '--all') {
    // Scan ALL >$1K TVL vaults with supported chain RPCs
    let vaults;
    try {
      const ipor = JSON.parse(fs.readFileSync('ipor-vaults.json', 'utf8'));
      const supportedChains = new Set(Object.keys(CHAIN_RPCS));
      vaults = ipor.vaults
        .filter(v => v.tvl >= 1000 && supportedChains.has(v.chain))
        .map(v => ({ address: v.address.toLowerCase(), chain: v.chain, name: v.name, tvl: v.tvl }));
    } catch (e) {
      console.error('Could not load ipor-vaults.json:', e.message);
      process.exit(1);
    }

    console.log(`\n=== FULL REBALANCE SCAN — ${vaults.length} vaults ===\n`);
    const summary = { updatedAt: null, vaults: [] };
    let scannedOk = 0, failed = 0;

    for (const v of vaults) {
      console.log(`\n[${scannedOk + failed + 1}/${vaults.length}] ${v.name} ($${(v.tvl/1000).toFixed(0)}K)`);
      try {
        const result = await scanVault(v.address, v.chain, { userTxs: userTxsByVault[v.address] || new Set() });
        summary.vaults.push({ ...result, name: v.name, tvl: v.tvl });
        scannedOk++;
      } catch (e) {
        console.log(`    FAILED: ${e.message}`);
        failed++;
      }
    }

    summary.updatedAt = new Date().toISOString();
    summary.scannedOk = scannedOk;
    summary.failed = failed;
    summary.totalVaults = vaults.length;
    fs.writeFileSync('rebalances-summary.json', JSON.stringify(summary, null, 2) + '\n');
    console.log(`\n=== DONE — ${scannedOk} ok, ${failed} failed → rebalances-summary.json ===\n`);
    return;
  }

  // --deepest-all [chain]
  // Sequential deep historical scan for ALL >$1K vaults. Conservative per-chain
  // backfill windows (smaller than single-vault --deepest) so the whole set
  // fits within the GHA 6h cap. continue-on-error per vault: a failure on
  // one doesn't stop the rest.
  if (args[0] === '--deepest-all') {
    const chainFilter = args[1] || null;
    // Conservative per-chain windows for the all-vaults sweep (smaller than --deepest single-vault)
    const DEEPEST_ALL_BACKFILL = {
      ethereum:  2_500_000,   // ~12 months at 12s
      base:      7_500_000,   // ~6 months at 2s
      arbitrum:  5_000_000,   // ~17 days at 0.3s — realistic for free RPCs
      plasma:    2_500_000,
      avalanche: 7_500_000,
      unichain:  7_500_000,
      _default:  2_500_000,
    };
    const PER_VAULT_DEADLINE_MS = 12 * 60 * 1000; // 12 min per vault hard cap

    let vaults;
    try {
      const ipor = JSON.parse(fs.readFileSync('ipor-vaults.json', 'utf8'));
      const supportedChains = new Set(Object.keys(CHAIN_RPCS));
      vaults = ipor.vaults
        .filter(v => v.tvl >= 1000 && supportedChains.has(v.chain))
        .filter(v => !chainFilter || v.chain === chainFilter)
        .map(v => ({ address: v.address.toLowerCase(), chain: v.chain, name: v.name, tvl: v.tvl }));
    } catch (e) {
      console.error('Could not load ipor-vaults.json:', e.message);
      process.exit(1);
    }

    // Sort: smaller chains first (fewer vaults, fast wins), then ETH (largest)
    const chainOrder = { plasma: 0, avalanche: 1, unichain: 2, arbitrum: 3, base: 4, ethereum: 5 };
    vaults.sort((a, b) => (chainOrder[a.chain] ?? 99) - (chainOrder[b.chain] ?? 99) || b.tvl - a.tvl);

    console.log(`\n=== DEEPEST-ALL REBALANCE SCAN — ${vaults.length} vaults ${chainFilter ? `[${chainFilter}]` : ''} ===`);
    console.log(`Throttle: ${RPC_MIN_INTERVAL_MS}ms · per-vault budget: ${PER_VAULT_DEADLINE_MS/60000}min\n`);

    const summary = { updatedAt: null, mode: 'deepest-all', vaults: [] };
    let scannedOk = 0, failed = 0, skipped = 0;
    const startedAt = Date.now();
    const GLOBAL_DEADLINE = startedAt + 5 * 60 * 60 * 1000; // 5h global cap

    for (const v of vaults) {
      const idx = scannedOk + failed + skipped + 1;
      const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
      if (Date.now() > GLOBAL_DEADLINE) {
        console.log(`\n[${idx}/${vaults.length}] SKIPPED ${v.name} — global deadline reached`);
        skipped++;
        continue;
      }
      console.log(`\n[${idx}/${vaults.length}] ${v.name} [${v.chain}] ($${(v.tvl/1000).toFixed(0)}K) · elapsed ${elapsedMin}min`);

      const window = DEEPEST_ALL_BACKFILL[v.chain] || DEEPEST_ALL_BACKFILL._default;
      const t0 = Date.now();
      try {
        let currentBlock;
        try { currentBlock = await getBlockNumber(v.chain); }
        catch (e) { console.log(`    SKIPPED: getBlockNumber failed: ${e.message}`); failed++; continue; }
        const fromBlock = Math.max(1, currentBlock - window);

        // Race scanVault against the per-vault budget
        const scanPromise = scanVault(v.address, v.chain, {
          userTxs: userTxsByVault[v.address] || new Set(),
          fromBlock,
          maxBlocksOverride: Infinity,
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`per-vault budget exceeded (${PER_VAULT_DEADLINE_MS/60000}min)`)), PER_VAULT_DEADLINE_MS)
        );
        const result = await Promise.race([scanPromise, timeoutPromise]);
        summary.vaults.push({ ...result, name: v.name, tvl: v.tvl, elapsedSec: Math.round((Date.now() - t0) / 1000) });
        scannedOk++;
        console.log(`    OK in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        console.log(`    FAILED: ${e.message}`);
        summary.vaults.push({ vault: v.address, chain: v.chain, name: v.name, error: e.message });
        failed++;
      }

      // Persist summary after each vault so progress survives mid-run crashes
      summary.updatedAt = new Date().toISOString();
      summary.scannedOk = scannedOk;
      summary.failed = failed;
      summary.skipped = skipped;
      summary.totalVaults = vaults.length;
      fs.writeFileSync('rebalances-summary.json', JSON.stringify(summary, null, 2) + '\n');
    }

    console.log(`\n=== DONE — ${scannedOk} ok, ${failed} failed, ${skipped} skipped (${Math.round((Date.now() - startedAt) / 60000)}min total) ===\n`);
    return;
  }

  // --deepest <vault> <chain> [fromBlock]
  // Scans backward as far as fromBlock (default: ~2 years on ETH equivalent for chain),
  // bypassing per-run safety cap. Use sparingly — meant for one-off historical seed.
  if (args[0] === '--deepest') {
    const vault = (args[1] || '').toLowerCase();
    const chain = args[2] || 'ethereum';
    const fromBlockArg = args[3] ? parseInt(args[3], 10) : null;
    if (!/^0x[a-f0-9]{40}$/.test(vault)) {
      console.error('Usage: node collect-rebalances.js --deepest <vaultAddress> [chain] [fromBlock]');
      process.exit(1);
    }
    // Deep backfill defaults: ~2 years equivalent
    const DEEP_BACKFILL = {
      ethereum:  5_000_000,    // ~24 months at 12s/block
      base:     30_000_000,    // ~24 months at 2s/block
      arbitrum: 200_000_000,   // ~24 months at 0.3s/block
      plasma:    5_000_000,
      avalanche:30_000_000,
      unichain: 15_000_000,
      _default:  5_000_000,
    };
    const currentBlock = await getBlockNumber(chain);
    const defaultDeep = DEEP_BACKFILL[chain] || DEEP_BACKFILL._default;
    const fromBlock = fromBlockArg ?? Math.max(1, currentBlock - defaultDeep);
    console.log(`\n=== DEEPEST scan for ${vault} on ${chain} ===`);
    console.log(`Range: block ${fromBlock} → ${currentBlock} (${currentBlock - fromBlock} blocks ≈ ${(((currentBlock - fromBlock) * 12) / 86400).toFixed(0)}d at ETH cadence)`);
    console.log(`Throttle: ${RPC_MIN_INTERVAL_MS}ms min between RPC calls per endpoint\n`);
    const t0 = Date.now();
    await scanVault(vault, chain, {
      userTxs: userTxsByVault[vault] || new Set(),
      fromBlock,
      maxBlocksOverride: Infinity,
    });
    console.log(`\nElapsed: ${Math.round((Date.now() - t0) / 1000)}s`);
    return;
  }

  if (!args[0]) {
    console.error('Usage:');
    console.error('  node collect-rebalances.js --all                              # scan all >$1K vaults (incremental)');
    console.error('  node collect-rebalances.js --deepest <vault> [chain] [fromBlock]  # one-off historical seed');
    console.error('  node collect-rebalances.js <vaultAddress> [chain]             # incremental single vault');
    process.exit(1);
  }

  // Single-vault mode
  const vault = args[0].toLowerCase();
  const chain = args[1] || 'ethereum';
  console.log(`\n=== Scanning rebalances for ${vault} on ${chain} ===\n`);
  await scanVault(vault, chain, { userTxs: userTxsByVault[vault] || new Set() });
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
