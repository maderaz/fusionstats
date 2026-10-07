// rebalance-flows.js — what a curator's rebalance moved, read from its token
// transfers (collect-rebalances.js). One copy of the rules, run in two places:
// the Address page (window.RebalanceFlows), and tools/build-explorer.js
// (require), which writes each vault's Curator Action History for the
// Explorer.
//
//   classify(flow)        { protocol, kind } from the token's symbol, with the
//                         latest rules (a scan's own labels can be older)
//   prepare(rebalances)   each flow classified, and a receipt token the price
//                         feed didn't price valued at the other side's sum
//   summarize(r)          { volume, moves }: what the transaction moved, the
//                         larger of what left and what came in (a move counted
//                         once, not twice), and its moves, a market's by its
//                         protocol (Aave) and a token's by its symbol (cbETH),
//                         on its side: out of the vault, or into it
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RebalanceFlows = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // First match wins: a protocol's receipt tokens before the generic stable
  // or staked tokens they wrap (sUSDe is Ethena's, not Spark's).
  const RULES = [
    { match: (s, n) => /^sp[A-Za-z]/.test(s) || /^(sDAI|sUSDS)$/i.test(s) || /spark/i.test(n) || /^variableDebtSp/i.test(s) || /^stableDebtSp/i.test(s), protocol: 'Spark', kind: 'lending' },
    { match: (s, n) => /^a(?:Eth|Base|Arb|Prime|Avax|Opt|Pol|Sonic)?[A-Z]/.test(s) || /aave/i.test(n) || /^variableDebt[A-Z]/.test(s) || /^stableDebt[A-Z]/.test(s), protocol: 'Aave', kind: 'lending' },
    { match: (s, n) => /^c[A-Z].*[Vv]3$/.test(s) || /compound/i.test(n), protocol: 'Compound', kind: 'lending' },
    { match: (s, n) => /^(PT|YT|SY|LP)-/i.test(s) || /pendle/i.test(n), protocol: 'Pendle', kind: 'yield' },
    // Euler V2's vault tokens: "ecbETH-1", "eUSDC-3".
    { match: (s, n) => /^evk-/i.test(s) || /^e[A-Z][a-zA-Z]+(V?2|Vault)$/.test(s) || /^e[A-Za-z][A-Za-z0-9.]*-\d+$/.test(s) || /euler/i.test(n), protocol: 'Euler', kind: 'lending' },
    { match: (s, n) => /morpho|metamorpho/i.test(n)
        || /steakhouse|gauntlet|re7\b|smokehouse|hyperithm|llamarisk|mev capital|block analitica|9summits|apostro|tulipa|hakutora|b\.protocol|index coop|usual\b/i.test(n)
        || /^(stk|gtl|re7|smk|hkt)[A-Z]/.test(s), protocol: 'Morpho', kind: 'lending' },
    { match: (s, n) => /^(USDe|sUSDe|ENA)$/i.test(s) || /ethena/i.test(n), protocol: 'Ethena', kind: 'collateral' },
    { match: (s) => /^(stETH|wstETH|weETH|eETH|ETHx|rETH|cbETH|swETH|frxETH|sfrxETH|mETH|osETH|rswETH|ezETH|pufETH)$/i.test(s), protocol: 'LST', kind: 'collateral' },
    { match: (s) => /^(WBTC|cbBTC|tBTC|LBTC|FBTC|solvBTC)$/i.test(s), protocol: 'BTC', kind: 'collateral' },
    { match: (s) => /^(USDC|USDT|DAI|crvUSD|GHO|USDS|FRAX|LUSD|PYUSD|FDUSD|TUSD|USDP|sFRAX)$/i.test(s), protocol: 'Stable', kind: 'collateral' },
  ];

  // The token's name isn't kept with a flow: rules on a name don't fire here.
  function classify(f) {
    const sym = (f && f.symbol) || '';
    for (const r of RULES) if (r.match(sym, '')) return { protocol: r.protocol, kind: r.kind };
    return { protocol: 'Unknown', kind: 'unknown' };
  }

  function prepare(rebalances) {
    for (const r of rebalances || []) {
      const flows = r.flows || [];
      for (const f of flows) Object.assign(f, classify(f));
      const sumOut = flows.filter(f => f.direction === 'out' && f.usdValue != null).reduce((a, f) => a + f.usdValue, 0);
      const sumIn = flows.filter(f => f.direction === 'in' && f.usdValue != null).reduce((a, f) => a + f.usdValue, 0);
      for (const f of flows) {
        if (f.usdValue != null || f.kind === 'unknown') continue;
        const proxy = f.direction === 'out' ? sumIn : sumOut;
        if (proxy > 0) { f.usdValue = Math.round(proxy * 100) / 100; f.usdInferred = true; }
      }
    }
    return rebalances;
  }

  function summarize(r) {
    let out = 0, inn = 0;
    const by = new Map();
    for (const f of (r && r.flows) || []) {
      if (f.kind === 'unknown' || !f.usdValue) continue;
      const usd = Math.abs(f.usdValue);
      if (f.direction === 'out') out += usd; else inn += usd;
      const k = (f.kind === 'collateral' ? f.symbol || f.protocol : f.protocol) + '|' + f.direction;
      by.set(k, (by.get(k) || 0) + usd);
    }
    const moves = [...by.entries()].map(([k, usd]) => {
      const [label, direction] = k.split('|');
      return { label, direction, usd };
    }).sort((a, b) => b.usd - a.usd);
    return { volume: Math.max(out, inn), moves };
  }

  return { RULES, classify, prepare, summarize };
});
