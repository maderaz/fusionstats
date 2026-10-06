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
// The DAO rates are fixed per vault when it is made (the factory's fee
// package, or a business client's own), so the FeeManager's immutables are
// the resolved figure, however they were chosen.
//
// Older vaults predate the FeeManager: their fee account is a plain wallet
// that keeps the whole fee. When that wallet is the DAO's own fee recipient
// (as the FeeManagers on that chain name it, getIporDaoFeeRecipientAddress),
// or a Safe with the very same signers and threshold, the whole fee is the
// DAO's (daoVia 'treasury'). Any other wallet is someone else's: null DAO
// rates, and the page leaves the vault out and says how many.
//
// Every vault above $10K in ipor-vaults.json, on the chains with endpoints
// here.
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
  daoRecipient: '0x12f6c6d6', // getIporDaoFeeRecipientAddress()
  threshold: '0xe75235b8',    // getThreshold()  (Safe)
  owners: '0xa0e67e2b',       // getOwners()     (Safe)
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
  const out = { chainId: id, name: v.name, perf: pct(uintAt(perf, 1)), mgmt: pct(uintAt(mgmt, 1)), daoPerf: null, daoMgmt: null, feeManager: null,
    perfAccount: addrAt(perf, 0), mgmtAccount: addrAt(mgmt, 0) };
  const account = out.perfAccount;
  const manager = account && /[1-9a-f]/.test(account.slice(2)) ? addrAt(await call(id, account, SEL.feeManager)) : null;
  if (manager) {
    const [dp, dm, rcpt] = await Promise.all([call(id, manager, SEL.daoPerf), call(id, manager, SEL.daoMgmt), call(id, manager, SEL.daoRecipient)]);
    Object.assign(out, { feeManager: manager, daoPerf: pct(uintAt(dp)), daoMgmt: pct(uintAt(dm)), daoRecipient: addrAt(rcpt) });
  }
  return [a, out];
}

// A Safe's signers and threshold, as one comparable string; null for anything
// that is not a Safe.
async function safeKey(chainId, account) {
  const [t, o] = await Promise.all([call(chainId, account, SEL.threshold), call(chainId, account, SEL.owners)]);
  const n = uintAt(t), w = words(o);
  if (!n || w.length < 3) return null;
  const owners = w.slice(2, 2 + Number(BigInt('0x' + w[1]))).map(x => '0x' + x.slice(24)).sort();
  return n + '/' + owners.join(',');
}

// Older vaults (no FeeManager): a fee whose account is the DAO's recipient,
// or a Safe signed by exactly the DAO recipient's signers, is the DAO's whole.
async function resolveTreasury(result) {
  const daoBy = {};   // chainId → Set of DAO recipient addresses
  for (const v of Object.values(result)) if (v.daoRecipient) (daoBy[v.chainId] = daoBy[v.chainId] || new Set()).add(v.daoRecipient);
  const keys = {};
  const keyOf = async (id, a) => { const k = id + ':' + a; if (!(k in keys)) keys[k] = await safeKey(id, a).catch(() => null); return keys[k]; };
  for (const v of Object.values(result)) {
    if (v.feeManager || !daoBy[v.chainId]) continue;
    const dao = [...daoBy[v.chainId]];
    const daoKeys = (await Promise.all(dao.map(a => keyOf(v.chainId, a)))).filter(Boolean);
    const isDao = async (a) => !!a && (dao.includes(a) || daoKeys.includes(await keyOf(v.chainId, a)));
    const [p, m] = await Promise.all([isDao(v.perfAccount), isDao(v.mgmtAccount)]);
    if (p || m) Object.assign(v, { daoPerf: p ? v.perf : 0, daoMgmt: m ? v.mgmt : 0, daoVia: 'treasury' });
  }
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
  await resolveTreasury(result);
  for (const v of Object.values(result)) { delete v.perfAccount; delete v.mgmtAccount; }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ readAt: new Date().toISOString(), floor: FLOOR, vaults: result }, null, 1) + '\n');
  const withDao = Object.values(result).filter(v => v.daoPerf != null).length;
  const treasury = Object.values(result).filter(v => v.daoVia === 'treasury').length;
  console.log(`dao-fees.json: ${Object.keys(result).length} vaults, ${withDao} with the DAO's rates on-chain (${treasury} paying the DAO's treasury directly), ${failed} unread (kept from the last run)`);
}

if (require.main === module) main().catch(e => { console.log('::error::dao-fees: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
module.exports = { main, readVault, SEL, words, uintAt, addrAt };
