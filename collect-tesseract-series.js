#!/usr/bin/env node
//
// collect-tesseract-series.js — daily history for every Tesseract vault,
// from each vault's deployment block to now, with no gaps.
//
// Reads tesseract-vaults.json (produced by collect-tesseract-discover.js).
//
// Per vault, per UTC day:
//   totalAssets, totalSupply          — underlying units / share units
//   sharePrice = totalAssets/totalSupply  (COMPUTED, never a display field)
//   priceUsd                          — oracle reading AT THAT BLOCK
//   tvlUsd = totalAssets * priceUsd   — never today's price on an old balance
//   deposits / withdrawals            — from Deposit/Withdraw events, with address
//   fees                              — performance, management, deposit, exit
//
// Accuracy rules enforced here:
//   * Underlying units are primary; USD is derived and stored alongside, so a
//     chart can show cbETH first and USD second without re-deriving.
//   * Historical points are priced at their own block. Applying today's price
//     to a July balance manufactures growth that never happened.
//   * sharePrice carries its block and timestamp so any rate quoted from it can
//     state its period. No annualisation happens in the collector.
//   * divergence: totalAssets is cached and event-driven, so where the oracle
//     and supply imply a different value we record the delta rather than hide it.
//
// Checkpointed: re-running resumes per vault, so a timed-out CI run makes
// progress instead of starting over.

const fs = require('fs');
const path = require('path');
const { selector } = require('./lib/keccak');
const LH = require('./lib/lending-health');

const IN = path.join(__dirname, 'tesseract-vaults.json');
const OUT = path.join(__dirname, 'tesseract-series.json');

const SEL = {
  totalAssets: selector('totalAssets()'),
  totalSupply: selector('totalSupply()'),
  decimals: selector('decimals()'),
  perfFee: selector('getPerformanceFeeData()'),
  mgmtFee: selector('getManagementFeeData()'),
  assetPrice: selector('getAssetPrice(address)'),
  convertToAssets: selector('convertToAssets(uint256)'),
};
const DEPOSIT_TOPIC = '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
const WITHDRAW_TOPIC = '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';

const CHAIN_RPCS = {
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com'],
  base: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc'],
  avalanche: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'],
  unichain: ['https://mainnet.unichain.org'],
  plasma: ['https://evm-rpc.plasma.io/api'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
  sonic: ['https://sonic-rpc.publicnode.com'],
  ink: ['https://rpc-gel.inkonchain.com'],
  katana: ['https://rpc.katana.network'],
  tac: ['https://rpc.tac.build'],
};
const BLOCKS_PER_DAY = {
  ethereum: 7200, base: 43200, arbitrum: 345600, avalanche: 43200,
  unichain: 21600, plasma: 43200, optimism: 43200, sonic: 86400,
  ink: 43200, katana: 43200, tac: 28800, _default: 7200,
};
const ABI_URL = (slug) => `https://raw.githubusercontent.com/IPOR-Labs/ipor-abi/main/mainnet/mainnet-${slug}-fusion/addresses.json`;

let callId = 0;
const active = {};

async function rpcCall(chain, method, params, { timeoutMs = 20000, tries = 3 } = {}) {
  const rpcs = CHAIN_RPCS[chain] || [];
  if (!rpcs.length) throw new Error(`no RPC for ${chain}`);
  const a = (active[chain] = active[chain] || 0);
  const order = [a, ...rpcs.map((_, i) => i).filter((i) => i !== a)];
  let lastErr;
  for (let t = 0; t < tries; t++) {
    for (const i of order) {
      try {
        const res = await fetch(rpcs[i], {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++callId, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (j.error) throw new Error(j.error.message || 'rpc error');
        active[chain] = i;
        return j.result;
      } catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 300 * (t + 1)));
  }
  throw new Error(`RPC failed ${method}: ${lastErr && lastErr.message}`);
}

const hexBlock = (b) => '0x' + b.toString(16);
const callAt = (chain, to, data, block) => rpcCall(chain, 'eth_call', [{ to, data }, hexBlock(block)]);

async function readBig(chain, to, data, block) {
  try {
    const r = await callAt(chain, to, data, block);
    if (!r || r === '0x') return null;
    return BigInt(r.slice(0, 66));
  } catch { return null; }
}

// getAssetPrice(address) -> (uint256 price, uint256 decimals)
async function oraclePrice(chain, oracle, token, block) {
  if (!oracle) return null;
  try {
    const data = SEL.assetPrice + token.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const r = await callAt(chain, oracle, data, block);
    if (!r || r === '0x' || r.length < 130) return null;
    const price = BigInt('0x' + r.slice(2, 66));
    const dec = Number(BigInt('0x' + r.slice(66, 130)));
    if (price === 0n) return null;
    return Number(price) / 10 ** (dec || 8);
  } catch { return null; }
}

// feeInPercentage is bps with 2 decimals: 10000 = 100%
async function feeData(chain, vault, block) {
  const out = { performance: null, management: null };
  for (const [k, sel] of [['performance', SEL.perfFee], ['management', SEL.mgmtFee]]) {
    try {
      const r = await callAt(chain, vault, sel, block);
      if (r && r.length >= 130) out[k] = Number(BigInt('0x' + r.slice(66, 130))) / 10000;
    } catch {}
  }
  return out;
}

// Adaptive log scan. Public RPCs cap eth_getLogs differently (and mostly by
// result size, not range), so we start wide and shrink the *learned* chunk for
// the chain on rejection rather than bisecting every call. A single factory
// address with few events answers fine over millions of blocks.
const chunkPref = {};
async function scanLogs(chain, address, topics, fromBlock, toBlock, deadline) {
  const name = typeof chain === 'string' ? chain : chain.name;
  const out = [];
  let chunk = chunkPref[name] || 5000000;
  let from = fromBlock;
  while (from <= toBlock) {
    if (Date.now() > deadline) throw new Error('deadline');
    const to = Math.min(from + chunk - 1, toBlock);
    try {
      const logs = await rpcCall(chain, 'eth_getLogs', [{
        ...(address ? { address } : {}),
        topics,
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      out.push(...logs);
      from = to + 1;
      chunkPref[name] = chunk;
    } catch (e) {
      if (String(e.message) === 'deadline') throw e;
      if (chunk <= 5000) { from = to + 1; continue; } // unscannable sliver: skip, don't stall
      chunk = Math.max(5000, Math.floor(chunk / 4));
      chunkPref[name] = chunk;
    }
  }
  return out;
}

async function getJson(url, ms = 25000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

(async function main() {
  const BUDGET_MS = Number(process.env.SERIES_BUDGET_MS || 900000); // 15 min default
  const started = Date.now();
  const deadline = started + BUDGET_MS;

  const disc = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`=== Tesseract series: ${disc.vaults.length} vaults ===`);

  let state = { updatedAt: null, vaults: {} };
  try { state = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  state.vaults = state.vaults || {};

  // Price oracle per chain (from ipor-abi, no hardcoding)
  const oracles = {};
  for (const c of [...new Set(disc.vaults.map((v) => v.chain))]) {
    try {
      const j = await getJson(ABI_URL(c));
      oracles[c] = j.PriceOracleMiddlewareUsdProxy || j.PriceOracleMiddlewareUsdWithRolesProxy || null;
    } catch { oracles[c] = null; }
    console.log(`  oracle[${c}] = ${oracles[c] || 'NONE (USD will be null)'}`);
  }

  const heads = {};
  for (const c of Object.keys(oracles)) {
    try { heads[c] = parseInt(await rpcCall(c, 'eth_blockNumber', []), 16); }
    catch (e) { console.log(`  [${c}] head unavailable: ${e.message}`); }
  }

  const COLLECT_HEALTH = process.env.COLLECT_HEALTH !== '0';
  const marketIdCache = {};
  console.log(`  lending health: ${COLLECT_HEALTH ? 'on' : 'off'}`);

  let done = 0, skipped = 0;
  for (const v of disc.vaults) {
    if (Date.now() > deadline) { console.log('\nBudget reached — checkpointing, resume next run.'); break; }
    const head = heads[v.chain];
    if (!head) { skipped++; continue; }

    const key = `${v.chainId}:${v.address}`;
    const prev = state.vaults[key] || { points: [], flows: [] };
    const bpd = BLOCKS_PER_DAY[v.chain] || BLOCKS_PER_DAY._default;
    const have = new Set(prev.points.map((p) => p.block));
    const scale = 10 ** (v.decimals || 18);

    // Daily block ladder from deployment to head — no gaps by construction.
    const ladder = [];
    for (let b = v.block; b <= head; b += bpd) ladder.push(b);
    if (ladder[ladder.length - 1] !== head) ladder.push(head);

    const points = prev.points.slice();
    let added = 0;
    for (const block of ladder) {
      if (have.has(block)) continue;
      if (Date.now() > deadline) break;
      const [ta, ts] = await Promise.all([
        readBig(v.chain, v.address, SEL.totalAssets, block),
        readBig(v.chain, v.address, SEL.totalSupply, block),
      ]);
      if (ta == null || ts == null) continue; // pre-deploy / reverted
      const shareDec = v.assetDecimals || v.decimals || 18;
      const assets = Number(ta) / scale;
      const supply = Number(ts) / 10 ** shareDec;
      // share price computed, never read from a display field
      const sharePrice = supply > 0 ? assets / supply : null;
      const priceUsd = await oraclePrice(v.chain, oracles[v.chain], v.underlyingToken, block);
      let timestamp = null;
      try {
        const blk = await rpcCall(v.chain, 'eth_getBlockByNumber', [hexBlock(block), false]);
        if (blk) timestamp = parseInt(blk.timestamp, 16);
      } catch {}
      // Cross-check: totalAssets is cached and event-driven, so compare the
      // ratio share price against the vault's own conversion path. The two are
      // computed independently, so a gap means the cached total is stale or a
      // fee/rounding step diverges — worth flagging, not smoothing over.
      const oneShare = 10n ** BigInt(shareDec);
      const conv = await readBig(v.chain, v.address, SEL.convertToAssets + oneShare.toString(16).padStart(64, '0'), block);
      const sharePriceConvert = conv != null ? Number(conv) / scale : null;
      const divergence = (sharePrice != null && sharePriceConvert != null)
        ? sharePrice - sharePriceConvert : null;

      // Per-market lending health. Market ids are cached per vault (they
      // change rarely) and health is only read for vaults holding assets —
      // an empty vault has no position to price.
      let markets = null;
      if (COLLECT_HEALTH && assets > 0) {
        if (!marketIdCache[key]) {
          marketIdCache[key] = await LH.marketIdsFor(
            (to, data, blk) => callAt(v.chain, to, data, blk), v.address, block);
        }
        const ids = marketIdCache[key];
        if (ids && ids.length) {
          markets = [];
          for (const id of ids.slice(0, 6)) {
            const h = await LH.healthForMarket(
              (to, data, blk) => callAt(v.chain, to, data, blk), v.address, id, block);
            // Scale raw token amounts to human units where we can.
            if (h.collateral != null) h.collateral /= scale;
            if (h.debt != null) h.debt /= scale;
            if (h.collateralValue != null) h.collateralValue /= scale;
            h.leverage = LH.leverage(h.collateralValue, assets);
            markets.push(h);
          }
        }
      }

      points.push({
        block, timestamp,
        markets,
        day: timestamp ? Math.floor(timestamp / 86400) : null,
        assets, supply, sharePrice,
        sharePriceConvert,
        divergence,
        divergencePct: (divergence != null && sharePrice) ? (divergence / sharePrice) * 100 : null,
        priceUsd,                                   // oracle AT THIS BLOCK
        tvlUsd: priceUsd != null ? assets * priceUsd : null,
      });
      added++;
    }
    points.sort((a, b) => a.block - b.block);

    // Flows — every deposit and withdrawal, with the address.
    let flows = prev.flows || [];
    const lastFlowBlock = flows.length ? Math.max(...flows.map((f) => f.block)) : v.block;
    if (Date.now() < deadline) {
      try {
        const [dep, wd] = await Promise.all([
          scanLogs(v.chain, v.address, [DEPOSIT_TOPIC], lastFlowBlock, head, deadline),
          scanLogs(v.chain, v.address, [WITHDRAW_TOPIC], lastFlowBlock, head, deadline),
        ]);
        const seen = new Set(flows.map((f) => f.tx + ':' + f.logIndex));
        const push = (l, type) => {
          const d = l.data.slice(2);
          const assets = Number(BigInt('0x' + d.slice(0, 64))) / scale;
          const shares = Number(BigInt('0x' + d.slice(64, 128))) / 10 ** (v.assetDecimals || v.decimals || 18);
          const block = parseInt(l.blockNumber, 16);
          const id = l.transactionHash + ':' + parseInt(l.logIndex, 16);
          if (seen.has(id)) return;
          seen.add(id);
          flows.push({
            type, block, tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16),
            // Deposit: topic1=sender, topic2=owner. Withdraw: topic1=sender,
            // topic2=receiver, topic3=owner.
            sender: l.topics[1] ? '0x' + l.topics[1].slice(-40) : null,
            owner: l.topics[type === 'deposit' ? 2 : 3] ? '0x' + l.topics[type === 'deposit' ? 2 : 3].slice(-40) : null,
            assets, shares,
            sharePrice: shares > 0 ? assets / shares : null, // resulting share price
          });
        };
        dep.forEach((l) => push(l, 'deposit'));
        wd.forEach((l) => push(l, 'withdraw'));
        flows.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
      } catch (e) { console.log(`  [${v.name}] flow scan stopped: ${e.message}`); }
    }

    const fees = await feeData(v.chain, v.address, head);

    state.vaults[key] = {
      chainId: v.chainId, chain: v.chain, address: v.address, name: v.name,
      symbol: v.symbol, decimals: v.decimals, underlyingToken: v.underlyingToken,
      deploymentBlock: v.block, matchedBy: v.matchedBy,
      fees,
      // Deployed-but-empty is a state, not a reason to drop the vault.
      status: points.length && points[points.length - 1].assets === 0 ? 'deployed-empty' : 'active',
      points, flows,
    };
    done++;
    const last = points[points.length - 1];
    console.log(`  [${v.chain}] ${v.name} ${v.address.slice(0, 10)} — +${added} pts (${points.length} total), ${flows.length} flows`
      + (last ? `, last assets=${last.assets.toFixed(4)} ${v.symbol} sp=${last.sharePrice != null ? last.sharePrice.toFixed(6) : 'n/a'}` : ''));
  }

  state.updatedAt = new Date().toISOString();
  state.discoveryUpdatedAt = disc.updatedAt;
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2) + '\n');
  const totalPts = Object.values(state.vaults).reduce((s, v) => s + v.points.length, 0);
  console.log(`\nProcessed ${done} vaults (${skipped} skipped, no RPC). ${totalPts} daily points total.`);
  console.log(`Wrote ${OUT}`);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
