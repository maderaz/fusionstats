'use strict';
// describe-changes.js — a vault's governance changes (vault-changes.json, by
// collect-vault-changes.js) as rows a person reads, for the Explorer's
// Curator Action History: what happened, on which of the contracts that run
// the vault, who did it and in what role.
//
//   describeVault(state, { deployedAt }) -> rows, newest first:
//     { t, d, what, detail, on, by, role, via, tx }
//   t  when (unix seconds); d 1 when made at the vault's deployment, in its
//      deployment block (the factory's set-up: roles, fuses, fees), whose
//      moment it carries
//   by the address that sent the transaction, or the contract with a role it
//      went through (a Safe), the sender then being via; role, its roles in
//      the vault's access manager at the time
//
// Changes of one kind in one transaction are one row ("Roles granted:
// Atomist to 0x…, Alpha to 0x…"), as a set-up grants dozens at once.

const { selector } = require('../keccak.js');
const { MARKETS } = require('../collect-vault-markets.js');

// IPOR-Labs/ipor-fusion: contracts/libraries/Roles.sol.
const ROLES = {
  0: 'Admin', 1: 'Owner', 2: 'Guardian', 3: 'Tech: vault', 4: 'IPOR DAO', 5: 'Tech: context manager',
  6: 'Tech: withdraw manager', 7: 'Tech: share transfers', 100: 'Atomist', 200: 'Alpha', 300: 'Fuse manager',
  301: 'Pre-hooks manager', 400: 'Tech: performance fee', 500: 'Tech: management fee', 600: 'Claim rewards',
  601: 'Tech: rewards claim manager', 700: 'Transfer rewards', 800: 'Whitelist', 900: 'Instant withdrawal fuses',
  901: 'Withdraw request fee', 902: 'Withdraw fee', 1000: 'Update balances', 1100: 'Update rewards balance',
  1200: 'Price oracle manager', '18446744073709551615': 'Public',
};
const roleName = (id) => ROLES[String(id)] || 'Role ' + id;
// Which of an address's roles to name first: the one that governs most.
const PRIORITY = ['100', '1', '0', '2', '200', '300', '4', '301', '1200', '900', '600', '700', '800', '1000', '1100'];

// The functions an access manager's rules name, by selector.
const FUNCTIONS = [
  'deposit(uint256,address)', 'mint(uint256,address)', 'withdraw(uint256,address,address)', 'redeem(uint256,address,address)',
  'redeemFromRequest(uint256,address,address)', 'depositWithPermit(uint256,address,uint256,uint8,bytes32,bytes32)',
  'transfer(address,uint256)', 'transferFrom(address,address,uint256)', 'execute((address,bytes)[])',
  'claimRewards((address,bytes)[])', 'updateMarketsBalances(uint256[])', 'addFuses(address[])', 'removeFuses(address[])',
  'addBalanceFuse(uint256,address)', 'removeBalanceFuse(uint256,address)', 'grantMarketSubstrates(uint256,bytes32[])',
  'configureInstantWithdrawalFuses((address,bytes32[])[])', 'setPriceOracleMiddleware(address)',
  'configurePerformanceFee(address,uint256)', 'configureManagementFee(address,uint256)',
  'setRewardsClaimManagerAddress(address)', 'setTotalSupplyCap(uint256)', 'setupMarketsLimits((uint256,uint256)[])',
  'activateMarketsLimits()', 'deactivateMarketsLimits()', 'updateDependencyBalanceGraphs(uint256[],uint256[][])',
  'updateCallbackHandler(address,address,bytes4)', 'convertToPublicVault()', 'enableTransferShares()',
  'setMinimalExecutionDelaysForRoles(uint64[],uint256[])', 'setRedemptionDelay(uint256)', 'addRewardFuses(address[])',
  'removeRewardFuses(address[])', 'setupVestingTime(uint256)', 'transferVestedTokensToVault()', 'updateBalance()',
  'requestShares(uint256)', 'releaseFunds(uint256,uint256)', 'updateWithdrawWindow(uint256)', 'updateRequestFee(uint256)',
  'updateWithdrawFee(uint256)', 'updateHighWaterMark()', 'harvestAllFees()', 'updatePerformanceFee(uint256)',
  'updateManagementFee(uint256)', 'setIporDaoFeeRecipientAddress(address)', 'addApprovedTargets(address[])',
  'removeApprovedTargets(address[])', 'setAssetsPricesSources(address[],address[])',
];
const FN = Object.fromEntries(FUNCTIONS.map(s => [selector(s), s.slice(0, s.indexOf('('))]));
const fnName = (sel) => FN[String(sel).toLowerCase()] || String(sel);

const CONTRACT = { vault: 'Vault', access: 'Access manager', fee: 'Fee manager', withdraw: 'Withdraw manager',
  rewards: 'Rewards manager', context: 'Context manager', oracle: 'Price oracle' };
const marketName = (id) => (MARKETS[Number(id)] ? MARKETS[Number(id)][1] : 'market ' + id);
const short = (a) => (/^0x[0-9a-fA-F]{40}$/.test(String(a)) ? a.slice(0, 6) + '…' + a.slice(-4) : String(a));
const num = (v) => Number(v);
const pct = (bps) => +(num(bps) / 100).toFixed(2) + '%';                                  // 10000 = 100%
const pct18 = (v) => { try { return +(Number(BigInt(v) * 100000n / 10n ** 18n) / 1000).toFixed(3) + '%'; } catch { return String(v); } };
function dur(s) {
  s = num(s);
  if (!s) return 'none';
  const u = [[86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']].find(([n]) => s >= n && s % n === 0) || [1, 'second'];
  const n = s / u[0];
  return n + ' ' + u[1] + (n === 1 ? '' : 's');
}
function amount(raw, decimals) {
  try {
    const d = 10n ** BigInt(decimals == null ? 18 : decimals), b = BigInt(raw);
    const v = Number(b / d) + Number(b % d) / Number(d);
    return v >= 1e15 ? 'no limit' : v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 4 : 0 });
  } catch { return String(raw); }
}

// One change: [what, detail]; grouped changes join their details.
const ONE = {
  FuseAdded: (a, x) => ['Fuse added', x.fuse(a.fuse)],
  FuseRemoved: (a, x) => ['Fuse removed', x.fuse(a.fuse)],
  BalanceFuseAdded: (a) => ['Balance fuse added', marketName(a.marketId) + ' · ' + short(a.fuse)],
  BalanceFuseRemoved: (a) => ['Balance fuse removed', marketName(a.marketId) + ' · ' + short(a.fuse)],
  MarketSubstratesGranted: (a) => ['Market access set', marketName(a.marketId) + ': ' + a.substrates.length + ' substrate' + (a.substrates.length === 1 ? '' : 's')],
  InstantWithdrawalFusesConfigured: (a) => ['Instant withdrawal order set', a.fuses.length + ' fuse' + (a.fuses.length === 1 ? '' : 's')],
  PriceOracleMiddlewareChanged: (a) => ['Price oracle changed', short(a.newPriceOracleMiddleware)],
  PerformanceFeeDataConfigured: (a) => ['Performance fee set', pct(a.feeInPercentage) + ' to ' + short(a.feeAccount)],
  ManagementFeeDataConfigured: (a) => ['Management fee set', pct(a.feeInPercentage) + ' to ' + short(a.feeAccount)],
  RewardsClaimManagerAddressChanged: (a) => ['Rewards manager changed', short(a.newRewardsClaimManagerAddress)],
  DependencyBalanceGraphChanged: (a) => ['Market dependencies set', marketName(a.marketId) + (a.newDependenceGraph.length ? ' → ' + a.newDependenceGraph.map(marketName).join(', ') : ': none')],
  WithdrawManagerChanged: (a) => ['Withdraw manager changed', short(a.newWithdrawManager)],
  TotalSupplyCapChanged: (a, x) => ['Supply cap set', a.capInAssets != null ? amount(a.capInAssets, x.decimals) + (x.symbol ? ' ' + x.symbol : '') : amount(a.newTotalSupplyCap, (x.decimals || 18) + 2) + ' shares'],
  MarketsLimitsActivated: () => ['Market limits on', ''],
  MarketsLimitsDeactivated: () => ['Market limits off', ''],
  MarketLimitUpdated: (a) => ['Market limit set', marketName(a.marketId) + ': ' + (BigInt(a.newLimit) >= 10n ** 18n ? 'no limit' : pct18(a.newLimit) + ' of the vault')],
  CallbackHandlerUpdated: (a) => ['Callback handler set', fnName(a.sig) + ' → ' + short(a.handler)],
  PreHookImplementationChanged: (a) => ['Pre-hook set', fnName(a.selector) + (/^0x0{40}$/.test(a.newImplementation) ? ': removed' : ' → ' + short(a.newImplementation))],
  RoleGranted: (a) => ['Role granted', roleName(a.roleId) + ' to ' + short(a.account) + (num(a.delay) ? ' (' + dur(a.delay) + ' delay)' : '')],
  RoleRevoked: (a) => ['Role revoked', roleName(a.roleId) + ' from ' + short(a.account)],
  RoleLabel: (a) => ['Role named', roleName(a.roleId) + ': "' + a.label + '"'],
  RoleAdminChanged: (a) => ['Role admin set', roleName(a.roleId) + ' managed by ' + roleName(a.admin)],
  RoleGuardianChanged: (a) => ['Role guardian set', roleName(a.roleId) + ' guarded by ' + roleName(a.guardian)],
  RoleGrantDelayChanged: (a) => ['Role grant delay set', roleName(a.roleId) + ': ' + dur(a.delay)],
  TargetClosed: (a, x) => [a.closed ? 'Contract closed' : 'Contract reopened', x.label(a.target)],
  TargetFunctionRoleUpdated: (a, x) => ['Function access set', fnName(a.selector) + ' → ' + roleName(a.roleId) + (x.label(a.target) !== 'Vault' ? ' (' + x.label(a.target) + ')' : '')],
  TargetAdminDelayUpdated: (a, x) => ['Admin delay set', x.label(a.target) + ': ' + dur(a.delay)],
  OperationScheduled: (a, x) => ['Timelocked call scheduled', x.label(a.target) + ', runs ' + new Date(num(a.schedule) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
  OperationExecuted: () => ['Timelocked call executed', ''],
  OperationCanceled: () => ['Timelocked call cancelled', ''],
  RedemptionDelayUpdated: (a) => ['Redemption delay set', dur(a.oldRedemptionDelayInSeconds) + ' → ' + dur(a.newRedemptionDelayInSeconds)],
  MinimalExecutionDelayForRoleUpdated: (a) => ['Execution delay set', roleName(a.roleId) + ': ' + dur(a.delay)],
  PerformanceFeeUpdated: (a) => ['Performance fee split', pct(a.totalFee) + ' in all, ' + a.recipients.length + ' recipient' + (a.recipients.length === 1 ? '' : 's')],
  ManagementFeeUpdated: (a) => ['Management fee split', pct(a.totalFee) + ' in all, ' + a.recipients.length + ' recipient' + (a.recipients.length === 1 ? '' : 's')],
  IporDaoFeeRecipientAddressChanged: (a) => ['DAO fee recipient changed', short(a.newRecipient)],
  WithdrawWindowLengthUpdated: (a) => ['Withdraw window set', dur(a.withdrawWindowLength)],
  ReleaseFundsUpdated: (a, x) => ['Withdrawals released', amount(a.sharesToRelease, (x.decimals || 18) + 2) + ' shares'],
  RequestFeeUpdated: (a) => ['Withdraw request fee set', pct18(a.fee)],
  WithdrawFeeUpdated: (a) => ['Withdraw fee set', pct18(a.fee)],
  VestingTimeUpdated: (a) => ['Rewards vesting set', dur(a.vestingTime)],
  TargetApproved: (a) => ['Context target approved', short(a.target)],
  TargetRemoved: (a) => ['Context target removed', short(a.target)],
  AssetPriceSourceUpdated: (a) => ['Price source set', short(a.asset) + ' → ' + short(a.source)],
  AssetPriceSourceAdded: (a) => ['Price source added', short(a.asset) + ' → ' + short(a.source)],
  AssetPriceSourceRemoved: (a) => ['Price source removed', short(a.asset)],
  PriceValidationUpdated: (a) => ['Price check set', short(a.asset) + ': within ' + pct18(a.maxPriceDelta)],
  PriceValidationRemoved: (a) => ['Price check removed', short(a.asset)],
  PriceValidationBaselineUpdated: (a) => ['Price check baseline set', short(a.asset)],
};
// The plural a grouped row takes.
const MANY = { 'Role granted': 'Roles granted', 'Role revoked': 'Roles revoked', 'Fuse added': 'Fuses added', 'Fuse removed': 'Fuses removed',
  'Function access set': 'Function access set', 'Market access set': 'Market access set', 'Market limit set': 'Market limits set',
  'Balance fuse added': 'Balance fuses added', 'Role named': 'Roles named', 'Role admin set': 'Role admins set',
  'Market dependencies set': 'Market dependencies set', 'Price source set': 'Price sources set', 'Price source added': 'Price sources added' };
const SHOWN = 6;

function describeVault(v, opts = {}) {
  if (!v || !Array.isArray(v.changes)) return [];
  const contracts = v.contracts || {};
  const kindOf = (a) => (contracts[String(a).toLowerCase()] || {}).kind;
  const ctx = {
    decimals: v.assetDecimals, symbol: opts.symbol || null,
    label: (a) => CONTRACT[kindOf(a)] || short(a),
    fuse: (f) => { const id = (v.fuses || {})[String(f).toLowerCase()] ?? (v.fuses || {})[f]; return (id ? marketName(id) + ' · ' : '') + short(f); },
  };
  // Who holds which role, as the access manager's grants and revocations go.
  const members = new Map();
  // An address's roles, the one that governs most first.
  const rank = (id) => { const i = PRIORITY.indexOf(String(id)); return i < 0 ? 100 + Number(id) / 1e6 : i; };
  const rolesOf = (a) => [...(members.get(String(a || '').toLowerCase()) || [])].sort((x, y) => rank(x) - rank(y)).map(roleName);
  const changes = v.changes.slice().sort((x, y) => x.block - y.block || x.index - y.index);
  const rows = [];
  let last = null;
  for (const ch of changes) {
    const fn = ONE[ch.event];
    if (!fn) continue;
    let what, detail;
    try { [what, detail] = fn(ch.args || {}, ctx); } catch { what = ch.event; detail = ''; }
    const atDeploy = !!(v.deployBlock && ch.block === v.deployBlock);
    // The actor, before this change takes effect: the contract the
    // transaction went to when it holds a role (a Safe calling the vault),
    // its signer then being via; else whoever sent it.
    let by = ch.from || null, role = rolesOf(by), via = null;
    if (ch.to && ch.to !== ch.contract && rolesOf(ch.to).length) { via = by; by = ch.to; role = rolesOf(ch.to); }
    if (!role.length && atDeploy) role = ['Deployer'];
    if (last && last.tx === ch.tx && last.event === ch.event) {
      last.items.push(detail);
    } else {
      last = { t: atDeploy && opts.deployedAt ? opts.deployedAt : ch.ts || null, d: atDeploy ? 1 : 0, what, items: [detail],
        on: ctx.label(ch.contract), by, role: role[0] || '', roles: role.slice(1), via, tx: ch.tx, event: ch.event };
      rows.push(last);
    }
    if (kindOf(ch.contract) === 'access') {
      const acct = String((ch.args || {}).account || '').toLowerCase();
      if (ch.event === 'RoleGranted') (members.get(acct) || members.set(acct, new Set()).get(acct)).add(String(ch.args.roleId));
      if (ch.event === 'RoleRevoked' && members.has(acct)) members.get(acct).delete(String(ch.args.roleId));
    }
  }
  return rows.map(r => {
    const items = r.items.filter(Boolean);
    const what = items.length > 1 ? (MANY[r.what] || r.what) : r.what;
    const detail = items.slice(0, SHOWN).join('; ') + (items.length > SHOWN ? '; and ' + (items.length - SHOWN) + ' more' : '');
    const out = { t: r.t, d: r.d, what, detail, on: r.on, by: r.by, role: r.role, tx: r.tx };
    if (r.roles.length) out.also = r.roles;
    if (items.length > 1) out.n = items.length;
    if (r.via) out.via = r.via;
    return out;
  }).reverse();
}

module.exports = { describeVault, roleName, fnName, ROLES };
