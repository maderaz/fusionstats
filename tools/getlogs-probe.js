#!/usr/bin/env node
'use strict';
// getlogs-probe.js — find out why eth_getLogs cannot complete on a chain.
//
// The collector batches every tracked vault on a chain into one eth_getLogs
// per block chunk. On Base that scans 50,000 blocks in 150s. On Ethereum, with
// 67 addresses instead of 29, it completes zero chunks in the same budget.
//
// Guessing which knob matters would be guessing. This times the real call
// against the real endpoints across a grid of address-batch and block-chunk
// sizes, and reports latency, errors and result counts per endpoint, so the
// collector's parameters can be chosen from measurements.
//
// Read-only: eth_blockNumber and eth_getLogs, nothing else.

const fs = require('fs');
const path = require('path');

const CHAIN = process.argv[2] || 'ethereum';
const RPCS = {
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org',
             'https://eth.llamarpc.com', 'https://cloudflare-eth.com'],
  base: ['https://base-rpc.publicnode.com', 'https://base.drpc.org',
         'https://mainnet.base.org', 'https://base.llamarpc.com'],
};
const DEPOSIT_TOPIC  = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
const WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';
const MIN_TVL_USD = Number(process.env.MIN_TVL_USD || 50);

function vaults() {
  const iv = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ipor-vaults.json'), 'utf8'));
  return (iv.vaults || [])
    .filter(v => v.chain === CHAIN && (v.tvl || 0) >= MIN_TVL_USD)
    .map(v => (v.address || '').toLowerCase());
}

async function rpc(url, method, params, timeoutMs = 30000) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, err: 'HTTP ' + res.status };
    const j = await res.json();
    if (j.error) return { ms, err: (j.error.message || JSON.stringify(j.error)).slice(0, 90) };
    return { ms, result: j.result };
  } catch (e) {
    return { ms: Date.now() - t0, err: (e.name === 'AbortError' ? 'timeout' : String(e.message)).slice(0, 90) };
  } finally { clearTimeout(timer); }
}

(async function main() {
  const all = vaults();
  console.log(`chain=${CHAIN}  tracked vaults=${all.length}\n`);

  // A head block every endpoint agrees on, so every cell scans the same range.
  let head = 0;
  for (const url of RPCS[CHAIN]) {
    const r = await rpc(url, 'eth_blockNumber', []);
    console.log(`  head via ${url.padEnd(42)} ${r.err ? 'ERR ' + r.err : parseInt(r.result, 16)}  ${r.ms}ms`);
    if (!r.err) head = Math.max(head, parseInt(r.result, 16));
  }
  if (!head) { console.log('no endpoint answered eth_blockNumber'); process.exit(1); }

  const ADDR_BATCHES = [all.length, 32, 16, 8, 1].filter((n, i, a) => n > 0 && a.indexOf(n) === i);
  const CHUNKS = [10000, 5000, 2000, 500];

  console.log('\nOne eth_getLogs per cell, both topics, ending at head. ms / logs / error.');
  for (const url of RPCS[CHAIN]) {
    console.log(`\n=== ${url} ===`);
    console.log('  addrs x blocks        result');
    for (const nAddr of ADDR_BATCHES) {
      for (const span of CHUNKS) {
        const addrs = all.slice(0, nAddr);
        const from = head - span + 1;
        const r = await rpc(url, 'eth_getLogs', [{
          address: addrs, topics: [[DEPOSIT_TOPIC, WITHDRAW_TOPIC]],
          fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16),
        }]);
        const cell = String(nAddr).padStart(3) + ' x ' + String(span).padStart(5);
        console.log('  ' + cell + '   ' + String(r.ms).padStart(6) + 'ms  '
          + (r.err ? 'ERR ' + r.err : (r.result.length + ' logs')));
        await new Promise(s => setTimeout(s, 250));   // be polite to free endpoints
      }
    }
  }
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
