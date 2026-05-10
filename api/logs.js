// GET /api/logs — returns the most recent traffic_logs rows from Supabase.
// Used by /admin/index.html. No auth: relies on the page being unlinked and
// noindex'd. Tighten this if you start logging anything sensitive.
//
// Query params:
//   ?limit=N   — max rows (default 500, hard cap 5000)
//   ?since=ISO — only rows with ts >= ISO timestamp

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ ok: false, error: 'storage_not_configured' }, 503);
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5000, parseInt(url.searchParams.get('limit') || '500', 10)));
  const since = url.searchParams.get('since');

  const params = new URLSearchParams({ select: '*', order: 'ts.desc', limit: String(limit) });
  if (since) params.append('ts', `gte.${since}`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/traffic_logs?${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return jsonResponse({ ok: false, error: 'fetch_failed', status: res.status, detail: detail.slice(0, 300) }, 502);
  }
  const rows = await res.json();
  return jsonResponse({ ok: true, count: rows.length, rows });
}
