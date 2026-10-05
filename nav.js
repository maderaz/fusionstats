// Shared site navigation. Injects a fixed left sidebar on desktop; on mobile a
// top bar with the logo on the left and a menu button on the right that opens
// the same links as a drawer from the right. On every page that loads this
// script.
// Replaces the old per-page <nav class="top-nav"> block. Loaded synchronously
// from <head> so the old nav doesn't flash before being hidden.
//
// To add this nav to a page: <script src="/nav.js"></script> in <head>.

(function () {
  const PAGES = [
    { href: '/',                       label: 'Activity' },
    { href: '/monitor',                label: 'Monitor', badge: 'NEW' },
    { href: '/switchers',              label: 'Switchers', badge: 'NEW' },
    { href: '/dust',                   label: 'Dust Tracker', badge: 'NEW' },
    { href: '/stocks',                 label: 'Stocks', badge: 'NEW' },
    { href: '/all-vaults',             label: 'All Vaults' },
    { href: '/tvl',                    label: 'TVL' },
    { href: '/dominance',              label: 'Dominance' },
    { href: '/address',                label: 'Address' },
    { href: '/spark',                  label: 'Spark' },
    { href: '/rebalance-methodology',  label: 'Rebalance Docs' },
    { href: '/logs',                   label: 'Logs' },
    { href: '/video',                  label: 'Video' },
    { href: '/socials',                label: 'Socials' },
  ];

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
      padding: 0.2rem 1.1rem 1rem;
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
      font-family: Poppins, -apple-system, sans-serif;
      font-weight: 600; font-size: 0.98rem; line-height: 18px; letter-spacing: -0.01em;
      color: var(--text-body, #70747A);
      white-space: nowrap;
    }
    .fnav-links { display: flex; flex-direction: column; }
    .fnav-links a {
      font-family: Poppins, -apple-system, sans-serif;
      font-size: 0.85rem;
      color: var(--text-body, #70747A);
      text-decoration: none;
      padding: 0.55rem 1.25rem;
      border-left: 3px solid transparent;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .fnav-links a:hover { color: var(--accent, #8429FF); background: var(--accent-bg, rgba(132,41,255,0.06)); }
    .fnav-links a.active {
      color: var(--accent, #8429FF);
      background: var(--accent-bg, rgba(132,41,255,0.08));
      border-left-color: var(--accent, #8429FF);
      font-weight: 600;
    }
    .fnav-badge {
      display: inline-block;
      margin-left: 0.5rem;
      font-size: 0.55rem; font-weight: 700;
      letter-spacing: 0.06em;
      padding: 0.08rem 0.4rem;
      border-radius: 999px;
      background: linear-gradient(90deg, #8429FF, #6C00FF);
      color: #fff;
      vertical-align: middle;
      line-height: 1.4;
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
    .fnav-topbar .fnav-word { font-size: 0.95rem; }
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
      .fnav-links a { padding: 0.75rem 1.25rem; font-size: 0.95rem; }   /* thumb-sized */
    }
  `;

  const links = PAGES.map(p => {
    const badge = p.badge ? `<span class="fnav-badge">${p.badge}</span>` : '';
    return `<a href="${p.href}"${isActive(p.href) ? ' class="active"' : ''}>${p.label}${badge}</a>`;
  }).join('');

  const inject = () => {
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
        <nav class="fnav-links">${links}</nav>
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
    scrim.addEventListener('click', () => open(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aside.classList.contains('open')) open(false); });
  };

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
