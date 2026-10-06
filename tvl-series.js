// tvl-series.js — total value locked per network per day, from the vaults'
// on-chain snapshots. One copy of the rules, run in two places: the TVL page
// (window.TvlSeries), and tools/build-tvl-daily.js (require), which writes the
// result to tvl-daily.json so the page need not download every snapshot of
// every vault (11 MB) to draw it.
//
//   buildSeries({ vaults, snapshots, anchorTs })
//     vaults     ipor-vaults.json's vaults (address, chain, tvl)
//     snapshots  tvl-snapshots.json's vaults (address → { snapshots })
//     anchorTs   ipor-vaults.json's updatedAt, in seconds: the right edge
//   → { perChain: { chain: [{ day, tvl }] }, currentByChain, anchorDay, minDay }
//
//   pack(series) / unpack(file)   the compact form tvl-daily.json stores
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TvlSeries = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY_SEC = 86400;
  const DAY_MS = DAY_SEC * 1000;
  // Sanity bounds for a snapshot's tvlUsd. HARD_CAP catches catastrophic
  // decimals/price parse errors (a vault cached with the wrong decimals can
  // read 1e9–1e12). On top of that, per vault we reject points above 50× the
  // vault's own non-zero median — this kills decimals glitches (e.g. a stray
  // $1.1B "Tanken WETH" point whose median is ~$0) while preserving genuine
  // historical highs (e.g. Reservoir ETH Yield really held ~$16M for weeks).
  const HARD_CAP = 2e9;
  // Days-since-epoch floor for a believable data point (2021-01-01).
  const MIN_VALID_DAY = Math.floor(Date.UTC(2021, 0, 1) / DAY_MS);

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Real per-vault daily TVL from on-chain snapshots: drop bad points, then
  // forward-fill from the vault's first snapshot to anchorDay. Returns a
  // Map(day -> tvlUsd), or null if the vault has no usable snapshot.
  function vaultDailySnapshots(snap) {
    const pts = (snap.snapshots || [])
      .filter(s => typeof s.tvlUsd === 'number' && s.tvlUsd >= 0 && s.tvlUsd < HARD_CAP)
      .map(s => ({ day: s.day != null ? s.day : Math.floor(s.timestamp / DAY_SEC), tvl: s.tvlUsd }))
      // A handful of snapshots carry day 0 because their block timestamp never
      // resolved. Forward-filling from 1970 stretched the axis across five
      // decades, and bucketing smeared those points into a phantom bar around
      // Jan 1971. Fusion did not exist before 2021, so anything older is bad
      // data, not history.
      .filter(s => s.day >= MIN_VALID_DAY);
    if (!pts.length) return null;
    const cap = Math.max(median(pts.map(p => p.tvl).filter(x => x > 0)) * 50, 1e6);
    const kept = pts.filter(p => p.tvl <= cap).sort((a, b) => a.day - b.day);
    if (!kept.length) return null;
    const byDay = new Map();
    for (const p of kept) byDay.set(p.day, p.tvl); // last write per day wins
    return byDay;
  }

  // Historical TVL comes from the real on-chain snapshot time-series, summed
  // per chain per day. The right edge (anchorDay) equals the per-vault values
  // the stat card sums, so chart and "Total TVL" agree exactly.
  function buildSeries({ vaults, snapshots, anchorTs }) {
    const anchorDay = Math.floor(anchorTs / DAY_SEC);
    const chainByAddr = {};
    for (const v of vaults) chainByAddr[(v.address || '').toLowerCase()] = v.chain || 'ethereum';

    const perChainDaily = {}; // chain -> Map(day -> tvl)
    const addDay = (c, d, val) => {
      let m = perChainDaily[c];
      if (!m) { m = new Map(); perChainDaily[c] = m; }
      m.set(d, (m.get(d) || 0) + val);
    };

    // 1) Snapshot-covered vaults: forward-fill their real history.
    const covered = new Set();
    let minDay = anchorDay;
    for (const [addr, snap] of Object.entries(snapshots || {})) {
      const byDay = vaultDailySnapshots(snap);
      if (!byDay) continue;
      covered.add(addr.toLowerCase());
      const days = [...byDay.keys()].sort((a, b) => a - b);
      if (days[0] < minDay) minDay = days[0];
      const c = chainByAddr[addr.toLowerCase()] || 'ethereum';
      let i = 0, cur = byDay.get(days[0]);
      for (let d = days[0]; d <= anchorDay; d++) {
        while (i < days.length && days[i] <= d) { cur = byDay.get(days[i]); i++; }
        addDay(c, d, cur);
      }
    }

    // 2) Vaults the snapshot indexer hasn't reached yet (small, newer): no
    //    history available, so hold their API tvl flat across the window.
    for (const v of vaults) {
      const a = (v.address || '').toLowerCase();
      if (covered.has(a) || !(v.tvl > 0)) continue;
      const c = v.chain || 'ethereum';
      for (let d = minDay; d <= anchorDay; d++) addDay(c, d, v.tvl);
    }

    // 3) Densify into the {day,tvl}[] shape the chart functions expect.
    const perChain = {};
    const currentByChain = {};
    for (const [c, m] of Object.entries(perChainDaily)) {
      const points = [];
      let last = 0;
      for (let d = minDay; d <= anchorDay; d++) {
        last = m.has(d) ? m.get(d) : last;
        points.push({ day: d, tvl: last });
      }
      perChain[c] = points;
      currentByChain[c] = m.get(anchorDay) || 0;
    }

    return { perChain, currentByChain, anchorDay, minDay };
  }

  // tvl-daily.json: each chain's daily values from minDay to anchorDay, as
  // bare numbers (the day is minDay plus the index), and the right edge.
  function pack(series, extra) {
    const perChain = {};
    for (const [c, pts] of Object.entries(series.perChain)) perChain[c] = pts.map(p => p.tvl);
    return Object.assign({ anchorDay: series.anchorDay, minDay: series.minDay, currentByChain: series.currentByChain, perChain }, extra || {});
  }
  function unpack(file) {
    const perChain = {};
    for (const [c, vals] of Object.entries(file.perChain || {})) perChain[c] = vals.map((tvl, i) => ({ day: file.minDay + i, tvl }));
    return { perChain, currentByChain: file.currentByChain || {}, anchorDay: file.anchorDay, minDay: file.minDay };
  }

  return { buildSeries, vaultDailySnapshots, median, pack, unpack, HARD_CAP, MIN_VALID_DAY, DAY_SEC, DAY_MS };
});
