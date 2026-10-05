// /api/refresh — start a "Collect Fusion Stats" run now.
//
// The collector is scheduled every 5 minutes, but GitHub runs scheduled
// workflows best-effort and in practice starts it only every 3–6 hours. A run
// started on request (workflow_dispatch) is not dropped. So the Activity page's
// refresh button asks here, and so can an outside scheduler for steady hourly
// updates.
//
//   GET  /api/refresh   whether refreshing is set up, and whether a run is underway
//   POST /api/refresh   start a run, unless one is underway or started recently
//
// A run is started at most once per cooldown (default 15 minutes), counting
// scheduled runs too, so the public button cannot be used to flood Actions.
//
// Required env var (Vercel → Project Settings → Environment Variables):
//   GITHUB_DISPATCH_TOKEN — fine-grained PAT for maderaz/fusionstats only, with
//                           the single permission "Actions: Read and write".
//                           Server-side only; never sent to the browser.
// Optional:
//   REFRESH_COOLDOWN_MIN  — minutes between runs this endpoint starts (min 5, default 15)
//   CRON_SECRET           — lets Vercel Cron start a run with a GET (Vercel sends it
//                           as "Authorization: Bearer <CRON_SECRET>")

export const config = { runtime: 'edge' };

const TOKEN = process.env.GITHUB_DISPATCH_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;
const COOLDOWN_MIN = Math.max(5, Number(process.env.REFRESH_COOLDOWN_MIN) || 15);

const OWNER = 'maderaz';
const REPO = 'fusionstats';
const WORKFLOW = 'collect.yml';
const BRANCH = 'claude/morpho-vault-demand-tracker-Zp6AV'; // where the data lives and Vercel deploys from
const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`;
// Every state a run is in before it finishes.
const UNFINISHED = new Set(['requested', 'queued', 'pending', 'waiting', 'in_progress']);

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache },
  });
}

function github(path, init = {}) {
  return fetch(API + path, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'fusionstats-refresh',
      ...(init.headers || {}),
    },
  });
}

// The newest runs of the collector, newest first.
async function recentRuns() {
  const res = await github(`/runs?branch=${encodeURIComponent(BRANCH)}&per_page=10`);
  if (!res.ok) throw new Error(`github_${res.status}`);   // 401: the token expired or was revoked
  const body = await res.json();
  return body.workflow_runs || [];
}

function summarize(runs) {
  const underway = runs.find(r => UNFINISHED.has(r.status));
  // When a run last started. A re-run keeps its run's old created_at.
  const starts = runs.map(r => Date.parse(r.run_started_at || r.created_at)).filter(Number.isFinite);
  return {
    running: !!underway,
    runningSince: underway ? (underway.run_started_at || underway.created_at) : null,
    lastRunAt: starts.length ? new Date(Math.max(...starts)).toISOString() : null,
  };
}

async function startRun() {
  const s = summarize(await recentRuns());
  if (s.running) return json({ state: 'running', since: s.runningSince });
  const ageMin = s.lastRunAt ? (Date.now() - Date.parse(s.lastRunAt)) / 60000 : Infinity;
  if (ageMin < COOLDOWN_MIN) {
    return json({ state: 'recent', lastRunAt: s.lastRunAt, retryInMin: Math.ceil(COOLDOWN_MIN - ageMin) });
  }
  const res = await github('/dispatches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (res.status !== 204) return json({ state: 'error', error: `dispatch_${res.status}` }, 502);
  return json({ state: 'started' }, 202);
}

// What went wrong, without anything from the request or the token in it.
const reason = e => (/^github_\d+$/.test(e && e.message) ? e.message : 'github_unavailable');

export default async function handler(req) {
  const fromCron = !!CRON_SECRET && req.headers.get('authorization') === `Bearer ${CRON_SECRET}`;

  if (req.method === 'GET' && !fromCron) {
    if (!TOKEN) return json({ configured: false });
    try {
      // Cached briefly at the edge: every Activity page load asks.
      return json({ configured: true, cooldownMin: COOLDOWN_MIN, ...summarize(await recentRuns()) },
        200, 'public, s-maxage=20');
    } catch (e) {
      return json({ configured: true, error: reason(e) }, 502);
    }
  }

  if (req.method !== 'POST' && !fromCron) return json({ error: 'method_not_allowed' }, 405);
  if (!TOKEN) return json({ state: 'unconfigured' }, 503);
  try {
    return await startRun();
  } catch (e) {
    return json({ state: 'error', error: reason(e) }, 502);
  }
}
