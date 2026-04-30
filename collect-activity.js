#!/usr/bin/env node
//
// Vault Activity Collector
// Scans ERC-4626 Deposit/Withdraw events and appends new entries to activity-events.json.
// Designed to run frequently (every 30 min) — only fetches events since last run.
//
// Usage:  node collect-activity.js
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'activity-events.json');
const IPOR_VAULTS_FILE = path.join(__dirname, 'ipor-vaults.json');

// Minimum TVL ($) for a vault to be actively scanned.
const MIN_TVL_USD = 1000;

// Initial backfill window for newly-discovered vaults (~48 hours per chain block time)
const NEW_VAULT_BACKFILL = {
  ethereum:  14_400,   // ~48h at 12s/block
  base:      86_400,   // ~48h at 2s/block
  arbitrum: 576_000,   // ~48h at 0.3s/block
  plasma:    14_400,   // ~48h (EVM, ~12s blocks)
  avalanche: 86_400,   // ~48h at 2s/block
  unichain:  43_200,   // ~48h at ~4s/block
  _default:  14_400,
};

// Per-chain RPC endpoints (free, no auth)
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
  plasma: [
    'https://evm-rpc.plasma.io/api',
  ],
  avalanche: [
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://avalanche.drpc.org',
    'https://api.avax.network/ext/bc/C/rpc',
  ],
  unichain: [
    'https://mainnet.unichain.org',
  ],
};

// Per-chain scan chunk sizes (smaller = less likely to hit RPC limits)
const CHAIN_CHUNKS = {
  ethereum:  10_000,
  base:      10_000,
  arbitrum:  10_000,
  plasma:    10_000,
  avalanche: 10_000,
  unichain:  10_000,
  _default:  10_000,
};

// Max seconds to spend scanning a single chain (prevents workflow hangs)
const CHAIN_TIMEOUT_MS = 150_000; // 2.5 min per chain

// DeFi Llama chain prefix for price lookups
const LLAMA_CHAIN = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  plasma: 'plasma',
  avalanche: 'avax',
  unichain: 'unichain',
};

// ERC-4626 event topics
const DEPOSIT_TOPIC = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
const WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';

// Token addresses on Ethereum (fallback for DeFi Llama price lookups when vaults.json unavailable)
const TOKEN_ADDRESSES = {
  'stETH':    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
  'wstETH':   '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
  'WETH':     '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  'USDC':     '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'USDT':     '0xdac17f958d2ee523a2206206994597c13d831ec7',
  'DAI':      '0x6b175474e89094c44da98b954eedeac495271d0f',
  'WBTC':     '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  'cbBTC':    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  'USDe':     '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
  'crvUSD':   '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e',
  'syrupUSDT':'0x7760305304cb8e395285e67a0385da55e43a09b1',
  'wsrUSD':   '0x1bee4f735062cd00841d6929b9c6b2b0034d8542',
  'stcUSD':   '0x252d4a2e5ec1db0c0e1153c7a23e1b12f1f4a422',
  'mHYPER':   '0xc3116259dff84f0abe9def1c912aff40116647b3',
};

// Fallback vault definitions if vaults.json is unavailable
const FALLBACK_VAULTS = [
  { address: '0xb8a451107a9f87fde481d4d686247d6e43ed715e', name: 'IPOR stETH Ethereum', symbol: 'stETH', decimals: 18 },
  { address: '0x3b3bdaa4462851621818d2cebc835e077587147a', name: 'K3 Leveraged syrupUSDT Strategy', symbol: 'syrupUSDT', decimals: 6 },
  { address: '0x604117f0c94561231060f56cd2ddd16245d434c5', name: 'AavEthena Loop Mainnet', symbol: 'USDe', decimals: 18 },
  { address: '0xd36f53497507e948df9f277cf8c3ececb09a1c1d', name: 'TAU InfiniFi Pointsmaxx - Silo', symbol: 'USDC', decimals: 6 },
  { address: '0xbfa9d6ec0e04b6691fcae5f8b48838c3918ec117', name: 'LlamaRisk crvUSD Optimizer', symbol: 'crvUSD', decimals: 18 },
  { address: '0x43a32d4f6c582f281c52393f8f9e5ace1d4a1e68', name: 'TAU Yield Bond ETF', symbol: 'USDC', decimals: 6 },
  { address: '0x63103375659d0aa94e9f35df15be01a3dd1ae9c0', name: 'TAU Lending Optimizer', symbol: 'USDC', decimals: 6 },
  { address: '0xe9385eff3f937fcb0f0085da9a3f53d6c2b4fb5f', name: 'Reservoir wsrUSD Looping', symbol: 'wsrUSD', decimals: 18 },
  { address: '0xb0f56bb0bf13ee05fef8cd2d8df5ffdfcac7a74f', name: 'TAU infiniFi Pointsmax', symbol: 'USDC', decimals: 6 },
  { address: '0xf6cd9e8415162c8fb3c52676c7ca68812a34f76e', name: 'Reservoir ETH Yield', symbol: 'WETH', decimals: 18 },
  { address: '0x6f66b845604dad6e80b2a1472e6cacbbe66a8c40', name: 'TAU Reservoir Pointsmax', symbol: 'wsrUSD', decimals: 18 },
  { address: '0xe47358eae04719f3cf7025e95d0ad202e68bd9b2', name: 'Reservoir BTC Yield', symbol: 'WBTC', decimals: 8 },
  { address: '0xc50b2d51fd1e2ac67a9c09eaf63c24ea2465c64b', name: 'TAU InfiniFi ETH Carry', symbol: 'WETH', decimals: 18 },
  { address: '0xe48cdd5ecec5aa53e630a7b4df12f79067b68dac', name: 'TAU InfiniFi BTC Carry', symbol: 'WBTC', decimals: 8 },
  { address: '0x20e934c725b6703f0ac696f1689008057db9ac44', name: 'IPOR DAI Prime', symbol: 'DAI', decimals: 18 },
  { address: '0xef53663bb775a51181f04d590f88fc38d6bd5751', name: 'Sentinel stcUSD Adaptive Looping', symbol: 'stcUSD', decimals: 18 },
  { address: '0xad685fec2066d7f5436f5804882998ba79725706', name: 'Magnus Lending Optimizer', symbol: 'USDC', decimals: 6 },
  { address: '0x87428d886f43068a44d7bdeef106d3c42e1d6f23', name: 'AlchemistCS', symbol: 'USDC', decimals: 6 },
  { address: '0x9824dcdac89f208bf8b5cb5c4dc41f04a0878607', name: 'Tesseract Managed ETH', symbol: 'WETH', decimals: 18 },
  { address: '0xc2a119ea6de75e4b1451330321cb2474eb8d82d4', name: 'Tesseract USDC Lending Optimizer', symbol: 'USDC', decimals: 6 },
  { address: '0x60e36a79c3d21120350e39b5ea59ae26b75ae74c', name: 'TAU InfiniFi cbBTC Carry', symbol: 'cbBTC', decimals: 8 },
  { address: '0x0b45a1e71a8a09f5d382fed27202d50ed983aaf3', name: 'Hyperithm mHYPER Looping', symbol: 'mHYPER', decimals: 18 },
  { address: '0xdab31950ddcc814c49e6bbd5153dd2062e44f368', name: 'Tesseract Managed BTC', symbol: 'WBTC', decimals: 8 },
];

// Decimals lookup by underlying token symbol (used when ipor-vaults.json
// doesn't supply decimals). Covers common tokens. Unknown tokens default to 18.
const DECIMALS_BY_SYMBOL = {
  USDC: 6, USDT: 6, DAI: 18, USDe: 18, crvUSD: 18, sUSDe: 18, GHO: 18,
  syrupUSDT: 6, syrupUSDC: 6, stcUSD: 18, wsrUSD: 18, rUSD: 18, srUSD: 18,
  WETH: 18, stETH: 18, wstETH: 18, weETH: 18, cbETH: 18, rETH: 18,
  WBTC: 8, cbBTC: 8, tBTC: 18, PAXG: 18, XAUt: 6,
  BOLD: 18, mHYPER: 18, EURC: 6, ZCHF: 18, slvlUSD: 18, csUSDL: 18, sUSDf: 18,
};

function decimalsFor(symbol) {
  if (symbol && DECIMALS_BY_SYMBOL[symbol] != null) return DECIMALS_BY_SYMBOL[symbol];
  return 18;
}

// Load vaults from ipor-vaults.json — ALL chains with supported RPCs.
// Falls back to FALLBACK_VAULTS (ethereum only) if file doesn't exist.
function loadVaults() {
  let iporData = null;
  try {
    iporData = JSON.parse(fs.readFileSync(IPOR_VAULTS_FILE, 'utf8'));
  } catch (e) {
    console.log(`ipor-vaults.json unavailable (${e.message}), using fallback list`);
    return FALLBACK_VAULTS.map(v => ({ ...v, chain: 'ethereum' }));
  }

  const supportedChains = new Set(Object.keys(CHAIN_RPCS));
  const all = (iporData.vaults || []).filter(v => supportedChains.has(v.chain));
  const tracked = all.filter(v => v.tvl >= MIN_TVL_USD);

  const byChain = {};
  tracked.forEach(v => { byChain[v.chain] = (byChain[v.chain] || 0) + 1; });
  const chainSummary = Object.entries(byChain).map(([c, n]) => `${c}:${n}`).join(', ');
  console.log(`Loaded ${iporData.vaults.length} total vaults, ${all.length} on supported chains, ` +
              `${tracked.length} above $${MIN_TVL_USD} TVL [${chainSummary}]`);

  return tracked.map(v => ({
    address: v.address.toLowerCase(),
    chain: v.chain || 'ethereum',
    name: v.name || 'Unknown',
    symbol: v.token || '?',
    decimals: decimalsFor(v.token),
    underlyingToken: v.assetAddress || null,
    tvl: v.tvl || 0,
  }));
}

// Stablecoin detection: symbol contains USD/DAI
function isStablecoin(symbol) {
  if (!symbol) return false;
  const s = symbol.toUpperCase();
  return s.includes('USD') || s.includes('DAI') || s === 'FRAX';
}

let callId = 0;
const activeRpcByChain = {};
const lastCallTimeByRpc = {};
const RPC_MIN_INTERVAL_MS = parseInt(process.env.RPC_MIN_INTERVAL_MS || '0', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rpcCall(chain, method, params) {
  const rpcs = CHAIN_RPCS[chain];
  if (!rpcs) throw new Error(`No RPCs for chain ${chain}`);
  const active = activeRpcByChain[chain] || 0;
  const order = [active, ...rpcs.map((_, i) => i).filter(i => i !== active)];
  for (const idx of order) {
    const url = rpcs[idx];
    if (RPC_MIN_INTERVAL_MS > 0) {
      const last = lastCallTimeByRpc[url] || 0;
      const wait = RPC_MIN_INTERVAL_MS - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      lastCallTimeByRpc[url] = Date.now();
    }
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
    } catch (e) {
      // suppress verbose per-RPC errors
    }
  }
  throw new Error(`All RPCs failed for ${chain}:${method}`);
}

async function getBlockNumber(chain) {
  const hex = await rpcCall(chain, 'eth_blockNumber', []);
  return parseInt(hex, 16);
}

async function getBlockTimestamp(chain, blockNum) {
  const block = await rpcCall(chain, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  return block ? parseInt(block.timestamp, 16) : 0;
}

// DeFi Llama historical price: https://coins.llama.fi/prices/historical/{ts}/ethereum:{addr}
async function fetchHistoricalPrice(symbol, tokenAddr, timestamp, chain) {
  if (isStablecoin(symbol)) return 1.0;
  if (!tokenAddr) tokenAddr = TOKEN_ADDRESSES[symbol];
  if (!tokenAddr) return null;
  const llamaChain = LLAMA_CHAIN[chain] || LLAMA_CHAIN[chain] || 'ethereum';
  try {
    const url = `https://coins.llama.fi/prices/historical/${timestamp}/${llamaChain}:${tokenAddr}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    // DeFi Llama may return keys in different case — match case-insensitively
    const coins = json.coins || {};
    const match = Object.keys(coins).find(k => k.toLowerCase() === `${llamaChain}:${tokenAddr.toLowerCase()}`);
    return match ? coins[match].price : null;
  } catch {
    return null;
  }
}

// Batch price lookups: group events by symbol+day, fetch one price per group
async function enrichWithPrices(events) {
  // Group by underlyingToken + day (don't need per-second precision)
  const groups = {};
  for (const e of events) {
    if (e.usdValue != null) continue; // already has price
    if (!e.timestamp) continue;
    const day = Math.floor(e.timestamp / 86400) * 86400; // round to day
    const key = `${e.underlyingToken || e.symbol}:${day}`;
    if (!groups[key]) groups[key] = { symbol: e.symbol, underlyingToken: e.underlyingToken, chain: e.chain, timestamp: day + 43200, events: [] }; // midday
    groups[key].events.push(e);
  }

  const keys = Object.keys(groups);
  console.log(`  Fetching prices for ${keys.length} symbol/day groups...`);

  for (let i = 0; i < keys.length; i += 3) {
    const batch = keys.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(k => fetchHistoricalPrice(groups[k].symbol, groups[k].underlyingToken, groups[k].timestamp, groups[k].chain))
    );
    results.forEach((price, j) => {
      if (price == null) return;
      for (const e of groups[batch[j]].events) {
        e.usdPrice = Math.round(price * 100) / 100;
        e.usdValue = Math.round(e.assets * price * 100) / 100;
      }
    });
  }
}

// Batch scan: accepts array of addresses so one eth_getLogs covers all vaults on a chain.
// Respects `deadline` (Date.now() + ms) — aborts scanning once exceeded.
// Returns { logs, reachedBlock } so caller knows where partial progress stopped.
async function scanLogs(chain, addresses, topic, fromBlock, toBlock, deadline) {
  const allLogs = [];
  const CHUNK = CHAIN_CHUNKS[chain] || CHAIN_CHUNKS._default;
  let reachedBlock = fromBlock - 1;

  async function scan(from, to) {
    if (Date.now() > deadline) throw new Error('chain timeout');
    try {
      const logs = await rpcCall(chain, 'eth_getLogs', [{
        address: addresses,
        topics: [topic],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      allLogs.push(...logs);
    } catch (e) {
      if (e.message === 'chain timeout') throw e;
      if (to - from <= 500) return; // give up on tiny ranges
      const mid = from + Math.floor((to - from) / 2);
      await scan(from, mid);
      await scan(mid + 1, to);
    }
  }

  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    try {
      await scan(start, end);
      reachedBlock = end;
    } catch (e) {
      if (e.message === 'chain timeout') { break; }
      throw e;
    }
  }
  return { logs: allLogs, reachedBlock };
}

function parseDepositLog(log, vault) {
  const sender = '0x' + log.topics[1].slice(26).toLowerCase();
  const owner = '0x' + log.topics[2].slice(26).toLowerCase();
  const assets = Number(BigInt(log.data.slice(0, 66))) / (10 ** vault.decimals);
  const shares = Number(BigInt('0x' + log.data.slice(66, 130))) / (10 ** vault.decimals);
  return {
    type: 'deposit',
    vault: vault.address,
    vaultName: vault.name,
    symbol: vault.symbol,
    chain: vault.chain,
    underlyingToken: vault.underlyingToken,
    sender, owner, assets, shares,
    tx: log.transactionHash,
    block: parseInt(log.blockNumber, 16),
    logIdx: parseInt(log.logIndex, 16),
  };
}

function parseWithdrawLog(log, vault) {
  const sender = '0x' + log.topics[1].slice(26).toLowerCase();
  const receiver = '0x' + log.topics[2].slice(26).toLowerCase();
  const owner = '0x' + log.topics[3].slice(26).toLowerCase();
  const assets = Number(BigInt(log.data.slice(0, 66))) / (10 ** vault.decimals);
  const shares = Number(BigInt('0x' + log.data.slice(66, 130))) / (10 ** vault.decimals);
  return {
    type: 'withdraw',
    vault: vault.address,
    vaultName: vault.name,
    symbol: vault.symbol,
    chain: vault.chain,
    underlyingToken: vault.underlyingToken,
    sender, receiver, owner, assets, shares,
    tx: log.transactionHash,
    block: parseInt(log.blockNumber, 16),
    logIdx: parseInt(log.logIndex, 16),
  };
}

// Deep historical scan for a single vault — bypass MAX_BLOCKS cap, scan
// from explicit fromBlock (default ~24 months back) to currentBlock, supporting
// both backward fill (extending historical coverage) and forward delta.
// Merges into activity-events.json with dedup by tx+logIdx.
async function deepestScanVault(vaultAddr, chain, fromBlockArg) {
  const vault = vaultAddr.toLowerCase();
  const DEEP_BACKFILL = {
    ethereum:  5_000_000,    // ~24 months at 12s/block
    base:     30_000_000,    // ~24 months at 2s/block
    arbitrum: 200_000_000,
    plasma:    5_000_000,
    avalanche: 30_000_000,
    unichain:  15_000_000,
    _default:  5_000_000,
  };
  const DEADLINE_NEVER = Date.now() + 6 * 60 * 60 * 1000;

  // Load existing data + locate vault
  let data = { updatedAt: null, lastBlock: {}, events: [], vaults: [] };
  try { data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch {}

  const VAULTS = loadVaults();
  const vaultMeta = VAULTS.find(v => v.address === vault);
  if (!vaultMeta) {
    console.error(`Vault ${vault} not found in ipor-vaults.json (or below TVL filter)`);
    process.exit(1);
  }

  const currentBlock = await getBlockNumber(chain);
  const defaultDeep = DEEP_BACKFILL[chain] || DEEP_BACKFILL._default;
  const startBlock = fromBlockArg ?? Math.max(1, currentBlock - defaultDeep);

  // Compute scan ranges from existing coverage
  const ranges = [];
  const existingFrom = data.lastBlock?.[`${vault}:from`];
  const existingTo   = data.lastBlock?.[vault];
  if (existingTo && existingFrom) {
    if (startBlock < existingFrom) ranges.push({ from: startBlock, to: existingFrom - 1, label: 'backward' });
    if (existingTo + 1 <= currentBlock) ranges.push({ from: existingTo + 1, to: currentBlock, label: 'forward' });
  } else {
    ranges.push({ from: startBlock, to: currentBlock, label: 'full' });
  }

  if (ranges.length === 0) {
    console.log(`${vault}: already covers the requested range`);
    return;
  }

  console.log(`\n=== DEEPEST scan for ${vault} (${vaultMeta.name}) on ${chain} ===`);
  console.log(`Throttle: ${RPC_MIN_INTERVAL_MS}ms min between RPC calls\n`);

  for (const r of ranges) {
    console.log(`  ${r.label} scan: blocks ${r.from} → ${r.to} (${(r.to - r.from + 1).toLocaleString()} blocks)`);
    const t0 = Date.now();
    const dep = await scanLogs(chain, [vault], DEPOSIT_TOPIC, r.from, r.to, DEADLINE_NEVER);
    const wd  = await scanLogs(chain, [vault], WITHDRAW_TOPIC, r.from, r.to, DEADLINE_NEVER);
    console.log(`    ${dep.logs.length} deposit + ${wd.logs.length} withdraw logs (${Math.round((Date.now() - t0)/1000)}s)`);

    const newEvents = [];
    for (const log of dep.logs)  newEvents.push(parseDepositLog(log, vaultMeta));
    for (const log of wd.logs)   newEvents.push(parseWithdrawLog(log, vaultMeta));

    // Fetch timestamps in parallel batches of 10
    const uniqueBlocks = [...new Set(newEvents.map(e => e.block))];
    if (uniqueBlocks.length > 0) {
      console.log(`    fetching timestamps for ${uniqueBlocks.length} blocks...`);
      const tsMap = {};
      for (let i = 0; i < uniqueBlocks.length; i += 10) {
        const batch = uniqueBlocks.slice(i, i + 10);
        const results = await Promise.all(batch.map(b => getBlockTimestamp(chain, b).catch(() => 0)));
        results.forEach((ts, j) => { tsMap[batch[j]] = ts; });
      }
      newEvents.forEach(e => { e.timestamp = tsMap[e.block] || 0; });
    }

    newEvents.forEach(e => {
      e.assets = Math.round(e.assets * 1e6) / 1e6;
      e.shares = Math.round(e.shares * 1e6) / 1e6;
    });

    await enrichWithPrices(newEvents);
    data.events.push(...newEvents);
    console.log(`    +${newEvents.length} events`);
  }

  // Update coverage markers
  if (!data.lastBlock) data.lastBlock = {};
  const newFrom = Math.min(startBlock, data.lastBlock[`${vault}:from`] ?? Infinity);
  const newTo   = Math.max(currentBlock, data.lastBlock[vault] ?? 0);
  data.lastBlock[`${vault}:from`] = newFrom;
  data.lastBlock[vault] = newTo;

  // Dedup events by tx + logIdx, sort newest first
  const seen = new Set();
  data.events = data.events
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || b.block - a.block || b.logIdx - a.logIdx)
    .filter(e => {
      const key = e.tx + ':' + e.logIdx;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  data.updatedAt = new Date().toISOString();
  data.vaults = VAULTS.map(v => ({ address: v.address, name: v.name, symbol: v.symbol, chain: v.chain, underlyingToken: v.underlyingToken }));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${data.events.length} total events to ${OUTPUT_FILE}`);
}

async function main() {
  // CLI: --deepest <vault> [chain] [fromBlock]
  const args = process.argv.slice(2);
  if (args[0] === '--deepest') {
    const vault = (args[1] || '').toLowerCase();
    const chain = args[2] || 'ethereum';
    const fromBlock = args[3] ? parseInt(args[3], 10) : null;
    if (!/^0x[a-f0-9]{40}$/.test(vault)) {
      console.error('Usage: node collect-activity.js --deepest <vault> [chain] [fromBlock]');
      process.exit(1);
    }
    await deepestScanVault(vault, chain, fromBlock);
    return;
  }

  console.log('=== Vault Activity Collector ===\n');

  const VAULTS = loadVaults();

  // Load existing data
  let data = { updatedAt: null, lastBlock: {}, events: [] };
  try {
    data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {}

  // Scan new events across all supported chains
  let newEventsTotal = 0;

  // Reset lastBlock for vaults with 0 events (need deeper backfill)
  const eventVaults = new Set(data.events.map(e => e.vault));
  for (const vault of VAULTS) {
    if (data.lastBlock[vault.address] && !eventVaults.has(vault.address)) {
      console.log(`${vault.name}: resetting lastBlock (0 events, needs deeper backfill)`);
      delete data.lastBlock[vault.address];
    }
  }

  // Group vaults by chain
  const byChain = {};
  VAULTS.forEach(v => {
    const c = v.chain || 'ethereum';
    if (!byChain[c]) byChain[c] = [];
    byChain[c].push(v);
  });

  for (const [chain, chainVaults] of Object.entries(byChain)) {
    if (!CHAIN_RPCS[chain]) { console.log(`Skipping ${chain} — no RPCs configured`); continue; }

    let currentBlock;
    try {
      currentBlock = await getBlockNumber(chain);
      console.log(`\n=== ${chain.toUpperCase()} === (block ${currentBlock}, ${chainVaults.length} vaults)`);
    } catch (e) {
      console.log(`\n=== ${chain.toUpperCase()} === SKIPPED (RPC error: ${e.message})`);
      continue;
    }

    const backfill = NEW_VAULT_BACKFILL[chain] || NEW_VAULT_BACKFILL._default;

    // Find the earliest fromBlock across all vaults on this chain
    const vaultsToScan = [];
    for (const vault of chainVaults) {
      const lastBlock = data.lastBlock[vault.address] || (currentBlock - backfill);
      const fromBlock = lastBlock + 1;
      if (fromBlock <= currentBlock) vaultsToScan.push({ vault, fromBlock });
    }

    if (vaultsToScan.length === 0) {
      console.log(`  All vaults up to date`);
      continue;
    }

    const earliestFrom = Math.min(...vaultsToScan.map(v => v.fromBlock));
    const allAddresses = vaultsToScan.map(v => v.vault.address);
    const vaultMap = Object.fromEntries(chainVaults.map(v => [v.address, v]));

    const deadline = Date.now() + CHAIN_TIMEOUT_MS;
    console.log(`  Batch scanning ${allAddresses.length} vaults from block ${earliestFrom} (deadline ${Math.round(CHAIN_TIMEOUT_MS/1000)}s)...`);

    try {
      // Single batch eth_getLogs for all vaults on this chain
      const dep = await scanLogs(chain, allAddresses, DEPOSIT_TOPIC, earliestFrom, currentBlock, deadline);
      const wd  = await scanLogs(chain, allAddresses, WITHDRAW_TOPIC, earliestFrom, currentBlock, deadline);
      const depositLogs = dep.logs;
      const withdrawLogs = wd.logs;
      // Conservative: use the min progress block across both topics
      const progressBlock = Math.min(dep.reachedBlock, wd.reachedBlock);

      console.log(`  ${depositLogs.length} deposit logs, ${withdrawLogs.length} withdraw logs (reached block ${progressBlock}/${currentBlock})`);

      const addrIdx = new Map(vaultsToScan.map(v => [v.vault.address, v]));
      const newEvents = [];
      const parseInto = (logs, parser) => {
        for (const log of logs) {
          const addr = log.address.toLowerCase();
          const vault = vaultMap[addr];
          if (!vault) continue;
          const entry = addrIdx.get(addr);
          if (entry && parseInt(log.blockNumber, 16) >= entry.fromBlock) {
            newEvents.push(parser(log, vault));
          }
        }
      };
      parseInto(depositLogs, parseDepositLog);
      parseInto(withdrawLogs, parseWithdrawLog);

      newEventsTotal += newEvents.length;

      // Fetch timestamps (batch 10 at a time), with chain deadline
      const uniqueBlocks = [...new Set(newEvents.map(e => e.block))];
      if (uniqueBlocks.length > 0) {
        console.log(`  Fetching timestamps for ${uniqueBlocks.length} blocks...`);
        const tsMap = {};
        for (let i = 0; i < uniqueBlocks.length; i += 10) {
          if (Date.now() > deadline) { console.log('  (timestamp fetch cut short — deadline)'); break; }
          const batch = uniqueBlocks.slice(i, i + 10);
          const results = await Promise.all(batch.map(b => getBlockTimestamp(chain, b).catch(() => 0)));
          results.forEach((ts, j) => { tsMap[batch[j]] = ts; });
        }
        newEvents.forEach(e => { e.timestamp = tsMap[e.block] || 0; });
      }

      newEvents.forEach(e => {
        e.assets = Math.round(e.assets * 1e6) / 1e6;
        e.shares = Math.round(e.shares * 1e6) / 1e6;
      });

      await enrichWithPrices(newEvents);
      data.events.push(...newEvents);
      // Persist partial progress: use progressBlock if we didn't reach currentBlock
      const stopBlock = (progressBlock >= currentBlock) ? currentBlock : progressBlock;
      if (stopBlock >= earliestFrom) {
        for (const { vault } of vaultsToScan) {
          data.lastBlock[vault.address] = stopBlock;
        }
      }
    } catch (e) {
      console.log(`  ${chain} batch scan failed: ${e.message}`);
    }

    // Persist after each chain so partial progress is saved even if later chains hang
    try {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n');
    } catch (e) {
      console.log(`  (warning: intermediate save failed: ${e.message})`);
    }
  }

  // Backfill prices for any events still missing usdValue (works without RPC)
  const needPrices = data.events.filter(e => e.usdValue == null && e.timestamp && e.symbol);
  if (needPrices.length > 0) {
    console.log(`\nBackfilling prices for ${needPrices.length} events...`);
    await enrichWithPrices(needPrices);
  }

  // Sort newest first, deduplicate by tx+logIdx
  data.events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || b.block - a.block || b.logIdx - a.logIdx);
  const seen = new Set();
  data.events = data.events.filter(e => {
    const key = e.tx + ':' + e.logIdx;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  data.updatedAt = new Date().toISOString();
  data.vaults = VAULTS.map(v => ({ address: v.address, name: v.name, symbol: v.symbol, chain: v.chain, underlyingToken: v.underlyingToken }));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${data.events.length} total events to ${OUTPUT_FILE}`);
  console.log(`New events this run: ${newEventsTotal}`);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  // Exit cleanly — don't break the pipeline if activity collection fails
  process.exit(0);
});
