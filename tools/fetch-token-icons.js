#!/usr/bin/env node
'use strict';
// fetch-token-icons.js — vendor Coinbase's tokenised-equity marks.
//
// The /stocks page serves these from our own origin rather than hotlinking
// Basescan: a vendored file cannot 404 mid-session, rate-limit, or change
// shape underneath the page. Run this to add a ticker or refresh the set.
//
//   node tools/fetch-token-icons.js            # the known set
//   node tools/fetch-token-icons.js tsla amzn  # plus more
//
// Writes to stocks/icons/<ticker>.svg. A ticker that 404s is reported and
// skipped, never written as an error page — the page falls back to a coloured
// dot for anything missing, which is a better failure than a broken glyph.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'stocks', 'icons');
const SRC = (t) => `https://basescan.org/token/images/coinbasetokenize_${t}.svg`;
const DEFAULT = ['nvda', 'meta', 'goog', 'aapl', 'coin', 'msft'];

(async function main() {
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  fs.mkdirSync(OUT, { recursive: true });
  let ok = 0, failed = 0;

  for (const t of tickers.map(x => x.toLowerCase())) {
    try {
      const res = await fetch(SRC(t), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { console.log(`  ${t.padEnd(6)} HTTP ${res.status} — skipped`); failed++; continue; }
      const body = await res.text();
      // Guard against a friendly error page served with a 200.
      if (!/^\s*<svg[\s>]/i.test(body)) { console.log(`  ${t.padEnd(6)} not an SVG — skipped`); failed++; continue; }
      // These are drawn in <img>, which cannot execute script, but a vendored
      // asset should still be inert on its own terms.
      if (/<script|javascript:|\son\w+\s*=/i.test(body)) { console.log(`  ${t.padEnd(6)} contains script — skipped`); failed++; continue; }
      fs.writeFileSync(path.join(OUT, t + '.svg'), body);
      console.log(`  ${t.padEnd(6)} ${String(body.length).padStart(6)} bytes`);
      ok++;
    } catch (e) {
      console.log(`  ${t.padEnd(6)} ${String(e.message).slice(0, 60)} — skipped`);
      failed++;
    }
  }
  console.log(`\n${ok} written to ${OUT}${failed ? `, ${failed} skipped` : ''}`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
