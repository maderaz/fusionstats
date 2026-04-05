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
  { address: '0xb8a451107a9f87fde481d4d686247d6e43ed715e', name: 'IPOR stETH Ethereum', symbol: 'wstETH', decimals: 18 },
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
