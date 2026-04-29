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
const PROTOCOL_RULES = [
  // Aave V3
  { match: (s, n) => /^a(?:Eth|Base|Arb)?[A-Z]/i.test(s) || /aave/i.test(n), protocol: 'Aave', kind: 'lending' },
  // Compound V3
  { match: (s, n) => /^c[A-Z].*V3?$/i.test(s) || /compound/i.test(n), protocol: 'Compound', kind: 'lending' },
  // Spark / MakerDAO
  { match: (s, n) => /^s(?:DAI|USDS|WETH|spk)/i.test(s) || /spark/i.test(n), protocol: 'Spark', kind: 'lending' },
  // Morpho (Blue and MetaMorpho)
  { match: (s, n) => /morpho|metamorpho/i.test(n), protocol: 'Morpho', kind: 'lending' },
  // Pendle
  { match: (s, n) => /^(PT|YT|SY)-/i.test(s) || /pendle/i.test(n), protocol: 'Pendle', kind: 'yield' },
  // Euler V2
  { match: (s, n) => /^e[A-Z]/.test(s) && /euler/i.test(n), protocol: 'Euler', kind: 'lending' },
  // Lido / wstETH (collateral, not protocol position)
  { match: (s, n) => /^(stETH|wstETH|weETH|ETHx|rETH|cbETH)$/i.test(s), protocol: 'LST', kind: 'collateral' },
  // Stablecoins
  { match: (s) => /^(USDC|USDT|DAI|USDe|crvUSD|GHO|USDS|FRAX|LUSD)$/i.test(s), protocol: 'Stable', kind: 'collateral' },
];

let callId = 0;
const activeRpcByChain = {};

async function rpcCall(chain, method, params) {
  const rpcs = CHAIN_RPCS[chain];
  if (!rpcs) throw new Error(`No RPCs for chain ${chain}`);
  const active = activeRpcByChain[chain] || 0;
  const order = [active, ...rpcs.map((_, i) => i).filter(i => i !== active)];
  for (const idx of order) {
    try {
      const res = await fetch(rpcs[idx], {
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

// Scan logs in chunks, halve on RPC error
async function scanLogs(chain, params, fromBlock, toBlock) {
  const out = [];
  const CHUNK = 10_000;
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
// Returns { vault, chain, txCount, newTxCount, fileName }
async function scanVault(vaultAddr, chain, opts = {}) {
  const vault = vaultAddr.toLowerCase();
  const outFile = `rebalance-events-${vault}.json`;

  // Load existing data for incremental scan
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  const currentBlock = await getBlockNumber(chain);
  const initialBackfill = INITIAL_BACKFILL[chain] || INITIAL_BACKFILL._default;
  const maxBlocks = MAX_BLOCKS_PER_RUN[chain] || MAX_BLOCKS_PER_RUN._default;

  let fromBlock;
  if (existing && existing.blockRange?.to) {
    fromBlock = existing.blockRange.to + 1;
  } else {
    fromBlock = Math.max(1, currentBlock - initialBackfill);
  }
  // Cap the scan window to avoid runaway scans on first run for old vaults
  if (currentBlock - fromBlock > maxBlocks) {
    fromBlock = currentBlock - maxBlocks;
  }

  if (fromBlock > currentBlock) {
    console.log(`  ${vault} [${chain}]: up to date`);
    return { vault, chain, txCount: existing?.rebalances?.length || 0, newTxCount: 0, fileName: outFile };
  }

  console.log(`  ${vault} [${chain}]: scanning blocks ${fromBlock} → ${currentBlock} (${currentBlock - fromBlock + 1} blocks)`);
  const padded = '0x' + vault.slice(2).padStart(64, '0');

  const outflowLogs = await scanLogs(chain, { topics: [TRANSFER_TOPIC, padded] }, fromBlock, currentBlock);
  const inflowLogs = await scanLogs(chain, { topics: [TRANSFER_TOPIC, null, padded] }, fromBlock, currentBlock);
  console.log(`    transfers: ${outflowLogs.length} out + ${inflowLogs.length} in`);

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
    const out = {
      vault, chain,
      updatedAt: new Date().toISOString(),
      blockRange: { from: existing?.blockRange?.from || fromBlock, to: currentBlock },
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

  const out = {
    vault, chain,
    updatedAt: new Date().toISOString(),
    blockRange: { from: existing?.blockRange?.from || fromBlock, to: currentBlock },
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

  if (!args[0]) {
    console.error('Usage:');
    console.error('  node collect-rebalances.js --all                              # scan all >$1K vaults');
    console.error('  node collect-rebalances.js <vaultAddress> [chain]             # scan single vault');
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
