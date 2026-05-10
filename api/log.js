// POST /api/log — accepts a beacon { path, sessionId } from track.js, enriches
// it with geo + UA on the edge, and inserts a row into Supabase. Synchronous,
// fire-and-forget from the browser (sendBeacon).
//
// Required env vars (set in Vercel Project Settings → Environment Variables):
//   SUPABASE_URL                — e.g. https://xyzcompany.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key (server-side only, never ship to browser)
//
// See admin/index.html for the matching `traffic_logs` table schema.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req) {
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ ok: false, error: 'storage_not_configured' }, 503);
  }

  let body = {};
  try { body = await req.json(); } catch { /* tolerate empty / malformed */ }

  const ua = req.headers.get('user-agent') || '';
  const { device, browser, os } = parseUserAgent(ua);
  const referrer = req.headers.get('referer') || '';

  // Vercel Edge runtime exposes geo on req.geo; fall back to headers if missing
  // (e.g. local dev or proxied requests).
  const geo = req.geo || {};
  const country = geo.country || req.headers.get('x-vercel-ip-country') || null;
  const region  = geo.region  || req.headers.get('x-vercel-ip-country-region') || null;
  const city    = geo.city    || req.headers.get('x-vercel-ip-city')    || null;

  const row = {
    path:       (typeof body.path === 'string' ? body.path : '/').slice(0, 256),
    session_id: (typeof body.sessionId === 'string' ? body.sessionId : '').slice(0, 64),
    referrer:   referrer.slice(0, 512),
    user_agent: ua.slice(0, 512),
    country, region, city,
    device, browser, os,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/traffic_logs`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return jsonResponse({ ok: false, error: 'insert_failed', status: res.status, detail: detail.slice(0, 200) }, 502);
  }
  return jsonResponse({ ok: true });
}
