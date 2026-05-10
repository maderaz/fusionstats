// POST /api/log — accepts a beacon { path, sessionId } from track.js, enriches
// it with geo + UA on the edge, and appends an entry to a private GitHub Gist
// (one file: traffic-log.json). Fire-and-forget from the browser (sendBeacon).
//
// Why a gist (not Supabase, not the repo itself):
//   - Zero third-party signups beyond GitHub (you already have it).
//   - Updates don't touch the repo, so Vercel won't redeploy on every visit.
//   - Free, private, version-controlled (gist keeps revision history).
//
// Required env vars (set in Vercel → Project Settings → Environment Variables):
//   GITHUB_TOKEN  — fine-grained PAT, scope: `gist` (read+write). Server-side only.
//   GIST_ID       — id of a secret gist containing one file: `traffic-log.json`
//                   seeded with `{"entries":[]}`.
//
// The setup card in /admin/index.html walks through this when env is missing.

export const config = { runtime: 'edge' };

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const FILENAME = 'traffic-log.json';
const MAX_ENTRIES = 5000; // FIFO trim so the gist file stays small forever

function parseUserAgent(ua) {
  ua = ua || '';
  const isTablet = /iPad|Tablet|Nexus 7|Nexus 10/i.test(ua);
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod|Mobile/i.test(ua);
  const device = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  let browser = 'Unknown';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os = 'Unknown';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return { device, browser, os };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function readGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'fusionstats-traffic-logger',
    },
  });
  if (!res.ok) throw new Error(`gist read ${res.status}`);
  const json = await res.json();
  const file = (json.files || {})[FILENAME];
  if (!file) return { entries: [] };
  let content = file.content;
  if (file.truncated && file.raw_url) {
    // gist API caps per-file content at ~1MB; fetch raw if it's bigger
    const raw = await fetch(file.raw_url, {
      headers: { authorization: `Bearer ${GITHUB_TOKEN}`, 'user-agent': 'fusionstats-traffic-logger' },
    });
    content = await raw.text();
  }
  try {
    const parsed = JSON.parse(content || '{}');
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'fusionstats-traffic-logger',
    },
    body: JSON.stringify({
      files: { [FILENAME]: { content: JSON.stringify(data) } },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gist write ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!GITHUB_TOKEN || !GIST_ID) {
    return jsonResponse({ ok: false, error: 'storage_not_configured' }, 503);
  }

  let body = {};
  try { body = await req.json(); } catch { /* tolerate */ }

  const ua = req.headers.get('user-agent') || '';
  const { device, browser, os } = parseUserAgent(ua);
  const referrer = req.headers.get('referer') || '';

  const geo = req.geo || {};
  const country = geo.country || req.headers.get('x-vercel-ip-country') || null;
  const region  = geo.region  || req.headers.get('x-vercel-ip-country-region') || null;
  const city    = geo.city    || req.headers.get('x-vercel-ip-city')    || null;

  const entry = {
    ts: new Date().toISOString(),
    path:       (typeof body.path === 'string' ? body.path : '/').slice(0, 256),
    session_id: (typeof body.sessionId === 'string' ? body.sessionId : '').slice(0, 64),
    referrer:   referrer.slice(0, 512),
    user_agent: ua.slice(0, 512),
    country, region, city,
    device, browser, os,
  };

  try {
    const data = await readGist();
    data.entries.push(entry);
    if (data.entries.length > MAX_ENTRIES) {
      data.entries.splice(0, data.entries.length - MAX_ENTRIES);
    }
    await writeGist(data);
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false, error: 'storage_error', detail: String(e.message || e).slice(0, 200) }, 502);
  }
}
