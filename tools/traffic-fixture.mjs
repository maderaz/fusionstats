// traffic-fixture.mjs — made-up traffic, shaped as /api/logs returns it, for
// the Traffic page (/admin) when no real log is to hand: tools/ui-audit.mjs
// serves it, and so can a test. Deterministic: the same rows every time,
// relative to `now`. No real visitor is in it.
//
//   import { trafficRows } from './traffic-fixture.mjs';
//   trafficRows(Date.now()) → [{ ts, path, session_id, ref?, country, region, city, device, browser, os, ... }]  newest first

const PAGES = ['/', '/', '/', '/stocks', '/stocks', '/stocks/aave-v4', '/explorer', '/explorer/?v=0xe883426b4fc84a7f5cc86415cabbef43e73a4cc8&c=base',
  '/finances/dao', '/finances/curator', '/protocol-tvl', '/all-vaults', '/switchers', '/dust', '/dominance', '/monitor', '/tvl',
  '/address/?a=0x17d0f109ee895bad0b68aa104aa72bd0b003ad8e', '/spark', '/logs'];
const PLACES = [['PL', '02', 'Wroc%C5%82aw'], ['PL', '14', 'Warsaw'], ['US', 'NY', 'New%20York'], ['US', 'CA', 'San%20Francisco'],
  ['DE', 'BE', 'Berlin'], ['GB', 'ENG', 'London'], ['SG', '', 'Singapore'], ['KR', '11', 'Seoul'], ['CH', 'ZH', 'Z%C3%BCrich'], ['AE', 'DU', 'Dubai']];
const KITS = [['desktop', 'Chrome', 'Windows'], ['desktop', 'Chrome', 'macOS'], ['desktop', 'Safari', 'macOS'], ['mobile', 'Safari', 'iOS'],
  ['mobile', 'Chrome', 'Android'], ['desktop', 'Firefox', 'Linux'], ['tablet', 'Safari', 'iOS'], ['desktop', 'Edge', 'Windows']];
const REFS = ['', '', '', 'x.com', 't.co', 'google.com', 'app.ipor.io', 'telegram.org', 'debank.com'];

// A small seeded generator, so the rows never change between runs.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-a${hex(r, 3)}-${hex(r, 12)}`;

// The site's owner, from Wrocław, looking at the pages often, now and then
// from Warsaw: the city the page hides, and the visitor a "this is me"
// switch leaves out.
export const OWNER = '2fce9424-1c2d-4e5f-9a7b-3c4d5e6f7a8b';

export function trafficRows(now = Date.now(), { days = 35, visitors = 140 } = {}) {
  const r = rng(20261007);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const people = [{ id: OWNER, place: PLACES[0], away: PLACES[1], kit: KITS[0], weight: 9, since: days }];
  for (let i = 0; i < visitors; i++) {
    people.push({ id: uuid(r), place: pick(PLACES), kit: pick(KITS), weight: r() < 0.15 ? 4 : 1, since: Math.floor(r() * days) + 1 });
  }
  const rows = [];
  for (const p of people) {
    const visits = Math.max(1, Math.round(p.weight * (1 + r() * 3)));
    for (let v = 0; v < visits; v++) {
      const at = now - Math.floor(r() * p.since * 864e5);
      const views = 1 + Math.floor(r() * (p.weight > 1 ? 5 : 3));
      const from = pick(REFS);
      const place = p.away && r() < 0.25 ? p.away : p.place;
      for (let k = 0; k < views; k++) {
        const row = {
          ts: new Date(at + k * 45000).toISOString(),
          path: pick(PAGES),
          session_id: p.id,
          referrer: 'https://fusionecosystem.xyz/',
          user_agent: '',
          country: place[0], region: place[1] || null, city: place[2],
          device: p.kit[0], browser: p.kit[1], os: p.kit[2],
        };
        // Where a visitor came from: recorded for the last ten days only, as
        // the beacon began sending it then; the first view of a visit only.
        if (now - at < 10 * 864e5) row.ref = k === 0 ? from : '';
        rows.push(row);
      }
    }
  }
  return rows.filter(x => Date.parse(x.ts) <= now).sort((a, b) => (a.ts < b.ts ? 1 : -1));
}
