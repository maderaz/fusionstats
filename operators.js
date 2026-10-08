'use strict';
// operators.js — who runs each vault, for the Explorer's list: a vault's
// name says so for most (TAU…, TESS…, Harvest…); one whose name doesn't
// takes the operator of the vaults its owner (the atomist, from the
// governance history) also runs. Logos are DefiLlama's, 64px (icons/operators/<id>.png).
(function (root) {
  const OPERATORS = [
    { id: 'tau', name: 'Tau Labs', logo: 'tau.png', match: /^tau\b/i },
    { id: 'tesseract', name: 'Tesseract', logo: 'tesseract.png', match: /^(tess|tesseract)/i },
    { id: 'harvest', name: 'Harvest', logo: 'harvest.png', match: /^harvest\b/i },
    { id: 'autopilot', name: 'Autopilot', logo: 'autopilot.png', match: /^(autopilot|pilot)\b/i },
    { id: 'ipor', name: 'IPOR', logo: 'ipor.png', match: /^(ipor|fusion)\b|^base (eth|usdc|cbeth|cbbtc)\b/i },
    { id: 'reservoir', name: 'Reservoir', logo: 'reservoir.png', match: /^reservoir\b/i },
    { id: 'ensuro', name: 'Ensuro', logo: 'ensuro.png', match: /^ensuro\b/i },
    { id: 'yo', name: 'Yo', logo: 'yo.png', match: /^yo(usd|eth|gold|btc)?\b|^yo\s/i },
    { id: 'hyperithm', name: 'Hyperithm', logo: 'hyperithm.png', match: /^hyperithm\b/i },
    { id: 'origin', name: 'Origin Protocol', logo: 'origin.png', match: /^origin\b/i },
    { id: 'llamarisk', name: 'LlamaRisk', logo: 'llamarisk.png', match: /^llamarisk\b/i },
    { id: 'strata', name: 'Strata', logo: 'strata.png', match: /^strata\b/i },
    { id: 'tanken', name: 'Tanken Capital', logo: 'tanken.png', match: /^tanken\b/i },
    { id: 'k3', name: 'K3 Capital', logo: 'k3.png', match: /^[kк]3\b/i },
    { id: 'clearstar', name: 'Clearstar', logo: 'clearstar.png', match: /^clearstar\b/i },
    { id: 'alphayields', name: 'AlphaYields', logo: null, match: /^alphayields\b/i },
    { id: 'sentinel', name: 'Sentinel', logo: null, match: /^sentinel\b/i },
  ];
  const byName = (name) => OPERATORS.find(o => o.match.test(String(name || '').trim())) || null;
  // vaults: [{ address, name, owner, iporAlpha }]; returns { address: operator
  // id }. Its name first; else its owner's other vaults'; else IPOR, where
  // IPOR's own alpha runs it and nothing names another operator.
  function assign(vaults) {
    const out = {}, ownerOp = {};
    for (const v of vaults) { const o = byName(v.name); if (o) { out[v.address] = o.id; if (v.owner) ownerOp[v.owner] = ownerOp[v.owner] || o.id; } }
    for (const v of vaults) if (!out[v.address] && v.owner && ownerOp[v.owner]) out[v.address] = ownerOp[v.owner];
    for (const v of vaults) if (!out[v.address] && v.iporAlpha) out[v.address] = 'ipor';
    return out;
  }
  const api = { OPERATORS, byName, assign, get: (id) => OPERATORS.find(o => o.id === id) || null };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FusionOperators = api;
})(typeof window !== 'undefined' ? window : globalThis);
