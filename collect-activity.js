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

const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://eth.drpc.org',
  'https://eth.llamarpc.com',
];

// ERC-4626 event topics
const DEPOSIT_TOPIC = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
const WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';

// Vaults to track
const VAULTS = [
  // Production vaults
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
  // Private vaults (beta)
  { address: '0xad685fec2066d7f5436f5804882998ba79725706', name: 'Magnus Lending Optimizer', symbol: 'USDC', decimals: 6 },
  { address: '0x87428d886f43068a44d7bdeef106d3c42e1d6f23', name: 'AlchemistCS', symbol: 'USDC', decimals: 6 },
  { address: '0x9824dcdac89f208bf8b5cb5c4dc41f04a0878607', name: 'Tesseract Managed ETH', symbol: 'WETH', decimals: 18 },
  { address: '0xc2a119ea6de75e4b1451330321cb2474eb8d82d4', name: 'Tesseract USDC Lending Optimizer', symbol: 'USDC', decimals: 6 },
  { address: '0x60e36a79c3d21120350e39b5ea59ae26b75ae74c', name: 'TAU InfiniFi cbBTC Carry', symbol: 'cbBTC', decimals: 8 },
  { address: '0x0b45a1e71a8a09f5d382fed27202d50ed983aaf3', name: 'Hyperithm mHYPER Looping', symbol: 'mHYPER', decimals: 18 },
  { address: '0xdab31950ddcc814c49e6bbd5153dd2062e44f368', name: 'Tesseract Managed BTC', symbol: 'WBTC', decimals: 8 },
];

let activeRpc = 0;
let callId = 0;

async function rpcCall(method, params) {
  const order = [activeRpc, ...RPCS.map((_, i) => i).filter(i => i !== activeRpc)];
  for (const idx of order) {
    try {
      const res = await fetch(RPCS[idx], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      activeRpc = idx;
      return json.result;
    } catch (e) {
      console.log(`  RPC ${idx} (${method}) failed: ${e.message}`);
    }
  }
  throw new Error(`All RPCs failed for ${method}`);
}

async function getBlockNumber() {
  const hex = await rpcCall('eth_blockNumber', []);
  return parseInt(hex, 16);
}

async function getBlockTimestamp(blockNum) {
  const block = await rpcCall('eth_getBlockByNumber', ['0x' + blockNum.toString(16), false]);
  return block ? parseInt(block.timestamp, 16) : 0;
}

async function scanLogs(address, topic, fromBlock, toBlock) {
  const allLogs = [];

  async function scan(from, to) {
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address,
        topics: [topic],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      allLogs.push(...logs);
    } catch (e) {
      if (to - from <= 2000) return;
      const mid = from + Math.floor((to - from) / 2);
      await scan(from, mid);
      await scan(mid + 1, to);
    }
  }

  const CHUNK = 100000;
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    await scan(start, end);
  }
  return allLogs;
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
    sender, receiver, owner, assets, shares,
    tx: log.transactionHash,
    block: parseInt(log.blockNumber, 16),
    logIdx: parseInt(log.logIndex, 16),
  };
}

async function main() {
  console.log('=== Vault Activity Collector ===\n');

  // Load existing data
  let data = { updatedAt: null, lastBlock: {}, events: [] };
  try {
    data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {}

  const currentBlock = await getBlockNumber();
  console.log(`Current block: ${currentBlock}`);

  let newEventsTotal = 0;

  for (const vault of VAULTS) {
    const lastBlock = data.lastBlock[vault.address] || (currentBlock - 220000); // default: 30 days back
    const fromBlock = lastBlock + 1;

    if (fromBlock > currentBlock) {
      console.log(`${vault.name}: already up to date`);
      continue;
    }

    console.log(`\n${vault.name}: scanning blocks ${fromBlock} to ${currentBlock}...`);

    // Scan deposits
    const depositLogs = await scanLogs(vault.address, DEPOSIT_TOPIC, fromBlock, currentBlock);
    const deposits = depositLogs.map(l => parseDepositLog(l, vault));
    console.log(`  ${deposits.length} deposits found`);

    // Scan withdrawals
    const withdrawLogs = await scanLogs(vault.address, WITHDRAW_TOPIC, fromBlock, currentBlock);
    const withdrawals = withdrawLogs.map(l => parseWithdrawLog(l, vault));
    console.log(`  ${withdrawals.length} withdrawals found`);

    const newEvents = [...deposits, ...withdrawals];
    newEventsTotal += newEvents.length;

    // Fetch timestamps for new events
    const uniqueBlocks = [...new Set(newEvents.map(e => e.block))];
    console.log(`  Fetching timestamps for ${uniqueBlocks.length} blocks...`);
    for (let i = 0; i < uniqueBlocks.length; i += 5) {
      const batch = uniqueBlocks.slice(i, i + 5);
      const results = await Promise.all(batch.map(b => getBlockTimestamp(b).catch(() => 0)));
      results.forEach((ts, j) => {
        const block = batch[j];
        newEvents.filter(e => e.block === block).forEach(e => e.timestamp = ts);
      });
    }

    // Round asset amounts
    newEvents.forEach(e => {
      e.assets = Math.round(e.assets * 1e6) / 1e6;
      e.shares = Math.round(e.shares * 1e6) / 1e6;
    });

    data.events.push(...newEvents);
    data.lastBlock[vault.address] = currentBlock;
  }

  // Sort newest first, deduplicate by tx+logIdx
  data.events.sort((a, b) => b.block - a.block || b.logIdx - a.logIdx);
  const seen = new Set();
  data.events = data.events.filter(e => {
    const key = e.tx + ':' + e.logIdx;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  data.updatedAt = new Date().toISOString();
  data.vaults = VAULTS.map(v => ({ address: v.address, name: v.name, symbol: v.symbol }));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${data.events.length} total events to ${OUTPUT_FILE}`);
  console.log(`New events this run: ${newEventsTotal}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
