// fusion-select.js — the site's dropdowns, drawn by the page instead of the
// operating system: a list in the page's own type and colours, each network's
// mark beside its name, a search box on long lists, and on a phone a sheet
// from the bottom of the screen in place of the system picker.
//
// The <select> stays where it is and stays the truth: the page reads its value
// and listens for its change event exactly as before; this only draws it. A
// <select data-fs> is taken over when this script runs (load it after the
// selects, before the page's own script). An <option> can carry
//   data-icon="/x.svg"   an image beside its name
//   data-chain="base"    that network's mark (see CHAINS)
//   data-token="USDC"    that token's mark (see TOKENS), or its first letter
//   data-glyph="all"     the "every network" mark
//   data-label="Base"    the name to show, when its text says more
//   data-note="12"       a quiet note at the end of its row
//   data-short="TVL"     a shorter name for the closed dropdown's cell
//   data-narrow="All"    a shorter one still, where a page's cell is cramped
//                        (the page shows .fs-narrow and hides .fs-wide there)
// FusionSelect.chainName(id) gives a network's display name, and
// FusionSelect.chainIcon(id) its mark ({ src, ink } or null).
(function () {
  'use strict';
  if (window.FusionSelect) return;

  // Network id in our data → [display name, mark in /icons/chains, drawn in
  // black (so lightened on a dark page)]. No mark: a lettered badge.
  const CHAINS = {
    ethereum: ['Ethereum', 'ethereum'], base: ['Base', 'base'], arbitrum: ['Arbitrum', 'arbitrum'],
    avalanche: ['Avalanche', 'avalanche'], unichain: ['Unichain', 'unichain'], ink: ['Ink', 'ink'],
    plasma: ['Plasma', 'plasma', true], katana: ['Katana', 'katana'], tac: ['TAC'],
    999: ['HyperEVM', 'hyperevm'], hyperevm: ['HyperEVM', 'hyperevm'],
    143: ['Monad', 'monad'], monad: ['Monad', 'monad'],
  };
  // Token symbol, lower-cased → its mark (/icons/tokens, or a tokenised
  // stock's in /stocks/icons). Wrapped and bridged forms share their asset's.
  // No mark: a lettered badge.
  const TOKENS = {
    usdc: 'usdc', usdt: 'usdt', usdt0: 'usdt', 'usd\u20ae0': 'usdt', dai: 'dai', usde: 'usde', usdg: 'usdg', pyusd: 'pyusd',
    crvusd: 'crvusd', eurc: 'eurc', crv: 'crv', cycrv: 'crv',
    eth: 'eth', weth: 'weth', steth: 'steth', wsteth: 'wsteth', weeth: 'weeth', reth: 'reth', cbeth: 'cbeth',
    btc: 'btc', 'btc.b': 'btc', wbtc: 'wbtc', cbbtc: 'cbbtc', pol: 'pol', xaut: 'xaut', xaut0: 'xaut',
  };
  const STOCKS = { googl: 'goog', googlc: 'goog', goog: 'goog', nvda: 'nvda', nvdac: 'nvda', aapl: 'aapl', aaplc: 'aapl',
    meta: 'meta', metac: 'meta', coin: 'coin', coinc: 'coin', msft: 'msft', msftc: 'msft', amzn: 'amzn', amznc: 'amzn',
    mstr: 'mstr', mstrc: 'mstr', tsla: 'tsla', tslac: 'tsla', sndk: 'sndk', sndkc: 'sndk', spcx: 'spcx', spcxc: 'spcx' };
  function tokenIcon(sym) {
    const k = String(sym || '').toLowerCase();
    if (TOKENS[k]) return '/icons/tokens/' + TOKENS[k] + '.svg';
    if (STOCKS[k]) return '/stocks/icons/' + STOCKS[k] + '.svg';
    return null;
  }

  const chainName = (id) => (CHAINS[id] ? CHAINS[id][0] : String(id || '').replace(/^./, c => c.toUpperCase()));
  // A network's mark: its file and whether it is drawn in black, or null.
  const chainIcon = (id) => (CHAINS[id] && CHAINS[id][1] ? { src: '/icons/chains/' + CHAINS[id][1] + '.svg', ink: !!CHAINS[id][2] } : null);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHECK = '<svg class="fs-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6"/></svg>';
  // The trigger's chevron: its glyph is the middle 6px of its 12, so the 6px
  // margin before it leaves 9px of air after the value.
  const CHEV = '<svg class="fs-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  const ALL = '<svg class="fs-ic fs-all" viewBox="0 0 18 18" aria-hidden="true"><circle cx="6.5" cy="9" r="4.25"/><circle cx="11.5" cy="9" r="4.25"/></svg>';
  const SEARCH = '<svg class="fs-search-ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg>';
  const CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  function iconHtml(o) {
    const d = o.dataset;
    if (d.icon) return `<img class="fs-ic" src="${esc(d.icon)}" alt="" width="18" height="18" decoding="async">`;
    if (d.glyph === 'all') return ALL;
    if (d.token != null) {
      const src = tokenIcon(d.token);
      if (src) return `<img class="fs-ic" src="${esc(src)}" alt="" width="18" height="18" decoding="async">`;
      return d.token ? `<span class="fs-ic fs-mono" aria-hidden="true">${esc(String(d.token)[0].toUpperCase())}</span>` : '';
    }
    if (d.chain != null) {
      const c = CHAINS[d.chain];
      if (c && c[1]) return `<img class="fs-ic${c[2] ? ' fs-ic-ink' : ''}" src="/icons/chains/${c[1]}.svg" alt="" width="18" height="18" decoding="async">`;
      const n = chainName(d.chain);
      return `<span class="fs-ic fs-mono" aria-hidden="true">${esc(n.length <= 3 ? n : n[0])}</span>`;
    }
    return '';
  }
  const labelOf = (o) => (o.dataset.label || o.textContent).trim();

  const css = `
    .fs-native {
      position: absolute !important; width: 1px !important; height: 1px !important;
      margin: -1px !important; padding: 0 !important; border: 0 !important;
      overflow: hidden !important; clip-path: inset(50%) !important;
      opacity: 0 !important; pointer-events: none !important;
    }
    .fs-trigger {
      -webkit-appearance: none; appearance: none;
      margin: 0; border: 0; background: none;
      font: inherit; color: inherit; text-align: left;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .fs-trigger:disabled { cursor: default; opacity: 0.55; }
    /* The chevron is the trigger's own (.fs-chev): at the end of the value's
       line, always clear of it. A page's old background chevron stays off. */
    .fs-trigger { display: flex; align-items: center; background-image: none !important; }
    .fs-face { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto; }
    .fs-chev {
      flex: none; width: 12px; height: 12px; margin-left: 6px;
      fill: none; stroke: var(--text-3, var(--text-secondary, #9A9AA6)); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
      transition: transform 0.18s ease;
    }
    .fs-trigger[aria-expanded="true"] .fs-chev { transform: rotate(180deg); }
    @media (prefers-reduced-motion: reduce) { .fs-chev { transition: none; } }
    .fs-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* An option's data-narrow is its word for a cramped trigger ("All" for
       "All vaults"); a page shows it (.fs-narrow) where the full one won't fit. */
    .fs-narrow { display: none; }
    .fs-ic { width: 18px; height: 18px; flex-shrink: 0; border-radius: 4px; object-fit: contain; }
    .fs-trigger .fs-ic { width: 16px; height: 16px; }
    [data-theme="dark"] .fs-ic-ink { filter: invert(1); }
    .fs-mono {
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      background: var(--text, #0B0B0F); color: var(--surface, var(--bg, #fff));
      font: 700 6.5px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
      letter-spacing: -0.02em;
    }
    .fs-all { fill: none; stroke: var(--text-3, var(--text-secondary, #9A9AA6)); stroke-width: 1.5; }

    .fs-pop {
      --fs-surface: var(--surface, var(--bg, #fff));
      position: fixed; z-index: 1000;
      display: flex; flex-direction: column;
      min-width: 200px; max-width: min(380px, calc(100vw - 16px));
      padding: 6px;
      box-sizing: border-box;
      background: var(--fs-surface);
      border: 1px solid var(--line-strong, var(--stroke, #E2E2E7));
      border-radius: 14px;
      box-shadow: 0 18px 44px rgba(16, 16, 24, 0.14), 0 2px 6px rgba(16, 16, 24, 0.06);
      font-family: var(--sans, Geist, ui-sans-serif, system-ui, sans-serif);
      color: var(--text, #0B0B0F);
      opacity: 0; visibility: hidden;
      transform: translateY(-4px) scale(0.985); transform-origin: top left;
      transition: opacity 0.13s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.16s;
    }
    .fs-pop.fs-up { transform-origin: bottom left; transform: translateY(4px) scale(0.985); }
    .fs-pop.open { opacity: 1; visibility: visible; transform: none; transition: opacity 0.13s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s; }
    [data-theme="dark"] .fs-pop { box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.02); }
    .fs-head { display: none; }
    .fs-search-wrap { position: relative; flex-shrink: 0; margin-bottom: 6px; }
    .fs-search-wrap[hidden] { display: none; }
    .fs-search {
      width: 100%; height: 36px; box-sizing: border-box;
      padding: 0 10px 0 32px;
      border: 1px solid var(--line-strong, var(--stroke, #E2E2E7)); border-radius: 10px;
      background: var(--bg-subtle, var(--bg-alt, rgba(127, 127, 127, 0.06)));
      font: 500 14px var(--sans, Geist, ui-sans-serif, system-ui, sans-serif); color: inherit;
      outline: none;
      -webkit-appearance: none; appearance: none;
    }
    .fs-search::-webkit-search-cancel-button { display: none; }
    @media (pointer: coarse) { .fs-search { font-size: 16px; } }   /* no zoom-on-focus */
    .fs-search:focus { border-color: var(--accent, #8429FF); background: var(--fs-surface); }
    .fs-search-ic {
      position: absolute; left: 10px; top: 50%; width: 14px; height: 14px; margin-top: -7px;
      fill: none; stroke: var(--text-3, var(--text-secondary, #9A9AA6)); stroke-width: 1.6; stroke-linecap: round;
      pointer-events: none;
    }
    .fs-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; outline: none; }
    .fs-opt {
      display: flex; align-items: center; gap: 10px;
      min-height: 36px; padding: 0 10px;
      border-radius: 9px;
      font-size: 14px; font-weight: 500; line-height: 1.25;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .fs-opt.active { background: var(--bg-hover, var(--bg-subtle, rgba(127, 127, 127, 0.08))); }
    .fs-opt[aria-selected="true"] { font-weight: 600; }
    .fs-opt.disabled { opacity: 0.45; cursor: default; }
    /* A long name takes a second line rather than end in "…" (past two, it
       does). The ✓ stands in the selected row's note, so no row keeps room
       for it: the names get that room. */
    .fs-opt { padding-top: 6px; padding-bottom: 6px; }
    .fs-opt .fs-text { flex: 1 1 auto; white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .fs-note { flex-shrink: 0; font-size: 12px; font-weight: 500; color: var(--text-3, var(--text-secondary, #9A9AA6)); }
    .fs-check {
      display: none; width: 15px; height: 15px; flex-shrink: 0; margin-left: 2px;
      fill: none; stroke: var(--accent, #8429FF); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
    }
    .fs-opt[aria-selected="true"] .fs-check { display: block; }
    .fs-opt[aria-selected="true"] .fs-note { display: none; }
    .fs-empty { padding: 12px 10px; font-size: 13px; color: var(--text-3, var(--text-secondary, #9A9AA6)); }

    /* A phone: a sheet from the bottom, thumb-sized rows. */
    .fs-scrim {
      position: fixed; inset: 0; z-index: 999;
      background: rgba(10, 10, 14, 0.36);
      opacity: 0; visibility: hidden;
      transition: opacity 0.22s ease, visibility 0s linear 0.22s;
    }
    .fs-scrim.open { opacity: 1; visibility: visible; transition: opacity 0.22s ease, visibility 0s; }
    .fs-pop.fs-sheet {
      left: 0; right: 0; top: auto; bottom: 0;
      width: auto; min-width: 0; max-width: none;
      max-height: min(78dvh, 640px);
      padding: 0 12px calc(12px + env(safe-area-inset-bottom, 0px));
      border: 0; border-radius: 20px 20px 0 0;
      box-shadow: 0 -18px 48px rgba(10, 10, 14, 0.18);
      opacity: 1;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear 0.3s;
    }
    .fs-pop.fs-sheet.open { transform: none; transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), visibility 0s; }
    .fs-pop.fs-sheet.dragging { transition: none; }
    .fs-sheet .fs-head {
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
      padding: 22px 4px 12px 8px;
      position: relative;
      touch-action: none;
    }
    .fs-sheet .fs-head::before {
      content: ''; position: absolute; top: 8px; left: 50%; margin-left: -19px;
      width: 38px; height: 5px; border-radius: 999px;
      background: var(--line-strong, var(--stroke, #E2E2E7));
    }
    .fs-title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    .fs-close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; padding: 0;
      border: 0; border-radius: 50%;
      background: var(--bg-subtle, var(--bg-alt, rgba(127, 127, 127, 0.08)));
      color: var(--text-2, var(--text-body, #5E5E6B));
      cursor: pointer;
    }
    .fs-close svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .fs-sheet .fs-search { height: 44px; font-size: 16px; border-radius: 12px; }
    .fs-sheet .fs-opt { min-height: 50px; padding: 6px 12px; border-radius: 12px; font-size: 15.5px; gap: 12px; }
    .fs-sheet .fs-ic { width: 22px; height: 22px; }
    .fs-sheet .fs-mono { font-size: 7.5px; }
    .fs-sheet .fs-check { width: 18px; height: 18px; }
    @media (prefers-reduced-motion: reduce) {
      .fs-pop, .fs-pop.open, .fs-pop.fs-sheet, .fs-pop.fs-sheet.open, .fs-scrim { transition: none; }
    }
  `;

  // ---- The one popup, shared by every dropdown on the page ----------------
  let pop, title, searchWrap, search, list, scrim;
  let current = null, items = [], active = -1, lockedScroll = false;
  const sheetMq = window.matchMedia('(max-width: 560px)');

  function build() {
    const style = document.createElement('style');
    style.id = 'fs-style';
    style.textContent = css;
    document.head.appendChild(style);

    scrim = document.createElement('div');
    scrim.className = 'fs-scrim';
    pop = document.createElement('div');
    pop.className = 'fs-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="fs-head"><span class="fs-title"></span>`
      + `<button type="button" class="fs-close" aria-label="Close">${CLOSE}</button></div>`
      + `<div class="fs-search-wrap" hidden>${SEARCH}<input class="fs-search" type="search" placeholder="Search"`
      + ` aria-label="Search" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`
      + `<div class="fs-list" id="fs-list" role="listbox" tabindex="-1"></div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(pop);
    title = pop.querySelector('.fs-title');
    searchWrap = pop.querySelector('.fs-search-wrap');
    search = pop.querySelector('.fs-search');
    list = pop.querySelector('.fs-list');

    list.addEventListener('click', (e) => {
      const o = e.target.closest('.fs-opt');
      if (o) choose(+o.dataset.k);
    });
    list.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const o = e.target.closest('.fs-opt');
      if (o && +o.dataset.k !== active) setActive(+o.dataset.k, false);
    });
    search.addEventListener('input', () => renderList(true));
    pop.addEventListener('keydown', onKey);
    pop.querySelector('.fs-close').addEventListener('click', () => close(true));
    scrim.addEventListener('click', () => close(false));
    // A click elsewhere closes the list (a phone's sheet closes on its scrim,
    // so the tap that closes it never lands on the page beneath).
    document.addEventListener('pointerdown', (e) => {
      if (!current || pop.classList.contains('fs-sheet')) return;
      if (pop.contains(e.target) || ownerOf(current).contains(e.target)) return;
      close(false);
    }, true);
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    swipeToClose();
  }

  // The trigger and the cell around it: a click anywhere on it opens the list.
  const ownerOf = (api) => api.btn.closest('label') || api.btn;
  const titleOf = (api) => {
    const own = api.btn.closest('label');
    const t = own && own.querySelector('.filter-label, .ui-filter-label');
    return (api.sel.getAttribute('aria-label') || (t ? t.textContent : '') || '').trim();
  };

  function open(api) {
    if (api.sel.disabled) return;
    if (current) close(false);
    current = api;
    const sheet = sheetMq.matches;
    pop.classList.toggle('fs-sheet', sheet);
    pop.setAttribute('aria-label', titleOf(api) || 'Choose');
    title.textContent = titleOf(api);
    const searchable = api.sel.options.length > 12;
    searchWrap.hidden = !searchable;
    search.value = '';
    renderList(false);
    api.btn.setAttribute('aria-expanded', 'true');
    api.btn.setAttribute('aria-controls', 'fs-list');
    position();
    pop.classList.add('open');
    scrim.classList.toggle('open', sheet);
    if (sheet) { lockedScroll = true; document.documentElement.style.overflow = 'hidden'; }
    // On a phone the keyboard waits until the search box is tapped.
    (searchable && !sheet ? search : list).focus({ preventScroll: true });
    revealActive();
  }

  function close(refocus) {
    if (!current) return;
    const api = current;
    current = null;
    pop.classList.remove('open');
    scrim.classList.remove('open');
    pop.style.transform = '';
    api.btn.setAttribute('aria-expanded', 'false');
    if (lockedScroll) { document.documentElement.style.overflow = ''; lockedScroll = false; }
    if (refocus || pop.contains(document.activeElement)) api.btn.focus({ preventScroll: true });
  }

  function renderList(keepQuery) {
    const sel = current.sel;
    const q = keepQuery ? search.value.trim().toLowerCase() : '';
    items = [];
    let html = '';
    for (let i = 0; i < sel.options.length; i++) {
      const o = sel.options[i];
      if (o.hidden) continue;
      const text = labelOf(o);
      if (q && !text.toLowerCase().includes(q) && !(o.dataset.note || '').toLowerCase().includes(q)) continue;
      const k = items.push(i) - 1;
      html += `<div class="fs-opt${o.disabled ? ' disabled' : ''}" role="option" id="fs-o${k}" data-k="${k}"`
        + ` aria-selected="${i === sel.selectedIndex}"${o.disabled ? ' aria-disabled="true"' : ''}>`
        + iconHtml(o) + `<span class="fs-text">${esc(text)}</span>`
        + (o.dataset.note ? `<span class="fs-note">${esc(o.dataset.note)}</span>` : '')
        + CHECK + '</div>';
    }
    list.innerHTML = html || '<div class="fs-empty">No match</div>';
    const at = items.indexOf(sel.selectedIndex);
    setActive(q ? firstEnabled(0, 1) : (at >= 0 ? at : firstEnabled(0, 1)), false);
  }

  function setActive(k, reveal = true) {
    const prev = list.querySelector('.fs-opt.active');
    if (prev) prev.classList.remove('active');
    active = k;
    const el = k >= 0 ? list.querySelector(`#fs-o${k}`) : null;
    if (el) {
      el.classList.add('active');
      list.setAttribute('aria-activedescendant', el.id);
      search.setAttribute('aria-activedescendant', el.id);
      if (reveal) el.scrollIntoView({ block: 'nearest' });
    } else {
      list.removeAttribute('aria-activedescendant');
      search.removeAttribute('aria-activedescendant');
    }
  }
  const revealActive = () => { const el = list.querySelector('.fs-opt.active'); if (el) el.scrollIntoView({ block: 'nearest' }); };
  const enabledAt = (k) => k >= 0 && k < items.length && !current.sel.options[items[k]].disabled;
  function firstEnabled(from, step) {
    for (let k = from; k >= 0 && k < items.length; k += step) if (enabledAt(k)) return k;
    return -1;
  }
  function move(by) {
    if (!items.length) return;
    const step = by > 0 ? 1 : -1;
    let k = Math.max(0, Math.min(items.length - 1, (active < 0 ? (by > 0 ? -1 : items.length) : active) + by));
    if (!enabledAt(k)) k = firstEnabled(k, step) >= 0 ? firstEnabled(k, step) : firstEnabled(k, -step);
    if (k >= 0) setActive(k);
  }

  function choose(k) {
    if (!current || !enabledAt(k)) return;
    const sel = current.sel, i = items[k];
    const changed = sel.selectedIndex !== i;
    close(true);
    if (!changed) return;
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let typed = '', typedAt = 0;
  function onKey(e) {
    if (!current) return;
    const inSearch = e.target === search;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); return;
      case 'ArrowUp': e.preventDefault(); move(-1); return;
      case 'PageDown': e.preventDefault(); move(8); return;
      case 'PageUp': e.preventDefault(); move(-8); return;
      case 'Home': if (!inSearch) { e.preventDefault(); setActive(firstEnabled(0, 1)); } return;
      case 'End': if (!inSearch) { e.preventDefault(); setActive(firstEnabled(items.length - 1, -1)); } return;
      case 'Enter': e.preventDefault(); choose(active); return;
      case ' ': if (!inSearch) { e.preventDefault(); choose(active); } return;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); return;
      case 'Tab': close(false); return;
    }
    // Typing jumps to the next name that starts with what was typed.
    if (!inSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = (now - typedAt > 700 ? '' : typed) + e.key.toLowerCase();
      typedAt = now;
      const n = items.length;
      for (let s = 0; s < n; s++) {
        const k = (Math.max(active, 0) + (typed.length > 1 ? 0 : 1) + s) % n;
        if (enabledAt(k) && labelOf(current.sel.options[items[k]]).toLowerCase().startsWith(typed)) { setActive(k); break; }
      }
    }
  }

  // Under its cell, or above it when there is more room there; follows the
  // page as it scrolls, and closes once the cell has left the screen.
  let queued = false;
  function schedule() {
    if (!current || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; position(); });
  }
  function position() {
    if (!current || pop.classList.contains('fs-sheet')) {
      if (pop) { pop.style.left = pop.style.top = pop.style.bottom = pop.style.minWidth = pop.style.maxHeight = ''; }
      return;
    }
    const r = ownerOf(current).getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) { close(false); return; }
    pop.style.minWidth = Math.max(200, Math.round(r.width)) + 'px';
    const below = vh - r.bottom - 12, above = r.top - 12;
    const down = below >= 260 || below >= above;
    pop.style.maxHeight = Math.max(140, Math.min(400, down ? below : above)) + 'px';
    const left = Math.max(8, Math.min(r.left, vw - pop.offsetWidth - 8));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = down ? Math.round(r.bottom + 6) + 'px' : 'auto';
    pop.style.bottom = down ? 'auto' : Math.round(vh - r.top + 6) + 'px';
    pop.classList.toggle('fs-up', !down);
  }

  // A phone's sheet follows a finger down from its header, and goes if let
  // go far or fast enough.
  function swipeToClose() {
    const head = pop.querySelector('.fs-head');
    let y0 = null, dy = 0, t0 = 0;
    head.addEventListener('touchstart', (e) => {
      if (!current || !pop.classList.contains('fs-sheet') || e.touches.length !== 1) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    }, { passive: true });
    head.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      pop.classList.add('dragging');
      pop.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      pop.classList.remove('dragging');
      if (dy > 70 || (dy > 24 && dy / Math.max(1, Date.now() - t0) > 0.5)) close(false);
      else pop.style.transform = '';
    };
    head.addEventListener('touchend', end);
    head.addEventListener('touchcancel', end);
  }

  // ---- One <select> ---------------------------------------------------------
  // Values set from script (select.value = …) fire no event: catch the setter.
  function hook(sel, prop, after) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(sel, prop, {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); after(); },
    });
  }

  function enhance(sel) {
    if (!sel || sel.__fs) return sel && sel.__fs;
    if (!pop) build();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fs-trigger';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    sel.parentNode.insertBefore(btn, sel);
    sel.classList.add('fs-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    const api = { sel, btn };
    sel.__fs = api;

    const sync = () => {
      const o = sel.options[sel.selectedIndex];
      const text = o && esc(o.dataset.short || labelOf(o));
      const words = o && o.dataset.narrow ? `<span class="fs-wide">${text}</span><span class="fs-narrow">${esc(o.dataset.narrow)}</span>` : text;
      btn.innerHTML = (o ? `<span class="fs-face">${iconHtml(o)}<span class="fs-text">${words}</span></span>` : '') + CHEV;
      btn.disabled = sel.disabled;
      if (current === api) renderList(true);
    };
    sync();
    sel.addEventListener('change', sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
    hook(sel, 'value', sync);
    hook(sel, 'selectedIndex', sync);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (current === api) close(true); else open(api);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(api); }
    });
    return api;
  }

  window.FusionSelect = {
    enhance,
    enhanceAll: (root) => (root || document).querySelectorAll('select[data-fs]').forEach(enhance),
    chainName,
    chainIcon,
    tokenIcon,
    close: () => close(false),
  };
  window.FusionSelect.enhanceAll();
})();
