// The newsroom's stories and their covers, shared by the News page and the
// article pages. Every cover is drawn here, as an SVG, in the hero's style.
(function () {
  'use strict';
  const S = [
    { d: '2026-08-20', cat: 'Ecosystem', min: 5, motif: 'shield', href: 'https://www.ipor.io/news/fusion-blockaid-onchain-threat-monitoring', big: 'Fusion × Blockaid', sub: 'Onchain threat monitoring',
      t: 'Fusion x Blockaid: Bringing Onchain Threat Monitoring to Fusion Vaults',
      x: 'Fusion has begun integrating Blockaid across its vault stack. Monitoring and post-transaction analysis are live for a selection of ecosystem vaults, with proactive detection in development.' },
    { d: '2026-07-15', cat: 'Ecosystem', min: 5, motif: 'share', pin: true, href: '/demo/news/cbeth-on-base', big: '~45%', sub: 'of cbETH on Base',
      t: 'Fusion Vaults Now Account for ~45% of cbETH on Base',
      x: "As of 15 July 2026, vaults built on Fusion hold around 30,500 cbETH on Base, roughly 45% of the network's cbETH and 19.3% of Coinbase's reported circulating supply." },
    { d: '2026-06-29', cat: 'Incentives', min: 3, motif: 'coins', href: 'https://www.ipor.io/news/base-rewards-fusion-strategies-anchorage-digital', big: 'Base Rewards', sub: 'via Anchorage Digital',
      t: 'Base Rewards Now Live for Select Fusion Strategies via Anchorage Digital',
      x: "From 29 June, wallets that reach select Fusion strategies on Base through the Porto by Anchorage Digital portal may earn Base-supported rewards in cbETH via Merkl, on top of each strategy's onchain results." },
    { d: '2026-06-24', cat: 'Strategies', min: 6, motif: 'chart', big: '2.75% → 15%', sub: 'cbETH on Aave',
      t: "Turning cbETH's 2.75% Native Yield to 15% on Aave with Fusion Automation",
      x: "There is far more yield inside Aave's markets than most participants ever reach. Fusion's automation turns that depth into performance, like TAU Labs' cbETH Dynamic Looping vault, which stacks cbETH's native yield into roughly 15% on Base." },
    { d: '2026-06-18', cat: 'Ecosystem', min: 4, motif: 'cover', big: 'Covered Vaults', sub: 'by OpenCover',
      t: 'Covered Vaults Come to Fusion: Embedded Onchain Protection by OpenCover',
      x: 'Onchain cover is now available for select Fusion vaults, provided by OpenCover and underwritten by Nexus Mutual, starting with a Covered Vault for the Liquity ETH Carry strategy.' },
    { d: '2026-06-09', cat: 'Ecosystem', min: 4, motif: 'pair', big: 'BitGo × Tesseract', sub: 'Dedicated Client Vaults',
      t: "BitGo Opens Institutional Access to Tesseract's Dedicated Client Vaults Powered by Fusion",
      x: "Eligible institutions can now allocate to Tesseract's Dedicated Client Vaults, powered by Fusion, directly from BitGo qualified custody, with assets staying inside the custodial perimeter." },
    { d: '2026-04-30', cat: 'Regulation', min: 10, motif: 'doc', big: 'MiCA in 2026', sub: 'for vault curators',
      t: 'How Vault Curators Can Navigate MiCA in 2026',
      x: "At Vault Summit during EthCC Cannes 2026, Stéphane Daniel of d&a partners laid out the MiCA legal considerations for vault curators, from CASP reclassification risk to three structuring strategies. A guest article, with a note on how Fusion's architecture relates." },
    { d: '2026-03-31', cat: 'Ecosystem', min: 5, motif: 'orbit', big: 'Tesseract × Fusion', sub: 'Institutional onchain yield',
      t: 'Tesseract Selects IPOR Fusion as Onchain Vault Infrastructure for Institutional Clients',
      x: 'Tesseract Investment Oy, a Helsinki-based MiCA-authorised CASP, has selected Fusion as its onchain vault infrastructure for institutional onchain yield, with 21Shares among the launch partners.' },
  ].sort((a, b) => b.d.localeCompare(a.d));

  const MARK = 'M72.9745 36.4854C72.9745 28.9218 65.2566 22.5 53.6982 19.2763C50.4708 7.71785 44.0491 0 36.4854 0C28.9218 0 22.5 7.71785 19.2763 19.2763C7.71785 22.5037 0 28.9254 0 36.4854C0 44.0454 7.71785 50.4708 19.2763 53.6982C22.5037 65.2566 28.9254 72.9745 36.4854 72.9745C44.0454 72.9745 50.4708 65.2566 53.6982 53.6982C65.2566 50.4708 72.9745 44.0491 72.9745 36.4854ZM26.8656 13.6513C29.5533 8.24658 33.0597 5.14769 36.4744 5.14769C39.889 5.14769 43.4065 8.24658 46.0832 13.6513C46.7734 15.0575 47.3756 16.5042 47.8859 17.9875C40.3223 16.7318 32.6008 16.7318 25.0371 17.9875C25.5475 16.5042 26.1643 15.0759 26.8546 13.6696L26.8656 13.6513ZM50.7792 36.5038C50.7829 39.8156 50.5112 43.1054 50.0008 46.3769L26.5939 22.9553C29.8654 22.4449 33.1736 22.1916 36.4854 22.1989C40.84 22.1842 45.1836 22.6285 49.4464 23.5281C50.346 27.7909 50.7902 32.0978 50.7756 36.4524M22.1953 36.4634C22.1916 33.1515 22.4486 29.8691 22.9553 26.5939L46.3769 50.0192C43.1054 50.5296 39.7973 50.7829 36.4854 50.7756C32.1308 50.7902 27.7872 50.3423 23.5244 49.4464C22.6248 45.1836 22.1806 40.84 22.1953 36.4854V36.4634ZM13.6549 46.0942C8.25025 43.4065 5.15136 39.9001 5.15136 36.4854C5.15136 33.0708 8.25392 29.5533 13.6549 26.8766C15.0612 26.1864 16.5078 25.5842 17.9912 25.0739C16.7355 32.6375 16.7355 40.359 17.9912 47.9227C16.5078 47.4123 15.0832 46.7991 13.677 46.1052L13.6549 46.0942ZM46.1162 59.3342C43.4285 64.7389 39.9221 67.8378 36.5074 67.8378C33.0928 67.8378 29.5753 64.7353 26.8987 59.3342C26.2084 57.928 25.6062 56.4813 25.0959 54.998C28.8704 55.6295 32.6889 55.9453 36.5185 55.9379C40.3443 55.9453 44.1665 55.6295 47.941 54.998C47.4307 56.4813 46.8212 57.9096 46.1309 59.3159L46.1199 59.3342H46.1162ZM59.3379 46.1089C57.9316 46.7991 56.4924 47.416 55.009 47.9227C55.6442 44.1482 55.9563 40.3297 55.9489 36.5001C55.9563 32.6742 55.6405 28.852 55.009 25.0775C56.4924 25.5842 57.939 26.1864 59.3452 26.8803C64.7499 29.568 67.8488 33.0744 67.8488 36.4891C67.8488 39.9037 64.7499 43.4212 59.3452 46.0978H59.3379V46.1089Z';
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const when = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  // A small seeded random, so a story's cover is the same on every visit.
  const rnd = (seed) => { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

  // The motifs, drawn at the cover's right, in lines of the theme's lavender.
  const L = 'fill="none" stroke="#D7B8FF" stroke-linecap="round" stroke-linejoin="round"';
  const MOTIF = {
    shield: () => `<g transform="translate(860 150)" ${L} stroke-width="3"><path d="M120 0l120 52v104c0 92-52 158-120 186C52 314 0 248 0 156V52z" fill="rgba(215,184,255,0.06)"/><path d="M120 44l84 36v74c0 64-36 110-84 130-48-20-84-66-84-130V80z" opacity="0.5"/><path d="M80 168l30 30 56-64" stroke-width="5"/></g>`,
    cover: () => `<g transform="translate(830 130)" ${L} stroke-width="3"><path d="M150 0l130 56v110c0 100-56 172-130 202C76 338 20 266 20 166V56z" fill="rgba(215,184,255,0.06)"/><circle cx="150" cy="180" r="62" opacity="0.6"/><path d="M150 132v96M102 180h96" stroke-width="5"/></g>`,
    share: (r) => {
      const a = 0.45 * Math.PI * 2, x = 1000 + 150 * Math.sin(a), y = 315 - 150 * Math.cos(a);
      return `<g ${L}><circle cx="1000" cy="315" r="150" stroke-width="3" opacity="0.35"/><path d="M1000 315V165A150 150 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}Z" fill="rgba(215,184,255,0.22)" stroke-width="3"/><circle cx="1000" cy="315" r="96" stroke-width="2" opacity="0.25"/></g>`;
    },
    coins: () => [0, 1, 2, 3].map(i => `<g ${L} stroke-width="3" transform="translate(${880 + i * 34} ${360 - i * 52})" opacity="${0.45 + i * 0.18}"><ellipse cx="80" cy="30" rx="80" ry="30" fill="#2C0C55"/><path d="M0 30v26c0 17 36 30 80 30s80-13 80-30V30"/></g>`).join('')
      + `<g ${L} stroke-width="4" transform="translate(1100 140)"><path d="M0 -18v36M-18 0h36"/></g>`,
    chart: (r) => {
      const pts = Array.from({ length: 14 }, (_, i) => [760 + i * 30, 470 - (i / 13) ** 1.6 * 280 - r() * 26]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join('');
      return `<g ${L}><path d="${d}L1150 520L760 520Z" fill="rgba(215,184,255,0.12)" stroke="none"/><path d="${d}" stroke-width="4"/><circle cx="${pts[13][0]}" cy="${pts[13][1].toFixed(0)}" r="9" fill="#D7B8FF"/><path d="M760 520H1150" stroke-width="2" opacity="0.3"/></g>`;
    },
    pair: () => `<g ${L} stroke-width="3"><rect x="790" y="210" width="170" height="170" rx="36" fill="rgba(215,184,255,0.08)"/><rect x="1000" y="250" width="170" height="170" rx="36" fill="rgba(215,184,255,0.16)"/><path d="M960 295h40" stroke-dasharray="6 8"/><path d="M845 270h60M845 300h40M1055 310h60M1055 340h40" stroke-width="4" opacity="0.7"/></g>`,
    doc: () => `<g ${L} stroke-width="3"><path d="M860 120h190l70 70v300H860z" fill="rgba(215,184,255,0.07)"/><path d="M1050 120v70h70"/>${[0, 1, 2, 3, 4, 5].map(i => `<path d="M900 ${236 + i * 38}h${i % 3 === 2 ? 110 : 180}" stroke-width="4" opacity="${0.75 - i * 0.08}"/>`).join('')}<circle cx="1110" cy="460" r="46" fill="#2C0C55"/><path d="M1090 460l14 14 28-30" stroke-width="5"/></g>`,
    orbit: () => `<g ${L} stroke-width="3"><ellipse cx="1000" cy="315" rx="190" ry="72" opacity="0.6"/><ellipse cx="1000" cy="315" rx="190" ry="72" transform="rotate(60 1000 315)" opacity="0.4"/><ellipse cx="1000" cy="315" rx="190" ry="72" transform="rotate(-60 1000 315)" opacity="0.4"/><circle cx="1000" cy="315" r="34" fill="rgba(215,184,255,0.3)"/></g>`,
  };

  // The cover is the hero, small: on the flat purple ground and dotted grid
  // its frame draws (.nw-cover), the mark, the mono label, and a headline in two tones (white, then
  // lavender, ending in a full stop). The motif sits small at the top right.
  function cover(s) {
    const r = rnd(s.t);
    const longest = Math.max(s.big.length, s.sub.length + 1);
    const size = Math.min(76, Math.floor(1040 / (longest * 0.54)));
    const ls = (-0.045 * size).toFixed(1);
    const H = 'font-family="Geist, sans-serif" font-weight="600"';
    return `<svg viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(s.big)}, ${esc(s.sub)}">`
      + `<g transform="translate(1150 64) scale(0.6) translate(-1180 -110)">${MOTIF[s.motif](r)}</g>`
      + `<g transform="translate(70 64)"><path transform="scale(0.52)" fill="#8429FF" d="${MARK}"/><text x="52" y="28" fill="#FFFFFF" ${H} font-size="27" letter-spacing="-0.8">Fusion</text></g>`
      + `<text x="72" y="${560 - size * 2.05 - 34}" fill="#B794E6" font-family="Geist Mono, monospace" font-size="26" font-weight="500" letter-spacing="3">${esc(s.cat.toUpperCase())}</text>`
      + `<text x="68" y="${(560 - size * 1.02).toFixed(0)}" fill="#FFFFFF" ${H} font-size="${size}" letter-spacing="${ls}">${esc(s.big)}</text>`
      + `<text x="68" y="560" fill="#D7B8FF" ${H} font-size="${size}" letter-spacing="${ls}">${esc(s.sub)}.</text>`
      + `</svg>`;
  }

  window.FusionNews = { S, cover, when, esc };
})();
