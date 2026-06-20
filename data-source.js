// =====================================================================
// data-source.js — keep the dashboard's data fresh without a redeploy.
//
// Why this exists:
//   The data JSONs (activity-events.json, ipor-vaults.json, vault-holders
//   .json, tvl-snapshots.json, rebalance-events-*.json, …) are committed
//   to the repo every few minutes by the GitHub Action crons, with
//   "[skip ci]" in the message. Vercel honors "[skip ci]" and SKIPS the
//   deployment, so those data commits never reach the deployed site — the
//   app kept serving whatever data was bundled at the last *code* deploy,
//   which is why the "updated X min ago" label could lag for hours.
//
//   Rather than redeploy on every data commit (which would burn Vercel
//   deploys), we read the data files straight from GitHub's raw CDN, which
//   reflects the latest commit on the branch within ~minutes. If that ever
//   fails (CORS / offline / branch renamed) we fall back to the normal
//   same-origin path, so behaviour degrades to exactly what it is today —
//   never worse.
//
// How:
//   Wrap window.fetch. Same-origin requests for one of our root-level data
//   JSONs get redirected to raw.githubusercontent.com (cache-busted to a
//   2-minute bucket). Everything else is untouched.
// =====================================================================
(function () {
  var OWNER  = 'maderaz';
  var REPO   = 'fusionstats';
  var BRANCH = 'claude/morpho-vault-demand-tracker-Zp6AV'; // Vercel's deploy branch
  var RAW    = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/';

  // Don't redirect during local dev or if we're already on a GitHub origin.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || /github\.(io|com)$/.test(host)) return;

  if (!window.fetch || window.__fusionDataPatched) return;
  window.__fusionDataPatched = true;

  // Matches a bare data JSON living at the repo root, e.g. "ipor-vaults.json",
  // "../activity-events.json", "/rebalance-events-0xabc.json".
  var DATA_JSON = /^(?:\.{0,2}\/)*[a-z0-9][a-z0-9._-]*\.json(?:\?.*)?$/i;

  var nativeFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    // Only touch plain string URLs (the app never fetches data via Request objects).
    if (typeof input !== 'string') return nativeFetch(input, init);

    // Skip absolute URLs and anything that isn't one of our root data JSONs.
    if (/^[a-z]+:\/\//i.test(input) || !DATA_JSON.test(input)) return nativeFetch(input, init);

    var file = input.split('?')[0].split('/').pop();
    var bust = 't=' + Math.floor(Date.now() / 120000); // 2-minute cache bucket
    var cdnUrl = RAW + file + '?' + bust;

    return nativeFetch(cdnUrl, init)
      .then(function (res) {
        // On any non-OK (404 on a brand-new file, CORS reject surfaced as !ok,
        // rate limit, …) fall back to the same-origin copy.
        return res && res.ok ? res : nativeFetch(input, init);
      })
      .catch(function () { return nativeFetch(input, init); });
  };
})();
