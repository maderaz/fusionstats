// =====================================================================
// data-source.js — keep the dashboard's data fresh without a redeploy,
// and get it on screen as early as possible.
//
// Why this exists:
//   The data JSONs (activity-events.json, ipor-vaults.json, vault-holders
//   .json, tvl-snapshots.json, rebalance-events-*.json, …) are committed
//   to the repo every few minutes by the GitHub Action crons. The site
//   serves whatever was bundled at its last deploy, which can lag the data
//   by hours.
//
//   So we read the data files straight from GitHub's raw CDN, which
//   reflects the latest commit on the branch within ~minutes. If that ever
//   fails (CORS / offline / branch renamed) we fall back to the normal
//   same-origin path, so behaviour degrades to exactly what it is today —
//   never worse.
//
// How:
//   Wrap window.fetch. Same-origin requests for one of our root-level data
//   JSONs get redirected to raw.githubusercontent.com (cache-busted to a
//   2-minute bucket). Everything else is untouched.
//
// And, for speed (window.FusionData):
//   preload(files)  Start fetching now. Called from a page's <head>, so the
//                   data is on its way while the rest of the page loads; the
//                   page's own first fetch of the file takes that response.
//   cached(file)    The copy kept from the last visit, parsed, or null. A
//                   page can draw from it at once and redraw if the fresh
//                   file differs. Kept for the few files a page needs to
//                   draw (KEEP), for up to three days.
// =====================================================================
(function () {
  var OWNER  = 'maderaz';
  var REPO   = 'fusionstats';
  var BRANCH = 'claude/morpho-vault-demand-tracker-Zp6AV'; // Vercel's deploy branch
  var RAW    = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/';

  if (!window.fetch || window.__fusionDataPatched) return;
  window.__fusionDataPatched = true;

  // Don't redirect during local dev or if we're already on a GitHub origin.
  var host = location.hostname;
  var direct = host === 'localhost' || host === '127.0.0.1' || /github\.(io|com)$/.test(host);

  // Matches a bare data JSON living at the repo root, e.g. "ipor-vaults.json",
  // "../activity-events.json", "/rebalance-events-0xabc.json", or one of the
  // Explorer's files a vault, "/explorer/vaults/base-0xabc.json".
  var DATA_JSON = /^(?:\.{0,2}\/)*(?:explorer\/vaults\/)?[a-z0-9][a-z0-9._-]*\.json(?:\?.*)?$/i;
  // Its path in the repository: the root file's name, or the Explorer's path.
  var repoPath = function (input) { return input.split('?')[0].replace(/^(?:\.{0,2}\/)*/, ''); };

  var nativeFetch = window.fetch.bind(window);

  function fromNetwork(input, init) {
    if (direct) return nativeFetch(input, init);
    var bust = 't=' + Math.floor(Date.now() / 120000); // 2-minute cache bucket
    var cdnUrl = RAW + repoPath(input) + '?' + bust;

    return nativeFetch(cdnUrl, init)
      .then(function (res) {
        // On any non-OK (404 on a brand-new file, CORS reject surfaced as !ok,
        // rate limit, …) fall back to the same-origin copy.
        return res && res.ok ? res : nativeFetch(input, init);
      })
      .catch(function () { return nativeFetch(input, init); });
  }

  // What a page needs to draw, small enough to keep a copy of on every fetch.
  // The full event history (activity-events.json, 19 MB) is not.
  var KEEP = { 'activity-recent.json': 1, 'activity-recent-tx.json': 1, 'ipor-vaults.json': 1, 'stocks-data.json': 1 };
  var STORE = 'fusion-data-v1';
  var MAX_AGE_MS = 3 * 86400000;
  var keyOf = function (file) { return '/__data/' + file; };

  function keep(file, res) {
    if (!KEEP[file] || !res || !res.ok || !window.caches) return;
    try {
      var copy = res.clone();
      copy.blob().then(function (body) {
        return caches.open(STORE).then(function (c) {
          return c.put(keyOf(file), new Response(body, {
            headers: { 'content-type': 'application/json', 'x-kept-at': String(Date.now()) },
          }));
        });
      }).catch(function () {});
    } catch (e) {}
  }

  function load(input, init) {
    var file = input.split('?')[0].split('/').pop();
    return fromNetwork(input, init).then(function (res) { keep(file, res); return res; });
  }

  // Started from <head>; handed to the page's first fetch of the same file.
  var early = {};

  window.fetch = function (input, init) {
    // Only touch plain string URLs (the app never fetches data via Request objects).
    if (typeof input !== 'string') return nativeFetch(input, init);

    // Skip absolute URLs and anything that isn't one of our root data JSONs.
    if (/^[a-z]+:\/\//i.test(input) || !DATA_JSON.test(input)) return nativeFetch(input, init);

    var file = input.split('?')[0].split('/').pop();
    if (early[file] && !init) {
      var p = early[file];
      delete early[file];
      return p;
    }
    return load(input, init);
  };

  window.FusionData = {
    preload: function (files) {
      files.forEach(function (f) {
        if (early[f]) return;
        early[f] = load('/' + f);
        // A failure is the page's to handle when it asks for the file; until
        // then it is not an uncaught error.
        early[f].catch(function () {});
      });
    },
    cached: function (file) {
      if (!window.caches || !KEEP[file]) return Promise.resolve(null);
      return caches.open(STORE)
        .then(function (c) { return c.match(keyOf(file)); })
        .then(function (res) {
          if (!res || Date.now() - (+res.headers.get('x-kept-at') || 0) > MAX_AGE_MS) return null;
          return res.json();
        })
        .catch(function () { return null; });
    },
  };
})();
