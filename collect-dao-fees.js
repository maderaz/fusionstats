#!/usr/bin/env node
'use strict';
// collect-dao-fees.js — what share of each vault's fees goes to the IPOR DAO,
// read on-chain, for Activity's Annualized earnings. Writes dao-fees.json.
//
// A Fusion vault charges a performance fee and a management fee
// (getPerformanceFeeData / getManagementFeeData: the account collecting each
// and its rate). The account is a FeeAccount whose FEE_MANAGER splits the fee
// between the vault's own recipients and the DAO, at the DAO's fixed rates
// (IPOR_DAO_PERFORMANCE_FEE / IPOR_DAO_MANAGEMENT_FEE). All rates in basis
// points (10000 = 100%); written as percents. (IPOR-Labs/ipor-fusion:
// contracts/vaults/PlasmaVaultGovernance.sol, managers/fee/FeeManager.sol.)
//
// Every vault above $10K in ipor-vaults.json, on the chains with endpoints
// here. A vault whose fee account is not a FeeManager's (older vaults) is
// written with null DAO rates: the page leaves it out and says how many.
//
//   node collect-dao-fees.js

const fs = require('fs');
const path = require('path');
const { rpcEndpoints } = require('./rpc-endpoints.js');

const OUT = path.join(__dirname, 'dao-fees.json');
const IPOR = path.join(__dirname, 'ipor-vaults.json');
const FLOOR = 10000;
const CHAINS = {
  1: ['ethereum', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.mevblocker.io']],
  8453: ['base', ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.llamarpc.com']],
  42161: ['arbitrum', ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc']],
};
const SEL = {
  perfData: '0x90acbe9c',     // getPerformanceFeeData()
  mgmtData: '0x31ee80ca',     // getManagementFeeData()
  feeManager: '0xea26266c',   // FEE_MANAGER()
  daoPerf: '0xcbc16b98',      // IPOR_DAO_PERFORMANCE_FEE()
  daoMgmt: '0xade9fb15',      // IPOR_DAO_MANAGEMENT_FEE()
};

const words = (hex) => { const h = String(hex || '0x').replace(/^0x/, ''); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
const uintAt = (hex, i = 0) => { const w = words(hex)[i]; return w ? Number(BigInt('0x' + w)) : null; };
const addrAt = (hex, i = 0) => { const w = words(hex)[i]; return w ? '0x' + w.slice(24) : null; };
const pct = (bps) => (bps == null ? null : bps / 100);

// One eth_call, endpoint by endpoint; null when the call reverts or the
// target has no code. Errors carry no URL: a keyed one carries its key.
async function call(chainId, to, data) {
  const [name, list] = CHAINS[chainId];
  const urls = rpcEndpoints(name, list);
  const why = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) { if (j.error.code === 3 || /revert/i.test(j.error.message || '')) return null; throw new Error(j.error.message); }
      return j.result && j.result !== '0x' ? j.result : null;
    } catch (e) { why.push(String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 50)); }
  }
  throw new Error(`${name}: every endpoint failed (${why.join('; ')})`);
}

async function readVault(v) {
  const id = Number(v.chainId), a = v.address.toLowerCase();
  const [perf, mgmt] = await Promise.all([call(id, a, SEL.perfData), call(id, a, SEL.mgmtData)]);
  const out = { chainId: id, name: v.name, perf: pct(uintAt(perf, 1)), mgmt: pct(uintAt(mgmt, 1)), daoPerf: null, daoMgmt: null, feeManager: null };
  const account = addrAt(perf, 0);
  const manager = account && /[1-9a-f]/.test(account.slice(2)) ? addrAt(await call(id, account, SEL.feeManager)) : null;
  if (manager) {
    const [dp, dm] = await Promise.all([call(id, manager, SEL.daoPerf), call(id, manager, SEL.daoMgmt)]);
    Object.assign(out, { feeManager: manager, daoPerf: pct(uintAt(dp)), daoMgmt: pct(uintAt(dm)) });
  }
  return [a, out];
}

async function main({ out: OUT_FILE = OUT, ipor: IPOR_FILE = IPOR } = {}) {
  let ipor;
  try { ipor = JSON.parse(fs.readFileSync(IPOR_FILE, 'utf8')); } catch { console.log('dao-fees.json: ipor-vaults.json unreadable; left as it was'); return; }
  const vaults = (ipor.vaults || []).filter(v => v.tvl > FLOOR && CHAINS[Number(v.chainId)]);
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).vaults || {}; } catch { return {}; } })();
  const result = {};
  let failed = 0;
  // A few at a time: public endpoints throttle bursts.
  for (let i = 0; i < vaults.length; i += 6) {
    const got = await Promise.allSettled(vaults.slice(i, i + 6).map(readVault));
    got.forEach((g, k) => {
      const v = vaults[i + k], a = v.address.toLowerCase();
      if (g.status === 'fulfilled') result[a] = g.value[1];
      else { failed++; if (prev[a]) result[a] = prev[a]; console.log(`::warning::dao-fees: ${v.name}: ${g.reason.message}`); }
    });
  }
  if (!Object.keys(result).length) { console.log('::error::dao-fees: no vault read; left as it was'); process.exitCode = 1; return; }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ readAt: new Date().toISOString(), floor: FLOOR, vaults: result }, null, 1) + '\n');
  const withDao = Object.values(result).filter(v => v.daoPerf != null).length;
  console.log(`dao-fees.json: ${Object.keys(result).length} vaults, ${withDao} with the DAO's rates on-chain, ${failed} unread (kept from the last run)`);
}

if (require.main === module) main().catch(e => { console.log('::error::dao-fees: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
module.exports = { main, readVault, SEL, words, uintAt, addrAt };
