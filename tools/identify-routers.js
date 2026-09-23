#!/usr/bin/env node
'use strict';
// identify-routers.js — put a protocol name to the contracts that deposit on
// someone else's behalf.
//
// A Fusion Deposit event carries `sender` and `owner`. When they differ, the
// deposit was pushed by a contract — a zap, an aggregator, a referral wrapper.
// Showing that contract's address tells a reader almost nothing. This reads the
// contract's VERIFIED SOURCE from Basescan and looks for the protocol's own
// fingerprints in it: storage namespaces, natspec, interface and contract
// names. Those are the protocol's own words about itself, not our guess.
//
// Output: router-identity.json, keyed by address. The page reads it. An address
// we cannot identify is recorded as unidentified WITH the reason, so the page
// can say "verified source, no known fingerprint" rather than silently bucket
// it as "Other".
//
//   node tools/identify-routers.js            # every router seen in events
//   node tools/identify-routers.js 0xabc...   # just these
//
// Read-only, and cached: an address already resolved is skipped unless --force.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'router-identity.json');
const FORCE = process.argv.includes('--force');

// Each protocol's own fingerprints. Word-boundary matched against the page with
// <script>/<style> stripped — without the boundary, "Enso" matches Basescan's
// own `popoverEnsOwnedAddress` chrome and every contract looks like Enso.
const SIGNATURES = [
  { protocol: 'Zyfi',     patterns: [/\bzyfi\b/i, /\bzyf\.ai\b/i] },
  { protocol: 'Harvest',  patterns: [/\bharvest(?:finance)?\b/i, /\bHarvestVault\b/] },
  { protocol: 'Spectra',  patterns: [/\bspectra\b/i, /\bIPrincipalToken\b/] },
  { protocol: 'Portals',  patterns: [/\bportals(?:\.fi)?\b/i, /\bPortalsRouter\b/] },
  { protocol: 'Enso',     patterns: [/\benso\b/i, /\bEnsoShortcuts?\b/] },
  { protocol: 'Odos',     patterns: [/\bodos\b/i] },
  { protocol: '1inch',    patterns: [/\b1inch\b/i, /\bAggregationRouter\b/] },
  { protocol: 'ParaSwap', patterns: [/\bparaswap\b/i, /\bAugustus\b/] },
  { protocol: 'LI.FI',    patterns: [/\blifi\b/i, /\bLiFiDiamond\b/] },
  { protocol: 'Pendle',   patterns: [/\bpendle\b/i] },
  { protocol: 'IPOR',     patterns: [/\bReferralPlasmaVault\b/, /\bipor\b/i] },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchAddressPage(addr) {
  const res = await fetch('https://basescan.org/address/' + addr, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fusionstats/1.0)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// Basescan renders verified Solidity as plain text in the body. Page chrome and
// its inline scripts are the noise; drop them before matching.
function sourceText(html) {
  let s = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  return s;
}

function contractName(text) {
  // The outermost declarations, in source order. The proxy usually comes first
  // and the implementation after, so keep a couple.
  const names = [];
  const re = /\bcontract\s+([A-Z][A-Za-z0-9_]{2,50})\s*(?:is\b|\{)/g;
  let m;
  while ((m = re.exec(text)) && names.length < 6) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

function identify(text) {
  const hits = [];
  for (const sig of SIGNATURES) {
    for (const p of sig.patterns) {
      const m = text.match(p);
      if (m) {
        const at = text.indexOf(m[0]);
        const snip = text.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ').trim();
        hits.push({ protocol: sig.protocol, matched: m[0], evidence: snip });
        break;
      }
    }
  }
  return hits;
}

function routersFromEvents() {
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8'));
  const seen = new Map();
  for (const e of ev.events || []) {
    if (e.type !== 'deposit') continue;
    const s = (e.sender || '').toLowerCase(), o = (e.owner || '').toLowerCase();
    if (!s || !o || s === o) continue;
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

(async function main() {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}

  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const addrs = args.length ? args.map(a => a.toLowerCase()) : routersFromEvents();
  console.log(`${addrs.length} router${addrs.length === 1 ? '' : 's'} to check\n`);

  for (const addr of addrs) {
    if (!FORCE && cache[addr] && cache[addr].checkedAt) {
      console.log(`  ${addr}  cached — ${cache[addr].protocol || 'unidentified'}`);
      continue;
    }
    try {
      const html = await fetchAddressPage(addr);
      const text = sourceText(html);
      const verified = /\bcontract\s+[A-Z]/.test(text);
      const names = contractName(text);
      const hits = identify(text);

      cache[addr] = {
        protocol: hits.length ? hits[0].protocol : null,
        alsoMatched: hits.slice(1).map(h => h.protocol),
        contractNames: names,
        verified,
        // Why we did or did not name it — so the page never has to say just
        // "unknown", and so a wrong call can be audited later.
        reason: hits.length
          ? `source matches ${hits[0].matched}`
          : verified ? 'verified source, no known fingerprint' : 'source not verified on Basescan',
        evidence: hits.length ? hits[0].evidence : null,
        checkedAt: new Date().toISOString(),
      };
      const c = cache[addr];
      console.log(`  ${addr}  ${(c.protocol || 'unidentified').padEnd(12)} ${names.slice(0, 2).join(', ') || '—'}`);
      if (c.evidence) console.log(`      ${c.reason}: …${c.evidence.slice(0, 90)}…`);
      else console.log(`      ${c.reason}`);
      await sleep(1200);   // Basescan is a courtesy, not an API contract
    } catch (e) {
      console.log(`  ${addr}  FAILED — ${String(e.message).slice(0, 60)}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(cache, null, 2) + '\n');
  const named = Object.values(cache).filter(v => v.protocol).length;
  console.log(`\n${Object.keys(cache).length} addresses in ${path.basename(OUT)}, ${named} identified`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
