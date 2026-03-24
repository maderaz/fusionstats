#!/usr/bin/env node
//
// Spark spWSTETH Holder Scanner
// Scans Transfer events from deployment to discover all holder addresses,
// checks current balances, and writes top holders to spark-holders.json.
//
// Usage:
//   node collect-spark-holders.js
//
// Run via GitHub Actions cron (every 6 hours) to keep data fresh.
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'spark-holders.json');

const SP_WSTETH = '0x12B54025C112Aa61fAce2CDB7118740875A566E9';
const DEPLOY_BLOCK = 17210000; // SparkLend launch, May 2023
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://eth.drpc.org',
  'https://eth.llamarpc.com',
];

const KNOWN_LABELS = {
  '0xb8a451107a9f87fde481d4d686247d6e43ed715e': 'IPOR stETH Ethereum',
};

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

async function getLogs(filter) {
  return await rpcCall('eth_getLogs', [filter]);
}

async function balanceOf(token, user) {
  const data = '0x70a08231' + user.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const result = await rpcCall('eth_call', [{ to: token, data }, 'latest']);
  if (!result || result === '0x') return 0;
  return Number(BigInt(result)) / 1e18;
}

// Scan Transfer events with adaptive chunking (splits on failure)
async function discoverAddresses() {
  const currentBlock = await getBlockNumber();
  const totalBlocks = currentBlock - DEPLOY_BLOCK;
  const addresses = new Set();

  async function scanRange(from, to) {
    try {
      const logs = await getLogs({
        address: SP_WSTETH,
        topics: [TRANSFER_TOPIC],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      });
      for (const entry of logs) {
        if (entry.topics?.[1]) {
          const addr = '0x' + entry.topics[1].slice(26).toLowerCase();
          if (addr !== ZERO_ADDR) addresses.add(addr);
        }
        if (entry.topics?.[2]) {
          const addr = '0x' + entry.topics[2].slice(26).toLowerCase();
          if (addr !== ZERO_ADDR) addresses.add(addr);
        }
      }
      const pct = Math.round(((to - DEPLOY_BLOCK) / totalBlocks) * 100);
      console.log(`  Blocks ${from}-${to}: ${logs.length} transfers (${pct}%, ${addresses.size} addrs)`);
    } catch (e) {
      if (to - from <= 2000) {
        console.log(`  Skipping blocks ${from}-${to}: ${e.message}`);
        return;
      }
      const mid = from + Math.floor((to - from) / 2);
      await scanRange(from, mid);
      await scanRange(mid + 1, to);
    }
  }

  console.log(`Scanning blocks ${DEPLOY_BLOCK} to ${currentBlock} (${totalBlocks} blocks)...`);
  const CHUNK = 500000;
  for (let start = DEPLOY_BLOCK; start < currentBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, currentBlock);
    await scanRange(start, end);
  }

  console.log(`Discovered ${addresses.size} unique addresses`);
  return Array.from(addresses);
}

async function main() {
  console.log('=== Spark spWSTETH Holder Scanner ===\n');

  // Step 1: discover all addresses from Transfer events
  const addresses = await discoverAddresses();

  // Step 2: check current balances (batch of 5)
  console.log(`\nChecking balances for ${addresses.length} addresses...`);
  const holders = [];
  for (let i = 0; i < addresses.length; i += 5) {
    const batch = addresses.slice(i, i + 5);
    const balances = await Promise.all(
      batch.map(a => balanceOf(SP_WSTETH, a).catch(() => 0))
    );
    for (let j = 0; j < batch.length; j++) {
      if (balances[j] > 0.01) {
        holders.push({
          address: batch[j],
          label: KNOWN_LABELS[batch[j]] || null,
          balance: balances[j],
        });
      }
    }
    if (i % 50 === 0 && i > 0) {
      console.log(`  Checked ${i}/${addresses.length}, found ${holders.length} holders`);
    }
  }

  // Sort by balance descending
  holders.sort((a, b) => b.balance - a.balance);

  // Step 3: compute total supply for share %
  const totalSupply = await balanceOf(SP_WSTETH, SP_WSTETH).catch(() => 0) ||
    holders.reduce((sum, h) => sum + h.balance, 0);

  // Build output — top 50 holders
  const top = holders.slice(0, 50).map((h, i) => ({
    rank: i + 1,
    address: h.address,
    label: h.label,
    balance: Math.round(h.balance * 100) / 100,
  }));

  const output = {
    token: SP_WSTETH,
    updatedAt: new Date().toISOString(),
    totalHolders: holders.length,
    holders: top,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nWrote ${top.length} holders to ${OUTPUT_FILE}`);
  console.log(`Total holders with balance > 0.01: ${holders.length}`);
  console.log('Top 10:');
  top.slice(0, 10).forEach(h =>
    console.log(`  #${h.rank} ${h.label || h.address} — ${h.balance.toLocaleString()} spWSTETH`)
  );
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
