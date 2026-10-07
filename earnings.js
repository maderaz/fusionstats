// earnings.js — what the IPOR DAO and the vaults' curators earn in a year at
// today's TVL and APY: Key Metrics' DAO and Curator earnings and the Finances
// pages' "Annualized", one formula in one place (window.FusionEarnings).
//
// Per vault above $10K: the DAO's share of the management fee, on the TVL,
// and its share of the performance fee, on the yield before fees; a
// curator, the rest of each fee. IPOR's APY is what depositors keep, so the
// yield before fees is (APY + management fee) / (1 - performance fee); a
// vault losing money pays no performance fee. The fee terms are each
// vault's own, read on-chain (dao-fees.json); TVL and APY are IPOR's
// (ipor-vaults.json), already in dollars. A vault paying the DAO's treasury
// directly leaves its curator nothing.
//
//   FusionEarnings.annualized(vaults, fees)
//     vaults  ipor-vaults.json's vaults ({ address, tvl, apy })
//     fees    dao-fees.json's vaults (address → { perf, mgmt, daoPerf, daoMgmt })
//   → { dao: { mgmt, perf, total }, curator: { mgmt, perf, total }, count, missing }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FusionEarnings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FLOOR = 10000;

  function annualized(vaults, fees) {
    const dao = { mgmt: 0, perf: 0 }, cur = { mgmt: 0, perf: 0 };
    let count = 0, missing = 0;
    for (const v of vaults || []) {
      if (!(v.tvl > FLOOR)) continue;
      const f = (fees || {})[String(v.address).toLowerCase()];
      if (!f || f.daoMgmt == null || f.daoPerf == null) { missing++; continue; }
      const net = Number(v.apy) / 100;
      const gross = net > 0 ? (net + f.mgmt / 100) / (1 - f.perf / 100) : 0;
      dao.mgmt += v.tvl * f.daoMgmt / 100;
      dao.perf += v.tvl * gross * f.daoPerf / 100;
      cur.mgmt += v.tvl * Math.max(0, f.mgmt - f.daoMgmt) / 100;
      cur.perf += v.tvl * gross * Math.max(0, f.perf - f.daoPerf) / 100;
      count++;
    }
    return { dao: Object.assign(dao, { total: dao.mgmt + dao.perf }), curator: Object.assign(cur, { total: cur.mgmt + cur.perf }), count, missing };
  }

  return { annualized, FLOOR };
});
