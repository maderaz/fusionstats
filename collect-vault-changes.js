#!/usr/bin/env node
'use strict';
// collect-vault-changes.js — each vault's Curator Action History: every change
// made to the vault and to the contracts that run it, read from their events
// on-chain. Writes vault-changes.json; tools/build-explorer.js turns it into a
// file a vault for the Explorer (explorer/actions/<chain>-<address>.json).
//
// What runs a vault (IPOR-Labs/ipor-fusion), and what is read from each:
//   the vault (PlasmaVault)        fuses and balance fuses added or removed,
//                                  markets' substrates and limits, instant-
//                                  withdrawal fuses, dependency graphs, fees,
//                                  the price oracle, the rewards and withdraw
//                                  managers, the supply cap, callbacks,
//                                  pre-hooks
//   its access manager             roles granted, revoked, relabelled; who may
//   (getAccessManagerAddress)      call what; timelocks; closed contracts;
//                                  operations scheduled, run, cancelled; the
//                                  redemption delay
//   the contracts it gives a       the fee manager (fee splits, the DAO's
//   system role (found in its      recipient), the withdraw manager (window,
//   grants, and named by the       fees, funds released), the rewards claim
//   vault's own events)            manager (vesting, reward fuses), the context
//                                  manager (approved targets)
//   its price oracle               price sources and their checks, when the
//   (getPriceOracleMiddleware)     oracle is the vault's own (one many vaults
//                                  share isn't this vault's history)
// Not read: what runs the vault day to day rather than changes it (its
// rebalances, fee and reward realisations, a depositor's redemption delay).
//
// Each change: its block, time and transaction, the contract, the event and
// its arguments, and who sent the transaction (from) and to what (to): the
// page names them by role where they hold one.
//
// From each vault's deployment (vault-deployments.json) onward, a budget of
// calls a chain a run, until every contract is read to the head; then each
// run reads what is new. A contract found later is read from the start.
//
//   node collect-vault-changes.js [--vault 0x...]

const fs = require('fs');
const path = require('path');
const { rpcEndpoints } = require('./rpc-endpoints.js');
const { CHAINS, CHAIN_OF_ID, MARKETS, pool } = require('./collect-vault-markets.js');
const { topic, selector } = require('./keccak.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'vault-changes.json');
const IPOR = path.join(ROOT, 'ipor-vaults.json');
const DEPLOYMENTS = path.join(ROOT, 'vault-deployments.json');
const FLOOR = 1000;                 // vaults above this TVL
const CALLS = 600;                  // per chain per run
const DEADLINE_MS = 9 * 60_000;
// Blocks an eth_getLogs asks for at first, a chain; it halves on a refusal
// (down to MIN_SPAN) and grows back on success.
const SPAN = { ethereum: 500_000, base: 2_000_000, arbitrum: 8_000_000 };
const MIN_SPAN = 2_000;

// ---- The events ---------------------------------------------------------------
// As the contracts declare them (names and indexed kept, for decoding).
const EVENT_SIGS = [
  // The vault (FusesLib, PlasmaVaultConfigLib, PlasmaVaultLib,
  // AssetDistributionProtectionLib, CallbackHandlerLib, PreHooksLib); the
  // rewards claim manager adds and removes its reward fuses with FusesLib too.
  'FuseAdded(address fuse)',
  'FuseRemoved(address fuse)',
  'BalanceFuseAdded(uint256 marketId, address fuse)',
  'BalanceFuseRemoved(uint256 marketId, address fuse)',
  'MarketSubstratesGranted(uint256 marketId, bytes32[] substrates)',
  'InstantWithdrawalFusesConfigured((address,bytes32[])[] fuses)',
  'PriceOracleMiddlewareChanged(address newPriceOracleMiddleware)',
  'PerformanceFeeDataConfigured(address feeAccount, uint256 feeInPercentage)',
  'ManagementFeeDataConfigured(address feeAccount, uint256 feeInPercentage)',
  'RewardsClaimManagerAddressChanged(address newRewardsClaimManagerAddress)',
  'DependencyBalanceGraphChanged(uint256 marketId, uint256[] newDependenceGraph)',
  'WithdrawManagerChanged(address newWithdrawManager)',
  'TotalSupplyCapChanged(uint256 newTotalSupplyCap)',
  'MarketsLimitsActivated()',
  'MarketsLimitsDeactivated()',
  'MarketLimitUpdated(uint256 marketId, uint256 newLimit)',
  'CallbackHandlerUpdated(address indexed handler, address indexed sender, bytes4 indexed sig)',
  'PreHookImplementationChanged(bytes4 indexed selector, address newImplementation, bytes32[] substrates)',
  // The access manager (OpenZeppelin's AccessManager, and IPOR's own).
  'RoleGranted(uint64 indexed roleId, address indexed account, uint32 delay, uint48 since, bool newMember)',
  'RoleRevoked(uint64 indexed roleId, address indexed account)',
  'RoleLabel(uint64 indexed roleId, string label)',
  'RoleAdminChanged(uint64 indexed roleId, uint64 indexed admin)',
  'RoleGuardianChanged(uint64 indexed roleId, uint64 indexed guardian)',
  'RoleGrantDelayChanged(uint64 indexed roleId, uint32 delay, uint48 since)',
  'TargetClosed(address indexed target, bool closed)',
  'TargetFunctionRoleUpdated(address indexed target, bytes4 selector, uint64 indexed roleId)',
  'TargetAdminDelayUpdated(address indexed target, uint32 delay, uint48 since)',
  'OperationScheduled(bytes32 indexed operationId, uint32 indexed nonce, uint48 schedule, address caller, address target, bytes data)',
  'OperationExecuted(bytes32 indexed operationId, uint32 indexed nonce)',
  'OperationCanceled(bytes32 indexed operationId, uint32 indexed nonce)',
  'RedemptionDelayUpdated(uint256 oldRedemptionDelayInSeconds, uint256 newRedemptionDelayInSeconds)',
  'MinimalExecutionDelayForRoleUpdated(uint64 roleId, uint256 delay)',
  // The fee manager.
  'PerformanceFeeUpdated(uint256 totalFee, address[] recipients, uint256[] fees)',
  'ManagementFeeUpdated(uint256 totalFee, address[] recipients, uint256[] fees)',
  'IporDaoFeeRecipientAddressChanged(address indexed newRecipient)',
  // The withdraw manager.
  'WithdrawWindowLengthUpdated(uint256 withdrawWindowLength)',
  'ReleaseFundsUpdated(uint32 releaseTimestamp, uint128 sharesToRelease)',
  'RequestFeeUpdated(uint256 fee)',
  'WithdrawFeeUpdated(uint256 fee)',
  // The rewards claim manager.
  'VestingTimeUpdated(uint256 vestingTime)',
  // The context manager.
  'TargetApproved(address indexed target)',
  'TargetRemoved(address indexed target)',
  // The vault's own price oracle (PriceOracleMiddleware, its manager).
  'AssetPriceSourceUpdated(address asset, address source)',
  'AssetPriceSourceAdded(address asset, address source)',
  'AssetPriceSourceRemoved(address asset)',
  'PriceValidationUpdated(address asset, uint256 maxPriceDelta)',
  'PriceValidationRemoved(address asset)',
  'PriceValidationBaselineUpdated(address asset, uint256 price)',
];
function parseEvent(sig) {
  const m = sig.match(/^(\w+)\((.*)\)$/);
  const params = [];
  let depth = 0, cur = '';
  for (const ch of m[2]) {
    if (ch === ',' && depth === 0) { params.push(cur.trim()); cur = ''; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  const args = params.map(p => {
    const parts = p.match(/^(\(.*\)(?:\[\])?|\S+)\s*(indexed)?\s*(\w*)$/);
    return { type: parts[1], indexed: !!parts[2], name: parts[3] || '' };
  });
  return { name: m[1], args, topic: topic(m[1] + '(' + args.map(a => a.type).join(',') + ')') };
}
const EVENTS = EVENT_SIGS.map(parseEvent);
const BY_TOPIC = new Map(EVENTS.map(e => [e.topic, e]));

// Roles (IPOR-Labs/ipor-fusion: libraries/Roles.sol): the system contracts
// hold these, so a grant of one names a contract that runs the vault.
const SYSTEM_ROLES = { 5: 'context', 6: 'withdraw', 400: 'fee', 500: 'fee', 601: 'rewards' };

// ---- ABI ------------------------------------------------------------------------
const strip = (h) => String(h || '0x').replace(/^0x/, '').toLowerCase();
const wordAt = (hex, byte) => hex.slice(byte * 2, byte * 2 + 64);
const num = (w) => Number(BigInt('0x' + (w || '0')));
function splitTuple(t) {
  const inner = t.slice(1, -1), out = [];
  let depth = 0, cur = '';
  for (const ch of inner) {
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const dynamic = (t) => t === 'bytes' || t === 'string' || t.endsWith('[]') || (t.startsWith('(') && splitTuple(t).some(dynamic));
const staticSize = (t) => (t.startsWith('(') ? splitTuple(t).reduce((s, x) => s + staticSize(x), 0) : 32);
function decodeTuple(types, hex, start) {
  const out = [];
  let head = start;
  for (const t of types) {
    out.push(dynamic(t) ? decodeValue(t, hex, start + num(wordAt(hex, head))) : decodeValue(t, hex, head));
    head += dynamic(t) ? 32 : staticSize(t);
  }
  return out;
}
function decodeValue(t, hex, at) {
  if (t.endsWith('[]')) return decodeTuple(Array(num(wordAt(hex, at))).fill(t.slice(0, -2)), hex, at + 32);
  if (t.startsWith('(')) return decodeTuple(splitTuple(t), hex, at);
  if (t === 'bytes' || t === 'string') {
    const n = num(wordAt(hex, at)), b = hex.slice((at + 32) * 2, (at + 32 + n) * 2);
    return t === 'string' ? Buffer.from(b, 'hex').toString('utf8') : '0x' + b;
  }
  const w = wordAt(hex, at);
  if (t === 'address') return '0x' + w.slice(24);
  if (t === 'bool') return /1$/.test(w);
  if (/^bytes\d+$/.test(t)) return '0x' + w.slice(0, Number(t.slice(5)) * 2);
  return BigInt('0x' + (w || '0')).toString();
}
// A log as { event, args } (null for one this file doesn't read).
function decodeLog(log) {
  const ev = BY_TOPIC.get(String(log.topics && log.topics[0]).toLowerCase());
  if (!ev) return null;
  const args = {}, data = strip(log.data);
  let t = 1;
  const plain = ev.args.filter(a => !a.indexed);
  const vals = plain.length ? decodeTuple(plain.map(a => a.type), data, 0) : [];
  for (const a of ev.args) {
    if (a.indexed) args[a.name] = decodeValue(a.type, strip(log.topics[t++]), 0);
    else args[a.name] = vals[plain.indexOf(a)];
  }
  return { event: ev.name, args };
}

// ---- RPC --------------------------------------------------------------------------
// One request, endpoint by endpoint (keyed ones first). Errors carry no URL:
// a keyed one carries its key.
function rpc(chain) {
  const urls = rpcEndpoints(chain, CHAINS[chain][1]);
  let calls = 0;
  const fn = async (method, params) => {
    calls++;
    const why = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25_000),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        if (j.error) {
          if (method === 'eth_call' && (j.error.code === 3 || /revert/i.test(j.error.message || ''))) return null;
          throw new Error(j.error.message || 'error');
        }
        return j.result;
      } catch (e) { why.push(String(e.message || e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 60)); }
    }
    throw new Error(`${chain}: every endpoint failed (${why.join('; ')})`);
  };
  fn.count = () => calls;
  return fn;
}
const hexBlock = (n) => '0x' + n.toString(16);
const call = async (req, to, data, block = 'latest') => {
  const r = await req('eth_call', [{ to, data }, typeof block === 'number' ? hexBlock(block) : block]);
  return r && r !== '0x' ? r : null;
};
const addrOf = (r) => (r && strip(r).length >= 64 ? '0x' + strip(r).slice(24, 64) : null);
const ZERO = '0x0000000000000000000000000000000000000000';
const SEL = {
  accessManager: selector('getAccessManagerAddress()'),
  authority: selector('authority()'),
  oracle: selector('getPriceOracleMiddleware()'),
  rewards: selector('getRewardsClaimManagerAddress()'),
  marketId: selector('MARKET_ID()'),
  asset: selector('asset()'),
  decimals: selector('decimals()'),
  toAssets: selector('convertToAssets(uint256)'),
};

// ---- One vault ----------------------------------------------------------------------
// v: its state (vault-changes.json's, or new); ctx: { req, head, span, budget, deadline }.
async function discover(req, a, v) {
  const got = async (sel) => { const x = addrOf(await call(req, a, sel)); return x && x !== ZERO ? x : null; };
  const access = (await got(SEL.accessManager)) || (await got(SEL.authority));
  const oracle = await got(SEL.oracle);
  const rewards = await got(SEL.rewards);
  const add = (x, kind) => { if (x && !v.contracts[x]) v.contracts[x] = { kind, scanned: v.deployBlock - 1 }; };
  add(a, 'vault'); add(access, 'access'); add(oracle, 'oracle'); add(rewards, 'rewards');
  if (v.assetDecimals == null) {
    const asset = await got(SEL.asset);
    const d = asset ? await call(req, asset, SEL.decimals) : null;
    v.assetDecimals = d ? num(strip(d)) : null;
  }
}
// What a change says about the contracts that run the vault: a contract named
// by a system role, or by the vault itself, is read too, from the start.
function learn(v, ch) {
  const add = (x, kind) => {
    x = String(x || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(x) || x === ZERO || v.contracts[x]) return;
    v.contracts[x] = { kind, scanned: v.deployBlock - 1 };
  };
  const kindOf = v.contracts[ch.contract] && v.contracts[ch.contract].kind;
  if (ch.event === 'RoleGranted' && kindOf === 'access' && SYSTEM_ROLES[ch.args.roleId]) add(ch.args.account, SYSTEM_ROLES[ch.args.roleId]);
  if (ch.event === 'WithdrawManagerChanged') add(ch.args.newWithdrawManager, 'withdraw');
  if (ch.event === 'RewardsClaimManagerAddressChanged') add(ch.args.newRewardsClaimManagerAddress, 'rewards');
  if (ch.event === 'PriceOracleMiddlewareChanged') add(ch.args.newPriceOracleMiddleware, 'oracle');
  if (/^(Fuse|BalanceFuse)(Added|Removed)$/.test(ch.event)) v.fuses[ch.args.fuse] = v.fuses[ch.args.fuse] === undefined ? null : v.fuses[ch.args.fuse];
}
// Reads every contract of a vault up to the head, or until the budget ends.
async function scan(ctx, a, v, shared) {
  const { req } = ctx;
  const topics = [EVENTS.map(e => e.topic)];
  const fresh = [];
  for (;;) {
    // The contracts furthest behind, read together while they are level.
    const open = Object.entries(v.contracts).filter(([x, c]) => c.scanned < ctx.head && !(c.kind === 'oracle' && shared.has(x)));
    if (!open.length) break;
    const from = Math.min(...open.map(([, c]) => c.scanned)) + 1;
    const group = open.filter(([, c]) => c.scanned + 1 === from).map(([x]) => x);
    const to = Math.min(ctx.head, from + ctx.span - 1);
    if (ctx.budget <= 0 || Date.now() > ctx.deadline) return { fresh, done: false };
    ctx.budget--;
    let logs;
    try {
      logs = await req('eth_getLogs', [{ address: group, topics, fromBlock: hexBlock(from), toBlock: hexBlock(to) }]);
    } catch (e) {
      if (ctx.span > MIN_SPAN) { ctx.span = Math.max(MIN_SPAN, Math.floor(ctx.span / 4)); continue; }
      throw e;
    }
    for (const log of logs || []) {
      const d = decodeLog(log);
      if (!d) continue;
      const ch = { block: parseInt(log.blockNumber, 16), index: parseInt(log.logIndex, 16), tx: log.transactionHash,
        contract: String(log.address).toLowerCase(), event: d.event, args: d.args };
      if (v.changes.some(c => c.tx === ch.tx && c.index === ch.index)) continue;
      v.changes.push(ch); fresh.push(ch);
      learn(v, ch);
    }
    for (const x of group) v.contracts[x].scanned = to;
    if ((logs || []).length < 200) ctx.span = Math.min(SPAN[ctx.chain] * 4, ctx.span * 2);
  }
  return { fresh, done: true };
}
// When each new change happened, who sent it and to what; the fuses named by
// their market; a supply cap in the vault's asset at its block.
async function enrich(ctx, a, v, fresh) {
  const { req } = ctx;
  const blocks = [...new Set(fresh.map(c => c.block))], txs = [...new Set(fresh.map(c => c.tx))];
  const times = {}, sent = {};
  await pool(blocks, 4, async (b) => { const blk = await req('eth_getBlockByNumber', [hexBlock(b), false]); times[b] = blk ? parseInt(blk.timestamp, 16) : null; });
  await pool(txs, 4, async (h) => { const t = await req('eth_getTransactionByHash', [h]); sent[h] = t ? { from: String(t.from).toLowerCase(), to: t.to ? String(t.to).toLowerCase() : null } : {}; });
  ctx.budget -= blocks.length + txs.length;
  for (const c of fresh) {
    c.ts = times[c.block] || null;
    Object.assign(c, sent[c.tx] || {});
    if (c.event === 'TotalSupplyCapChanged') {
      const r = await call(req, a, SEL.toAssets + BigInt(c.args.newTotalSupplyCap).toString(16).padStart(64, '0'), c.block).catch(() => null);
      if (r) c.args.capInAssets = BigInt('0x' + strip(r).slice(0, 64)).toString();
    }
  }
  const unnamed = Object.keys(v.fuses).filter(f => v.fuses[f] === null);
  await pool(unnamed, 4, async (f) => { const r = await call(req, f, SEL.marketId).catch(() => null); v.fuses[f] = r ? num(strip(r).slice(0, 64)) : 0; });
}

async function main({ out = OUT, ipor = IPOR, deployments = DEPLOYMENTS, only = null, now = Date.now(), connect = rpc } = {}) {
  const started = Date.now();
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const list = read(ipor);
  if (!list) { console.log('vault-changes.json: ipor-vaults.json unreadable; left as it was'); return; }
  const deploys = (read(deployments) || {}).deployments || {};
  const state = read(out) || { vaults: {} };
  const vaults = (list.vaults || []).filter(v => CHAIN_OF_ID[Number(v.chainId)] && (only ? v.address.toLowerCase() === only : v.tvl > FLOOR));
  const byChain = {};
  vaults.forEach(v => (byChain[CHAIN_OF_ID[Number(v.chainId)]] = byChain[CHAIN_OF_ID[Number(v.chainId)]] || []).push(v));
  let total = 0, behind = 0, failed = 0;
  await Promise.all(Object.entries(byChain).map(async ([chain, items]) => {
    const req = connect(chain);
    let head;
    try { head = parseInt(await req('eth_blockNumber', []), 16) - 3; }
    catch (e) { console.log(`::warning::vault-changes: ${chain}: no head (${String(e.message).slice(0, 80)})`); failed += items.length; return; }
    const ctx = { chain, req, head, span: SPAN[chain], budget: CALLS, deadline: started + DEADLINE_MS };
    // Least read first: a vault that has never been read before one up to date.
    const work = items.map(item => {
      const a = item.address.toLowerCase(), dep = deploys[a];
      const v = state.vaults[a] = state.vaults[a] || { chain, contracts: {}, fuses: {}, changes: [] };
      v.name = item.name;
      if (!v.deployBlock && dep && dep.block) v.deployBlock = dep.block;
      return { a, v };
    }).filter(w => w.v.deployBlock)
      .sort((x, y) => Math.min(...Object.values(x.v.contracts).map(c => c.scanned), Infinity) - Math.min(...Object.values(y.v.contracts).map(c => c.scanned), Infinity));
    for (const w of work) {
      try { if (!w.v.contracts[w.a]) await discover(req, w.a, w.v); }
      catch (e) { failed++; console.log(`::warning::vault-changes: ${w.v.name}: ${String(e.message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 100)}`); }
    }
    // An oracle many of this chain's vaults use isn't any one vault's history.
    const users = {};
    for (const { v } of work) for (const [x, c] of Object.entries(v.contracts)) if (c.kind === 'oracle') users[x] = (users[x] || 0) + 1;
    const shared = new Set(Object.keys(users).filter(x => users[x] > 1));
    for (const w of work) {
      if (!w.v.contracts[w.a]) continue;
      try {
        const { fresh, done } = await scan(ctx, w.a, w.v, shared);
        if (fresh.length) await enrich(ctx, w.a, w.v, fresh);
        total += fresh.length;
        if (!done) behind++;
        w.v.readAt = new Date(now).toISOString();
      } catch (e) {
        failed++;
        console.log(`::warning::vault-changes: ${w.v.name}: ${String(e.message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 100)}`);
      }
    }
    console.log(`  ${chain}: ${work.length} vaults, ${CALLS - ctx.budget} calls`);
  }));
  for (const v of Object.values(state.vaults)) v.changes.sort((x, y) => x.block - y.block || x.index - y.index);
  state.updatedAt = new Date(now).toISOString();
  fs.writeFileSync(out, JSON.stringify(state) + '\n');
  const all = Object.values(state.vaults).reduce((s, v) => s + v.changes.length, 0);
  console.log(`vault-changes.json: ${Object.keys(state.vaults).length} vaults, ${all} changes (${total} new this run); ${behind} still being read back${failed ? `, ${failed} unread` : ''}`);
}

if (require.main === module) {
  const i = process.argv.indexOf('--vault');
  main({ only: i > 0 ? String(process.argv[i + 1] || '').toLowerCase() : null })
    .catch(e => { console.log('::error::vault-changes: ' + String(e.message || e).replace(/https?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
}
module.exports = { main, decodeLog, parseEvent, EVENTS, SYSTEM_ROLES, learn };
