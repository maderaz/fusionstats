#!/usr/bin/env node
// og-cards.mjs — a share card for every page in the side menu: the image a
// link to the page shows on X, Slack, LinkedIn and the rest (og:image).
//
// Each card is 1200 × 630: on the left the site's mark, a live badge with
// the day, the page's name and its line (tools/pages.js), and its address;
// on the right the page itself, as a phone shows it, with the latest data,
// in a rounded frame that runs off the card's foot.
//
//   node tools/og-cards.mjs [--out og-out] [--only stocks,tvl] [--plotly <plotly.min.js>]
//
// Pages are served from this checkout, with its data files (the workflow
// runs it after the data's own runs). og-cards.yml draws them every day
// onto a branch of their own, og-cards, which keeps one copy of each.

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
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const PLOTLY = arg('plotly', process.env.PLOTLY_JS || '');

// The site's mark and the pages' icons, as the side menu draws them (nav.js).
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

// ---- The page, as a phone shows it -------------------------------------------
const SHOT_W = 540, SHOT_H = 700;
async function screenshot(p) {
  const ctx = await browser.newContext({ viewport: { width: SHOT_W, height: 1000 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('fusionstats_theme', 'light'); } catch {} });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'cdn.plot.ly' && PLOTLY) return r.fulfill({ path: PLOTLY, contentType: 'application/javascript' });
    // The repository's raw files are this checkout's: the page falls back to them.
    if (u.hostname === 'raw.githubusercontent.com') return r.fulfill({ status: 404, body: '' });
    return r.fallback();
  });
  const page = await ctx.newPage();
  try { await page.goto(ORIGIN + shotPath(p), { waitUntil: 'networkidle', timeout: 60000 }); } catch {}
  // The site's bars are not the page: the card shows the page alone.
  await page.addStyleTag({ content: '#fnav-root { display: none !important; } body { padding-top: 0 !important; padding-bottom: 0 !important; }' });
  for (let y = 0; y < 4000; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(60); }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(2500);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } });
  await ctx.close();
  return buf;
}

// ---- The card ----------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function cardHtml(p, shot, day) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body { position: relative; overflow: hidden; background: #FFFFFF; color: #0B0B0F; font-family: Geist, -apple-system, 'Segoe UI', sans-serif; }
  .glow { position: absolute; right: -220px; top: -260px; width: 900px; height: 900px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(132, 41, 255, 0.14), rgba(132, 41, 255, 0)); }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(rgba(25, 23, 23, 0.16) 1.1px, transparent 1.3px); background-size: 18px 18px;
    -webkit-mask-image: linear-gradient(90deg, transparent 8%, #000 62%); mask-image: linear-gradient(90deg, transparent 8%, #000 62%); }
  .left { position: absolute; left: 72px; top: 62px; bottom: 58px; width: 548px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 25px; font-weight: 600; letter-spacing: -0.03em; }
  .brand svg { width: 34px; height: 34px; }
  .badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; margin-top: auto; height: 40px; padding: 0 17px 0 15px;
    border-radius: 999px; background: rgba(22, 163, 74, 0.10); color: #15803D; font-size: 18px; font-weight: 500; white-space: nowrap; }
  .badge i { width: 10px; height: 10px; border-radius: 50%; background: #16A34A; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.2); }
  h1 { margin-top: 22px; font-size: 80px; line-height: 1.02; font-weight: 600; letter-spacing: -0.045em; white-space: nowrap; }
  p { margin-top: 18px; font-size: 25px; line-height: 1.38; color: #5E5E6B; }
  .url { margin-top: 26px; font-size: 19px; font-weight: 500; color: #9A9AA6; }
  .url b { color: #8429FF; font-weight: 500; }
  .shot { position: absolute; left: 680px; top: 54px; width: 462px; height: 640px; overflow: hidden;
    border-radius: 28px; border: 1px solid #E5E5EA; background: #FFFFFF;
    box-shadow: 0 34px 80px rgba(30, 12, 60, 0.18), 0 4px 14px rgba(30, 12, 60, 0.06); }
  .shot img { display: block; width: 100%; }
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="left">
    <div class="brand">${MARK}<span>Ecosystem</span></div>
    <span class="badge"><i></i>Live data · ${esc(day)}</span>
    <h1 id="t">${esc(p.name)}</h1>
    <p id="d">${esc(p.description)}</p>
    <div class="url">${esc(SITE.replace(/^https?:\/\//, ''))}<b>${esc(p.path === '/' ? '' : p.path)}</b></div>
  </div>
  <div class="shot"><img alt="" src="data:image/png;base64,${shot.toString('base64')}"></div>
  <script>
    // The name keeps one line: a long one steps down a size at a time. The
    // line under it is never cut: past four lines it steps down too.
    const t = document.getElementById('t'); let s = 80;
    while (t.scrollWidth > t.parentElement.clientWidth && s > 52) { s -= 2; t.style.fontSize = s + 'px'; }
    const d = document.getElementById('d'); let z = 25;
    while (d.getBoundingClientRect().height > 25 * 1.38 * 4 + 1 && z > 19) { z -= 1; d.style.fontSize = z + 'px'; }
  </script>
</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cardCtx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
let made = 0;
for (const p of PAGES) {
  if (ONLY && !ONLY.includes(p.card)) continue;
  const t0 = Date.now();
  try {
    const shot = await screenshot(p);
    const page = await cardCtx.newPage();
    await page.setContent(cardHtml(p, shot, day), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const file = path.join(OUT, p.card + '.png');
    await page.screenshot({ path: file });
    await page.close();
    made++;
    console.log(`${p.card.padEnd(18)} ${(fs.statSync(file).size / 1024).toFixed(0).padStart(5)} KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`${p.card}: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}
await browser.close();
server.close();
console.log(`${made} cards in ${path.relative(process.cwd(), OUT) || OUT}`);
