#!/usr/bin/env node
'use strict';
// collect-vault-markets.js — where each vault's assets sit, market by market,
// for the Explorer. Writes vault-markets.json (the latest reading) and adds a
// reading a day to vault-markets-history.json.
//
// A Fusion vault keeps its assets in markets (Aave V3, Morpho, Euler V2, an
// ERC-4626 vault, the tokens it holds, ...), each valued by its balance fuse
// and kept on the vault in its asset's units (totalAssetsInMarket). The
// markets a vault uses are its fuses' (getFuses, each fuse's MARKET_ID) and
// the tokens it holds (ERC20_VAULT_BALANCE, 7). (IPOR-Labs/ipor-fusion:
// contracts/vaults/PlasmaVault.sol, PlasmaVaultGovernance.sol,
// libraries/IporFusionMarkets.sol.)
//
// The lending markets are read further, position by position, as their
// balance fuses read them, so the page can show what is supplied and what is
// borrowed (the vault counts the difference), each at its rate:
//   Aave V3   each substrate asset's aToken and debt token balances (the
//             pool's data provider), at the reserve's supply and variable
//             borrow rates
//   Morpho    each substrate market's supply, collateral and borrow
//             (position, market), at the borrow rate its IRM quotes and the
//             supply rate that implies
//   Euler V2  each substrate vault's shares, in assets, and debt for the
//             vault's sub-account, at the vault's interest rate and the
//             supply rate that implies
// in dollars at the vault's own price oracle (getPriceOracleMiddleware,
// getAssetPrice). A loop's collateral earns no rate from its market but its
// own (a staked token's): its price against the token borrowed, now and about
// a month back (at a TVL snapshot's block), a year's worth, between tokens of
// one family only. The supply cap (getTotalSupplyCap, in shares) is the
// vault's capacity, in its asset at the vault's own rate.
//
// The history is each market's dollars a day: today's reading, and each run
// reaches back over the days the TVL snapshots have (at their blocks, with
// their prices), newest first, within a budget of calls: every day of the
// last 120, one a week before that.
//
//   node collect-vault-markets.js [--vault 0x...]

const fs = require('fs');
const path = require('path');
const { rpcEndpoints } = require('./rpc-endpoints.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'vault-markets.json');
const HISTORY = path.join(ROOT, 'vault-markets-history.json');
const IPOR = path.join(ROOT, 'ipor-vaults.json');
const SNAPSHOTS = path.join(ROOT, 'tvl-snapshots.json');
const CHANGES = path.join(ROOT, 'vault-changes.json');
const FLOOR = 10000;
const DAY = 86400;
const YEAR = 365 * DAY;
const DAILY_DAYS = 120;        // history: every day this far back, weekly before
const BACKFILL_CALLS = 1500;   // per chain per run
const DEADLINE_MS = 15 * 60_000;

// As collect-activity.js: measured from GitHub Actions, keyed endpoints first.
const CHAINS = {
  ethereum: [1, ['https://gateway.tenderly.co/public/mainnet', 'https://ethereum.public.blockpi.network/v1/rpc/public', 'https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']],
  base: [8453, ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.llamarpc.com']],
  arbitrum: [42161, ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com']],
};
const CHAIN_OF_ID = Object.fromEntries(Object.entries(CHAINS).map(([name, [id]]) => [id, name]));

const SEL = {
  getFuses: '0xd6e900b5',              // getFuses()
  marketId: '0x454dab23',              // MARKET_ID()
  inMarket: '0x3887fd78',              // totalAssetsInMarket(uint256)
  totalAssets: '0x01e1d114',           // totalAssets()
  supplyCap: '0xe88fa189',             // getTotalSupplyCap()
  oracle: '0xa462da02',                // getPriceOracleMiddleware()
  price: '0xb3596f07',                 // getAssetPrice(address)
  substrates: '0x2ede66bc',            // getMarketSubstrates(uint256)
  // The vault's parameters (the Explorer's Parameters tab).
  accessManager: '0x978dcd38',         // getAccessManagerAddress()
  rewardsManager: '0xa81b0b42',        // getRewardsClaimManagerAddress()
  withdrawManager: '0x42022932',       // getWithdrawManager()
  withdrawManagerAlt: '0x930df82e',    // getWithdrawManagerAddress()
  withdrawWindow: '0x78ae0d8a',        // getWithdrawWindow()       (WithdrawManager)
  requestFee: '0x0d37b537',            // getRequestFee()           (WithdrawManager, WAD)
  withdrawFee: '0x1540aa89',           // getWithdrawFee()          (WithdrawManager, WAD)
  perfData: '0x90acbe9c',              // getPerformanceFeeData()   (its account)
  feeManager: '0xea26266c',            // FEE_MANAGER()             (on that account)
  depositFee: '0x0de705b5',            // getDepositFee()           (FeeManager, WAD)
  instantFuses: '0x3d357c40',          // getInstantWithdrawalFuses()
  redemptionDelay: '0x5f0f55da',       // getRedemptionDelay()      (access manager, seconds)
  redemptionDelayAlt: '0xfeeb4e6a',    // REDEMPTION_DELAY_IN_SECONDS()
  asset: '0x38d52e0f',                 // asset()
  decimals: '0x313ce567',              // decimals()
  symbol: '0x95d89b41',                // symbol()
  name: '0x06fdde03',                  // name()
  balanceOf: '0x70a08231',             // balanceOf(address)
  toAssets: '0x07a2d13a',              // convertToAssets(uint256)
  aaveProvider: '0x875f5415',          // AAVE_V3_POOL_ADDRESSES_PROVIDER()
  dataProvider: '0xe860accb',          // getPoolDataProvider()
  reserveTokens: '0xd2493b6c',         // getReserveTokensAddresses(address)
  reserveData: '0x35ea6a75',           // getReserveData(address)
  morpho: '0x3acb5624',                // MORPHO()
  position: '0x93c52062',              // position(bytes32,address)
  market: '0x5c60e39a',                // market(bytes32)
  params: '0x2c3c9157',                // idToMarketParams(bytes32)
  borrowRate: '0x8c00bf6b',            // borrowRateView((address,address,address,address,uint256),(uint128 x6))
  debtOf: '0xd283e75f',                // debtOf(address)
  interestRate: '0x7c3a00fd',          // interestRate()
  interestFee: '0xa75df498',           // interestFee()
  totalBorrows: '0x47bd3718',          // totalBorrows()
  cash: '0x961be391',                  // cash()
};

// IporFusionMarkets.sol: a market's id, its name there, and how it reads here.
const MARKETS = {
  1: ['AAVE_V3', 'Aave V3'], 2: ['COMPOUND_V3_USDC', 'Compound V3 USDC'], 3: ['GEARBOX_POOL_V3', 'Gearbox'],
  4: ['GEARBOX_FARM_DTOKEN_V3', 'Gearbox farm'], 5: ['FLUID_INSTADAPP_POOL', 'Fluid'], 6: ['FLUID_INSTADAPP_STAKING', 'Fluid staking'],
  7: ['ERC20_VAULT_BALANCE', 'Tokens held'], 8: ['UNISWAP_SWAP_V3_POSITIONS', 'Uniswap V3 positions'], 9: ['UNISWAP_SWAP_V2', 'Uniswap V2'],
  10: ['UNISWAP_SWAP_V3', 'Uniswap V3'], 11: ['EULER_V2', 'Euler V2'], 12: ['UNIVERSAL_TOKEN_SWAPPER', 'Token swapper'],
  1202: ['UNIVERSAL_TOKEN_SWAPPER_V2', 'Token swapper'], 13: ['COMPOUND_V3_USDT', 'Compound V3 USDT'], 14: ['MORPHO', 'Morpho'],
  15: ['SPARK', 'Spark'], 16: ['CURVE_POOL', 'Curve'], 17: ['CURVE_LP_GAUGE', 'Curve gauge'], 18: ['RAMSES_V2_POSITIONS', 'Ramses V2'],
  19: ['MORPHO_FLASH_LOAN', 'Morpho flash loans'], 20: ['AAVE_V3_LIDO', 'Aave V3 Lido'], 21: ['MOONWELL', 'Moonwell'],
  22: ['MORPHO_REWARDS', 'Morpho rewards'], 23: ['PENDLE', 'Pendle'], 24: ['FLUID_REWARDS', 'Fluid rewards'],
  25: ['CURVE_GAUGE_ERC4626', 'Curve gauge'], 26: ['COMPOUND_V3_WETH', 'Compound V3 WETH'], 27: ['HARVEST_HARD_WORK', 'Harvest'],
  28: ['TAC_STAKING', 'TAC staking'], 29: ['LIQUITY_V2', 'Liquity V2'], 30: ['AERODROME', 'Aerodrome'],
  31: ['VELODROME_SUPERCHAIN', 'Velodrome'], 32: ['VELODROME_SUPERCHAIN_SLIPSTREAM', 'Velodrome Slipstream'],
  33: ['AREODROME_SLIPSTREAM', 'Aerodrome Slipstream'], 34: ['STAKE_DAO_V2', 'Stake DAO'], 35: ['SILO_V2', 'Silo V2'],
  36: ['BALANCER', 'Balancer'], 37: ['YIELD_BASIS_LT', 'Yield Basis'], 38: ['ENSO', 'Enso'], 39: ['EBISU', 'Ebisu'],
  40: ['ASYNC_ACTION', 'Async actions'], 41: ['MORPHO_LIQUIDITY_IN_MARKETS', 'Morpho liquidity'], 42: ['ODOS_SWAPPER', 'Odos'],
  43: ['VELORA_SWAPPER', 'Velora'], 44: ['SPARK_LEND', 'SparkLend'], 45: ['MIDAS', 'Midas'], 46: ['NAPIER', 'Napier'],
  47: ['DOLOMITE', 'Dolomite'], 48: ['LITE_PSM', 'Lite PSM'], 49: ['AAVE_V4', 'Aave V4'], 50: ['EXTERNAL_STATE', 'External state'],
  51: ['AGUA_GLOBAL_CARRY', 'Agua global carry'], 52: ['TERM_FINANCE', 'Term Finance'], 53: ['UNISWAP_V4', 'Uniswap V4'],
  424243: ['SPOL_UNSTAKE', 'sPOL unstake'],
};
for (let i = 1; i <= 20; i++) MARKETS[100000 + i] = ['ERC4626_' + String(i).padStart(4, '0'), 'ERC-4626 vault'];
for (let i = 1; i <= 10; i++) MARKETS[200000 + i] = ['META_MORPHO_' + String(i).padStart(4, '0'), 'Morpho vault'];
const AAVE_LIKE = new Set([1, 20, 44]);
const MORPHO = 14, EULER = 11, TOKENS = 7;
// A market whose substrate is the vault it holds, named after it.
const namedBySubstrate = (id) => (id > 100000 && id <= 100020) || (id > 200000 && id <= 200010);

// ---- ABI ------------------------------------------------------------------
const strip = (h) => String(h || '0x').replace(/^0x/, '');
const words = (hex) => { const h = strip(hex); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
const big = (hex, i = 0) => { const w = words(hex)[i]; return w ? BigInt('0x' + w) : null; };
const addr = (hex, i = 0) => { const w = words(hex)[i]; return w ? '0x' + w.slice(24) : null; };
const pad = (v) => (typeof v === 'bigint' ? v.toString(16) : strip(v).toLowerCase()).padStart(64, '0');
// A dynamic array of words (address[], bytes32[], uint256[]).
function array(hex) {
  const w = words(hex);
  if (w.length < 2) return [];
  const at = Number(BigInt('0x' + w[0]) / 32n), n = Number(BigInt('0x' + w[at]));
  return w.slice(at + 1, at + 1 + n);
}
// A string, or the bytes32 some old tokens return instead.
function text(hex) {
  const h = strip(hex);
  if (!h) return null;
  const bytes = (s) => Buffer.from(s, 'hex').toString('utf8').replace(/\0+$/, '');
  if (h.length === 64) return bytes(h) || null;
  const w = words(hex), at = Number(BigInt('0x' + w[0]) / 32n), n = Number(BigInt('0x' + w[at]));
  return bytes(h.slice((at + 1) * 64, (at + 1) * 64 + n * 2)) || null;
}
// A token amount as a number, without losing the large ones on the way.
const units = (v, dec) => (v == null ? 0 : Number(v / 10n ** BigInt(Math.max(0, dec - 6))) / 10 ** Math.min(6, dec));
const pct = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e2);
const round = (v) => Math.round(v * 100) / 100;

// ---- RPC ------------------------------------------------------------------
// One eth_call, endpoint by endpoint; null when the call reverts or the target
// has no code. Errors carry no URL: a keyed one carries its key.
function caller(chain) {
  const urls = rpcEndpoints(chain, CHAINS[chain][1]);
  let calls = 0;
  const fn = async (to, data, block = 'latest') => {
    calls++;
    const why = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, block] }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        if (j.error) { if (j.error.code === 3 || /revert/i.test(j.error.message || '')) return null; throw new Error(j.error.message); }
        return j.result && j.result !== '0x' ? j.result : null;
      } catch (e) { why.push(String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 50)); }
    }
    throw new Error(`${chain}: every endpoint failed (${why.join('; ')})`);
  };
  fn.count = () => calls;
  return fn;
}
// Up to n at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---- One vault --------------------------------------------------------------
// past: { block, days }, a reading about a month back (a TVL snapshot's), to
// measure a loop's collateral by.
// known: what the governance history knows of the vault (its withdraw
// manager, which no getter on the vault names).
async function readVault(call, vaultAddr, past = null, known = {}) {
  const v = vaultAddr.toLowerCase();
  const tryCall = (to, data, block) => call(to, data, block).catch(() => null);
  const [ta, assetHex, capHex, fusesHex, oracleHex] = await Promise.all([
    call(v, SEL.totalAssets), call(v, SEL.asset), tryCall(v, SEL.supplyCap), call(v, SEL.getFuses), tryCall(v, SEL.oracle)]);
  const asset = addr(assetHex);
  if (!asset || ta == null) throw new Error('not a Fusion vault');
  const oracle = addr(oracleHex);
  const meta = {};
  const tokenMeta = async (t) => {
    if (!meta[t]) meta[t] = Promise.all([tryCall(t, SEL.decimals), tryCall(t, SEL.symbol)]).then(([d, s]) => ({ dec: d ? Number(big(d)) : 18, sym: text(s) }));
    return meta[t];
  };
  // Dollars per whole token, at the vault's own oracle, now or at a block.
  const prices = {};
  const priceOf = async (t, block = 'latest') => {
    const k = t + '@' + block;
    if (!(k in prices)) prices[k] = (async () => {
      if (!oracle) return null;
      const r = await tryCall(oracle, SEL.price + pad(t), block === 'latest' ? 'latest' : '0x' + block.toString(16));
      const w = words(r);
      return w.length >= 2 ? Number(big(r, 0)) / 10 ** Number(big(r, 1)) : null;
    })();
    return prices[k];
  };
  const { dec, sym } = await tokenMeta(asset);
  const price = await priceOf(asset);

  // The markets: each fuse's, the tokens held, none of the bookkeeping ones.
  const fuses = array(fusesHex).map(w => '0x' + w.slice(24));
  const ids = await pool(fuses, 6, f => tryCall(f, SEL.marketId).then(r => (r ? big(r) : null)));
  const fuseOf = {};
  fuses.forEach((f, i) => { const id = ids[i]; if (id != null && id < 10n ** 9n) (fuseOf[Number(id)] = fuseOf[Number(id)] || []).push(f); });
  const marketIds = [...new Set([...Object.keys(fuseOf).map(Number), TOKENS])].sort((a, b) => a - b);
  const nets = await pool(marketIds, 6, id => call(v, SEL.inMarket + pad(BigInt(id))).then(r => (r ? big(r) : 0n)));

  const markets = [];
  for (let i = 0; i < marketIds.length; i++) {
    const id = marketIds[i];
    const net = units(nets[i], dec);
    const [key, label] = MARKETS[id] || ['MARKET_' + id, 'Market ' + id];
    const m = { id, key, name: label, net: round(net), netUsd: price != null ? round(net * price) : null };
    try {
      if (AAVE_LIKE.has(id)) await aavePositions(m);
      else if (id === MORPHO) await morphoPositions(m);
      else if (id === EULER) await eulerPositions(m);
      else if (namedBySubstrate(id)) {
        const sub = (array(await tryCall(v, SEL.substrates + pad(BigInt(id))))[0] || '').slice(24);
        if (sub) { const n = text(await tryCall('0x' + sub, SEL.name)); if (n) m.name = n; m.substrate = '0x' + sub; }
      }
      if (m.positions) await ownYield(m);
    } catch (e) { m.note = String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 80); }
    if (m.positions) {
      m.supplyUsd = round(m.positions.filter(p => p.side !== 'borrow').reduce((a, p) => a + p.usd, 0));
      m.borrowUsd = round(m.positions.filter(p => p.side === 'borrow').reduce((a, p) => a + p.usd, 0));
      const weighted = (side) => {
        const ps = m.positions.filter(p => side(p.side) && p.usd > 0);
        const usd = ps.reduce((a, p) => a + p.usd, 0);
        return usd > 0 && ps.every(p => p.apy != null) ? pct(ps.reduce((a, p) => a + p.usd * p.apy, 0) / usd / 100) : null;
      };
      m.supplyApy = weighted(s => s !== 'borrow');
      m.borrowApy = weighted(s => s === 'borrow');
    }
    if (m.net > 0 || (m.positions && m.positions.some(p => p.usd >= 1))) markets.push(m);
  }
  // The cap is in shares: in assets at the vault's own rate.
  const capShares = capHex ? big(capHex) : null;
  const capAssets = capShares != null && capShares < 2n ** 255n ? big(await tryCall(v, SEL.toAssets + pad(capShares))) : null;
  const params = await readParams().catch(e => ({ error: String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 80) }));
  return { asset, symbol: sym, decimals: dec, priceUsd: price, totalAssets: round(units(big(ta), dec)),
    cap: capAssets != null ? round(units(capAssets, dec)) : null, markets, params };

  // -- What the vault may do and who runs it: its managers, its entry and exit
  //    contributions and withdraw window, and each market's fuses with the
  //    assets or markets (substrates) granted to them. The roles' holders are
  //    the governance history's (collect-vault-changes.js).
  async function readParams() {
    const live = (a) => (a && /[1-9a-f]/.test(a.slice(2)) ? a : null);
    const first = async (to, sels) => { for (const s of sels) { const a = live(addr(await tryCall(to, s))); if (a) return a; } return null; };
    const wad = (r) => (r ? Math.round(Number(big(r)) / 1e12) / 1e4 : null);   // a WAD fraction, in percent
    const [access, rewards, withdraw, feeAccount] = await Promise.all([first(v, [SEL.accessManager]), first(v, [SEL.rewardsManager]),
      first(v, [SEL.withdrawManager, SEL.withdrawManagerAlt]).then(a => a || known.withdraw || null), first(v, [SEL.perfData])]);
    const feeManager = feeAccount ? await first(feeAccount, [SEL.feeManager]) : null;
    const [win, rq, wd] = withdraw ? await Promise.all([tryCall(withdraw, SEL.withdrawWindow), tryCall(withdraw, SEL.requestFee), tryCall(withdraw, SEL.withdrawFee)]) : [];
    let depositFee = null;
    for (const c of [feeManager, feeAccount].filter(Boolean)) { const r = await tryCall(c, SEL.depositFee); if (r) { depositFee = wad(r); break; } }
    const instant = array(await tryCall(v, SEL.instantFuses));
    let redemptionDelay = null;
    if (access) for (const s of [SEL.redemptionDelay, SEL.redemptionDelayAlt]) { const r = await tryCall(access, s); if (r) { redemptionDelay = Number(big(r)); break; } }
    const byMarket = {};
    fuses.forEach((f, i) => { const id = ids[i]; if (id != null && id < 10n ** 9n) (byMarket[Number(id)] = byMarket[Number(id)] || []).push(f); });
    const permIds = [...new Set([...Object.keys(byMarket).map(Number), TOKENS])].sort((a, b) => a - b);
    const permissions = await pool(permIds, 3, async (id) => {
      const ws = array(await tryCall(v, SEL.substrates + pad(BigInt(id))));
      const subs = await pool(ws.slice(0, 40), 4, async (w) => {
        if (/^0{24}/.test(w) && /[1-9a-f]/.test(w)) { const a = '0x' + w.slice(24); return { a, sym: (await tokenMeta(a)).sym || null }; }
        return { raw: '0x' + w };
      });
      const [key, label] = MARKETS[id] || ['MARKET_' + id, 'Market ' + id];
      return { id, key, name: label, fuses: byMarket[id] || [], subs, more: Math.max(0, ws.length - 40) };
    });
    return { access, rewards, withdraw, oracle, feeManager: feeManager || feeAccount,
      withdrawWindow: win ? Number(big(win)) : null, requestFee: wad(rq), withdrawFee: wad(wd), depositFee, redemptionDelay,
      instantFuses: instant.length, permissions };
  }

  // -- A loop's collateral earns its own yield (a staked token's), which its
  //    market does not pay: its price against the token borrowed against it,
  //    now and about a month back, at the vault's oracle, a year's worth.
  //    Only between tokens of one family (a ratio from 0.5 to 3: cbETH and
  //    WETH, sUSDe and USDC), never BTC against dollars, where it would be a
  //    price move. Supplied, it adds to what the market pays.
  async function ownYield(m) {
    if (!past || !(past.days > 0)) return;
    const debts = m.positions.filter(p => p.side === 'borrow');
    if (!debts.length) return;
    for (const p of m.positions) {
      const debt = debts.find(d => d.market && d.market === p.market) || debts[0];
      if (p.side === 'borrow' || !p.token || p.token === debt.token) continue;
      const [a1, b1, a0, b0] = await Promise.all([priceOf(p.token), priceOf(debt.token), priceOf(p.token, past.block), priceOf(debt.token, past.block)]);
      if (![a1, b1, a0, b0].every(x => x > 0)) continue;
      const r1 = a1 / b1, r0 = a0 / b0;
      if (r1 < 0.5 || r1 > 3) continue;
      const y = Math.pow(r1 / r0, 365 / past.days) - 1;
      if (!Number.isFinite(y) || Math.abs(y) > 0.3) continue;
      p.ownApy = pct(y);
      p.apy = pct((p.apy || 0) / 100 + y);
    }
  }

  // -- Aave V3 and its forks: each substrate asset's aToken and debt.
  async function aavePositions(m) {
    const subs = array(await call(v, SEL.substrates + pad(BigInt(m.id)))).map(w => '0x' + w.slice(24));
    let provider = null;
    for (const f of fuseOf[m.id] || []) { provider = addr(await tryCall(f, SEL.aaveProvider)); if (provider) break; }
    const dp = provider && addr(await call(provider, SEL.dataProvider));
    if (!dp) return;
    m.positions = [];
    for (const a of subs) {
      const [tokens, data, { dec: d, sym: s }, p] = await Promise.all([call(dp, SEL.reserveTokens + pad(a)), tryCall(dp, SEL.reserveData + pad(a)), tokenMeta(a), priceOf(a)]);
      if (!tokens || p == null) continue;
      const [aToken, stableDebt, varDebt] = [addr(tokens, 0), addr(tokens, 1), addr(tokens, 2)];
      const bal = async (t) => (t && /[1-9a-f]/.test(t.slice(2)) ? big(await call(t, SEL.balanceOf + pad(v))) || 0n : 0n);
      const [sup, sd, vd] = await Promise.all([bal(aToken), bal(stableDebt), bal(varDebt)]);
      // Rates are yearly, in ray, compounded every second.
      const apy = (i) => (data ? pct(Math.exp(Number(big(data, i)) / 1e27) - 1) : null);
      if (sup > 0n) m.positions.push({ asset: s, token: a, side: 'supply', usd: round(units(sup, d) * p), apy: apy(5) });
      if (sd + vd > 0n) m.positions.push({ asset: s, token: a, side: 'borrow', usd: round(units(sd + vd, d) * p), apy: apy(6) });
    }
  }

  // -- Morpho: each substrate market's supply, collateral and borrow.
  async function morphoPositions(m) {
    const subs = array(await call(v, SEL.substrates + pad(BigInt(m.id))));
    let morpho = null;
    for (const f of fuseOf[m.id] || []) { morpho = addr(await tryCall(f, SEL.morpho)); if (morpho) break; }
    if (!morpho) return;
    m.positions = [];
    for (const id of subs) {
      const [pos, mk, mp] = await Promise.all([call(morpho, SEL.position + id + pad(v)), call(morpho, SEL.market + id), call(morpho, SEL.params + id)]);
      if (!pos || !mk || !mp) continue;
      const [supplyShares, borrowShares, collateral] = [big(pos, 0), big(pos, 1), big(pos, 2)];
      const [tsa, tss, tba, tbs, , fee] = [0, 1, 2, 3, 4, 5].map(i => big(mk, i));
      const [loan, coll, , irm] = [addr(mp, 0), addr(mp, 1), addr(mp, 2), addr(mp, 3)];
      // Morpho's virtual shares: assets = shares × (total assets + 1) / (total shares + 1e6).
      const toAssets = (sh, ta, ts) => (sh * (ta + 1n)) / (ts + 1000000n);
      const supplied = toAssets(supplyShares, tsa, tss), borrowed = toAssets(borrowShares, tba, tbs);
      const [lm, cm, lp, cp] = await Promise.all([tokenMeta(loan), tokenMeta(coll), priceOf(loan), priceOf(coll)]);
      let borrowApy = null, supplyApy = null;
      if (irm && /[1-9a-f]/.test(irm.slice(2))) {
        const r = await tryCall(irm, SEL.borrowRate + strip(mp).slice(0, 320) + strip(mk).slice(0, 384));
        if (r) {
          // A rate a second, in WAD; suppliers get it on what is lent out,
          // less Morpho's fee.
          const perSec = Number(big(r)) / 1e18;
          const util = tsa > 0n ? Number(tba * 1000000n / tsa) / 1e6 : 0;
          borrowApy = Math.exp(perSec * YEAR) - 1;
          supplyApy = Math.exp(perSec * util * (1 - Number(fee) / 1e18) * YEAR) - 1;
        }
      }
      const label = (cm.sym || '?') + '/' + (lm.sym || '?');
      if (collateral > 0n && cp != null) m.positions.push({ asset: cm.sym, token: coll, market: label, side: 'collateral', usd: round(units(collateral, cm.dec) * cp), apy: null });
      if (supplied > 0n && lp != null) m.positions.push({ asset: lm.sym, token: loan, market: label, side: 'supply', usd: round(units(supplied, lm.dec) * lp), apy: pct(supplyApy) });
      if (borrowed > 0n && lp != null) m.positions.push({ asset: lm.sym, token: loan, market: label, side: 'borrow', usd: round(units(borrowed, lm.dec) * lp), apy: pct(borrowApy) });
    }
  }

  // -- Euler V2: each substrate vault's shares, in assets, and debt for the
  //    vault's sub-account (the vault's address with its last byte XORed).
  async function eulerPositions(m) {
    const subs = array(await call(v, SEL.substrates + pad(BigInt(m.id))));
    m.positions = [];
    for (const w of subs) {
      const ev = '0x' + w.slice(0, 40);
      const isCollateral = (parseInt(w.slice(40, 42), 16) & 1) === 1;
      const subId = parseInt(w.slice(44, 46), 16);
      const sub = '0x' + (BigInt(v) ^ BigInt(subId)).toString(16).padStart(40, '0');
      const [a, shares, debt, rate, fee, borrows, cash] = await Promise.all([call(ev, SEL.asset), call(ev, SEL.balanceOf + pad(sub)), tryCall(ev, SEL.debtOf + pad(sub)),
        tryCall(ev, SEL.interestRate), tryCall(ev, SEL.interestFee), tryCall(ev, SEL.totalBorrows), tryCall(ev, SEL.cash)]);
      const u = addr(a);
      if (!u) continue;
      const [{ dec: d, sym: s }, p] = await Promise.all([tokenMeta(u), priceOf(u)]);
      if (p == null) continue;
      const sh = big(shares) || 0n;
      const held = sh > 0n ? big(await call(ev, SEL.toAssets + pad(sh))) || 0n : 0n;
      const owed = big(debt) || 0n;
      // A rate a second, scaled by 1e27; suppliers get it on what is lent
      // out, less the vault's interest fee (in 1e4ths).
      const perSec = rate ? Number(big(rate)) / 1e27 : null;
      const [b, c] = [big(borrows), big(cash)];
      const util = b != null && c != null && b + c > 0n ? Number(b * 1000000n / (b + c)) / 1e6 : null;
      const borrowApy = perSec != null ? Math.exp(perSec * YEAR) - 1 : null;
      const supplyApy = perSec != null && util != null && fee ? Math.exp(perSec * util * (1 - Number(big(fee)) / 1e4) * YEAR) - 1 : null;
      if (held > 0n) m.positions.push({ asset: s, token: u, side: isCollateral ? 'collateral' : 'supply', usd: round(units(held, d) * p), apy: isCollateral ? null : pct(supplyApy) });
      if (owed > 0n) m.positions.push({ asset: s, token: u, side: 'borrow', usd: round(units(owed, d) * p), apy: pct(borrowApy) });
    }
  }
}

// ---- History ------------------------------------------------------------------
// The days to have for a vault: every snapshot day of the last DAILY_DAYS, one
// a week before that, newest first, with the snapshot's block and price.
function wantedDays(snap, today) {
  const byDay = new Map();
  for (const s of (snap && snap.snapshots) || []) {
    const day = s.day != null ? s.day : Math.floor(s.timestamp / DAY);
    if (!(s.block > 0) || !(s.priceUsd > 0)) continue;
    const cur = byDay.get(day);
    if (!cur || s.timestamp > cur.timestamp) byDay.set(day, s);
  }
  return [...byDay.entries()].filter(([d]) => d < today && (today - d <= DAILY_DAYS || d % 7 === 0))
    .sort((a, b) => b[0] - a[0]).map(([day, s]) => ({ day, block: s.block, price: s.priceUsd }));
}

async function main({ out = OUT, history = HISTORY, ipor = IPOR, snapshots = SNAPSHOTS, changes = CHANGES, only = null, now = Date.now() } = {}) {
  const started = Date.now();
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const list = read(ipor);
  if (!list) { console.log('vault-markets.json: ipor-vaults.json unreadable; left as it was'); return; }
  const vaults = (list.vaults || []).filter(v => CHAIN_OF_ID[Number(v.chainId)] && (only ? v.address.toLowerCase() === only : v.tvl > FLOOR));
  const prev = (read(out) || {}).vaults || {};
  const hist = read(history) || { vaults: {} };
  const snaps = (read(snapshots) || {}).vaults || {};
  // Each vault's withdraw manager, from its governance history (collect-vault-changes.js).
  const govern = (read(changes) || {}).vaults || {};
  const { currentWithdraw } = require('./tools/describe-changes.js');
  const withdrawOf = (a) => (govern[a] ? currentWithdraw(govern[a]) : null);
  const today = Math.floor(now / 1000 / DAY);
  const result = {};
  let failed = 0;
  const byChain = {};
  vaults.forEach(v => (byChain[CHAIN_OF_ID[Number(v.chainId)]] = byChain[CHAIN_OF_ID[Number(v.chainId)]] || []).push(v));
  await Promise.all(Object.entries(byChain).map(async ([chain, list]) => {
    const call = caller(chain);
    // Today, a few vaults at a time: public endpoints throttle bursts.
    await pool(list, 3, async (v) => {
      const a = v.address.toLowerCase();
      // The snapshot nearest a month back: its block, for a loop's collateral.
      const month = wantedDays(snaps[a] || snaps[v.address], today).filter(w => today - w.day >= 21)
        .sort((x, y) => Math.abs(today - x.day - 30) - Math.abs(today - y.day - 30))[0];
      try {
        result[a] = Object.assign({ chain, name: v.name, readAt: new Date(now).toISOString() },
          await readVault(call, a, month ? { block: month.block, days: today - month.day } : null, { withdraw: withdrawOf(a) }));
      } catch (e) {
        failed++;
        if (prev[a]) result[a] = prev[a];
        console.log(`::warning::vault-markets: ${v.name}: ${String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 120)}`);
      }
    });
    // The history: today's dollars per market, then earlier days at their
    // snapshot blocks, newest first, while the budget and the time last.
    let budget = BACKFILL_CALLS;
    for (const v of list) {
      const a = v.address.toLowerCase(), r = result[a];
      if (!r || !r.markets) continue;
      const h = hist.vaults[a] = hist.vaults[a] || { chain, markets: {}, days: {} };
      r.markets.forEach(m => { h.markets[m.id] = m.name; });
      h.days[today] = Object.fromEntries(r.markets.filter(m => m.netUsd != null).map(m => [m.id, Math.round(m.netUsd)]));
    }
    for (const v of list) {
      const a = v.address.toLowerCase(), r = result[a], h = hist.vaults[a];
      if (!r || !h || !r.markets.length) continue;
      const ids = r.markets.map(m => m.id), dec = r.decimals;
      for (const w of wantedDays(snaps[a] || snaps[v.address], today)) {
        if (h.days[w.day] || budget < ids.length || Date.now() - started > DEADLINE_MS) continue;
        budget -= ids.length;
        try {
          const vals = await pool(ids, 4, id => call(a, SEL.inMarket + pad(BigInt(id)), '0x' + w.block.toString(16)));
          h.days[w.day] = Object.fromEntries(ids.map((id, i) => [id, Math.round(units(vals[i] ? big(vals[i]) : 0n, dec) * w.price)]).filter(([, usd]) => usd > 0));
        } catch { budget = 0; }   // the endpoints are failing: stop for this run
      }
    }
  }));
  if (!Object.keys(result).length) { console.log('::error::vault-markets: no vault read; left as it was'); process.exitCode = 1; return; }
  fs.writeFileSync(out, JSON.stringify({ readAt: new Date(now).toISOString(), floor: FLOOR, vaults: Object.assign({}, only ? prev : {}, result) }) + '\n');
  hist.updatedAt = new Date(now).toISOString();
  fs.writeFileSync(history, JSON.stringify(hist) + '\n');
  const days = Object.values(hist.vaults).reduce((a, h) => a + Object.keys(h.days).length, 0);
  console.log(`vault-markets.json: ${Object.keys(result).length} vaults (${failed} unread, kept from the last run); history: ${days} vault-days`);
}

if (require.main === module) {
  const i = process.argv.indexOf('--vault');
  main({ only: i > 0 ? String(process.argv[i + 1] || '').toLowerCase() : null })
    .catch(e => { console.log('::error::vault-markets: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
}
module.exports = { main, readVault, wantedDays, SEL, MARKETS, CHAINS, CHAIN_OF_ID, words, array, text, units, pool };
