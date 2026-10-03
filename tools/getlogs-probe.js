#!/usr/bin/env node
'use strict';
// getlogs-probe.js — replay the exact eth_getLogs request production is failing on.
//
// Production (collect-activity.js) has made no Ethereum progress since mid-
// September: every run spends its 150s and reaches nothing, finding 0 logs.
// That is either the endpoints refusing the request, or the scan structure
// starving — this tells them apart by sending production's own requests:
// the live tracked-vault list, production's grouping, from the frozen cursor.
// Read-only: eth_blockNumber and eth_getLogs.

const RAW = 'https://raw.githubusercontent.com/maderaz/fusionstats/claude/morpho-vault-demand-tracker-Zp6AV/';
const RPCS = {
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com',
             'https://eth.drpc.org', 'https://eth.llamarpc.com',
             // candidates not in production yet
             'https://rpc.ankr.com/eth', 'https://1rpc.io/eth', 'https://eth.merkle.io',
             'https://ethereum.blockpi.network/v1/rpc/public'],
  plasma: ['https://evm-rpc.plasma.io/api', 'https://rpc.plasma.to', 'https://plasma.drpc.org',
           'https://plasma-rpc.publicnode.com'],
};
const TOPICS = [['0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7',
                 '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db']];

async function rpc(url, method, params, timeoutMs = 15000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, err: 'HTTP ' + res.status };
    const j = await res.json();
    if (j.error) return { ms, err: String(j.error.message || JSON.stringify(j.error)).slice(0, 100) };
    return { ms, result: j.result };
  } catch (e) { return { ms: Date.now() - t0, err: (e.name === 'TimeoutError' ? 'timeout' : String(e.message)).slice(0, 100) }; }
}

(async () => {
  const iv = await (await fetch(RAW + 'ipor-vaults.json')).json();
  const ae = await (await fetch(RAW + 'activity-events.json')).json();
  const tracked = new Set((ae.vaults || []).map(v => v.address.toLowerCase()));
  const eth = (iv.vaults || []).filter(v => v.chain === 'ethereum' && tracked.has(v.address.toLowerCase())).map(v => v.address.toLowerCase());
  const cursors = eth.map(a => ae.lastBlock[a]).filter(Boolean);
  const from = Math.min(...cursors) + 1;
  console.log(`ethereum: ${eth.length} tracked vaults; production scans from block ${from}`);
  const groups = []; for (let i = 0; i < eth.length; i += 25) groups.push(eth.slice(i, i + 25));

  for (const url of RPCS.ethereum) {
    const head = await rpc(url, 'eth_blockNumber', []);
    console.log(`\n=== ${url}  head ${head.err ? 'ERR ' + head.err : parseInt(head.result, 16)} (${head.ms}ms)`);
    if (head.err) continue;
    for (const [label, addrs, span] of [['group1 x4000', groups[0], 4000], ['group2 x4000', groups[1], 4000],
                                        ['group3 x4000', groups[2] || groups[0], 4000],
                                        ['group1 x1000', groups[0], 1000], ['1 addr x4000', groups[0].slice(0, 1), 4000]]) {
      const r = await rpc(url, 'eth_getLogs', [{ address: addrs, topics: TOPICS,
        fromBlock: '0x' + from.toString(16), toBlock: '0x' + (from + span - 1).toString(16) }]);
      console.log(`   ${label.padEnd(14)} ${String(r.ms).padStart(6)}ms  ${r.err ? 'ERR ' + r.err : r.result.length + ' logs'}`);
      await new Promise(s => setTimeout(s, 300));
    }
  }
  console.log('\n=== plasma: which endpoints answer at all ===');
  for (const url of RPCS.plasma) {
    const r = await rpc(url, 'eth_blockNumber', []);
    console.log(`   ${url.padEnd(42)} ${r.err ? 'ERR ' + r.err : 'block ' + parseInt(r.result, 16)} (${r.ms}ms)`);
  }
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
