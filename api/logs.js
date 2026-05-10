// GET /api/logs — returns recent traffic entries from the secret gist used as
// our internal log store. Used by /admin/index.html.
//
// Query params:
//   ?limit=N   — max rows (default 500, hard cap 5000)

export const config = { runtime: 'edge' };

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const FILENAME = 'traffic-log.json';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!GITHUB_TOKEN || !GIST_ID) {
    return jsonResponse({ ok: false, error: 'storage_not_configured' }, 503);
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5000, parseInt(url.searchParams.get('limit') || '500', 10)));

  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'fusionstats-traffic-logger',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return jsonResponse({ ok: false, error: 'fetch_failed', status: res.status, detail: detail.slice(0, 200) }, 502);
    }
    const json = await res.json();
    const file = (json.files || {})[FILENAME];
    let content = file ? file.content : '{"entries":[]}';
    if (file && file.truncated && file.raw_url) {
      const raw = await fetch(file.raw_url, {
        headers: { authorization: `Bearer ${GITHUB_TOKEN}`, 'user-agent': 'fusionstats-traffic-logger' },
      });
      content = await raw.text();
    }
    let entries = [];
    try { entries = JSON.parse(content || '{}').entries || []; } catch {}

    // newest first, capped
    const rows = entries.slice().reverse().slice(0, limit);
    return jsonResponse({ ok: true, count: rows.length, rows });
  } catch (e) {
    return jsonResponse({ ok: false, error: 'storage_error', detail: String(e.message || e).slice(0, 200) }, 502);
  }
}
