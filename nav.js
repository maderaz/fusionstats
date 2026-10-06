// Shared site navigation, on every page that loads this script.
// Desktop: a fixed sidebar on the left. Phone and tablet (900px and under): the
// logo at the top, which scrolls away with the page, and a tab bar fixed at the
// bottom with the key pages and More; More opens a sheet with everything else
// and the theme switch.
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
    // Everything else, four tiles.
    more: '<rect x="2" y="2" width="5" height="5" rx="1.5"/><rect class="a" x="9" y="2" width="5" height="5" rx="1.5"/><rect x="2" y="9" width="5" height="5" rx="1.5"/><rect x="9" y="9" width="5" height="5" rx="1.5"/>',
  };
  const icon = (name) => `<svg class="fnav-ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  const path = (location.pathname.replace(/\/$/, '') || '/');
  const isActive = (href) => {
    if (href === '/') return path === '/' || path === '/index.html';
    return path === href || path.startsWith(href + '/');
  };

  // ---- Theme: one choice for the whole site ----------------------------------
  // The sidebar's switch is the site's only theme control. The choice lives
  // under one key. Pages used to keep their own — Stocks a second key, the older
  // pages a third — so those are read once when this one is not set yet.
  // A page with no dark styles says so with
  //   <meta name="fusion-theme" content="light-only">
  // ahead of this script: it stays light, and the switch is not offered there.
  const THEME_KEY = 'fusionstats_theme';
  const lightOnly = !!document.querySelector('meta[name="fusion-theme"][content="light-only"]');
  function storedTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'dark' || v === 'light') return v;
      if (v === '') return 'light';                 // how Activity and its siblings wrote light
      const old = localStorage.getItem('theme') || localStorage.getItem('fusionstats_stocks_theme');
      if (old === 'dark' || old === 'light') return old;
    } catch (e) {}
    return 'light';
  }
  // Pages that draw in theme colours (charts) listen for 'fusion:theme'.
  function applyTheme(t) {
    const dark = t === 'dark' && !lightOnly;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    window.dispatchEvent(new CustomEvent('fusion:theme', { detail: { theme: dark ? 'dark' : 'light' } }));
  }
  applyTheme(storedTheme());
  window.FusionTheme = {
    get: () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
  };

  const SIDEBAR_W = 220;
  const TOPBAR_H = 56;
  const TABBAR_H = 58;
  // Notched phones: the bars keep clear of the notch and the home indicator
  // (with viewport-fit=cover, set below).
  const INSET_L = 'env(safe-area-inset-left, 0px)';
  const INSET_R = 'env(safe-area-inset-right, 0px)';
  const INSET_B = 'env(safe-area-inset-bottom, 0px)';

  // The Fusion atomic mark (as in /video/fusion-mark.svg), drawn inline so it
  // is there with the first paint, then the word.
  const MARK = '<svg class="fnav-mark" viewBox="0 0 73 73" aria-hidden="true"><path fill="#8429FF" d="M72.9745 36.4854C72.9745 28.9218 65.2566 22.5 53.6982 19.2763C50.4708 7.71785 44.0491 0 36.4854 0C28.9218 0 22.5 7.71785 19.2763 19.2763C7.71785 22.5037 0 28.9254 0 36.4854C0 44.0454 7.71785 50.4708 19.2763 53.6982C22.5037 65.2566 28.9254 72.9745 36.4854 72.9745C44.0454 72.9745 50.4708 65.2566 53.6982 53.6982C65.2566 50.4708 72.9745 44.0491 72.9745 36.4854ZM26.8656 13.6513C29.5533 8.24658 33.0597 5.14769 36.4744 5.14769C39.889 5.14769 43.4065 8.24658 46.0832 13.6513C46.7734 15.0575 47.3756 16.5042 47.8859 17.9875C40.3223 16.7318 32.6008 16.7318 25.0371 17.9875C25.5475 16.5042 26.1643 15.0759 26.8546 13.6696L26.8656 13.6513ZM50.7792 36.5038C50.7829 39.8156 50.5112 43.1054 50.0008 46.3769L26.5939 22.9553C29.8654 22.4449 33.1736 22.1916 36.4854 22.1989C40.84 22.1842 45.1836 22.6285 49.4464 23.5281C50.346 27.7909 50.7902 32.0978 50.7756 36.4524M22.1953 36.4634C22.1916 33.1515 22.4486 29.8691 22.9553 26.5939L46.3769 50.0192C43.1054 50.5296 39.7973 50.7829 36.4854 50.7756C32.1308 50.7902 27.7872 50.3423 23.5244 49.4464C22.6248 45.1836 22.1806 40.84 22.1953 36.4854V36.4634ZM13.6549 46.0942C8.25025 43.4065 5.15136 39.9001 5.15136 36.4854C5.15136 33.0708 8.25392 29.5533 13.6549 26.8766C15.0612 26.1864 16.5078 25.5842 17.9912 25.0739C16.7355 32.6375 16.7355 40.359 17.9912 47.9227C16.5078 47.4123 15.0832 46.7991 13.677 46.1052L13.6549 46.0942ZM46.1162 59.3342C43.4285 64.7389 39.9221 67.8378 36.5074 67.8378C33.0928 67.8378 29.5753 64.7353 26.8987 59.3342C26.2084 57.928 25.6062 56.4813 25.0959 54.998C28.8704 55.6295 32.6889 55.9453 36.5185 55.9379C40.3443 55.9453 44.1665 55.6295 47.941 54.998C47.4307 56.4813 46.8212 57.9096 46.1309 59.3159L46.1199 59.3342H46.1162ZM59.3379 46.1089C57.9316 46.7991 56.4924 47.416 55.009 47.9227C55.6442 44.1482 55.9563 40.3297 55.9489 36.5001C55.9563 32.6742 55.6405 28.852 55.009 25.0775C56.4924 25.5842 57.939 26.1864 59.3452 26.8803C64.7499 29.568 67.8488 33.0744 67.8488 36.4891C67.8488 39.9037 64.7499 43.4212 59.3452 46.0978H59.3379V46.1089Z"/></svg>';
  const LOGO = `${MARK}<span class="fnav-word">Ecosystem</span>`;

  const css = `
    nav.top-nav { display: none !important; }      /* hide legacy per-page nav */
    #fnav-root { --fnav-font: Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
    body { margin: 0; }
    /* Zero everywhere but a notched phone on its side: there the page keeps
       clear of the notch. On <html>, as pages set their own body padding. */
    html { padding-left: ${INSET_L}; padding-right: ${INSET_R}; }
    @media (min-width: 901px) {
      body { padding-left: ${SIDEBAR_W}px; }
      .fnav-topbar, .fnav-tabbar, .fnav-sheet, .fnav-sheet-scrim { display: none !important; }
    }
    .fnav-sidebar {
      position: fixed; left: 0; top: 0; bottom: 0;
      width: calc(${SIDEBAR_W}px + ${INSET_L});
      padding: 1rem 0 1rem ${INSET_L};
      box-sizing: border-box;
      background: var(--surface, #ffffff);
      border-right: 1px solid var(--stroke, #e5e5e5);
      box-shadow: 0 0 24px rgba(0,0,0,0.04);
      display: flex; flex-direction: column;
      z-index: 100;
      overflow-y: auto;
    }
    .fnav-brand {
      display: flex; align-items: center; gap: 9px;
      padding: 0.2rem 20px 1.25rem;
      color: #000;
      text-decoration: none;
    }
    .fnav-mark { display: block; flex-shrink: 0; width: 24px; height: 24px; }
    /* "Ecosystem" in full black; white on dark. */
    .fnav-word {
      font: 600 17px/1 var(--fnav-font);
      letter-spacing: -0.03em;
      color: #000;
      white-space: nowrap;
    }
    [data-theme="dark"] .fnav-brand, [data-theme="dark"] .fnav-word { color: #fff; }
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
    /* Theme switch, at the foot of the sidebar and of the More sheet:
       Activity's segmented control. */
    .fnav-foot { margin-top: auto; padding: 18px 20px 6px; }
    .fnav-theme {
      display: flex; padding: 3px;
      border: 1px solid var(--stroke, #e5e5e5); border-radius: 11px;
      background: var(--bg-alt, var(--bg-subtle, rgba(127, 127, 127, 0.06)));
    }
    .fnav-theme button {
      flex: 1;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 30px; padding: 0 8px;
      border: none; border-radius: 8px;
      background: transparent;
      color: var(--text-body, #70747A);
      font: 500 12.5px var(--fnav-font);
      cursor: pointer;
      transition: color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    .fnav-theme button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .fnav-theme button:hover { color: var(--text, #000); }
    .fnav-theme button[aria-pressed="true"] {
      background: var(--surface, #fff);
      color: var(--text, #000);
      box-shadow: 0 1px 2px rgba(16, 16, 24, 0.08), 0 0 0 1px var(--stroke, #e5e5e5);
    }
    .fnav-theme button:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: 1px; }
    .fnav-badge {
      margin-left: auto;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--accent-bg, rgba(132, 41, 255, 0.10));
      color: var(--accent, #8429FF);
      font: 600 10px/1.3 var(--fnav-font);
      letter-spacing: 0.02em;
    }
    @media (prefers-reduced-motion: reduce) {
      .fnav-fold-body, .fnav-chev, .fnav-sheet, .fnav-sheet-scrim { transition: none !important; }
    }

    /* ---------- Phone and tablet ---------- */
    @media (max-width: 900px) {
      /* Room for the logo above the page, and for the tab bar (and a little
         air) below it. */
      body {
        padding-top: ${TOPBAR_H}px;
        padding-bottom: calc(${TABBAR_H + 16}px + ${INSET_B});
      }
      .fnav-sidebar { display: none; }
      /* The logo, at the top of the page: it scrolls away with it. */
      .fnav-topbar {
        position: absolute; top: 0; left: 0; right: 0; z-index: 99;
        height: ${TOPBAR_H}px;
        display: flex; align-items: center;
        padding: 0 calc(16px + ${INSET_R}) 0 calc(16px + ${INSET_L});
        box-sizing: border-box;
      }
      .fnav-topbar .fnav-brand { padding: 0; }
      .fnav-topbar .fnav-mark { width: 22px; height: 22px; }
      .fnav-topbar .fnav-word { font-size: 16.5px; }

      /* The tab bar: the key pages, then More. */
      .fnav-tabbar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 103;
        display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
        height: calc(${TABBAR_H}px + ${INSET_B});
        padding: 0 calc(8px + ${INSET_R}) ${INSET_B} calc(8px + ${INSET_L});
        box-sizing: border-box;
        background: var(--surface, #ffffff);
        border-top: 1px solid var(--stroke, #e5e5e5);
      }
      .fnav-tab {
        position: relative;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
        min-width: 0; padding: 0; margin: 0;
        border: 0; background: none;
        color: var(--text-secondary, #9BA3AF);
        font: 500 11px/1.1 var(--fnav-font);
        letter-spacing: 0.005em;
        text-decoration: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: color 0.15s;
      }
      /* The icon sits in a pill that fills in on the current page. */
      .fnav-pill {
        display: flex; align-items: center; justify-content: center;
        width: 52px; height: 28px;
        border-radius: 999px;
        transition: background 0.18s, transform 0.12s;
      }
      .fnav-tab .fnav-ic { width: 20px; height: 20px; color: inherit; }
      .fnav-tab.active, .fnav-tab[aria-expanded="true"] { color: var(--accent, #8429FF); font-weight: 600; }
      .fnav-tab.active .fnav-pill, .fnav-tab[aria-expanded="true"] .fnav-pill { background: var(--accent-bg, rgba(132, 41, 255, 0.10)); }
      /* With the sheet up, only More reads as chosen. */
      .fnav-tabbar.sheet-open .fnav-tab.active:not(.fnav-more) { color: var(--text-secondary, #9BA3AF); font-weight: 500; }
      .fnav-tabbar.sheet-open .fnav-tab.active:not(.fnav-more) .fnav-pill { background: transparent; }
      .fnav-tab:active .fnav-pill { transform: scale(0.94); }
      .fnav-tab:focus-visible { outline: none; }
      .fnav-tab:focus-visible .fnav-pill { box-shadow: 0 0 0 2px var(--accent, #8429FF); }
      .fnav-tab .fnav-dot {
        position: absolute; top: 8px; left: calc(50% + 13px);
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--accent, #8429FF);
        box-shadow: 0 0 0 2px var(--surface, #fff);
      }

      /* More: a sheet that rises from behind the tab bar. */
      .fnav-sheet-scrim {
        position: fixed; inset: 0; z-index: 101;
        background: rgba(10, 10, 14, 0.36);
        opacity: 0; pointer-events: none;
        transition: opacity 0.24s ease;
      }
      .fnav-sheet-scrim.open { opacity: 1; pointer-events: auto; }
      .fnav-sheet {
        position: fixed; left: 0; right: 0; z-index: 102;
        bottom: calc(${TABBAR_H}px + ${INSET_B});
        max-height: calc(100dvh - ${TABBAR_H}px - ${INSET_B} - 40px);
        overflow-y: auto; overscroll-behavior: contain;
        padding: 0 calc(16px + ${INSET_R}) 16px calc(16px + ${INSET_L});
        box-sizing: border-box;
        background: var(--surface, #ffffff);
        border-radius: 20px 20px 0 0;
        box-shadow: 0 -18px 48px rgba(10, 10, 14, 0.16);
        transform: translateY(calc(100% + ${TABBAR_H + 24}px));
        visibility: hidden;
        transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear 0.32s;
      }
      .fnav-sheet.open {
        transform: translateY(0);
        visibility: visible;
        transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), visibility 0s;
      }
      .fnav-sheet.dragging { transition: none; }
      .fnav-sheet:focus { outline: none; }
      .fnav-grab {
        position: sticky; top: 0; z-index: 1;
        display: flex; justify-content: center;
        margin: 0 -16px; padding: 10px 0 14px;
        background: var(--surface, #ffffff);
        touch-action: none;
      }
      .fnav-grab::before {
        content: ''; width: 38px; height: 5px; border-radius: 999px;
        background: var(--stroke, #e5e5e5);
      }
      .fnav-sheet-group + .fnav-sheet-group { margin-top: 18px; }
      .fnav-sheet-label {
        padding: 0 4px 8px;
        font: 500 12px/1.2 var(--fnav-font);
        letter-spacing: 0.01em;
        color: var(--text-secondary, #9BA3AF);
      }
      .fnav-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .fnav-tile {
        display: flex; align-items: center; gap: 11px;
        min-width: 0; height: 50px; padding: 0 14px;
        border: 1px solid var(--stroke, #e5e5e5);
        border-radius: 14px;
        background: var(--surface, #ffffff);
        color: var(--text, #000);
        font: 500 14px/1.1 var(--fnav-font);
        letter-spacing: -0.01em;
        text-decoration: none;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.12s, border-color 0.12s, transform 0.12s;
      }
      .fnav-tile .fnav-ic { width: 18px; height: 18px; }
      .fnav-tile:active { transform: scale(0.98); background: var(--bg-hover, var(--bg-alt, rgba(127, 127, 127, 0.08))); }
      .fnav-tile:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: 1px; }
      .fnav-tile.active { border-color: transparent; background: var(--accent-bg, rgba(132, 41, 255, 0.08)); color: var(--accent, #8429FF); font-weight: 600; }
      .fnav-tile.active .fnav-ic, .fnav-tile.active .fnav-ic .a { color: var(--accent, #8429FF); }
      .fnav-sheet .fnav-foot { margin: 20px 0 0; padding: 0; }
      .fnav-sheet .fnav-theme button { height: 40px; font-size: 14px; }
    }
  `;

  const CHEVRON = '<svg class="fnav-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
  const here = (p) => (isActive(p.href) ? ' aria-current="page"' : '');
  const KEY = GROUPS.filter(g => !g.label).flatMap(g => g.pages);
  const MORE = GROUPS.filter(g => g.label);

  // Sidebar links (desktop).
  const link = (p) => {
    const badge = p.badge ? `<span class="fnav-badge">${p.badge}</span>` : '';
    const cls = [isActive(p.href) ? 'active' : '', KEY.includes(p) ? 'fnav-key' : ''].filter(Boolean).join(' ');
    return `<a href="${p.href}"${cls ? ` class="${cls}"` : ''}${here(p)}>${icon(p.icon)}<span class="fnav-label">${p.label}</span>${badge}</a>`;
  };
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

  // Tab bar and More sheet (phone and tablet).
  const pill = (name) => `<span class="fnav-pill">${icon(name)}</span>`;
  const inMore = MORE.some(g => g.pages.some(p => isActive(p.href)));
  const tabs = KEY.map(p => `<a class="fnav-tab fnav-key${isActive(p.href) ? ' active' : ''}" href="${p.href}"${here(p)}>`
      + `${pill(p.icon)}${p.badge ? '<span class="fnav-dot" aria-hidden="true"></span>' : ''}<span>${p.label}</span></a>`).join('')
    + `<button type="button" class="fnav-tab fnav-more${inMore ? ' active' : ''}" id="fnav-more" aria-expanded="false"`
    + ` aria-controls="fnav-sheet" aria-haspopup="dialog">${pill('more')}<span>More</span></button>`;
  const tiles = MORE.map(g => `<div class="fnav-sheet-group" role="group" aria-label="${g.label}">`
      + `<div class="fnav-sheet-label">${g.label}</div><div class="fnav-tiles">`
      + g.pages.map(p => `<a class="fnav-tile${isActive(p.href) ? ' active' : ''}" href="${p.href}"${here(p)}>`
          + `${icon(p.icon)}<span class="fnav-label">${p.label}</span></a>`).join('')
      + `</div></div>`).join('');

  const THEME_SWITCH = `<div class="fnav-foot">
      <div class="fnav-theme" role="group" aria-label="Theme">
        <button type="button" data-theme-pick="light" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/></svg>Light</button>
        <button type="button" data-theme-pick="dark" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z"/></svg>Dark</button>
      </div>
    </div>`;

  // Room for the bars on a notched phone; zero insets everywhere else.
  function coverViewport() {
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';
  }
  coverViewport();

  // The next page, ready before the tap lands (Chrome; others ignore this).
  // The key pages are prerendered when a link is pressed — or hovered, on a
  // desktop — and the rest have their HTML fetched. A prerendered page holds
  // anything with an effect (analytics, starting a refresh) until it is shown.
  function speculate() {
    if (!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'))) return;
    const not = { not: { href_matches: location.pathname } };
    const rules = {
      prerender: [{ where: { and: [{ selector_matches: '#fnav-root a.fnav-key' }, not] }, eagerness: 'moderate' }],
      prefetch: [{ where: { and: [{ selector_matches: '#fnav-root a[href^="/"]' }, not] }, eagerness: 'moderate' }],
    };
    const s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify(rules);
    document.head.appendChild(s);
  }

  const inject = () => {
    coverViewport();
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
        <a class="fnav-brand" href="/" aria-label="Fusion Ecosystem home">${LOGO}</a>
      </header>
      <aside class="fnav-sidebar" id="fnav-aside">
        <a class="fnav-brand" href="/" aria-label="Fusion Ecosystem home">${LOGO}</a>
        <nav class="fnav-links" aria-label="Pages">${links}</nav>
        ${lightOnly ? '' : THEME_SWITCH}
      </aside>
      <nav class="fnav-tabbar" aria-label="Pages">${tabs}</nav>
      <div class="fnav-sheet-scrim" id="fnav-sheet-scrim"></div>
      <div class="fnav-sheet" id="fnav-sheet" role="dialog" aria-modal="true" aria-label="More pages" tabindex="-1">
        <div class="fnav-grab" aria-hidden="true"></div>
        ${tiles}
        ${lightOnly ? '' : THEME_SWITCH}
      </div>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    // Remove the page's own old top nav if present.
    document.querySelectorAll('nav.top-nav').forEach(n => n.remove());

    // The theme switches (sidebar and sheet): remembered for every page, and
    // followed by other open tabs of the site.
    const picks = wrap.querySelectorAll('button[data-theme-pick]');
    const showPick = () => picks.forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.themePick === window.FusionTheme.get())));
    picks.forEach(b => b.addEventListener('click', () => {
      try { localStorage.setItem(THEME_KEY, b.dataset.themePick); } catch (e) {}
      applyTheme(b.dataset.themePick);
      showPick();
    }));
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_KEY) { applyTheme(storedTheme()); showPick(); }
    });
    showPick();

    // Folding groups: open or close, remember it, and bring an opened group into view.
    wrap.querySelectorAll('.fnav-fold-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fold = btn.closest('.fnav-fold');
        const isOpen = !fold.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(isOpen));
        try { localStorage.setItem(fold.dataset.key, isOpen ? 'open' : 'closed'); } catch {}
        if (isOpen) setTimeout(() => fold.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 240);
      });
    });

    // More: open and close the sheet. It closes on More again, the scrim,
    // Escape, a link, or a swipe down.
    const sheet = document.getElementById('fnav-sheet');
    const scrim = document.getElementById('fnav-sheet-scrim');
    const more = document.getElementById('fnav-more');
    let lastFocus = null;
    const setOpen = (v) => {
      if (v === sheet.classList.contains('open')) return;
      sheet.classList.toggle('open', v);
      scrim.classList.toggle('open', v);
      more.parentNode.classList.toggle('sheet-open', v);
      more.setAttribute('aria-expanded', String(v));
      document.documentElement.style.overflow = v ? 'hidden' : '';   // the page stays put behind it
      sheet.style.transform = '';
      if (v) { lastFocus = document.activeElement; sheet.scrollTop = 0; sheet.focus({ preventScroll: true }); }
      else if (lastFocus && sheet.contains(document.activeElement)) more.focus({ preventScroll: true });
    };
    more.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
    scrim.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheet.classList.contains('open')) setOpen(false);
      // Keep Tab inside the open sheet.
      if (e.key === 'Tab' && sheet.classList.contains('open')) {
        const f = [...sheet.querySelectorAll('a, button')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // Back from a page opened from the sheet: closed, not as it was left.
    window.addEventListener('pageshow', () => setOpen(false));
    // A swipe down closes it: from the grabber, or from anywhere once the
    // sheet is scrolled to its top.
    let y0 = null, dy = 0, t0 = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (!sheet.classList.contains('open') || e.touches.length !== 1) return;
      if (sheet.scrollTop > 0 && !e.target.closest('.fnav-grab')) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 4) { sheet.classList.add('dragging'); sheet.style.transform = `translateY(${dy}px)`; }
      if (dy > 4 && e.cancelable) e.preventDefault();
    }, { passive: false });
    const endDrag = () => {
      if (y0 == null) return;
      const fast = dy > 30 && dy / Math.max(1, Date.now() - t0) > 0.5;
      sheet.classList.remove('dragging');
      y0 = null;
      if (dy > 80 || fast) setOpen(false); else sheet.style.transform = '';
    };
    sheet.addEventListener('touchend', endDrag);
    sheet.addEventListener('touchcancel', endDrag);

    speculate();
  };

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
