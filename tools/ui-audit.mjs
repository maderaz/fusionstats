#!/usr/bin/env node
// tools/ui-audit.mjs — the site's layout rules (CLAUDE.md, "UI rules"), checked
// in a real browser on every page, from the narrowest phone to a wide desktop:
//
//   wrap     a label on more than one line: a figure's or a filter's name, a
//            section title, a table heading, a button, a tab, a chip, a
//            dropdown's value
//   cut      text cut off with "…": only a long name in a list's row may (a
//            vault's); a caption, a figure, a heading or a value never does
//   align    words in one row of a table or list off each other's line (a
//            name raised a few pixels by the icon beside it)
//   close    two things nearly touching: an icon within 4px of its text, a
//            chevron within 8px of anything, two neighbouring items within 6px
//   overlap  two things on top of each other
//   inset    text or an icon within 6px of the side of the box drawn round it
//            (a filter cell, a button, a pill)
//   edge     anything past the screen's edge, or a page that scrolls sideways
//
// Each page is also checked with its first dropdown open, Activity's More
// panel open, (on a phone) the menu sheet open, and Stocks' Holders view on.
//
//   node tools/ui-audit.mjs                     every page, 22 widths, 320–1920
//   node tools/ui-audit.mjs --widths 320,390,1440 --pages /,/stocks
//   node tools/ui-audit.mjs --plotly path/to/plotly-basic.min.js   (offline)
//   node tools/ui-audit.mjs --json findings.json
//   node tools/ui-audit.mjs --verbose          (each page and width as it goes)
//
// It serves this checkout itself (like Vercel: /stocks is stocks/index.html;
// data-source.js reads the local data files on localhost) and blocks every
// other host but Google Fonts and Plotly's CDN, so a run is the same each
// time. Exits 1 when anything is found. Needs Playwright with its Chromium
// (npx playwright install chromium), and the Geist font: from Google Fonts,
// or installed, as widths in any other font say nothing about the real page.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const WIDTHS = arg('widths', '320,335,350,360,375,380,390,400,412,430,480,560,640,700,768,834,900,1024,1180,1280,1440,1920').split(',').map(Number);
const PAGES = arg('pages', '/,/stocks,/stocks/aave-v4/,/finances/dao,/finances/curator,/all-vaults,/switchers,/dust,/dominance,/monitor,/tvl,/address/?a=0x17d0f109ee895bad0b68aa104aa72bd0b003ad8e,/spark,/rebalance-methodology,/logs,/video,/socials').split(',');
const PLOTLY = arg('plotly', process.env.PLOTLY_JS || '');
const JSON_OUT = arg('json', '');
const PARALLEL = +arg('parallel', 3);
const VERBOSE = process.argv.includes('--verbose');

async function loadPlaywright() {
  for (const m of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return await import(m); } catch {}
  }
  console.error('ui-audit: Playwright not found (npm i -D playwright, or set PLAYWRIGHT_MODULE to its index.mjs)');
  process.exit(2);
}

// ---- The site, served from this checkout -------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function resolveFile(p) {
  let f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT)) return null;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch {}
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  if (fs.existsSync(f + '.html')) return f + '.html';
  // Any root data file by any path, as data-source.js maps them.
  if (/\.json$/i.test(p)) { const r = path.join(ROOT, path.basename(p)); if (fs.existsSync(r)) return r; }
  return null;
}
function serve() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/')) { res.writeHead(u.pathname === '/api/refresh' ? 200 : 204, { 'content-type': 'application/json' }); return res.end(u.pathname === '/api/refresh' ? '{"configured":false}' : ''); }
      const f = resolveFile(u.pathname);
      if (!f) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => ok(s));
  });
}

// ---- The checks, run in the page ---------------------------------------------
function inPage(opts) {
  const ROOT_SEL = (opts && opts.root) || 'body';
  const TAG = opts && opts.tag ? ' [' + opts.tag + ']' : '';
  const RULE = { ICON: 4, CHEV: 8, ITEM: 6, EDGE: 6 };
  const SKIP = (opts && opts.skip) || '.js-plotly-plot .main-svg, #js-plotly-tester, .hv, .fs-pop, .fs-scrim, .more-pop, .more-scrim, .tip-bubble, .ui-tip-bubble, .fnav-sheet, .fnav-sheet-scrim, script, style, noscript, .ui-dates, .hv-slot';
  // What the eye takes for one mark: an icon, a chevron, a dot, a sort arrow.
  const ICONISH = 'svg, img, .info-tip, .ui-tip, .fs-chev, .fs-ic, .rt-dot, .dot, .hv-sw, .debank, .fnav-ic, .more-ic, .arrow';
  // Labels: each on one line.
  const LABELS = '.stat-card .label, .ui-figure .k, .stat .k, .filter-label, .ui-filter-label, .flow-chart-title, .ui-head h2, .feed-title h2, .ui-section-title, th, .fs-trigger .fs-text, .addr, .addr-link, .more-k, .ui-menu-k, button, .ui-btn, .chip, .key span, .seg button, .ui-seg button, .pg-step, .fnav-tab span, .fnav-label, .fnav-badge, .ratio, .badge, .k, .ui-masthead h1';
  const vw = document.documentElement.clientWidth;
  const out = [], seen = new Set();
  const name = (el) => {
    const s = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return s + (t ? ' "' + t + '"' : '');
  };
  const add = (kind, el, detail) => { const k = kind + '|' + name(el) + '|' + detail; if (!seen.has(k)) { seen.add(k); out.push({ kind, el: name(el), detail: detail + TAG }); } };
  const shown = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || n.hidden) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const scrolls = (n) => { const o = getComputedStyle(n).overflowX; return o === 'auto' || o === 'scroll'; };
  const vOverlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const box = (L, R, T, B) => ({ left: L, right: R, top: T, bottom: B, width: R - L, height: B - T });
  // What can be seen of a box: cut by every ancestor that clips.
  const clip = (el, r) => {
    let L = r.left, R = r.right, T = r.top, B = r.bottom;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
      const q = n.getBoundingClientRect();
      if (c.overflowX !== 'visible') { L = Math.max(L, q.left); R = Math.min(R, q.right); }
      if (c.overflowY !== 'visible') { T = Math.max(T, q.top); B = Math.min(B, q.bottom); }
    }
    return R - L > 0.5 && B - T > 0.5 ? box(L, R, T, B) : null;
  };
  // An svg's ink is its shapes (a 12px chevron box draws a 6px glyph).
  const ink = (n) => {
    if (n.tagName.toLowerCase() !== 'svg') return n.getBoundingClientRect();
    let L = 1e9, R = -1e9, T = 1e9, B = -1e9;
    for (const s of n.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse, text, image, use')) {
      const q = s.getBoundingClientRect(); if (q.width + q.height < 0.5) continue;
      L = Math.min(L, q.left); R = Math.max(R, q.right); T = Math.min(T, q.top); B = Math.max(B, q.bottom);
    }
    return R > L ? box(L, R, T, B) : n.getBoundingClientRect();
  };
  const iconAtom = (n) => { const r = clip(n, ink(n)); return r ? { type: n.matches('.fs-chev') ? 'chev' : 'icon', el: n, r } : null; };
  // The marks in a subtree: each text line as seen (an ellipsis cuts it), and each icon.
  function atoms(root) {
    if (root.matches(ICONISH)) { const a = iconAtom(root); return a ? [a] : []; }
    const res = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.matches(SKIP) || n.closest(SKIP) || !shown(n)) return NodeFilter.FILTER_REJECT;
          if (n.matches(ICONISH)) { const a = iconAtom(n); if (a) res.push(a); return NodeFilter.FILTER_REJECT; }
          return NodeFilter.FILTER_SKIP;
        }
        return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent, a = t.search(/\S/), b = t.length - (t.match(/\s*$/) || [''])[0].length;
      const rg = document.createRange(); rg.setStart(n, a); rg.setEnd(n, b);
      // One box per line: an ellipsis gives a run two rects on its line.
      const keep = [];
      for (const raw of rg.getClientRects()) {
        const r = clip(n.parentElement, raw); if (!r || r.width <= 0.5) continue;
        const k = keep.find(k => vOverlap(k, r) >= 0.5 * Math.min(k.height, r.height));
        if (!k) keep.push(r); else Object.assign(k, box(Math.min(k.left, r.left), Math.max(k.right, r.right), Math.min(k.top, r.top), Math.max(k.bottom, r.bottom)));
      }
      for (const r of keep) res.push({ type: 'text', el: n.parentElement, r });
    }
    return res;
  }
  const need = (a, b) => (a.type === 'chev' || b.type === 'chev') ? RULE.CHEV : (a.type === 'icon' || b.type === 'icon') ? RULE.ICON : RULE.ITEM;
  // Neighbours on one line: too close, or on top of each other.
  function crowd(group, where) {
    const xs = group.slice().sort((p, q) => p.r.left - q.r.left);
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const a = xs[i], b = xs[j];
        if (vOverlap(a.r, b.r) < 0.5 * Math.min(a.r.height, b.r.height)) continue;
        const gap = b.r.left - a.r.right;
        if (gap > 40) break;
        if (xs.some((c, k) => k !== i && k !== j && c.r.left >= a.r.right - 0.5 && c.r.right <= b.r.left + 0.5 && vOverlap(c.r, a.r) > 0)) continue;
        // Two runs of one text flow meet with a space between, not a gap.
        const sameFlow = a.type === 'text' && b.type === 'text' && (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)
          || (getComputedStyle(a.el).display.startsWith('inline') && getComputedStyle(b.el).display.startsWith('inline') && a.el.parentElement === b.el.parentElement));
        if (sameFlow && gap > -0.5) continue;
        if (gap < -0.5) add('overlap', a.el, `with ${name(b.el).slice(0, 40)} by ${(-gap).toFixed(1)}px` + where);
        else if (gap < need(a, b) - 0.5) add('close', a.el, `${gap.toFixed(1)}px from ${name(b.el).slice(0, 40)} (min ${need(a, b)})` + where);
      }
    }
  }
  // Boxes drawn round content: a filled pill, a bordered cell, a button with a background.
  const boxy = (el, cs) => {
    const bg = cs.backgroundColor, hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none').length;
    const round = parseFloat(cs.borderTopLeftRadius) > 0;
    const r = el.getBoundingClientRect();
    if (r.height > 140 || r.width > 760) return false;   // a card or a section, not a control
    return (hasBg && round) || sides >= 3 || (sides >= 1 && round) || (hasBg && el.matches('button, .ui-btn, .chip, .pg-step, .pg-num'));
  };
  const CONTROL = 'button, a, label, .ui-btn, .chip, .pg-step, .pg-num, .fs-trigger';
  const comps = [];
  for (const el of document.querySelectorAll(ROOT_SEL + ' *')) {
    if (el.matches(SKIP) || el.closest(SKIP) || el.matches(ICONISH)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents' || !boxy(el, cs) || !shown(el)) continue;
    comps.push(el);
  }
  const groups = [...new Set([...comps, ...[...document.querySelectorAll(ROOT_SEL + ' :is(' + CONTROL + ')')].filter(el => !el.closest(SKIP) && shown(el))])];
  for (const c of groups) {
    const inner = atoms(c).filter(a => !groups.some(o => o !== c && c.contains(o) && o.contains(a.el)));
    if (inner.length > 1) crowd(inner, ' in ' + name(c).slice(0, 40));
  }
  for (const c of comps) {
    if (scrolls(c)) continue;
    const cr = c.getBoundingClientRect(), cs = getComputedStyle(c);
    const L = cr.left + parseFloat(cs.borderLeftWidth), R = cr.right - parseFloat(cs.borderRightWidth);
    for (const a of atoms(c).filter(a => !comps.some(o => o !== c && c.contains(o) && o.contains(a.el)))) {
      const left = a.r.left - L, right = R - a.r.right;
      if (left < RULE.EDGE - 0.5 && left > -50) add('inset', a.el, `${left.toFixed(1)}px from the left side of ${name(c).slice(0, 40)}`);
      if (right < RULE.EDGE - 0.5 && right > -50) add('inset', a.el, `${right.toFixed(1)}px from the right side of ${name(c).slice(0, 40)}`);
    }
  }
  // Rows laid out by flex or grid outside those boxes: their items apart.
  for (const el of document.querySelectorAll(ROOT_SEL + ' *')) {
    if (el.matches(SKIP) || el.closest(SKIP)) continue;
    const cs = getComputedStyle(el);
    if (!/flex|grid/.test(cs.display) || !shown(el) || comps.some(c => c === el || c.contains(el))) continue;
    const items = [...el.children].filter(k => shown(k) && !k.matches(SKIP)).map(k => atoms(k)).filter(g => g.length);
    for (let i = 0; i < items.length; i++) for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      for (const a of items[i]) for (const b of items[j]) {
        if (vOverlap(a.r, b.r) < 0.5 * Math.min(a.r.height, b.r.height) || a.r.right > b.r.left + 0.5) continue;
        const gap = b.r.left - a.r.right;
        if (gap < need(a, b) - 0.5 && gap > -0.5) add('close', a.el, `${gap.toFixed(1)}px from ${name(b.el).slice(0, 40)} (min ${need(a, b)}) in ${name(el).slice(0, 30)}`);
      }
    }
  }
  // Labels on one line. An icon stacked above its word (a tab) is the
  // design; an icon after the words that fell to a line of its own is a wrap.
  for (const el of document.querySelectorAll(ROOT_SEL + ' :is(' + LABELS + ')')) {
    if (el.closest(SKIP) || !shown(el)) continue;
    const txt = (el.innerText || '').trim();
    if (!txt || txt.length > 40) continue;
    const at = atoms(el), first = at.findIndex(a => a.type === 'text');
    const lines = [];
    for (const a of at.filter((a, i) => a.type === 'text' || i > first)) {
      const l = lines.find(x => vOverlap(x, a.r) >= 0.5 * Math.min(x.bottom - x.top, a.r.height));
      if (l) { l.top = Math.min(l.top, a.r.top); l.bottom = Math.max(l.bottom, a.r.bottom); } else lines.push({ top: a.r.top, bottom: a.r.bottom });
    }
    if (lines.length > 1) add('wrap', el, `${lines.length} lines`);
  }
  // Cut short: text ending in "…". Only a long name in a list's row may (a
  // vault's, in a table or a .vrow/.src-row line); a caption, a figure, a
  // heading or a filter's value never does, however long.
  const inListRow = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches('tr, li, [role="row"], .fs-opt')) return true;
    if ([...n.classList].some(c => c !== 'stat-row' && /^[a-z]row$|-row$/.test(c))) return true;
  } return false; };
  for (const el of document.querySelectorAll(ROOT_SEL + ' *')) {
    if (el.closest(SKIP)) continue;
    const c = getComputedStyle(el);
    if (c.textOverflow !== 'ellipsis' || c.overflowX === 'visible' || el.scrollWidth <= el.clientWidth + 1 || !shown(el)) continue;
    const full = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!full) continue;
    const longName = full.length > 20 && inListRow(el) && !el.matches('.fs-trigger .fs-text, .fs-trigger .fs-wide');
    if (!longName) add('cut', el, `"${full.slice(0, 40)}" ends in … (${el.scrollWidth - el.clientWidth}px short)`);
  }
  // Level: the words in one row of a table or a list share their line. A
  // one-line cell's text sits on the same centre as its neighbours' (same
  // size of type, within 1.5px), never a few pixels up for an icon beside it.
  const rows = [...document.querySelectorAll(ROOT_SEL + ' :is(tr, [role="row"])')]
    .concat([...document.querySelectorAll(ROOT_SEL + ' *')].filter(n => [...n.classList].some(c => c !== 'stat-row' && /^[a-z]row$|-row$/.test(c))));
  for (const row of new Set(rows)) {
    if (row.closest(SKIP) || !shown(row)) continue;
    const cells = [...row.children].filter(k => shown(k) && !k.matches(SKIP)).map(k => {
      const lines = atoms(k).filter(a => a.type === 'text');
      if (!lines.length) return null;
      const tops = new Set(lines.map(a => Math.round(a.r.top)));
      if ([...tops].some(t => Math.abs(t - lines[0].r.top) > lines[0].r.height * 0.5)) return null;   // more than one line: centred as a block
      return { k, r: lines.reduce((m, a) => (a.r.height > m.r.height ? a : m)).r, fs: parseFloat(getComputedStyle(lines[0].el).fontSize) };
    }).filter(Boolean);
    // Against the line most of the row's cells share (their median centre),
    // among the cells on that visual line in the same size of type.
    for (const a of cells) {
      const peers = cells.filter(b => b !== a && Math.abs(a.fs - b.fs) <= 1.5 && vOverlap(a.r, b.r) >= 0.3 * Math.min(a.r.height, b.r.height));
      if (peers.length < 2) continue;
      const mids = peers.map(b => (b.r.top + b.r.bottom) / 2).sort((x, y) => x - y);
      const d = (a.r.top + a.r.bottom) / 2 - mids[mids.length >> 1];
      if (Math.abs(d) > 1.5) add('align', a.k, `${Math.abs(d).toFixed(1)}px ${d < 0 ? 'above' : 'below'} the rest of its row (${name(row).slice(0, 30)})`);
    }
  }
  // The screen's edge.
  for (const el of document.querySelectorAll(ROOT_SEL + ' *')) {
    if (el.matches(SKIP) || el.closest(SKIP)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || (r.right <= vw + 0.5 && r.left >= -0.5) || !shown(el)) continue;
    let vl = r.left, vr = r.right, inScroller = false;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (scrolls(n)) { inScroller = true; break; }
      if (getComputedStyle(n).overflowX !== 'visible') { const q = n.getBoundingClientRect(); vl = Math.max(vl, q.left); vr = Math.min(vr, q.right); }
    }
    if (!inScroller && vr > vl && (vr > vw + 0.5 || vl < -0.5)) add('edge', el, `${Math.round(Math.max(vr - vw, -vl))}px past`);
  }
  if (ROOT_SEL === 'body' && document.documentElement.scrollWidth > vw) out.push({ kind: 'edge', el: 'page', detail: `scrolls sideways by ${document.documentElement.scrollWidth - vw}px` });
  return out;
}

// ---- A run ---------------------------------------------------------------------
const { chromium } = await loadPlaywright();
const server = await serve();
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const all = [];
let fontWarned = false;

async function auditWidth(w) {
  const phone = w < 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'cdn.plot.ly' && PLOTLY) return r.fulfill({ path: PLOTLY, contentType: 'application/javascript' });
    if (u.hostname === '127.0.0.1' || u.hostname === 'cdn.plot.ly' || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return r.fallback();
    return r.fulfill({ status: 404, body: '' });
  });
  for (const pg of PAGES) {
    const t0 = Date.now();
    const p = await ctx.newPage();
    try { await p.goto(ORIGIN + pg, { waitUntil: 'networkidle', timeout: 60000 }); } catch {}
    // Everything drawn: scroll through, so lazy sections render.
    for (let y = 0; y < 30000; y += 700) { const more = await p.evaluate((y) => { scrollTo(0, y); return y < document.documentElement.scrollHeight; }, y); if (!more) break; await p.waitForTimeout(40); }
    await p.waitForTimeout(800);
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150);
    if (!fontWarned) {
      const geist = await p.evaluate(() => { const c = document.createElement('canvas').getContext('2d'); c.font = '14px Geist, monospace'; const a = c.measureText('abcdefghij').width; c.font = '14px monospace'; return a !== c.measureText('abcdefghij').width; });
      if (!geist) { fontWarned = true; console.warn('ui-audit: Geist is not available here; widths measured in a fallback font.'); }
    }
    const push = (list) => { for (const f of list) all.push({ w, path: pg, ...f }); };
    try { push(await p.evaluate(inPage)); } catch (e) { all.push({ w, path: pg, kind: 'error', el: 'audit', detail: String(e.message).slice(0, 120) }); }
    // The same rules inside what opens: a dropdown, the More panel, the menu sheet.
    // (Stocks' Holders view last: it stays switched on.)
    for (const [open, root, tag] of [['.fs-trigger', '.fs-pop', 'dropdown open'], ['#moreBtn', '.more-pop, #morePanel', 'more open'], ['#fnav-more', '.fnav-sheet', 'menu sheet'], ['button[data-view="holders"]', '#holdersView', 'holders view']]) {
      const btn = await p.$(open);
      if (!btn || !(await btn.isVisible().catch(() => false))) continue;
      try {
        await btn.scrollIntoViewIfNeeded(); await btn.click({ timeout: 3000 }); await p.waitForTimeout(450);
        const there = await p.evaluate((root) => { const el = [...document.querySelectorAll(root)].find(n => n.getBoundingClientRect().height > 0); if (el) el.setAttribute('data-ui-audit', ''); return !!el; }, root);
        if (there) push(await p.evaluate(inPage, { root: '[data-ui-audit]', skip: 'script, style, .fs-scrim, .more-scrim, .fnav-sheet-scrim', tag }));
        await p.evaluate(() => document.querySelectorAll('[data-ui-audit]').forEach(n => n.removeAttribute('data-ui-audit')));
        await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      } catch (e) { all.push({ w, path: pg, kind: 'error', el: tag, detail: String(e.message).slice(0, 100) }); }
    }
    await p.close();
    if (VERBOSE) console.log(`  ${w}px ${pg}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  await ctx.close();
}

const queue = WIDTHS.slice();
await Promise.all(Array.from({ length: Math.max(1, PARALLEL) }, async () => { for (let w; (w = queue.shift()) != null;) await auditWidth(w); }));
await browser.close();
server.close();

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
// One line per problem, with the widths it shows at.
const grouped = new Map();
for (const f of all) {
  const k = `${f.path} | ${f.kind} | ${f.el} | ${String(f.detail).replace(/-?[\d.]+px/g, '·')}`;
  const e = grouped.get(k) || { ws: new Set(), d: f.detail };
  e.ws.add(f.w); grouped.set(k, e);
}
for (const [k, e] of [...grouped.entries()].sort()) console.log(k.split(' | ').slice(0, 3).join(' | '), '|', e.d, ' @', [...e.ws].sort((a, b) => a - b).join(','));
console.log(grouped.size ? `\n${grouped.size} problem${grouped.size === 1 ? '' : 's'} on ${new Set(all.map(f => f.path)).size} page(s)` : `clean: ${PAGES.length} pages × ${WIDTHS.length} widths`);
process.exitCode = grouped.size ? 1 : 0;
