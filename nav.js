// Shared site navigation. Injects a fixed left sidebar on desktop + a slide-in
// drawer behind a hamburger on mobile, on every page that loads this script.
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
  const css = `
    nav.top-nav { display: none !important; }      /* hide legacy per-page nav */
    body { margin: 0; }
    @media (min-width: 901px) {
      body { padding-left: ${SIDEBAR_W}px; }
      .fnav-scrim { display: none; }
      .fnav-sidebar { transform: none !important; }
    }
    @media (max-width: 900px) {
      .fnav-sidebar { transform: translateX(-100%); }
      .fnav-sidebar.open { transform: translateX(0); }
      .fnav-scrim.open { opacity: 1; pointer-events: auto; }
      .fnav-hamburger { display: flex; }   /* mobile only */
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
      font-family: Poppins, -apple-system, sans-serif;
      font-weight: 700; font-size: 1.05rem;
      color: var(--accent, #8429FF);
      padding: 0.4rem 1.25rem 1rem;
      letter-spacing: -0.01em;
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
    .fnav-hamburger {
      display: none;                       /* hidden by default; shown only on mobile */
      position: fixed; top: 12px; left: 12px; z-index: 102;
      width: 40px; height: 40px;
      border: 1px solid var(--stroke, #e5e5e5);
      background: var(--surface, #ffffff);
      color: var(--text, #000);
      border-radius: 8px;
      font-size: 1.1rem; cursor: pointer;
      align-items: center; justify-content: center;
    }
    .fnav-scrim {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      opacity: 0; pointer-events: none; transition: opacity 0.18s;
      z-index: 99;
    }
    @media (max-width: 900px) {
      body { padding-top: 56px; }   /* room for the hamburger button */
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
      <button class="fnav-hamburger" id="fnav-burger" aria-label="Menu">&#9776;</button>
      <aside class="fnav-sidebar" id="fnav-aside">
        <div class="fnav-brand">Fusion Stats</div>
        <nav class="fnav-links">${links}</nav>
      </aside>
      <div class="fnav-scrim" id="fnav-scrim"></div>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    // Remove the page's own old top nav if present.
    document.querySelectorAll('nav.top-nav').forEach(n => n.remove());

    const aside = document.getElementById('fnav-aside');
    const scrim = document.getElementById('fnav-scrim');
    const open = (v) => { aside.classList.toggle('open', v); scrim.classList.toggle('open', v); };
    document.getElementById('fnav-burger').addEventListener('click', () => open(!aside.classList.contains('open')));
    scrim.addEventListener('click', () => open(false));
  };

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
