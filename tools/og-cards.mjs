#!/usr/bin/env node
// og-cards.mjs — a share card for every page in the side menu, and for the
// demo pages outside it (tools/pages.js PAGES and EXTRA): the image a link to
// the page shows on X, Slack, LinkedIn and the rest (og:image).
//
// Each card is 1200 × 630, in the demo hero's look: the flat purple ground
// and its dots; at the left the mark, a live-data badge (or, for a demo page,
// a label), the title in white then lavender, the page's line and its
// address; at the right the page itself in its purple theme, in a browser
// window that runs off the card's foot. Only the figures and the charts: the
// page's own title, tips (ⓘ), notes, methodology and export buttons are left
// out, as is a demo page's own browser bar.
//
// No card shows an error. A page that shows one (a source that didn't
// answer), or is still loading, keeps its card from the day before (--prev);
// with none, its card is drawn without the screenshot.
//
//   node tools/og-cards.mjs [--out og-out] [--prev <yesterday's cards>]
//                           [--only stocks,tvl] [--plotly <plotly.min.js>]
//
// Pages are served from this checkout, with its data files. og-cards.yml
// draws them every day onto a branch of their own, og-cards.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PAGES, EXTRA, SITE } = require('./pages.js');
const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'og-out')));
const PREV = arg('prev', '') ? path.resolve(arg('prev', '')) : null;
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const PLOTLY = arg('plotly', process.env.PLOTLY_JS || '');

// The site's mark, as the side menu draws it (nav.js).
const NAV = fs.readFileSync(path.join(ROOT, 'nav.js'), 'utf8');
const MARK = NAV.match(/const MARK = '(<svg[\s\S]*?<\/svg>)';/)[1];

// ---- The site, served from this checkout ------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function resolveFile(p) {
  let f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT)) return null;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch {}
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  if (fs.existsSync(f + '.html')) return f + '.html';
  if (/\.json$/i.test(p)) { const r = path.join(ROOT, path.basename(p)); if (fs.existsSync(r)) return r; }
  return null;
}
const server = await new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) { res.writeHead(204); return res.end(); }
    const f = resolveFile(u.pathname);
    if (!f) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1', () => ok(s));
});
const ORIGIN = 'http://127.0.0.1:' + server.address().port;

let playwright = null;
for (const m of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(m); break; } catch {}
}
if (!playwright) { console.error('og-cards: Playwright not found (npm i -D playwright)'); process.exit(2); }
const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// The largest vault, for the Address card: the page with an address in it.
let topVault = null;
try { topVault = JSON.parse(fs.readFileSync(path.join(ROOT, 'ipor-vaults.json'), 'utf8')).vaults.filter(v => v.address).sort((a, b) => (+b.tvl || 0) - (+a.tvl || 0))[0]; } catch {}
const shotPath = (p) => (p.path === '/address' && topVault ? '/address/?a=' + topVault.address.toLowerCase() : p.path);

// ---- The page, on a laptop's screen ------------------------------------------
const SHOT_W = 1100, SHOT_H = 900;
// What the card leaves out: the site's bars, the page's own title (the card
// says it), tips, notes, methodology, export and Back buttons.
const LEAN = `
  #fnav-root, .ui-masthead, header.masthead, .ui-tip, .info-tip, .ui-tip-bubble, details.ui-more, .ui-more,
  .chart-note, .ui-export, .xport, .ui-head .ui-btn, .xp-back, .methodology { display: none !important; }
  .hp-bar { display: none !important; } .hp { --bar-h: 0px !important; }
  html, body { padding: 0 !important; }
  .ui-section:first-of-type, .ui-figures:first-child { border-top: none !important; }`;
// Whether the page shows an error or is still loading, read as a visitor would.
function pageState() {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    return true;
  };
  const leaves = [...document.querySelectorAll('body *')].filter(el => !el.closest('#fnav-root') && el.children.length === 0 && el.textContent.trim() && shown(el));
  const texts = leaves.map(el => el.textContent.trim().replace(/\s+/g, ' '));
  const error = texts.find(t => /did not (answer|load)|failed to (fetch|load|read)|could not (load|be (read|loaded))|all rpcs failed|^error\b/i.test(t))
    || ([...document.querySelectorAll('.ui-error, [role=alert]')].find(shown) || {}).textContent || null;
  const loading = texts.some(t => /^(loading|fetching)\b/i.test(t)) || [...document.querySelectorAll('.ui-loading-row')].some(shown);
  return { error, loading };
}
async function screenshot(p) {
  const ctx = await browser.newContext({ viewport: { width: SHOT_W, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('fusionstats_theme', 'purple'); } catch {} });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'cdn.plot.ly' && PLOTLY) return r.fulfill({ path: PLOTLY, contentType: 'application/javascript' });
    // The repository's raw files are this checkout's: the page falls back to them.
    if (u.hostname === 'raw.githubusercontent.com') return r.fulfill({ status: 404, body: '' });
    return r.fallback();
  });
  const page = await ctx.newPage();
  try {
    try { await page.goto(ORIGIN + shotPath(p), { waitUntil: 'networkidle', timeout: 60000 }); } catch {}
    for (let y = 0; y < 4000; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(60); }
    await page.evaluate(() => scrollTo(0, 0));
    // Settled: nothing loading, and no error, for up to 15 seconds.
    let state = null;
    for (let t = 0; t < 15000; t += 500) {
      await page.waitForTimeout(500);
      state = await page.evaluate(pageState);
      if (state.error || !state.loading) break;
    }
    if (state.error) throw new Error('the page shows an error: "' + String(state.error).slice(0, 90) + '"');
    if (state.loading) throw new Error('the page was still loading');
    await page.addStyleTag({ content: LEAN });
    await page.waitForTimeout(600);   // the charts redraw for the width the bars gave back
    return await page.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } });
  } finally {
    await ctx.close();
  }
}

// ---- The card ----------------------------------------------------------------
// The hero's look: the flat purple ground and its dots, the mark, a line above
// the title (live data on Fusion Stats' pages, a label on the demo site's), the
// title in white then lavender, the line under it, and the page's address; at
// the right the page itself in a browser window running off the card's foot.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = SITE.replace(/^https?:\/\//, '');
// Where the card says the page lives: Fusion Stats' own address, or for a
// demo page the Fusion site it shows (fusion.app, as its browser bar does).
const where = (p) => (p.demo
  ? ['fusion.app', p.path.replace(/^\/demo/, '').replace(/^\/homepage$/, '')]
  : [host, p.path === '/' ? '' : p.path]);
function cardHtml(p, shot, day) {
  const [h, path_] = where(p);
  const [l1, l2] = (p.head || p.name).split('|');
  const line = p.demo
    ? `<span class="k">${esc(p.kicker || 'Fusion')}</span>`
    : `<span class="badge"><i></i>Live data · ${esc(day)}</span>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body { position: relative; overflow: hidden; color: #FFFFFF; font-family: Geist, -apple-system, 'Segoe UI', sans-serif;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.09) 1px, transparent 1.4px) 0 0 / 20px 20px, #2C0C55; }
  .left { position: absolute; left: 64px; top: 58px; bottom: 56px; width: 452px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 11px; font-size: 23px; font-weight: 600; letter-spacing: -0.03em; }
  .brand svg { width: 31px; height: 31px; }
  .badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 9px; margin-top: auto; height: 34px; padding: 0 14px 0 12px;
    border-radius: 999px; background: rgba(94, 232, 154, 0.14); color: #7BF0AE; font-size: 16px; font-weight: 500; white-space: nowrap; }
  .badge i { width: 8px; height: 8px; border-radius: 50%; background: #5EE89A; box-shadow: 0 0 0 4px rgba(94, 232, 154, 0.2); }
  .k { margin-top: auto; font: 500 15px/1 'Geist Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; color: #B794E6; white-space: nowrap; }
  h1 { margin-top: 20px; font-size: 60px; line-height: 1.02; font-weight: 600; letter-spacing: -0.045em; }
  h1 span { display: block; white-space: nowrap; }
  h1 span + span { color: #D7B8FF; }
  p { margin-top: 18px; font-size: 20px; line-height: 1.45; color: #E2CDFE; }
  .url { margin-top: 22px; font-size: 17px; font-weight: 500; color: #B794E6; }
  .url b { color: #FFFFFF; font-weight: 500; }
  /* A browser window, dark like the ground, running off the card's foot. */
  .win { position: absolute; left: 556px; top: 64px; width: 600px; height: 640px; overflow: hidden;
    border-radius: 16px; border: 1px solid #5D3097; background: #2C0C55;
    box-shadow: 0 34px 80px rgba(8, 0, 24, 0.55), 0 4px 14px rgba(8, 0, 24, 0.3); }
  .bar { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-bottom: 1px solid #4C247F; background: #1E0842; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #FF5F57; }
  .bar i:nth-child(2) { background: #FEBC2E; } .bar i:nth-child(3) { background: #28C840; }
  .bar span { margin-left: 18px; height: 20px; padding: 0 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.07); font-size: 12px; line-height: 20px; color: #B794E6; }
  .win img { display: block; width: 100%; }
  .win .none { height: 100%; display: grid; place-items: center; }
  .win .none svg { width: 150px; height: 150px; opacity: 0.9; margin-top: -90px; }
</style></head><body>
  <div class="left">
    <div class="brand">${MARK}<span>${p.demo ? 'Fusion' : 'Ecosystem'}</span></div>
    ${line}
    <h1 id="t"><span>${esc(l1)}</span>${l2 ? `<span>${esc(l2)}</span>` : ''}</h1>
    <p id="d">${esc(p.description)}</p>
    <div class="url">${esc(h)}<b>${esc(path_)}</b></div>
  </div>
  <div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(h + path_)}</span></div>${shot
    ? `<img alt="" src="data:image/png;base64,${shot.toString('base64')}">`
    : `<div class="none">${MARK}</div>`}</div>
  <script>
    // Each line of the title keeps one line: a long one steps the size down.
    // The line under it is never cut: past four lines it steps down too.
    const t = document.getElementById('t'); let s = 60;
    const wide = () => Math.max(...[...t.children].map(c => c.scrollWidth));
    while (wide() > t.parentElement.clientWidth && s > 34) { s -= 2; t.style.fontSize = s + 'px'; }
    const d = document.getElementById('d'); let z = 20;
    const lines = t.children.length > 1 ? 3 : 4;
    while (d.getBoundingClientRect().height > z * 1.45 * lines + 1 && z > 15) { z -= 1; d.style.fontSize = z + 'px'; }
  </script>
</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cardCtx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
async function draw(p, shot) {
  const page = await cardCtx.newPage();
  await page.setContent(cardHtml(p, shot, day), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const file = path.join(OUT, p.card + '.png');
  await page.screenshot({ path: file });
  await page.close();
  return file;
}
let made = 0, kept = 0, plain = 0;
for (const p of PAGES.concat(EXTRA)) {
  if (ONLY && !ONLY.includes(p.card)) continue;
  const t0 = Date.now();
  let shot = null;
  try { shot = await screenshot(p); }
  catch (e) {
    // Yesterday's card, or one without the screenshot: never an error.
    const prev = PREV && path.join(PREV, p.card + '.png');
    if (prev && fs.existsSync(prev)) {
      fs.copyFileSync(prev, path.join(OUT, p.card + '.png'));
      kept++;
      console.log(`${p.card.padEnd(18)} kept yesterday's card: ${e.message}`);
      continue;
    }
    plain++;
    console.log(`${p.card.padEnd(18)} drawn without the screenshot: ${e.message}`);
  }
  const file = await draw(p, shot);
  if (shot) made++;
  console.log(`${p.card.padEnd(18)} ${(fs.statSync(file).size / 1024).toFixed(0).padStart(5)} KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
console.log(`${made} cards drawn, ${kept} kept from the day before, ${plain} without a screenshot, in ${path.relative(process.cwd(), OUT) || OUT}`);
