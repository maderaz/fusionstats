'use strict';
// operators.js — who runs each vault, for the Explorer's list: a vault's
// name says so for most (TAU…, TESS…, Harvest…), or its share symbol
// (TAUUSDCTZS, $TAUSIUSDETH, tessUSDC…); one whose neither does takes the
// operator of the vaults its owner (the atomist, from the governance
// history) also runs. Logos are DefiLlama's, 64px (icons/operators/<id>.png).
(function (root) {
  const OPERATORS = [
    // owners: atomists known to be the operator's, read on-chain (the IPOR
    // tool): Tau Labs' Safe on Ethereum and Base (the stock carry trades),
    // and its Tezos series'.
    { id: 'tau', name: 'Tau Labs', logo: 'tau.png', match: /^tau\b/i, sym: /^\$?tau/i,
      owners: ['0xd556a9fa4dd83ade79b89f4a431c57169d00d4a6', '0xd0d7bb5463db1a15dfb6116d7be16967f077052a'] },
    { id: 'tesseract', name: 'Tesseract', logo: 'tesseract.png', match: /^(tess|tesseract)/i, sym: /^tess/i },
    { id: 'harvest', name: 'Harvest', logo: 'harvest.png', match: /^harvest\b/i },
    { id: 'autopilot', name: 'Autopilot', logo: 'autopilot.png', match: /^(autopilot|pilot)\b/i },
    { id: 'ipor', name: 'IPOR', logo: 'ipor.png', match: /^(ipor|fusion)\b/i },
    { id: 'reservoir', name: 'Reservoir', logo: 'reservoir.png', match: /^reservoir\b/i },
    { id: 'ensuro', name: 'Ensuro', logo: 'ensuro.png', match: /^ensuro\b/i },
    { id: 'yo', name: 'Yo', logo: 'yo.png', match: /^yo(usd|eth|gold|btc)?\b|^yo\s/i },
    { id: 'hyperithm', name: 'Hyperithm', logo: 'hyperithm.png', match: /^hyperithm\b/i },
    { id: 'origin', name: 'Origin Protocol', logo: 'origin.png', match: /^origin\b/i },
    { id: 'llamarisk', name: 'LlamaRisk', logo: 'llamarisk.png', match: /^llamarisk\b/i },
    { id: 'strata', name: 'Strata', logo: 'strata.png', match: /^strata\b/i },
    { id: 'tanken', name: 'Tanken Capital', logo: 'tanken.png', match: /^tanken\b/i },
    { id: 'k3', name: 'K3 Capital', logo: 'k3.png', match: /^[kк]3\b/i },
    // Clearstar's Safes: the Base Lending Optimizers' and Loooper's atomist,
    // and Clearstar Core's (also AlchemistCS's); they share an alpha and a
    // management-fee recipient (read with the IPOR tool). Its Base vaults are
    // also pinned by address (vaults), since a Base vault's atomist can be
    // missing from the data (the free endpoints refuse its history).
    { id: 'clearstar', name: 'Clearstar', logo: 'clearstar.png', match: /^clearstar\b/i,
      owners: ['0xb3cf59a5f12ca319861376c5e63eef4790a42b44', '0x30988479c2e6a03e7fb65138b94762d41a733458'],
      vaults: ['0x5900c3b72458f12967dc1bef35b92d271f5cdbc1', '0x17d0f109ee895bad0b68aa104aa72bd0b003ad8e', '0xd46a3c2d958d0a2cb098d48c48dc19fe3a710f37'] },
    { id: 'alphayields', name: 'AlphaYields', logo: null, match: /^alphayields\b/i },
    // Sentinel Codes: its named vaults, and rETH Liquity LP Carry (the same
    // rETH / Liquity V2 / Uniswap V4 BOLD-USDC strategy, its atomist 0x3278…).
    { id: 'sentinel', name: 'Sentinel Codes', logo: null, match: /^sentinel\b/i,
      owners: ['0xfd5cbab07ee70bbfd42ea97d161a1794d4c06a67', '0x32787cd59244581a358a068d52e460eb00df6543'],
      vaults: ['0xb9e806e8f2d94c015ffefa90cd24ecce18f1663c'] },
  ];
  const byName = (name, sym) => OPERATORS.find(o => o.match.test(String(name || '').trim()))
    || (sym ? OPERATORS.find(o => o.sym && o.sym.test(String(sym).trim())) : null) || null;
  // vaults: [{ address, name, shareSymbol, owner, iporAlpha }]; returns
  // { address: operator id }. A vault pinned to an operator first; then its
  // name or share symbol; else its owner's other vaults'; else IPOR, where
  // IPOR's own alpha runs it and nothing names another operator.
  function assign(vaults) {
    const out = {}, ownerOp = {}, pinned = {};
    for (const o of OPERATORS) for (const a of o.owners || []) ownerOp[a] = o.id;
    for (const o of OPERATORS) for (const a of o.vaults || []) pinned[a] = o.id;
    for (const v of vaults) if (pinned[String(v.address).toLowerCase()]) out[v.address] = pinned[String(v.address).toLowerCase()];
    for (const v of vaults) { if (out[v.address]) continue; const o = byName(v.name, v.shareSymbol); if (o) { out[v.address] = o.id; if (v.owner) ownerOp[v.owner] = ownerOp[v.owner] || o.id; } }
    for (const v of vaults) if (!out[v.address] && v.owner && ownerOp[v.owner]) out[v.address] = ownerOp[v.owner];
    for (const v of vaults) if (!out[v.address] && v.iporAlpha) out[v.address] = 'ipor';
    return out;
  }
  const api = { OPERATORS, byName, assign, get: (id) => OPERATORS.find(o => o.id === id) || null };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FusionOperators = api;
})(typeof window !== 'undefined' ? window : globalThis);
