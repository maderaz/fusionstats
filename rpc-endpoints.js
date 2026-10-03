'use strict';
// rpc-endpoints.js — which endpoints a collector calls, in what order.
//
// Every collector here ran on free public endpoints, and free endpoints change
// their terms without notice: in September every Ethereum endpoint the
// collectors used stopped serving eth_getLogs within days of each other, and
// five datasets went stale or quietly wrong at once. Public lists are kept in
// each collector; this adds the one thing they cannot provide — a keyed
// endpoint that does not disappear — ahead of them, when one is configured.
//
//   RPC_URL_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/<key>
//   RPC_URL_BASE=...,...          (comma-separated; tried in order)
//
// Set as GitHub Actions secrets and passed through by the workflows. Unset, a
// collector behaves exactly as it did without this module.
//
// A keyed URL carries its key. Nothing in any collector prints an endpoint
// URL, and nothing should start to.

function keyedEndpoints(chain) {
  const raw = process.env['RPC_URL_' + String(chain).toUpperCase()] || '';
  return raw.split(',').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
}

// Keyed endpoints first, then the collector's public list, without duplicates.
function rpcEndpoints(chain, publicList) {
  const out = [];
  for (const u of [...keyedEndpoints(chain), ...(publicList || [])]) if (!out.includes(u)) out.push(u);
  return out;
}

module.exports = { rpcEndpoints, keyedEndpoints };
