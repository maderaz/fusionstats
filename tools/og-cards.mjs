#!/usr/bin/env node
// og-cards.mjs — a share card for every page in the side menu: the image a
// link to the page shows on X, Slack, LinkedIn and the rest (og:image).
//
// Each card is 1200 × 630: on the left the site's mark, a live badge with
// the day, the page's name and its line (tools/pages.js), and its address;
// on the right the page itself on a laptop's screen, with the latest data,
// in a browser window that runs off the card's foot. Only the figures and
// the charts: the page's own title, its tips (ⓘ), notes, methodology and
// export buttons are left out.
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
const { PAGES, SITE } = require('./pages.js');
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
  await ctx.addInitScript(() => { try { localStorage.setItem('fusionstats_theme', 'light'); } catch {} });
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
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const host = SITE.replace(/^https?:\/\//, '');
function cardHtml(p, shot, day) {
  const where = host + (p.path === '/' ? '' : p.path);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body { position: relative; overflow: hidden; background: #FFFFFF; color: #0B0B0F; font-family: Geist, -apple-system, 'Segoe UI', sans-serif; }
  .glow { position: absolute; right: -260px; top: -300px; width: 980px; height: 980px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(132, 41, 255, 0.14), rgba(132, 41, 255, 0)); }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(rgba(25, 23, 23, 0.15) 1.1px, transparent 1.3px); background-size: 18px 18px;
    -webkit-mask-image: linear-gradient(90deg, transparent 6%, #000 55%); mask-image: linear-gradient(90deg, transparent 6%, #000 55%); }
  .left { position: absolute; left: 64px; top: 58px; bottom: 56px; width: 444px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 11px; font-size: 23px; font-weight: 600; letter-spacing: -0.03em; }
  .brand svg { width: 31px; height: 31px; }
  .badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 9px; margin-top: auto; height: 36px; padding: 0 15px 0 13px;
    border-radius: 999px; background: rgba(22, 163, 74, 0.10); color: #15803D; font-size: 16.5px; font-weight: 500; white-space: nowrap; }
  .badge i { width: 9px; height: 9px; border-radius: 50%; background: #16A34A; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.2); }
  h1 { margin-top: 20px; font-size: 64px; line-height: 1.04; font-weight: 600; letter-spacing: -0.04em; white-space: nowrap; }
  p { margin-top: 16px; font-size: 21px; line-height: 1.42; color: #5E5E6B; }
  .url { margin-top: 22px; font-size: 17px; font-weight: 500; color: #9A9AA6; }
  .url b { color: #8429FF; font-weight: 500; }
  /* A laptop's browser window, running off the card's foot. */
  .win { position: absolute; left: 548px; top: 64px; width: 600px; height: 640px; overflow: hidden;
    border-radius: 16px; border: 1px solid #E3E3EA; background: #FFFFFF;
    box-shadow: 0 34px 80px rgba(30, 12, 60, 0.17), 0 4px 14px rgba(30, 12, 60, 0.06); }
  .bar { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border-bottom: 1px solid #EEEEF2; background: #FAFAFC; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #E2E2E9; }
  .bar span { margin-left: 18px; height: 20px; padding: 0 12px; border-radius: 6px; background: #F0F0F4; font-size: 12px; line-height: 20px; color: #8A8A96; }
  .win img { display: block; width: 100%; }
  .win .none { height: 100%; display: grid; place-items: center; background: linear-gradient(160deg, #F7F2FF, #FFFFFF 60%); }
  .win .none svg { width: 150px; height: 150px; opacity: 0.9; margin-top: -90px; }
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="left">
    <div class="brand">${MARK}<span>Ecosystem</span></div>
    <span class="badge"><i></i>Live data · ${esc(day)}</span>
    <h1 id="t">${esc(p.name)}</h1>
    <p id="d">${esc(p.description)}</p>
    <div class="url">${esc(host)}<b>${esc(p.path === '/' ? '' : p.path)}</b></div>
  </div>
  <div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(where)}</span></div>${shot
    ? `<img alt="" src="data:image/png;base64,${shot.toString('base64')}">`
    : `<div class="none">${MARK}</div>`}</div>
  <script>
    // The name keeps one line: a long one steps down a size at a time. The
    // line under it is never cut: past four lines it steps down too.
    const t = document.getElementById('t'); let s = 64;
    while (t.scrollWidth > t.parentElement.clientWidth && s > 44) { s -= 2; t.style.fontSize = s + 'px'; }
    const d = document.getElementById('d'); let z = 21;
    while (d.getBoundingClientRect().height > 21 * 1.42 * 4 + 1 && z > 16) { z -= 1; d.style.fontSize = z + 'px'; }
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
for (const p of PAGES) {
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
