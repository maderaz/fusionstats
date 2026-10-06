// share-price.js — each vault's share price over a window, as the Share-Price
// Monitor shows it. One copy of the rules, run in two places: the Monitor
// (window.SharePrice), and tools/build-share-prices.js (require), which writes
// every window's rows to share-prices.json so the page need not download
// every snapshot of every vault (tvl-snapshots.json, 11 MB) to draw them.
//
//   rows(vaults, windowDays)
//     vaults      tvl-snapshots.json's vaults (address → { symbol, chain, snapshots })
//     windowDays  7, 30, 90, or 0 for all of it
//   → [{ addr, name, symbol, chain, vals, winFirst, latest, deltaPct, apyPct,
//        dataFlag, firstTs, lastTs }]
//
//   pack(row) / unpack(packed)   the compact form share-prices.json stores:
//     the numbers as they are, the sparkline as at most SPARK_MAX heights
//     from 0 to 1000 (its shape, bucket by bucket with each bucket's low and
//     high), and which way the last move went (mom: 1, -1 or 0)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SharePrice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SPARK_MAX = 120;

  function rows(vaults, windowDays) {
    const out = [];
    for (const [addr, v] of Object.entries(vaults || {})) {
      const ser = (v.snapshots || [])
        .filter(s => typeof s.sharePrice === 'number' && s.day != null && typeof s.timestamp === 'number')
        .sort((a, b) => a.timestamp - b.timestamp);
      // The window: the points whose day (UNIX days) is within the last N
      // calendar days of the vault's own latest point. By day, not by count:
      // the collector samples several times a day, and "the last 7 points"
      // would be a few hours. 0 keeps the whole series.
      let winPts;
      if (windowDays > 0 && ser.length) {
        const maxDay = ser[ser.length - 1].day;
        winPts = ser.filter(s => s.day >= maxDay - windowDays + 1);
      } else {
        winPts = ser.slice();
      }
      const win = winPts.map(s => s.sharePrice);

      // A yield vault's share price lives near 1.0 and drifts slowly.
      // Readings outside [0.1, 100] are scaling artifacts (some historical
      // snapshots are off by 100x): dropped, so one bad point cannot make a
      // +9927% "gain".
      const cleanPts = winPts.filter(p => p.sharePrice >= 0.1 && p.sharePrice <= 100);
      const clean = cleanPts.map(p => p.sharePrice);

      let deltaPct = null, dataFlag = null, vals = clean;
      let apyPct = null;
      let firstTs = null, lastTs = null;
      if (clean.length >= 2) {
        deltaPct = (clean[clean.length - 1] / clean[0] - 1) * 100;
        // Annualised over the seconds actually elapsed between the first and
        // last trusted points, and only past ~12 hours of them: intra-day
        // noise annualised reads as 50000%.
        firstTs = cleanPts[0].timestamp;
        lastTs = cleanPts[cleanPts.length - 1].timestamp;
        const daysSpan = (lastTs - firstTs) / 86400;
        const r = clean[clean.length - 1] / clean[0];
        if (r > 0 && daysSpan >= 0.5) apyPct = (Math.pow(r, 365 / daysSpan) - 1) * 100;
        // A jump left after filtering, or an implausible size: flagged.
        let maxJump = 1;
        for (let i = 1; i < clean.length; i++) {
          const rr = clean[i] > 0 && clean[i - 1] > 0 ? Math.max(clean[i] / clean[i - 1], clean[i - 1] / clean[i]) : Infinity;
          if (rr > maxJump) maxJump = rr;
        }
        if (Math.abs(deltaPct) > 300 || maxJump > 3) dataFlag = 'anomaly';
      } else if (win.length >= 2) {
        // There were points, all implausible: a data glitch, not a number.
        dataFlag = 'glitch';
        vals = win;   // the raw shape, so the issue shows
      }
      const winFirst = clean.length >= 2 ? clean[0] : null;
      const winLast = clean.length ? clean[clean.length - 1] : (win.length ? win[win.length - 1] : null);
      const lastPointTs = winPts.length ? winPts[winPts.length - 1].timestamp : null;
      out.push({
        addr, name: v.symbol ? (v.symbol + ' vault') : addr.slice(0, 10),
        symbol: v.symbol || '?',
        chain: v.chain || 'unknown',
        vals, winFirst, latest: winLast, deltaPct, apyPct, dataFlag,
        firstTs, lastTs: lastTs || lastPointTs,
      });
    }
    return out;
  }

  // Which way the last move went: up, down or flat.
  const momentum = (vals) => (!vals || vals.length < 2 ? 0 : Math.sign(vals[vals.length - 1] - vals[vals.length - 2]));

  // A sparkline's shape as heights 0..1000: every point when there are few,
  // else each of SPARK_MAX / 2 buckets' low and high, in order, so a spike
  // stays visible.
  function sparkShape(vals) {
    if (!vals || !vals.length) return [];
    let pts = vals;
    if (vals.length > SPARK_MAX) {
      const n = SPARK_MAX / 2, out = [];
      for (let b = 0; b < n; b++) {
        const from = Math.floor(b * vals.length / n), to = Math.floor((b + 1) * vals.length / n);
        let lo = from, hi = from;
        for (let i = from; i < to; i++) { if (vals[i] < vals[lo]) lo = i; if (vals[i] > vals[hi]) hi = i; }
        if (lo === hi) out.push(vals[lo]); else if (lo < hi) out.push(vals[lo], vals[hi]); else out.push(vals[hi], vals[lo]);
      }
      // The last point stays the last point: the dot sits on it.
      if (out[out.length - 1] !== vals[vals.length - 1]) out.push(vals[vals.length - 1]);
      pts = out;
    }
    const lo = Math.min(...pts), hi = Math.max(...pts);
    return pts.map(v => (hi > lo ? Math.round((v - lo) / (hi - lo) * 1000) : 0));
  }

  const pack = (r) => [r.addr, r.symbol, r.chain, sparkShape(r.vals), momentum(r.vals),
    r.winFirst, r.latest, r.deltaPct, r.apyPct, r.dataFlag, r.firstTs, r.lastTs];
  const unpack = (p) => ({
    addr: p[0], symbol: p[1], chain: p[2], name: p[1] && p[1] !== '?' ? p[1] + ' vault' : p[0].slice(0, 10),
    vals: p[3], mom: p[4], winFirst: p[5], latest: p[6], deltaPct: p[7], apyPct: p[8], dataFlag: p[9], firstTs: p[10], lastTs: p[11],
  });

  return { rows, momentum, sparkShape, pack, unpack, SPARK_MAX, WINDOWS: [7, 30, 90, 0] };
});
