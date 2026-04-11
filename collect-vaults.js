#!/usr/bin/env node
//
// Vault Discovery Collector
// Scans FusionInstanceCreated events from the FusionFactory contract
// to dynamically discover all deployed Fusion vaults.
//
// Usage:  node collect-vaults.js
//

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'vaults.json');

const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
];

const FACTORY_ADDRESS = '0xcd05909C4A1F8E501e4ED554cEF4Ed5E48D9b852';
// keccak256("FusionInstanceCreated(uint256,uint256,string,string,uint8,address,string,uint8,address,address,address,address)")
const FUSION_INSTANCE_CREATED_TOPIC = '0x9c0af8f185eba94f5cd30afcaee7c849a3ce40571f1f27677b1de7383aa9e78f';
// First known Fusion vault activity is around block 24,500,000 — factory deployed before that
const FACTORY_DEPLOY_BLOCK = 21000000;

let activeRpc = 0;
let callId = 0;

// Global timeout — abort after 90 seconds to avoid blocking the pipeline
const GLOBAL_TIMEOUT_MS = 90_000;
const startTime = Date.now();

async function rpcCall(method, params) {
  if (Date.now() - startTime > GLOBAL_TIMEOUT_MS) {
    throw new Error('Global timeout exceeded');
  }
  const order = [activeRpc, ...RPCS.map((_, i) => i).filter(i => i !== activeRpc)];
  for (const idx of order) {
    try {
      const res = await fetch(RPCS[idx], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method, params }),
        signal: AbortSignal.timeout(15_000),
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

// ABI decode helpers
function decodeUint256(hex, offset) {
  return BigInt('0x' + hex.slice(offset * 2, offset * 2 + 64));
}

function decodeAddress(hex, offset) {
  return '0x' + hex.slice(offset * 2 + 24, offset * 2 + 64).toLowerCase();
}

function decodeUint8(hex, offset) {
  return Number(BigInt('0x' + hex.slice(offset * 2, offset * 2 + 64)));
}

function decodeString(hex, dataOffset) {
  // dataOffset points to the start of the ABI-encoded string data
  const lengthHex = hex.slice(dataOffset * 2, dataOffset * 2 + 64);
  const length = Number(BigInt('0x' + lengthHex));
  if (length === 0) return '';
  const strHex = hex.slice(dataOffset * 2 + 64, dataOffset * 2 + 64 + length * 2);
  return Buffer.from(strHex, 'hex').toString('utf8');
}

function parseFusionInstanceCreated(log) {
  // All params are non-indexed, so everything is in log.data
  // Remove 0x prefix
  const data = log.data.slice(2);

  // ABI layout (each slot = 32 bytes = 64 hex chars):
  // Slot 0: uint256 index
  // Slot 1: uint256 version
  // Slot 2: offset to string assetName
  // Slot 3: offset to string assetSymbol
  // Slot 4: uint8 assetDecimals
  // Slot 5: address underlyingToken
  // Slot 6: offset to string underlyingTokenSymbol
  // Slot 7: uint8 underlyingTokenDecimals
  // Slot 8: address initialOwner
  // Slot 9: address plasmaVault
  // Slot 10: address plasmaVaultBase
  // Slot 11: address feeManager
  // Then dynamic data (strings) at their respective offsets

  const index = Number(decodeUint256(data, 0));
  const version = Number(decodeUint256(data, 32));

  const assetNameOffset = Number(decodeUint256(data, 64));
  const assetSymbolOffset = Number(decodeUint256(data, 96));
  const assetDecimals = decodeUint8(data, 128);
  const underlyingToken = decodeAddress(data, 160);

  const underlyingTokenSymbolOffset = Number(decodeUint256(data, 192));
  const underlyingTokenDecimals = decodeUint8(data, 224);
  const initialOwner = decodeAddress(data, 256);
  const plasmaVault = decodeAddress(data, 288);
  const plasmaVaultBase = decodeAddress(data, 320);
  const feeManager = decodeAddress(data, 352);

  const assetName = decodeString(data, assetNameOffset);
  const assetSymbol = decodeString(data, assetSymbolOffset);
  const underlyingTokenSymbol = decodeString(data, underlyingTokenSymbolOffset);

  return {
    index,
    version,
    address: plasmaVault,
    name: assetName,
    assetSymbol,
    assetDecimals,
    symbol: underlyingTokenSymbol,
    decimals: underlyingTokenDecimals,
    underlyingToken,
    owner: initialOwner,
    feeManager,
    block: parseInt(log.blockNumber, 16),
    tx: log.transactionHash,
  };
}

async function scanLogs(fromBlock, toBlock) {
  const allLogs = [];

  async function scan(from, to) {
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address: FACTORY_ADDRESS,
        topics: [FUSION_INSTANCE_CREATED_TOPIC],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      allLogs.push(...logs);
    } catch (e) {
      if (to - from <= 5000) return;
      const mid = from + Math.floor((to - from) / 2);
      await scan(from, mid);
      await scan(mid + 1, to);
    }
  }

  const CHUNK = 50000;
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    await scan(start, end);
  }
  return allLogs;
}

async function main() {
  console.log('=== Vault Discovery Collector ===\n');
  console.log(`Factory: ${FACTORY_ADDRESS}`);

  // Load existing data
  let data = { updatedAt: null, lastBlock: 0, factoryAddress: FACTORY_ADDRESS, vaults: [] };
  try {
    data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {}

  const currentBlock = parseInt(await rpcCall('eth_blockNumber', []), 16);
  const fromBlock = (data.lastBlock || FACTORY_DEPLOY_BLOCK) + 1;

  console.log(`Current block: ${currentBlock}`);
  console.log(`Scanning from block ${fromBlock}...`);

  if (fromBlock > currentBlock) {
    console.log('Already up to date');
    return;
  }

  const logs = await scanLogs(fromBlock, currentBlock);
  console.log(`Found ${logs.length} FusionInstanceCreated events`);

  const newVaults = logs.map(log => {
    try {
      return parseFusionInstanceCreated(log);
    } catch (e) {
      console.log(`  Failed to parse log: ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  // Fetch block timestamps for new vaults (small batch, only on first discovery)
  if (newVaults.length > 0) {
    console.log(`Fetching block timestamps for ${newVaults.length} new vaults...`);
    const uniqueBlocks = [...new Set(newVaults.map(v => v.block))];
    const blockTsMap = {};
    for (let i = 0; i < uniqueBlocks.length; i += 5) {
      const batch = uniqueBlocks.slice(i, i + 5);
      const results = await Promise.all(batch.map(async b => {
        try {
          const blk = await rpcCall('eth_getBlockByNumber', ['0x' + b.toString(16), false]);
          return blk ? parseInt(blk.timestamp, 16) : 0;
        } catch {
          return 0;
        }
      }));
      batch.forEach((b, j) => { blockTsMap[b] = results[j]; });
    }
    newVaults.forEach(v => {
      const ts = blockTsMap[v.block];
      if (ts) v.deployedAt = new Date(ts * 1000).toISOString();
    });
  }

  // Merge with existing vaults (deduplicate by address)
  const existing = new Map(data.vaults.map(v => [v.address, v]));
  for (const v of newVaults) {
    existing.set(v.address, v);
  }

  data.vaults = [...existing.values()].sort((a, b) => a.index - b.index);
  data.lastBlock = currentBlock;
  data.updatedAt = new Date().toISOString();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${data.vaults.length} vaults to ${OUTPUT_FILE}`);
  if (newVaults.length > 0) {
    console.log('New vaults discovered:');
    newVaults.forEach(v => console.log(`  #${v.index}: ${v.name} (${v.symbol}) → ${v.address}`));
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  // Don't exit(1) — allow workflow to continue even if vault discovery fails
  // Other collectors will use existing vaults.json or operate with empty vault list
  process.exit(0);
});
