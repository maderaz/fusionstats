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

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Usage: node collect-rebalances.js <vaultAddress> [chain] [backfillBlocks]');
    process.exit(1);
  }
  const vault = args[0].toLowerCase();
  const chain = args[1] || 'ethereum';
  const backfill = parseInt(args[2] || '50000', 10);

  console.log(`\n=== Scanning rebalances for ${vault} on ${chain} ===\n`);

  const currentBlock = await getBlockNumber(chain);
  const fromBlock = currentBlock - backfill;
  console.log(`Block range: ${fromBlock} → ${currentBlock} (${backfill} blocks)`);

  const padded = '0x' + vault.slice(2).padStart(64, '0');

  console.log('Fetching outflows (vault → *)...');
  const outflowLogs = await scanLogs(chain, { topics: [TRANSFER_TOPIC, padded] }, fromBlock, currentBlock);
  console.log(`  ${outflowLogs.length} outflow transfers`);

  console.log('Fetching inflows (* → vault)...');
  const inflowLogs = await scanLogs(chain, { topics: [TRANSFER_TOPIC, null, padded] }, fromBlock, currentBlock);
  console.log(`  ${inflowLogs.length} inflow transfers`);

  const allTransfers = [...outflowLogs, ...inflowLogs]
    .map(parseTransfer)
    .filter(Boolean);

  // Cross-reference user deposits/withdrawals from existing activity-events.json
  let userTxs = new Set();
  try {
    const activity = JSON.parse(fs.readFileSync('activity-events.json', 'utf8'));
    activity.events
      .filter(e => e.vault.toLowerCase() === vault)
      .forEach(e => userTxs.add(e.tx.toLowerCase()));
    console.log(`\nFound ${userTxs.size} user deposit/withdraw txs to filter out`);
  } catch (e) {
    console.log(`(no activity-events.json: ${e.message})`);
  }

  const rebalanceTransfers = allTransfers.filter(t => !userTxs.has(t.tx.toLowerCase()));
  console.log(`\nNon-user transfers (rebalance candidates): ${rebalanceTransfers.length}`);

  // Group by transaction hash
  const txGroups = {};
  for (const t of rebalanceTransfers) {
    if (!txGroups[t.tx]) txGroups[t.tx] = [];
    txGroups[t.tx].push(t);
  }

  console.log(`\nUnique rebalance transactions: ${Object.keys(txGroups).length}\n`);

  // Resolve token metadata for unique tokens
  const uniqueTokens = [...new Set(allTransfers.map(t => t.token))];
  console.log(`Resolving metadata for ${uniqueTokens.length} unique tokens...`);
  const tokenMeta = {};
  for (let i = 0; i < uniqueTokens.length; i += 5) {
    const batch = uniqueTokens.slice(i, i + 5);
    const results = await Promise.all(batch.map(t => getTokenMeta(chain, t)));
    batch.forEach((addr, j) => { tokenMeta[addr] = results[j]; });
  }

  // Build rebalance event records
  const rebalances = [];
  for (const [tx, transfers] of Object.entries(txGroups)) {
    const block = transfers[0].block;
    const ts = await getBlockTimestamp(chain, block).catch(() => 0);
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
    rebalances.push({ tx, block, timestamp: ts, flows });
  }

  rebalances.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Print summary
  console.log('\n=== TOKEN BREAKDOWN ===');
  const byProtocol = {};
  for (const tx of rebalances) {
    for (const f of tx.flows) {
      const k = `${f.protocol} (${f.symbol})`;
      byProtocol[k] = (byProtocol[k] || 0) + 1;
    }
  }
  Object.entries(byProtocol)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${k}: ${n}`));

  console.log('\n=== LATEST REBALANCES ===');
  rebalances.slice(0, 5).forEach(r => {
    const date = r.timestamp ? new Date(r.timestamp * 1000).toISOString() : `block ${r.block}`;
    console.log(`\n${date}  tx ${r.tx.slice(0, 12)}...`);
    r.flows.forEach(f => {
      const arrow = f.direction === 'out' ? '→' : '←';
      const usd = f.usdValue ? ` ($${f.usdValue.toLocaleString()})` : '';
      console.log(`  ${arrow} ${f.amount} ${f.symbol} via ${f.protocol}${usd}`);
    });
  });

  // Save to JSON
  const out = {
    vault,
    chain,
    updatedAt: new Date().toISOString(),
    blockRange: { from: fromBlock, to: currentBlock },
    txCount: rebalances.length,
    rebalances,
  };
  const outFile = `rebalance-events-${vault}.json`;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${rebalances.length} rebalance events to ${outFile}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
