// Shared site navigation. Injects a fixed left sidebar on desktop; on mobile a
// top bar with the logo on the left and a menu button on the right that opens
// the same links as a drawer from the right. On every page that loads this
// script.
// Replaces the old per-page <nav class="top-nav"> block. Loaded synchronously
// from <head> so the old nav doesn't flash before being hidden.
//
// To add this nav to a page: <script src="/nav.js"></script> in <head>.

(function () {
  // The pages, in three groups: the key pages, the insights that support
  // them, and tools. A group's label is its heading; the key pages need none.
  // A folding group starts closed and remembers being opened; on one of its
  // own pages it is open, so the current page always shows.
  const GROUPS = [
    { pages: [
      { href: '/',                      label: 'Activity',       icon: 'activity' },
      { href: '/stocks',                label: 'Stocks',         icon: 'stocks', badge: 'New' },
    ] },
    { label: 'Insights', pages: [
      { href: '/all-vaults',            label: 'All Vaults',     icon: 'vaults' },
      { href: '/switchers',             label: 'Switchers',      icon: 'switchers' },
      { href: '/dust',                  label: 'Dust Tracker',   icon: 'dust' },
      { href: '/dominance',             label: 'Dominance',      icon: 'dominance' },
    ] },
    { label: 'Tools', folds: true, pages: [
      { href: '/monitor',               label: 'Monitor',        icon: 'monitor' },
      { href: '/tvl',                   label: 'TVL',            icon: 'tvl' },
      { href: '/address',               label: 'Address',        icon: 'address' },
      { href: '/spark',                 label: 'Spark',          icon: 'spark' },
      { href: '/rebalance-methodology', label: 'Rebalance Docs', icon: 'docs' },
      { href: '/logs',                  label: 'Logs',           icon: 'logs' },
      { href: '/video',                 label: 'Video',          icon: 'video' },
      { href: '/socials',               label: 'Socials',        icon: 'socials' },
    ] },
  ];

  // One icon per page, drawn for it: a 16px grid, 1.5px strokes, round ends.
  // The part marked "a" lights up in the accent colour on hover; the whole
  // icon does on the current page. "f" parts are filled, not stroked.
  const ICONS = {
    // Deposits drop into the vault, withdrawals rise out of it.
    activity: '<path d="M2.5 9.5v2.25A2.25 2.25 0 0 0 4.75 14h6.5a2.25 2.25 0 0 0 2.25-2.25V9.5"/><path class="a" d="M6 2v7.75M4 7.75l2 2 2-2"/><path d="M10 9.75V2M8 4l2-2 2 2"/>',
    // Candles: hollow up, filled down.
    stocks: '<path d="M3.25 3.5v1.75M3.25 10.75v2.25"/><rect x="1.75" y="5.25" width="3" height="5.5" rx=".75"/><path class="a" d="M8 2v2M8 9v2.75"/><rect class="a f" x="6.5" y="4" width="3" height="5" rx=".75"/><path d="M12.75 5.5v2.25M12.75 12.25V14"/><rect x="11.25" y="7.75" width="3" height="4.5" rx=".75"/>',
    // A safe: dial, handle, feet.
    vaults: '<rect x="2" y="2.25" width="12" height="10.5" rx="2.5"/><path d="M4.5 12.75v1.5M11.5 12.75v1.5M11.25 6.25v2.5"/><circle cx="7" cy="7.5" r="2.4"/><circle class="a f" cx="7" cy="7.5" r=".9"/>',
    // Capital leaving one vault for another.
    switchers: '<rect x="1.75" y="9.75" width="4.5" height="4.5" rx="1.25"/><rect class="a" x="9.75" y="1.75" width="4.5" height="4.5" rx="1.25"/><path d="M4 9.75C4 6.4 5.6 4 8.75 4"/><path d="M7 2.25L8.75 4 7 5.75"/>',
    // Specks settling on the floor.
    dust: '<path d="M2 14h12"/><g class="a f"><circle cx="4.25" cy="11.5" r="1.5"/><circle cx="8" cy="11.9" r="1.1"/><circle cx="11.5" cy="12.15" r=".85"/><circle cx="6.25" cy="7.25" r=".8"/><circle cx="10" cy="5.6" r=".65"/><circle cx="12.75" cy="8.6" r=".55"/><circle cx="8.1" cy="3.1" r=".5"/></g>',
    // One share of the ring dominates.
    dominance: '<path class="dim" d="M3.07 9.8A5.25 5.25 0 0 1 8 2.75" stroke-width="2.25" stroke-linecap="butt"/><path class="a" d="M8 2.75a5.25 5.25 0 1 1-4.93 7.05" stroke-width="2.25" stroke-linecap="butt"/>',
    // The advertised rate (dashed) against the realised share price.
    monitor: '<path class="dim2" d="M2 7.25L14 3" stroke-dasharray="2 2.4"/><path class="a" d="M2 12.75c2.4-.2 3.6-2.9 5.6-3.1 2-.2 3.3-1.2 6.4-3.4"/>',
    // How full the vessel is.
    tvl: '<path class="a f soft" d="M3 8.9c1.6-.9 3.2.9 5 0s3.4-.9 5 0V11.5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 3 11.5z"/><path class="a" d="M3 8.9c1.6-.9 3.2.9 5 0s3.4-.9 5 0"/><rect x="3" y="2" width="10" height="12" rx="2.5"/>',
    // 0x…
    address: '<ellipse cx="5.25" cy="8.25" rx="2.5" ry="3.75"/><path class="a" d="M9.25 6.75l3.75 5.25M13 6.75L9.25 12"/>',
    // Looped stETH: one position stacked on another.
    spark: '<path d="M8.49 6.07L6.5 3 3.75 7.25 6.5 11.5l1.02-1.57"/><path class="a" d="M9.5 4.5l2.75 4.25L9.5 13l-2.75-4.25zM6.75 8.75L9.5 10l2.75-1.25"/>',
    // The method behind rebalances.
    docs: '<path d="M9.25 1.75H5A1.5 1.5 0 0 0 3.5 3.25v9.5A1.5 1.5 0 0 0 5 14.25h6a1.5 1.5 0 0 0 1.5-1.5V5zM9.25 1.75V5h3.25"/><path class="a" d="M5.9 7.5h4.2M8.6 6l1.5 1.5L8.6 9"/><path d="M10.1 11H5.9M7.4 9.5L5.9 11l1.5 1.5"/>',
    // Run history, newest on top.
    logs: '<path d="M4 3.75v8.5M7.5 3.75h6M7.5 8h4.25M7.5 12.25h5.25"/><circle class="a f" cx="4" cy="3.75" r="1.6"/><circle class="f" cx="4" cy="8" r="1.25"/><circle class="f" cx="4" cy="12.25" r="1.25"/>',
    // A frame and its keyframe timeline.
    video: '<rect x="2" y="2" width="12" height="8.5" rx="2"/><path class="f" d="M6.9 4.6l2.9 1.65-2.9 1.65z"/><path d="M2 13.5h12"/><path class="a f" d="M10 11.85l1.65 1.65L10 15.15 8.35 13.5z"/>',
    // A post: avatar, name, media.
    socials: '<rect x="2" y="2" width="12" height="12" rx="2.75"/><circle class="a f" cx="5.25" cy="5.25" r="1.25"/><path d="M8 5.25h3.25"/><rect class="a f soft2" x="4.25" y="8" width="7.5" height="3.75" rx="1.1"/>',
  };
  const icon = (name) => `<svg class="fnav-ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  const path = (location.pathname.replace(/\/$/, '') || '/');
  const isActive = (href) => {
    if (href === '/') return path === '/' || path === '/index.html';
    return path === href || path.startsWith(href + '/');
  };

  const SIDEBAR_W = 220;
  const TOPBAR_H = 56;

  // The Fusion logo as IPOR publishes it (ipor.io/brand), then "Stats". The
  // published file has black text; in dark mode the white-text version is
  // used, or — if ipor.io has none — the same logo drawn in white.
  const LOGO_SRC = 'https://ipor.io/brand/full-logo/fusion-full-logo-black-text.svg';
  const LOGO_DARK_SRC = 'https://ipor.io/brand/full-logo/fusion-full-logo-white-text.svg';
  const LOGO = `
    <img class="fnav-logo fnav-logo-light" src="${LOGO_SRC}" alt="Fusion" height="24" decoding="async">
    <img class="fnav-logo fnav-logo-dark" src="${LOGO_DARK_SRC}" alt="Fusion" height="24" decoding="async" onerror="this.remove()">
    <span class="fnav-word">Stats</span>`;
  const css = `
    nav.top-nav { display: none !important; }      /* hide legacy per-page nav */
    #fnav-root { --fnav-font: Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
    body { margin: 0; }
    @media (min-width: 901px) {
      body { padding-left: ${SIDEBAR_W}px; }
      .fnav-scrim { display: none; }
      .fnav-sidebar { transform: none !important; }
      .fnav-topbar { display: none !important; }
    }
    @media (max-width: 900px) {
      .fnav-scrim.open { opacity: 1; pointer-events: auto; }
    }
    .fnav-sidebar {
      position: fixed; left: 0; top: 0; bottom: 0;
      width: ${SIDEBAR_W}px;
      background: var(--surface, #ffffff);
      border-right: 1px solid var(--stroke, #e5e5e5);
      box-shadow: 0 0 24px rgba(0,0,0,0.04);
      display: flex; flex-direction: column;
      padding: 1rem 0;
      z-index: 100;
      transition: transform 0.22s ease;
      overflow-y: auto;
    }
    .fnav-brand {
      display: flex; align-items: center; gap: 10px;
      padding: 0.2rem 20px 1.25rem;
      color: var(--text, #000);
      text-decoration: none;
    }
    /* The logo keeps its own proportions; a very wide file is fitted, not cut. */
    .fnav-logo {
      display: block; flex-shrink: 0;
      height: 24px; width: auto; max-width: 140px;
      object-fit: contain; object-position: left center;
    }
    .fnav-logo-dark { display: none; }
    [data-theme="dark"] .fnav-logo-light { display: none; }
    [data-theme="dark"] .fnav-logo-dark { display: block; }
    [data-theme="dark"] .fnav-brand:not(:has(.fnav-logo-dark)) .fnav-logo-light {
      display: block; filter: brightness(0) invert(1);
    }
    .fnav-word {
      padding-left: 10px;
      border-left: 1px solid var(--stroke, #e5e5e5);
      font: 600 15px/18px var(--fnav-font);
      letter-spacing: -0.02em;
      color: var(--text-body, #70747A);
      white-space: nowrap;
    }
    /* Links in groups: the key pages first, then Insights and Tools under a
       quiet heading each. */
    .fnav-links { display: flex; flex-direction: column; gap: 20px; padding: 0 10px 16px; }
    .fnav-group { display: flex; flex-direction: column; gap: 1px; }
    .fnav-group-label {
      padding: 0 10px 6px;
      font: 500 11.5px/1.2 var(--fnav-font);
      letter-spacing: 0.01em;
      color: var(--text-secondary, #9BA3AF);
    }
    .fnav-links a {
      display: flex; align-items: center; gap: 10px;
      height: 34px; padding: 0 10px;
      border-radius: 8px;
      font: 500 13.5px/1 var(--fnav-font);
      letter-spacing: -0.005em;
      color: var(--text-body, #70747A);
      text-decoration: none;
      transition: background 0.12s, color 0.12s;
    }
    .fnav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fnav-links a:hover { color: var(--text, #000); background: var(--bg-hover, var(--bg-alt, rgba(127, 127, 127, 0.08))); }
    .fnav-links a.active { color: var(--accent, #8429FF); background: var(--accent-bg, rgba(132, 41, 255, 0.08)); font-weight: 600; }
    .fnav-links a:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: -2px; }
    /* Icons: muted at rest; on hover the part marked "a" takes the accent;
       on the current page the whole icon does. */
    .fnav-ic {
      width: 16px; height: 16px; flex-shrink: 0; overflow: visible;
      fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
      color: var(--text-secondary, #9BA3AF);
      transition: color 0.12s;
    }
    .fnav-ic .f { fill: currentColor; stroke: none; }
    .fnav-ic .a { transition: color 0.12s; }
    .fnav-ic .soft { opacity: 0.22; }
    .fnav-ic .soft2 { opacity: 0.4; }
    .fnav-ic .dim { opacity: 0.3; }
    .fnav-ic .dim2 { opacity: 0.55; }
    .fnav-links a:hover .fnav-ic { color: var(--text-body, #70747A); }
    .fnav-links a:hover .fnav-ic .a,
    .fnav-links a.active .fnav-ic,
    .fnav-links a.active .fnav-ic .a { color: var(--accent, #8429FF); }
    /* A folding group: its heading opens and closes it. */
    .fnav-fold-toggle {
      display: flex; align-items: center; gap: 4px;
      width: 100%; margin: -4px 0 0; padding-top: 4px;
      border: 0; border-radius: 6px; background: none;
      text-align: left; cursor: pointer;
      transition: color 0.12s;
    }
    .fnav-fold-toggle:hover { color: var(--text-body, #70747A); }
    .fnav-fold-toggle:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: 0; }
    .fnav-chev {
      width: 12px; height: 12px; flex-shrink: 0;
      fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
      transition: transform 0.2s ease;
    }
    .fnav-fold.collapsed .fnav-chev { transform: rotate(-90deg); }
    .fnav-fold-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.22s ease; }
    .fnav-fold-body > div { display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow: hidden; }
    .fnav-fold.collapsed .fnav-fold-body { grid-template-rows: 0fr; }
    /* Closed links leave the tab order once the fold has shut. */
    .fnav-fold.collapsed .fnav-fold-body > div { visibility: hidden; transition: visibility 0s 0.22s; }
    @media (prefers-reduced-motion: reduce) {
      .fnav-fold-body, .fnav-chev { transition: none; }
    }
    .fnav-badge {
      margin-left: auto;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--accent-bg, rgba(132, 41, 255, 0.10));
      color: var(--accent, #8429FF);
      font: 600 10px/1.3 var(--fnav-font);
      letter-spacing: 0.02em;
    }
    /* Mobile top bar: logo left, menu right. Hidden on desktop. */
    .fnav-topbar {
      display: flex;
      position: fixed; top: 0; left: 0; right: 0; z-index: 101;
      height: ${TOPBAR_H}px;
      align-items: center; justify-content: space-between;
      padding: 0 12px 0 16px;
      background: var(--surface, #ffffff);
      background: color-mix(in srgb, var(--surface, #ffffff) 88%, transparent);
      -webkit-backdrop-filter: saturate(1.6) blur(14px);
              backdrop-filter: saturate(1.6) blur(14px);
      border-bottom: 1px solid var(--stroke, #e5e5e5);
    }
    .fnav-topbar .fnav-brand { padding: 0; gap: 10px; }
    .fnav-topbar .fnav-logo { height: 22px; }
    .fnav-topbar .fnav-word { font-size: 15px; }
    .fnav-hamburger {
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      width: 40px; height: 40px; padding: 0;
      border: 1px solid var(--stroke, #e5e5e5);
      border-radius: 10px;
      background: var(--surface, #ffffff);
      cursor: pointer;
    }
    .fnav-hamburger span {
      display: block; width: 16px; height: 1.6px; border-radius: 2px;
      background: var(--text, #000);
      transition: transform 0.2s ease, opacity 0.15s ease;
    }
    /* Three lines become a cross while the drawer is open. */
    .fnav-hamburger[aria-expanded="true"] span:nth-child(1) { transform: translateY(5.6px) rotate(45deg); }
    .fnav-hamburger[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
    .fnav-hamburger[aria-expanded="true"] span:nth-child(3) { transform: translateY(-5.6px) rotate(-45deg); }
    .fnav-hamburger:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: 2px; }
    .fnav-scrim {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      opacity: 0; pointer-events: none; transition: opacity 0.18s;
      z-index: 99;
    }
    /* Last, so it overrides the sidebar's desktop placement: on mobile the
       drawer comes in from the right, under the top bar. */
    @media (max-width: 900px) {
      body { padding-top: ${TOPBAR_H}px; }   /* room for the top bar */
      .fnav-sidebar {
        top: ${TOPBAR_H}px; left: auto; right: 0;
        border-right: none; border-left: 1px solid var(--stroke, #e5e5e5);
        box-shadow: -16px 0 40px rgba(0, 0, 0, 0.08);
        transform: translateX(100%);
        padding-top: 0.6rem;
      }
      .fnav-sidebar.open { transform: translateX(0); }
      .fnav-sidebar .fnav-brand { display: none; }   /* the top bar carries it */
      .fnav-links { padding: 4px 10px 24px; }
      .fnav-links a { height: 44px; gap: 12px; font-size: 15px; }   /* thumb-sized */
      .fnav-ic { width: 18px; height: 18px; }
      .fnav-fold-toggle { margin: -12px 0 -4px; padding: 12px 10px 10px; font-size: 12.5px; }
      .fnav-chev { width: 14px; height: 14px; }
    }
  `;

  const link = (p) => {
    const badge = p.badge ? `<span class="fnav-badge">${p.badge}</span>` : '';
    const here = isActive(p.href) ? ' class="active" aria-current="page"' : '';
    return `<a href="${p.href}"${here}>${icon(p.icon)}<span class="fnav-label">${p.label}</span>${badge}</a>`;
  };
  const CHEVRON = '<svg class="fnav-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
  const foldKey = (g) => 'fusionstats_nav_' + g.label.toLowerCase();
  const startsOpen = (g) => {
    if (g.pages.some(p => isActive(p.href))) return true;
    try { return localStorage.getItem(foldKey(g)) === 'open'; } catch { return false; }
  };
  const links = GROUPS.map((g, i) => {
    const items = g.pages.map(link).join('');
    if (!g.label) return `<div class="fnav-group">${items}</div>`;
    if (!g.folds) {
      return `<div class="fnav-group" role="group" aria-labelledby="fnav-g${i}">`
        + `<div class="fnav-group-label" id="fnav-g${i}">${g.label}</div>${items}</div>`;
    }
    const open = startsOpen(g);
    return `<div class="fnav-group fnav-fold${open ? '' : ' collapsed'}" data-key="${foldKey(g)}">`
      + `<button type="button" class="fnav-group-label fnav-fold-toggle" id="fnav-g${i}" aria-expanded="${open}" aria-controls="fnav-g${i}-list">${g.label}${CHEVRON}</button>`
      + `<div class="fnav-fold-body" id="fnav-g${i}-list" role="group" aria-labelledby="fnav-g${i}"><div>${items}</div></div></div>`;
  }).join('');

  const inject = () => {
    // The nav is set in Geist, like the redesigned pages; load it where a page doesn't.
    if (!document.querySelector('link[href*="family=Geist:"]')) {
      const font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap';
      document.head.appendChild(font);
    }
    // Style first so legacy nav is hidden immediately.
    const style = document.createElement('style');
    style.id = 'fnav-style';
    style.textContent = css;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'fnav-root';
    wrap.innerHTML = `
      <header class="fnav-topbar">
        <a class="fnav-brand" href="/" aria-label="Fusion Stats home">${LOGO}</a>
        <button class="fnav-hamburger" id="fnav-burger" type="button" aria-label="Menu"
                aria-expanded="false" aria-controls="fnav-aside"><span></span><span></span><span></span></button>
      </header>
      <aside class="fnav-sidebar" id="fnav-aside">
        <a class="fnav-brand" href="/" aria-label="Fusion Stats home">${LOGO}</a>
        <nav class="fnav-links" aria-label="Pages">${links}</nav>
      </aside>
      <div class="fnav-scrim" id="fnav-scrim"></div>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    // Remove the page's own old top nav if present.
    document.querySelectorAll('nav.top-nav').forEach(n => n.remove());

    const aside = document.getElementById('fnav-aside');
    const scrim = document.getElementById('fnav-scrim');
    const burger = document.getElementById('fnav-burger');
    const open = (v) => {
      aside.classList.toggle('open', v);
      scrim.classList.toggle('open', v);
      burger.setAttribute('aria-expanded', String(v));
      document.documentElement.style.overflow = v ? 'hidden' : '';   // the page stays put behind it
    };
    burger.addEventListener('click', () => open(!aside.classList.contains('open')));
    // Folding groups: open or close, remember it, and bring an opened group into view.
    aside.querySelectorAll('.fnav-fold-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fold = btn.closest('.fnav-fold');
        const isOpen = !fold.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(isOpen));
        try { localStorage.setItem(fold.dataset.key, isOpen ? 'open' : 'closed'); } catch {}
        if (isOpen) setTimeout(() => fold.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 240);
      });
    });
    scrim.addEventListener('click', () => open(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aside.classList.contains('open')) open(false); });
  };

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
