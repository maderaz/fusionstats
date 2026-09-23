#!/usr/bin/env node
'use strict';
// identify-routers.js — put a protocol name to the contracts that put money
// into Fusion vaults.
//
// Two kinds of contract show up in a Deposit event, and only one of them is
// obvious:
//
//   sender != owner   A contract pushed the deposit on someone else's behalf —
//                     a zap, an aggregator, a referral wrapper. The sender is
//                     the route.
//   sender == owner   A contract deposited for ITSELF and holds the shares.
//                     That is what an autocompounder does: Harvest's strategy
//                     holds the Fusion position on behalf of Harvest's own
//                     depositors. It looks exactly like a retail wallet unless
//                     you go and check, which is why these were being counted
//                     as "Direct" — the single biggest source of stock-vault
//                     deposits was filed under "nobody routed this".
//
// Both are candidates here. For each address this reads its Basescan page and
// records what can be established:
//
//   via: 'source'    the protocol's own fingerprints are in the VERIFIED
//                    SOURCE — storage namespaces, contract and interface
//                    names. The protocol's words about itself.
//   via: 'deployer'  the source is a bare proxy and says nothing, but Basescan
//                    attributes the deployment to a named protocol. Weaker:
//                    it is Basescan's attribution, not the contract's. Kept
//                    separate so the page can say which it is.
//   via: null        nothing found, WITH the reason — an EOA, an unverified
//                    contract, or a verified one with no known fingerprint.
//                    Never silently bucketed as "Other".
//
//   node tools/identify-routers.js            # every depositing contract seen
//   node tools/identify-routers.js 0xabc...   # just these
//   node tools/identify-routers.js --force    # re-check cached entries
//
// Read-only against Basescan, and cached: an address already resolved is
// skipped unless --force.

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
  { protocol: 'Harvest',  patterns: [/\bharvest\s*finance\b/i, /\bharvestfinance\b/i, /\bHarvestVault\b/] },
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

// The VERIFIED SOURCE only, not the page it sits on.
//
// This used to return the whole page minus <script>/<style>, which is not the
// same thing at all: Basescan puts the deployer's name-tag in a tooltip in the
// header, so a bare proxy deployed by Harvest matched /harvest finance/ and was
// reported as "the source says Harvest". It does not. The source says
// `BaseUpgradeabilityProxy` and nothing else. Anchor to the contract-code
// section so a source match means the contract's own words.
function sourceText(html) {
  const i = html.search(/id=['"]dividcode['"]|Contract Source Code/i);
  if (i < 0) return '';                       // unverified: no source to read
  let s = html.slice(i);
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  return s;
}

// The creator block is its own element, so the deployer label can be read as a
// field rather than grepped out of the whole page — "Harvest Finance" in an ad
// or an unrelated tooltip must not be able to name a contract.
function creatorOf(html) {
  const i = html.indexOf('ContentPlaceHolder1_trContract');
  if (i < 0) return null;                     // no creator row: an EOA
  const block = html.slice(i, i + 1500);
  const m = block.match(/href='\/address\/(0x[0-9a-fA-F]{40})'[^>]*>([^<]{0,80})</);
  if (!m) return { address: null, label: null };
  const label = m[2].trim();
  return { address: m[1].toLowerCase(), label: /^0x/.test(label) ? null : label };
}

function tokenNameOf(html) {
  const m = html.match(/Token Tracker[\s\S]{0,400}?href='\/token\/0x[0-9a-fA-F]{40}'[^>]*>([^<]{2,60})</);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
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

function matchSignatures(text) {
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

function classify(html) {
  const text = sourceText(html);
  const creator = creatorOf(html);
  const isContract = creator !== null;
  const verified = /\bcontract\s+[A-Z]/.test(text);
  const names = contractName(text);
  const token = tokenNameOf(html);

  if (!isContract) {
    return { protocol: null, via: null, isContract: false, verified: false,
             contractNames: [], reason: 'externally owned account, not a contract' };
  }

  // Strongest first: the contract's own source.
  const inSource = matchSignatures(text);
  if (inSource.length) {
    return { protocol: inSource[0].protocol, via: 'source', isContract: true, verified,
             contractNames: names, tokenName: token,
             creator: creator.label || creator.address,
             alsoMatched: inSource.slice(1).map(h => h.protocol),
             reason: 'verified source matches ' + inSource[0].matched,
             evidence: inSource[0].evidence };
  }

  // A bare proxy tells us nothing about itself. Basescan's attribution of the
  // deployer is the next best thing, and is labelled as such.
  const label = [creator.label, token].filter(Boolean).join(' ');
  const inLabel = label ? matchSignatures(label) : [];
  if (inLabel.length) {
    return { protocol: inLabel[0].protocol, via: 'deployer', isContract: true, verified,
             contractNames: names, tokenName: token, creator: creator.label || creator.address,
             alsoMatched: inLabel.slice(1).map(h => h.protocol),
             reason: 'deployed by ' + creator.label + (token ? ', issues ' + token : ''),
             evidence: label };
  }

  return { protocol: null, via: null, isContract: true, verified,
           contractNames: names, tokenName: token, creator: creator.label || creator.address,
           reason: verified ? 'verified source, no known fingerprint'
                            : 'source not verified on Basescan' };
}

// Every contract that has put money into a vault: the ones that pushed it for
// someone else, and the ones that hold it for themselves.
//
// The first set is small and fully checkable. The second is not — most
// addresses that deposit for themselves are ordinary wallets, and there are
// over a thousand of them. Checking all of them would mean ~30 minutes of
// fetches against a site that owes us nothing. So the sweep is bounded, and
// the bound is recorded in the output rather than left implicit:
//
//   * every self-depositor into a vault the stocks page covers, however few
//     deposits it made — that page attributes routes, so its coverage has to
//     be complete or its totals are wrong;
//   * elsewhere, self-depositors with at least --min deposits, because a
//     contract that compounds deposits repeatedly and a wallet that deposits
//     once look identical from here without an eth_getCode we cannot make.
//
// Ordered by deposit count, so a run that is cut short covers the ones that
// move the most money.
const STOCK_ASSET = /^0xb20{20}/;

function stockVaults() {
  try {
    const iv = JSON.parse(fs.readFileSync(path.join(ROOT, 'ipor-vaults.json'), 'utf8'));
    return new Set((iv.vaults || [])
      .filter(v => STOCK_ASSET.test((v.assetAddress || '').toLowerCase()))
      .map(v => (v.address || '').toLowerCase()));
  } catch { return new Set(); }
}

function candidatesFromEvents(minSelf) {
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'activity-events.json'), 'utf8'));
  const stock = stockVaults();
  const routed = new Map(), self = new Map(), onStock = new Set();
  for (const e of ev.events || []) {
    if (e.type !== 'deposit') continue;
    const s = (e.sender || '').toLowerCase(), o = (e.owner || '').toLowerCase();
    if (!s || !o) continue;
    if (s !== o) { routed.set(s, (routed.get(s) || 0) + 1); continue; }
    self.set(s, (self.get(s) || 0) + 1);
    if (stock.has((e.vault || '').toLowerCase())) onStock.add(s);
  }
  for (const [a, n] of self) {
    if (n >= minSelf || onStock.has(a)) routed.set(a, (routed.get(a) || 0) + n);
  }
  return { list: [...routed.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a),
           selfTotal: self.size, onStock: onStock.size };
}

(async function main() {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}

  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const minArg = process.argv.find(a => a.startsWith('--min='));
  const minSelf = minArg ? Number(minArg.slice(6)) : 5;
  let disc = null;
  const addrs = args.length ? args.map(a => a.toLowerCase())
                            : (disc = candidatesFromEvents(minSelf)).list;
  console.log(`${addrs.length} address${addrs.length === 1 ? '' : 'es'} to check`
    + (disc ? `  (all routers, all self-depositors on stock vaults, plus self-depositors with >= ${minSelf} deposits)` : '') + '\n');

  let checked = 0;
  for (const addr of addrs) {
    if (!FORCE && cache[addr] && cache[addr].checkedAt) {
      console.log(`  ${addr}  cached — ${cache[addr].protocol || 'unidentified'}`);
      continue;
    }
    try {
      const html = await fetchAddressPage(addr);
      const c = classify(html);
      cache[addr] = { ...c, checkedAt: new Date().toISOString() };
      const tag = c.protocol ? `${c.protocol} (${c.via})` : (c.isContract ? 'unidentified' : 'EOA');
      console.log(`  ${addr}  ${tag.padEnd(20)} ${(c.contractNames || []).slice(0, 2).join(', ') || '—'}`);
      console.log(`      ${c.reason}`);
      checked++;
      await sleep(1200);   // Basescan is a courtesy, not an API contract
    } catch (e) {
      console.log(`  ${addr}  FAILED — ${String(e.message).slice(0, 60)}`);
    }
  }

  // What the sweep did and did not reach, so the page can say so instead of
  // implying every depositing contract has been looked at.
  if (disc) {
    cache._meta = { checkedAt: new Date().toISOString(), minSelfDeposits: minSelf,
                    stockVaultDepositorsFullyChecked: true,
                    selfDepositorsTotal: disc.selfTotal, candidates: addrs.length };
  }
  fs.writeFileSync(OUT, JSON.stringify(cache, null, 2) + '\n');
  const v = Object.values(cache).filter(x => x && x.checkedAt && x.reason !== undefined);
  console.log(`\n${v.length} addresses in ${path.basename(OUT)} (${checked} newly checked)`);
  console.log(`  ${v.filter(x => x.via === 'source').length} named from verified source`);
  console.log(`  ${v.filter(x => x.via === 'deployer').length} named from deployer attribution`);
  console.log(`  ${v.filter(x => x.isContract === false).length} externally owned accounts`);
  console.log(`  ${v.filter(x => x.isContract !== false && !x.protocol).length} contracts still unidentified`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
