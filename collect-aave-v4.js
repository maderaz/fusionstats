#!/usr/bin/env node
'use strict';
// collect-aave-v4.js — what Fusion's vaults supply to Aave V4's tokenised-stock
// markets on Base, for /stocks/aave-v4. Writes aave-v4.json.
//
// Aave V4 is a hub with spokes: a user supplies and borrows at a spoke, which
// lists each asset as a reserve. The stock vaults (the Carry Trades) use one
// spoke on Base, set as their AAVE_V4 market's substrate: they supply their
// stock (NVDAc, AAPLc …) as collateral there and borrow USDC against it. Every
// read below is a view on that spoke, on its hub, or on its price oracle
// (aave/aave-v4: src/spoke/interfaces/ISpoke.sol, src/hub/interfaces/IHub.sol,
// src/spoke/interfaces/IPriceOracle.sol).
//
// Per stock reserve, now:
//   supplied   the whole reserve: what every supplier has in it (getReserveSuppliedAssets)
//   cap        its deposit cap, in whole tokens (the hub's addCap for this spoke; null: none)
//   price      the spoke's own oracle (getReservePrice), USD
//   fusion     what Fusion's vaults have supplied to it (getUserSuppliedAssets)
//   debt       the USDC those vaults owe at the spoke (getUserTotalDebt)
//   idle       the stock those vaults hold and have not supplied (balanceOf)
//   vaults     the same, vault by vault
// and a daily history of what Fusion supplied and the reserve's size, each
// priced that day: the page's chart. A day is read at its last block (Base
// makes one every two seconds); a run fills in at most BACKFILL_DAYS missing
// days, newest first, so the history grows back to the spoke's first day over
// a few runs.
//
//   node collect-aave-v4.js
//
// A run that cannot read the market as it is now writes nothing: the page
// keeps the last good file.

const fs = require('fs');
const path = require('path');
const { rpcEndpoints } = require('./rpc-endpoints.js');

const OUT = path.join(__dirname, 'aave-v4.json');
const IPOR = path.join(__dirname, 'ipor-vaults.json');
const PUBLIC_RPCS = ['https://base.gateway.tenderly.co', 'https://base.public.blockpi.network/v1/rpc/public', 'https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.llamarpc.com'];
// The spoke every stock vault's AAVE_V4 substrate names (IPOR Fusion vault
// substrates, market 49), and the asset they borrow.
const SPOKE = '0x17905db0e4a3514467539956c084180616ae7b8d';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
// Tokenised stocks share a vanity prefix (as on Activity and Stocks).
const STOCK = /^0xb20{20}/i;
const BASE_CHAIN_ID = 8453;
const BLOCK_SEC = 2;
const DAY = 86400;
const BACKFILL_DAYS = 45;
const BATCH = 40;

// Selectors: the first four bytes of keccak256 of each signature.
const SEL = {
  reserveCount: '0x99806546',    // getReserveCount()
  reserve: '0x77778db3',         // getReserve(uint256)
  reserveSupplied: '0x2fd00527', // getReserveSuppliedAssets(uint256)
  userSupplied: '0xf1568a89',    // getUserSuppliedAssets(uint256,address)
  userTotalDebt: '0x9b7172a6',   // getUserTotalDebt(uint256,address)
  oracle: '0x38013f02',          // ORACLE()
  reservePrice: '0xd45c35ff',    // getReservePrice(uint256)
  decimals: '0x313ce567',        // decimals()
  spokeConfig: '0xf701f06e',     // getSpokeConfig(uint256,address)
  balanceOf: '0x70a08231',       // balanceOf(address)
  symbol: '0x95d89b41',          // symbol()
};
const UNCAPPED = (1n << 40n) - 1n;   // the hub's MAX_ALLOWED_SPOKE_CAP

// ---- ABI, by hand -----------------------------------------------------------
const pad = (h) => h.padStart(64, '0');
const enc = (sel, ...args) => sel + args.map(a => (typeof a === 'string' ? pad(a.toLowerCase().replace(/^0x/, '')) : pad(BigInt(a).toString(16)))).join('');
function words(hex) {
  const h = String(hex || '0x').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= h.length; i += 64) out.push(h.slice(i, i + 64));
  return out;
}
const uint = (hex, i = 0) => { const w = words(hex)[i]; return w ? BigInt('0x' + w) : null; };
const addressAt = (hex, i = 0) => { const w = words(hex)[i]; return w ? '0x' + w.slice(24) : null; };
// An ABI string, or a bytes32 one (older tokens).
function str(hex) {
  const w = words(hex);
  if (!w.length) return null;
  if (w.length >= 3 && BigInt('0x' + w[0]) === 32n) {
    const len = Number(BigInt('0x' + w[1]));
    const bytes = w.slice(2).join('').slice(0, len * 2);
    return Buffer.from(bytes, 'hex').toString('utf8');
  }
  return Buffer.from(w[0], 'hex').toString('utf8').replace(/\0+$/, '');
}
// A raw amount as a number of whole tokens.
const units = (raw, decimals) => (raw == null ? null : Number(raw) / 10 ** decimals);

// ---- RPC ----------------------------------------------------------------------
// Keyed endpoints first (RPC_URL_BASE), then public ones; batches of eth_call,
// one request each when an endpoint will not take a batch. Errors carry no
// URL: a keyed one carries its key.
const endpoints = rpcEndpoints('base', PUBLIC_RPCS);
let active = 0, id = 0;
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function rpc(method, params) {
  const why = [];
  for (let k = 0; k < endpoints.length; k++) {
    const i = (active + k) % endpoints.length;
    try {
      const j = await post(endpoints[i], { jsonrpc: '2.0', id: ++id, method, params });
      if (j.error) throw new Error(j.error.message || 'error');
      active = i;
      return j.result;
    } catch (e) { why.push(String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 60)); }
  }
  throw new Error(`base ${method}: every endpoint failed (${why.join('; ')})`);
}
const isRevert = (err) => err && (err.code === 3 || /revert/i.test(err.message || ''));
// calls: [{ to, data }] at one block. Returns each result's hex, or null when
// that call reverted. A transport failure throws.
async function calls(list, block) {
  const tag = typeof block === 'number' ? '0x' + block.toString(16) : (block || 'latest');
  const out = new Array(list.length).fill(null);
  for (let s = 0; s < list.length; s += BATCH) {
    const part = list.slice(s, s + BATCH);
    let done = false;
    for (let k = 0; k < endpoints.length && !done; k++) {
      const i = (active + k) % endpoints.length;
      try {
        const base = id;
        const res = await post(endpoints[i], part.map((c, j) => ({ jsonrpc: '2.0', id: base + j + 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, tag] })));
        id = base + part.length;
        if (!Array.isArray(res)) throw new Error('no batch');
        const byId = new Map(res.map(r => [r.id, r]));
        part.forEach((c, j) => {
          const r = byId.get(base + j + 1);
          if (!r) throw new Error('short batch');
          if (r.error && !isRevert(r.error)) throw new Error(r.error.message || 'error');
          out[s + j] = r.error ? null : r.result;
        });
        active = i;
        done = true;
      } catch (e) { /* the next endpoint, then one at a time */ }
    }
    if (done) continue;
    for (let j = 0; j < part.length; j++) {
      try { out[s + j] = await rpc('eth_call', [{ to: part[j].to, data: part[j].data }, tag]); }
      catch (e) { if (/revert/i.test(e.message)) out[s + j] = null; else throw e; }
    }
  }
  return out;
}

// ---- The market --------------------------------------------------------------
// The spoke's reserves as listed now: underlying, hub, asset id, decimals.
async function readReserves(block) {
  const [count] = await calls([{ to: SPOKE, data: SEL.reserveCount }], block);
  const n = Number(uint(count) || 0n);
  if (!n) return [];
  const raw = await calls(Array.from({ length: n }, (_, i) => ({ to: SPOKE, data: enc(SEL.reserve, i) })), block);
  return raw.map((hex, i) => (hex ? { reserveId: i, underlying: addressAt(hex, 0), hub: addressAt(hex, 1), assetId: Number(uint(hex, 2)), decimals: Number(uint(hex, 3)) } : null)).filter(Boolean);
}

// Every stock reserve, priced, sized and capped, and what each Fusion stock
// vault has in it, owes, and holds idle, at one block.
async function readMarket(block, vaults) {
  const reserves = await readReserves(block);
  const stocks = reserves.filter(r => STOCK.test(r.underlying));
  const usdc = reserves.find(r => r.underlying.toLowerCase() === USDC);
  if (!stocks.length) return null;
  const [oracleHex] = await calls([{ to: SPOKE, data: SEL.oracle }], block);
  const oracle = addressAt(oracleHex);
  const [odec] = oracle ? await calls([{ to: oracle, data: SEL.decimals }], block) : [null];
  const priceDecimals = odec ? Number(uint(odec)) : 8;

  const q = [];
  const at = (to, data) => q.push({ to, data }) - 1;
  const per = stocks.map(r => ({
    r,
    symbol: at(r.underlying, SEL.symbol),
    supplied: at(SPOKE, enc(SEL.reserveSupplied, r.reserveId)),
    price: oracle ? at(oracle, enc(SEL.reservePrice, r.reserveId)) : -1,
    cap: at(r.hub, enc(SEL.spokeConfig, r.assetId, SPOKE)),
    vaults: vaults.map(v => ({
      v,
      supplied: at(SPOKE, enc(SEL.userSupplied, r.reserveId, v.address)),
      own: v.asset === r.underlying.toLowerCase(),
      idle: v.asset === r.underlying.toLowerCase() ? at(r.underlying, enc(SEL.balanceOf, v.address)) : -1,
    })),
  }));
  const debtAt = usdc ? vaults.map(v => at(SPOKE, enc(SEL.userTotalDebt, usdc.reserveId, v.address))) : [];
  const res = await calls(q, block);
  const val = (i) => (i >= 0 ? res[i] : null);

  const markets = per.map(p => {
    const d = p.r.decimals;
    const cap = uint(val(p.cap), 0);
    const rows = p.vaults.map((x, k) => ({
      address: x.v.address,
      name: x.v.name,
      supplied: units(uint(val(x.supplied)), d) || 0,
      debt: x.own && usdc ? units(uint(res[debtAt[k]]), usdc.decimals) || 0 : 0,
      idle: x.own ? units(uint(val(x.idle)), d) || 0 : 0,
    })).filter(x => x.supplied > 0 || x.debt > 0 || x.idle > 0);
    const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
    const priceRaw = uint(val(p.price));
    return {
      reserveId: p.r.reserveId,
      symbol: str(val(p.symbol)) || p.r.underlying.slice(0, 10),
      underlying: p.r.underlying,
      decimals: d,
      price: priceRaw == null ? null : Number(priceRaw) / 10 ** priceDecimals,
      supplied: units(uint(val(p.supplied)), d) || 0,
      cap: cap == null || cap === UNCAPPED ? null : Number(cap),
      fusion: sum('supplied'),
      debt: sum('debt'),
      idle: sum('idle'),
      vaults: rows,
    };
  });
  return { markets, debt: usdc ? { reserveId: usdc.reserveId, symbol: 'USDC', decimals: usdc.decimals } : null };
}

// A day's point for the chart: per market, Fusion's supply, the reserve's
// size, and the price that day.
const point = (m) => [round(m.fusion, 6), round(m.supplied, 6), m.price == null ? null : round(m.price, 6)];
const round = (x, k) => Math.round(x * 10 ** k) / 10 ** k;

// ---- The run ------------------------------------------------------------------
function stockVaults(ipor) {
  return ((ipor && ipor.vaults) || [])
    .filter(v => Number(v.chainId) === BASE_CHAIN_ID && STOCK.test(v.assetAddress || ''))
    .map(v => ({ address: v.address.toLowerCase(), name: v.name, asset: v.assetAddress.toLowerCase() }));
}

// The days the history still lacks, newest first, after `from` and before today.
function missingDays(history, today, from, limit) {
  const have = new Set((history || []).map(h => h.d));
  const out = [];
  for (let d = today - 1; d >= from && out.length < limit; d--) if (!have.has(d)) out.push(d);
  return out;
}

async function main({ out: OUT_FILE = OUT, ipor: IPOR_FILE = IPOR } = {}) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const vaults = stockVaults(read(IPOR_FILE));
  if (!vaults.length) { console.log('aave-v4.json: no stock vaults in ipor-vaults.json; left as it was'); return; }
  const prev = read(OUT_FILE) || {};

  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const headNum = parseInt(head.number, 16), headTs = parseInt(head.timestamp, 16);
  const now = await readMarket(headNum, vaults);
  if (!now) { console.log('::error::aave-v4: the spoke lists no stock reserve; left as it was'); process.exitCode = 1; return; }

  const today = Math.floor(headTs / DAY);
  const history = (prev.history || []).filter(h => h.d < today);
  history.push({ d: today, m: Object.fromEntries(now.markets.map(m => [m.symbol, point(m)])) });

  // History, a day at its last block, until the spoke had nothing to read.
  let from = prev.historyFrom || 0;
  const todo = missingDays(history, today, from, BACKFILL_DAYS);
  let filled = 0, failed = 0;
  for (const d of todo) {
    const block = headNum - Math.floor((headTs - ((d + 1) * DAY - 1)) / BLOCK_SEC);
    if (block <= 0) break;
    let m;
    try { m = await readMarket(block, vaults); failed = 0; } catch (e) {
      // An endpoint without old state fails every day alike: three in a row
      // and the rest wait for the next run.
      console.log(`::warning::aave-v4: day ${d}: ${String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')}`);
      if (++failed >= 3) break;
      continue;
    }
    if (!m) { from = d + 1; break; }   // before the spoke listed a stock: the history starts here
    history.push({ d, m: Object.fromEntries(m.markets.map(x => [x.symbol, point(x)])) });
    filled++;
  }
  history.sort((a, b) => a.d - b.d);

  const file = {
    updatedAt: new Date(headTs * 1000).toISOString(),
    chain: 'base',
    block: headNum,
    spoke: SPOKE,
    debt: now.debt,
    markets: now.markets,
    historyFrom: from || null,
    history,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(file) + '\n');
  const fusion = now.markets.reduce((a, m) => a + m.fusion * (m.price || 0), 0);
  console.log(`aave-v4.json: ${now.markets.length} stock reserves, Fusion supplies $${Math.round(fusion).toLocaleString('en-US')}; `
    + `${history.length} days of history (${filled} filled in this run)`);
}

if (require.main === module) main().catch(e => { console.log('::error::aave-v4: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
module.exports = { enc, words, uint, addressAt, str, units, stockVaults, missingDays, readMarket, readReserves, main, SEL, SPOKE, UNCAPPED };
