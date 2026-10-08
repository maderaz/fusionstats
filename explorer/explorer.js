// explorer/explorer.js — one vault at a time. A search field over every
// vault IPOR lists (by name, token, network or address, as the Activity
// page's product list filters), and, once one is picked, the vault: what it
// is, its yield, its assets, its markets now and over time, its capacity.
//
// The list, the APY and the TVL now are ipor-vaults.json's; the rest is the
// vault's own file, explorer/vaults/<chain>-<address>.json
// (tools/build-explorer.js, from the TVL snapshots, the holders, the fee
// terms and the markets read on-chain, collect-vault-markets.js). The page's
// address carries the vault (?v=0x…&c=base), so a vault can be linked to.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY = 864e5;
  const esc = UI.esc, usd = UI.usd;
  const FS = window.FusionSelect;
  const chainName = (c) => (FS ? FS.chainName(c) : String(c));
  const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || f;
  const pctTxt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d) + '%');
  const iso = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const dateTxt = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const amount = (n) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 }));
  const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  // How long ago, however long: the site's "8h ago", "40d ago", then months
  // and years rather than a date (a row says its date beside it).
  const agoLong = (t) => {
    const s = Date.now() / 1000 - t;
    if (s < 60 * 86400) return UI.ago(t);
    if (s < 365 * 86400) return Math.round(s / (30.44 * 86400)) + ' mo ago';
    return (s / (365.25 * 86400)).toFixed(1).replace(/\.0$/, '') + ' y ago';
  };
  // An amount, a tiny one to its first two digits rather than "0".
  const qty = (n) => (n == null ? '—' : n !== 0 && Math.abs(n) < 0.0001 ? String(Number(n.toPrecision(2))) : amount(n));
  const cents = (v) => (v == null ? '—' : v > 0 && v < 0.005 ? '<$0.01' : usd(v));
  const EXPLORERS = { ethereum: ['Etherscan', 'https://etherscan.io/address/'], base: ['Basescan', 'https://basescan.org/address/'], arbitrum: ['Arbiscan', 'https://arbiscan.io/address/'] };

  // What a name says about a vault: who runs it, and what kind it is.
  const CURATORS = [[/^TAU\b/i, 'TAU Labs'], [/^(TESS|Tesseract)\b/i, 'Tesseract'], [/^Harvest\b/i, 'Harvest'], [/^Reservoir\b/i, 'Reservoir'],
    [/^(IPOR|Fusion)\b/i, 'IPOR'], [/^Hyperithm\b/i, 'Hyperithm'], [/^Origin\b/i, 'Origin Protocol'], [/^Strata/i, 'Strata'],
    [/^Llamarisk/i, 'LlamaRisk'], [/^Ensuro\b/i, 'Ensuro'], [/^Tanken\b/i, 'Tanken'], [/^AlphaYields/i, 'AlphaYields'], [/^yo(USD|ETH|BTC)\b/i, 'Yo']];
  const curatorOf = (name) => { for (const [re, c] of CURATORS) if (re.test(name || '')) return c; return null; };
  function categoryOf(name) {
    const n = String(name || '');
    if (/loop|looper|looping|leverage/i.test(n)) return 'Leveraged looping';
    if (/carry/i.test(n)) return 'Carry trade';
    if (/debt vault/i.test(n)) return 'Debt vault';
    if (/lending optimi[sz]er|\bLO\b/i.test(n)) return 'Lending optimizer';
    if (/pointsmax/i.test(n)) return 'Points';
    if (/liquidity/i.test(n)) return 'Liquidity';
    return 'Yield vault';
  }

  // ---- The vault list -------------------------------------------------------
  let vaults = [];
  const mark = (sym) => {
    const src = FS && FS.tokenIcon ? FS.tokenIcon(sym) : null;
    return src ? `<img class="ic" src="${esc(src)}" alt="" width="20" height="20" decoding="async">`
      : `<span class="mono" aria-hidden="true">${esc(String(sym || '?')[0].toUpperCase())}</span>`;
  };
  const chainMark = (c) => {
    const ic = FS && FS.chainIcon ? FS.chainIcon(c) : null;
    return ic ? `<img src="${esc(ic.src)}" alt=""${ic.ink ? ' class="ink"' : ''} width="14" height="14" decoding="async">` : '';
  };
  // A vault's row: an option in the search's list, or a plain link (a pick).
  const row = (v, i, pick) => `<a class="xp-opt vault-row"${pick ? '' : ` role="option" id="xp-o${i}" data-i="${i}"`} href="${hrefOf(v)}">${mark(v.token)}`
    + `<span class="nm">${esc(v.name)}</span><span class="nt">${chainMark(v.chain)}${v.tvl >= 1 ? usd(v.tvl) : '—'}</span></a>`;
  const hrefOf = (v) => '/explorer/?v=' + v.address.toLowerCase() + '&c=' + encodeURIComponent(v.chain);

  // ---- Search ----------------------------------------------------------------
  const input = $('q'), pop = $('xpPop'), list = $('xpList');
  let shown = [], active = -1;
  const isAddress = (s) => /^0x[0-9a-f]{40}$/i.test(s.trim());
  function filter(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return vaults;
    // Words match the name, token and network; an address only what is
    // typed as one (0x…), not two letters that happen to be in it.
    return vaults.filter(v => {
      const hay = (v.name + ' ' + v.token + ' ' + chainName(v.chain) + ' ' + v.chain).toLowerCase();
      return terms.every(t => (/^0x/.test(t) ? v.address.toLowerCase().startsWith(t) : hay.includes(t)));
    });
  }
  function render() {
    const q = input.value.trim();
    shown = filter(q).slice(0, 80);
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.length ? shown.map((v, i) => row(v, i)).join('')
      : `<div class="xp-empty">${isAddress(q) ? 'No Fusion vault we track at ' + esc(shortAddr(q)) + '.' : 'No vault matches.'}</div>`;
    paint();
  }
  function paint() {
    list.querySelectorAll('.xp-opt').forEach((el, i) => el.classList.toggle('active', i === active));
    input.setAttribute('aria-activedescendant', active >= 0 ? 'xp-o' + active : '');
    const el = active >= 0 && list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  const open = () => { if (!vaults.length) return; render(); pop.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (pop.hidden) open();
      e.preventDefault();
      if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; paint(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  // A press on a row picks it before the field loses focus.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const a = e.target.closest('.xp-opt');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    pick(shown[Number(a.dataset.i)]);
  });
  document.addEventListener('pointerdown', (e) => { if (!$('search').contains(e.target)) close(); });
  function pick(v) {
    if (!v) return;
    close();
    input.value = '';
    input.blur();
    history.pushState({ fromHome: true }, '', hrefOf(v));
    route();
    window.scrollTo({ top: 0 });
  }

  // ---- Routing ---------------------------------------------------------------
  function route() {
    const p = new URLSearchParams(location.search);
    const a = (p.get('v') || '').toLowerCase(), c = (p.get('c') || '').toLowerCase();
    const v = a && (vaults.find(x => x.address.toLowerCase() === a && (!c || String(x.chain).toLowerCase() === c))
      || vaults.find(x => x.address.toLowerCase() === a));
    if (!a) return showHome();
    if (!v) return showMissing(a);
    showTab(p.get('tab'));
    showVault(v);
  }
  window.addEventListener('popstate', route);
  // The title keeps one line: a long vault name steps down a size at a time,
  // to 16px; one too long even then takes a second line.
  function fitTitle() {
    const h = $('title');
    h.style.fontSize = '';
    h.style.whiteSpace = 'nowrap';
    // Stepped aside on a phone (nav.js), the top bar saying it: nothing to fit.
    if (h.getBoundingClientRect().width <= 1) return;
    let size = parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth + 0.5 && size > 16) { size -= 1; h.style.fontSize = size + 'px'; }
    if (h.scrollWidth > h.clientWidth + 0.5) h.style.whiteSpace = '';
  }
  window.addEventListener('resize', fitTitle);
  function showHome() {
    document.title = 'Explorer — Fusion Stats';
    $('title').textContent = 'Explorer';
    requestAnimationFrame(fitTitle);   // after nav.js has seen the new heading
    $('lede').textContent = 'Every Fusion vault, one at a time: search by name, token or network, or paste its address.';
    $('tags').hidden = true;
    $('status').textContent = '';
    $('home').hidden = false;
    $('vault').hidden = true;
    $('search').hidden = false;
    $('back').hidden = true;
    $('picks').innerHTML = vaults.slice(0, 12).map((v, i) => row(v, i, true)).join('');
  }
  function showMissing(a) {
    showHome();
    $('status').innerHTML = 'No Fusion vault we track at <b>' + esc(shortAddr(a)) + '</b>.';
  }

  // ---- A vault -----------------------------------------------------------------
  let cur = null, file = null, perfView = 'apy', perfRange = '90', allocRange = '90', tvlUnit = 'usd';
  async function showVault(v) {
    cur = v; file = null;
    document.title = v.name + ' — Explorer — Fusion Stats';
    $('title').textContent = v.name;
    requestAnimationFrame(fitTitle);   // after nav.js has seen the new heading
    $('lede').textContent = categoryOf(v.name);
    $('home').hidden = true;
    $('vault').hidden = false;
    close();
    $('search').hidden = true;
    $('back').hidden = false;
    $('status').textContent = '';
    tags(null);
    figures(null);
    $('perfChart').innerHTML = $('allocChart').innerHTML = '<div class="ui-empty">Loading…</div>';
    holdersPage = 1; actionsPage = 1; admPage = 1; avPage = 1;
    if (tab === 'params') paramsView();
    if (tab === 'holders') holdersView();
    if (tab === 'activity') activityView();
    if (tab === 'actions') actionsView();
    const want = v;
    const f = await fetch('/explorer/vaults/' + String(v.chain).toLowerCase() + '-' + v.address.toLowerCase() + '.json')
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (cur !== want) return;   // another vault was picked meanwhile
    file = f || {};
    tags(file);
    figures(file);
    markets(file);
    capacity(file);
    facts(file);
    const at = file.markets && file.markets.readAt || file.builtAt;
    $('status').innerHTML = at ? 'Updated <b>' + UI.ago(Date.parse(at) / 1000) + '</b>' : '';
    if (tab === 'holders') holdersView();
    if (tab === 'params') paramsView();
    // A chart drawn while its tab is hidden has no size: drawn when it shows.
    if (tab === 'perf') await Promise.all([drawPerf(), drawAlloc()]);
  }

  // ---- Tabs: Performance, All Holders, Activity, Curator Action History ----------
  // The tab is kept in the address bar (&tab=holders), so a view can be linked
  // to; switching tabs doesn't add to Back's history.
  const TABS = ['perf', 'params', 'holders', 'activity', 'actions'];
  let tab = 'perf';
  function showTab(t, fromClick) {
    const was = tab;
    tab = TABS.includes(t) ? t : 'perf';
    for (const k of TABS) {
      $('tab-' + k).setAttribute('aria-selected', String(k === tab));
      $('tab-' + k).tabIndex = k === tab ? 0 : -1;
      $('pane-' + k).hidden = k !== tab;
    }
    // On a phone the tabs scroll sideways: the one picked comes into view.
    const strip = $('tabs'), on = $('tab-' + tab);
    if (strip.scrollWidth > strip.clientWidth) strip.scrollLeft = on.offsetLeft - strip.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
    if (!fromClick) return;
    const u = new URL(location.href);
    if (tab === 'perf') u.searchParams.delete('tab'); else u.searchParams.set('tab', tab);
    history.replaceState(history.state, '', u.pathname + u.search);
    if (tab === 'params') paramsView();
    if (tab === 'holders') holdersView();
    if (tab === 'activity') activityView();
    if (tab === 'actions') actionsView();
    if (tab === 'perf' && was !== 'perf' && file) { drawPerf(); drawAlloc(); }
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab, true); });
  // Arrow keys move along the tabs, as a tab list does.
  $('tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(next, true);
    $('tab-' + next).focus();
  });

  // ---- Parameters ---------------------------------------------------------------------------
  // How the vault is set up, read from the chain (tools/build-explorer.js'
  // params): its fees and limits, what each market's fuses may touch, who
  // holds each role, the contracts that run it. The strategy is told on the
  // IPOR app, which this links to.
  const EXPLORE = { ethereum: 'https://etherscan.io/address/', base: 'https://basescan.org/address/', arbitrum: 'https://arbiscan.io/address/' };
  const pct3 = (v) => (v == null ? '—' : v.toFixed(v > 0 && v < 1 ? 3 : 2) + '%');
  const span = (sec) => {
    if (sec == null) return '—';
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.round(sec / 60) + ' min';
    if (sec < 86400 * 2) return +(sec / 3600).toFixed(1) + ' h';
    return +(sec / 86400).toFixed(1) + ' days';
  };
  const addrLink = (a) => `<a class="prm-addr" href="/address/?a=${esc(a)}" title="${esc(a)}"><span class="m-hide">${esc(a)}</span><span class="m-show">${esc(shortAddr(a))}</span></a>`;
  const prmRow = (k, v, cls) => `<div class="prm-row"><span class="k">${k}</span><span class="v${cls ? ' ' + cls : ''}">${v}</span></div>`;
  function paramsView() {
    if (!cur) return;
    const chain = String(cur.chain).toLowerCase();
    $('prmStrategy').innerHTML = 'Each vault\'s strategy and its prospectus are written up by its curator on the IPOR app. '
      + `<a href="https://app.ipor.io/fusion/${esc(chain)}/${esc(cur.address.toLowerCase())}" target="_blank" rel="noopener">Read it on the IPOR app ↗</a>`;
    const empty = (id, text) => { $(id).innerHTML = '<div class="empty-state">' + esc(text) + '</div>'; };
    if (!file) { ['prmFees', 'prmPerms', 'prmRoles', 'prmContracts'].forEach(id => { $(id).innerHTML = '<div class="ui-empty">Loading…</div>'; }); return; }
    const p = file.params, fees = file.fees || {};
    ['prmPermsNote', 'prmRolesNote', 'prmNote'].forEach(id => { $(id).textContent = ''; });
    if (!p) {
      $('prmFees').innerHTML = prmRow('Management fee', pct3(fees.mgmt)) + prmRow('Performance fee', pct3(fees.perf));
      const text = 'Not read yet: a vault\'s set-up is read from the chain every six hours, for every vault above $10K.';
      empty('prmPerms', text); empty('prmRoles', text); empty('prmContracts', text);
      return;
    }
    const sym = esc(cur.token || '');
    $('prmFees').innerHTML = prmRow('Management fee', pct3(fees.mgmt)) + prmRow('Performance fee', pct3(fees.perf))
      + prmRow('Onboarding', pct3(p.depositFee)) + prmRow('Offboarding, scheduled', pct3(p.requestFee)) + prmRow('Offboarding, instant', pct3(p.withdrawFee))
      + prmRow('Vault size limit', p.cap != null ? amount(p.cap) + ' ' + sym : 'None')
      + (p.redemptionDelay != null ? prmRow('Redemption delay', span(p.redemptionDelay)) : '')
      + prmRow('Withdraw window', span(p.withdrawWindow));
    const base = EXPLORE[chain];
    const chip = ([a, s]) => (s ? `<a class="prm-chip" href="${base ? base + esc(a) : '#'}" target="_blank" rel="noopener" title="${esc(a)}">${esc(s)}</a>`
      : /^0x[0-9a-f]{40}$/i.test(a) ? `<a class="prm-chip mono" href="${base ? base + esc(a) : '#'}" target="_blank" rel="noopener" title="${esc(a)}">${esc(shortAddr(a))}</a>`
      : `<span class="prm-chip mono" title="${esc(a)}">${esc(a.slice(0, 6) + '…' + a.slice(-4))}</span>`);
    const perms = (p.permissions || []).filter(m => m.fuses || m.subs.length);
    if (!perms.length) empty('prmPerms', 'No markets: the vault has no fuses yet.');
    else $('prmPerms').innerHTML = perms.map(m => '<div class="prm-mkt"><div class="prm-mkt-h"><b>' + esc(m.name) + '</b><span>'
        + (m.fuses ? m.fuses + (m.fuses === 1 ? ' fuse' : ' fuses') : '') + '</span></div>'
        + (m.subs.length ? '<div class="prm-chips">' + m.subs.map(chip).join('') + (m.more ? `<span class="prm-chip">+${m.more} more</span>` : '') + '</div>' : '')
        + '</div>').join('');
    $('prmPermsNote').textContent = 'Each market the vault\'s fuses act in, and the assets, pools or markets granted to it there (its substrates). Tokens held are those it may keep.'
      + (p.instantFuses ? ' ' + p.instantFuses + (p.instantFuses === 1 ? ' fuse serves' : ' fuses serve') + ' instant withdrawals.' : '');
    if (!p.roles) empty('prmRoles', 'Being read: who holds each role is read from the vault\'s access manager history, from its deployment on.');
    else if (!p.roles.length) empty('prmRoles', 'No roles found.');
    else $('prmRoles').innerHTML = p.roles.map(([name, who]) => prmRow(esc(name), who.map(addrLink).join(''), 'addrs')).join('');
    if (p.roles && !p.rolesComplete) $('prmRolesNote').textContent = 'Still being read back: the vault\'s earlier role changes may change this.';
    const NAMES = { access: 'Access manager', withdraw: 'Withdraw manager', oracle: 'Price oracle', rewards: 'Rewards manager', fee: 'Fee manager' };
    const cs = Object.entries(p.contracts || {});
    if (!cs.length) empty('prmContracts', 'Not read yet.');
    else $('prmContracts').innerHTML = cs.map(([k, a]) => prmRow(NAMES[k] || k, addrLink(a), 'addrs')).join('');
    $('prmNote').textContent = 'Read from the chain' + (p.readAt ? ' ' + UI.ago(Date.parse(p.readAt) / 1000) : '') + '. Fees are a share of the gain (performance), a year\'s share of the assets (management), or a share of what comes in or goes out.';
  }

  // ---- All holders ------------------------------------------------------------------------
  // Every holder, largest first (tools/build-explorer.js, from the holders
  // collector's balances), 25 a page. What each holds is its share of the
  // vault: of its assets as the markets read them (else its shares at the
  // latest share price) and of the TVL now; a holder that is itself a Fusion
  // vault is named.
  const PAGE = 25;
  let holdersPage = 1, actionsPage = 1, admPage = 1, avPage = 1;
  const lastOf = (s) => { s = series(s); if (!s) return null; for (let i = s.v.length - 1; i >= 0; i--) if (s.v[i] != null) return s.v[i]; return null; };
  const debank = (a) => `<a class="debank" href="https://debank.com/profile/${a}" target="_blank" rel="noopener" title="View on DeBank" aria-label="View on DeBank"><img src="/icons/debank.svg" alt="" width="18" height="18"></a>`;
  function holderRows() {
    const f = file || {}, all = (f.holders && f.holders.all) || [];
    const supply = all.reduce((a, h) => a + h[1], 0);
    const sp = lastOf(f.days && f.days.sharePrice), total = f.markets && f.markets.totalAssets;
    return all.map(([a, shares], i) => {
      const share = supply > 0 ? shares / supply : null;
      const v = vaults.find(x => x.address.toLowerCase() === a);
      const asset = share != null && total > 0 ? total * share : sp ? shares * sp : null;
      return { rank: i + 1, address: a, shares, asset, usd: share != null && cur.tvl ? cur.tvl * share : null, share, name: v ? v.name : null };
    });
  }
  function holdersView() {
    if (!cur) return;
    const body = $('holders').querySelector('tbody');
    if (!file) { body.innerHTML = '<tr class="ui-loading-row"><td colspan="5"></td></tr>'; $('holdersList').innerHTML = ''; $('holdersPager').innerHTML = ''; $('holdersNote').textContent = ''; return; }
    const rows = holderRows();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="dim">Not read yet: the holders collector reads every vault above $10K.</td></tr>';
      $('holdersList').innerHTML = '<div class="empty-state">Not read yet: the holders collector reads every vault above $10K.</div>';
      $('holdersPager').innerHTML = ''; $('holdersNote').textContent = '';
      return;
    }
    const top10 = rows.slice(0, 10).reduce((a, r) => a + (r.share || 0), 0);
    $('holdersNote').textContent = rows.length.toLocaleString('en-US') + ' holders. The largest holds ' + pctTxt((rows[0].share || 0) * 100, 1)
      + (rows.length > 10 ? ', the ten largest ' + pctTxt(top10 * 100, 1) : '') + ' of the vault.';
    const last = Math.ceil(rows.length / PAGE);
    holdersPage = Math.min(Math.max(1, holdersPage), last);
    const page = rows.slice((holdersPage - 1) * PAGE, holdersPage * PAGE);
    const name = (r) => (r.name ? `<span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>` : '');
    const who = (r, rank) => `<span class="hd">${rank ? `<span class="rkn">${r.rank}</span>` : ''}<a class="mono" href="/address/?a=${r.address}" title="${esc(r.address)}">${esc(shortAddr(r.address))}</a>${debank(r.address)}`
      + (rank ? '' : name(r)) + '</span>';
    const holds = (r) => (r.asset != null ? amount(r.asset) + ' ' + esc(cur.token) : amount(r.shares) + ' shares');
    body.innerHTML = page.map(r => `<tr><td class="rk">${r.rank}</td><td>${who(r)}</td><td class="n">${holds(r)}</td>`
      + `<td class="n">${r.usd != null ? usd(r.usd) : '—'}</td><td class="n">${r.share != null ? pctTxt(r.share * 100, 2) : '—'}</td></tr>`).join('');
    // A phone: a holder a block, its value and share under it; a holder that
    // is a Fusion vault has its name on a line of its own, the width of the row.
    const line = (cls, left, right) => `<div class="l ${cls}">${left.startsWith('<span class="hd">') ? left : `<span>${left}</span>`}<span>${right}</span></div>`;
    $('holdersList').innerHTML = page.map(r => `<div class="mk-item">${line('l1', who(r, true), r.usd != null ? usd(r.usd) : '—')}`
      + (r.name ? `<div class="l nm-l">${name(r)}</div>` : '')
      + line('', holds(r), r.share != null ? pctTxt(r.share * 100, 2) : '—') + '</div>').join('');
    $('holdersPager').innerHTML = UI.pager({ total: rows.length, page: holdersPage, size: PAGE, noun: 'holders' });
  }
  UI.onPage($('holdersPager'), (n) => { holdersPage = n; holdersView(); $('holdersSec').scrollIntoView({ block: 'start' }); });
  $('holdersCsv').addEventListener('click', () => {
    if (!cur || !file) return;
    const rows = holderRows();
    if (!rows.length) return;
    UI.csv('fusion-' + slug() + '-holders-' + stamp(), [['rank', 'address', 'shares', 'holds_' + String(cur.token).toLowerCase(), 'value_usd', 'share_pct', 'fusion_vault']]
      .concat(rows.map(r => [r.rank, r.address, r.shares, r.asset != null ? r.asset.toFixed(6) : '', r.usd != null ? r.usd.toFixed(2) : '', r.share != null ? (r.share * 100).toFixed(4) : '', r.name || ''])));
  });

  // ---- Activity -------------------------------------------------------------------------------
  // The vault's deposits and withdrawals, newest first (explorer/activity/…,
  // from activity-events.json), 25 a page: by type, from an amount, by wallet.
  let av = null, avFor = null, avType = '', avMin = 0, avWallet = '';
  const TXS_AV = { ethereum: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', arbitrum: 'https://arbiscan.io/tx/' };
  async function activityView() {
    if (!cur) return;
    const want = cur, key = String(cur.chain).toLowerCase() + '-' + cur.address.toLowerCase();
    if (avFor !== key) {
      avFor = key; av = null; avPage = 1;
      $('activity').querySelector('tbody').innerHTML = '<tr class="ui-loading-row"><td colspan="6"></td></tr>';
      $('activityList').innerHTML = ''; $('activityPager').innerHTML = ''; $('activityNote').textContent = '';
      const a = await fetch('/explorer/activity/' + key + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (cur !== want || avFor !== key) return;
      av = a || { rows: [], count: 0, missing: true };
    }
    if (av) renderActivity();
  }
  function avRows() {
    const w = avWallet.toLowerCase().replace(/\s+/g, '');
    return (av.rows || []).filter(r => (avType === '' || String(r[1]) === avType)
      && (!avMin || (r[3] != null && r[3] >= avMin)) && (!w || String(r[4]).includes(w)));
  }
  function renderActivity() {
    const rows = avRows(), set = (i, v, sub) => { const f = $('avFigures').querySelectorAll('.ui-figure')[i]; f.querySelector('.v').textContent = v; f.querySelector('.s').textContent = sub || ' '; };
    const dep = rows.filter(r => r[1] === 1), wd = rows.filter(r => r[1] === 0);
    const sum = (l) => l.reduce((a, r) => a + (r[3] || 0), 0);
    const din = sum(dep), dout = sum(wd);
    set(0, usd(din), dep.length.toLocaleString('en-US') + (dep.length === 1 ? ' deposit' : ' deposits'));
    set(1, usd(dout), wd.length.toLocaleString('en-US') + (wd.length === 1 ? ' withdrawal' : ' withdrawals'));
    set(2, (din - dout < 0 ? '−' : '+') + usd(Math.abs(din - dout)), rows.length ? 'in what is shown' : '');
    const body = $('activity').querySelector('tbody');
    if (!rows.length) {
      const why = av.missing ? 'Not read yet: deposits and withdrawals are read every few minutes for every vault above $50.'
        : (av.rows || []).length ? 'Nothing matches these filters.' : 'No deposits or withdrawals yet.';
      body.innerHTML = '<tr><td colspan="6" class="dim">' + why + '</td></tr>';
      $('activityList').innerHTML = '<div class="empty-state">' + why + '</div>';
      $('activityPager').innerHTML = ''; $('activityNote').textContent = '';
      return;
    }
    const last = Math.ceil(rows.length / PAGE);
    avPage = Math.min(Math.max(1, avPage), last);
    const page = rows.slice((avPage - 1) * PAGE, avPage * PAGE);
    const txBase = TXS_AV[String(cur.chain).toLowerCase()];
    const sym = esc(av.symbol || cur.token || '');
    const when = (t) => (t ? esc(agoLong(t)) + '<span>' + esc(dateTxt(t * 1000)) + '</span>' : '—');
    const badge = (k) => (k ? '<span class="av-badge dep">Deposit</span>' : '<span class="av-badge wd">Withdrawal</span>');
    const wallet = (a) => `<span class="hd"><a class="mono" href="/address/?a=${esc(a)}" title="${esc(a)}">${esc(shortAddr(a))}</a>${debank(a)}</span>`;
    const tx = (h) => (txBase && h ? `<a class="act-tx" href="${txBase}${esc(h)}" target="_blank" rel="noopener" title="${esc(h)}" aria-label="The transaction">${esc(h.slice(0, 6) + '…' + h.slice(-4))} ↗</a>` : '');
    body.innerHTML = page.map(([t, k, amt, v, a, h]) => `<tr><td class="when">${when(t)}</td><td>${badge(k)}</td><td class="n">${qty(amt)} ${sym}</td>`
      + `<td class="n">${cents(v)}</td><td>${wallet(a)}</td><td class="n">${tx(h)}</td></tr>`).join('');
    $('activityList').innerHTML = page.map(([t, k, amt, v, a, h]) => '<div class="mk-item">'
      + `<div class="l l1"><span>${badge(k)}</span><span>${v != null ? cents(v) : qty(amt) + ' ' + sym}</span></div>`
      + `<div class="l"><span class="when">${t ? esc(agoLong(t)) : '—'}</span><span>${qty(amt)} ${sym}</span></div>`
      + `<div class="l">${wallet(a)}<span>${tx(h)}</span></div></div>`).join('');
    $('activityPager').innerHTML = UI.pager({ total: rows.length, page: avPage, size: PAGE, noun: rows.length === 1 ? 'event' : 'events' });
    $('activityNote').innerHTML = 'Every deposit into the vault and withdrawal from it, read from its own events on-chain; a wallet is the one the shares belong to.'
      + (av.count > (av.rows || []).length ? ' The newest ' + (av.rows || []).length.toLocaleString('en-US') + ' of ' + av.count.toLocaleString('en-US') + ' are here.' : '')
      + (av.updatedAt ? ' Read ' + esc(UI.ago(Date.parse(av.updatedAt) / 1000)) + '.' : '');
  }
  UI.onPage($('activityPager'), (n) => { avPage = n; renderActivity(); $('activitySec').scrollIntoView({ block: 'start' }); });
  $('avType').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === avType) return;
    avType = b.dataset.v; avPage = 1;
    $('avType').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (av) renderActivity();
  });
  $('avMin').addEventListener('change', (e) => { avMin = Number(e.target.value) || 0; avPage = 1; if (av) renderActivity(); });
  $('avWallet').addEventListener('input', (e) => { avWallet = e.target.value.trim(); avPage = 1; if (av) renderActivity(); });
  $('activityCsv').addEventListener('click', () => {
    if (!av || !(av.rows || []).length) return;
    UI.csv('fusion-' + slug() + '-activity-' + stamp(), [['time_utc', 'type', 'amount_' + String(av.symbol || cur.token || 'asset').toLowerCase(), 'value_usd', 'wallet', 'tx']]
      .concat(avRows().map(([t, k, amt, v, a, h]) => [t ? new Date(t * 1000).toISOString() : '', k ? 'deposit' : 'withdrawal', amt, v != null ? v : '', a, h || ''])));
  });

  // ---- Curator action history ---------------------------------------------------------------
  // Each rebalance the curator made, newest first (explorer/actions/…, from
  // the rebalance scan's on-chain token transfers): what moved, out of the
  // vault (↗) or into it (↙), a market by its protocol and a token by its
  // symbol; and what the rebalance moved in all, counted once.
  let acts = null, actsFor = null;
  const TXS = { ethereum: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', arbitrum: 'https://arbiscan.io/tx/' };
  let actKind = 'admin';
  $('actKind').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === actKind) return;
    actKind = b.dataset.v;
    $('actKind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (acts) renderActions();
  });
  async function actionsView() {
    if (!cur) return;
    const want = cur, key = String(cur.chain).toLowerCase() + '-' + cur.address.toLowerCase();
    if (actsFor !== key) {
      actsFor = key; acts = null; actionsPage = 1;
      $('actList').innerHTML = '<div class="ui-empty">Loading…</div>';
      $('actPager').innerHTML = ''; $('actNote').textContent = '';
      $('actFigures').querySelectorAll('.v').forEach(n => { n.textContent = ''; });
      const a = await fetch('/explorer/actions/' + key + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (cur !== want || actsFor !== key) return;
      acts = a || { actions: [], count: 0, missing: true };
    }
    if (!acts) return;
    renderActions();
  }
  // Administrative: every change made to the vault and the contracts that run
  // it (tools/describe-changes.js), newest first; the set-up made at its
  // deployment carries that moment.
  function renderAdmin() {
    const adm = acts.admin, rows = (adm && adm.rows) || [];
    const set = (i, v, sub) => { const f = $('admFigures').querySelectorAll('.ui-figure')[i]; f.querySelector('.v').textContent = v; f.querySelector('.s').textContent = sub || ' '; };
    if (!rows.length) {
      $('admFigures').hidden = true;
      $('admList').innerHTML = '<div class="empty-state">' + (adm && adm.complete
        ? 'No changes found: nothing about the vault or the contracts that run it has been changed.'
        : adm ? 'Being read: changes to the vault and its contracts are read from their events on-chain, from the vault\'s deployment on, a stretch every six hours.'
        : 'Not read yet: changes to the vault and its contracts are read from their events on-chain every six hours, from the vault\'s deployment on.') + '</div>';
      $('admPager').innerHTML = ''; $('admNote').textContent = '';
      return;
    }
    $('admFigures').hidden = false;
    const n = (r) => r.n || 1;
    const total = rows.reduce((a, r) => a + n(r), 0), atDeploy = rows.filter(r => r.d).reduce((a, r) => a + n(r), 0);
    const since = rows.filter(r => !r.d);
    set(0, total.toLocaleString('en-US'), rows.length === total ? '' : rows.length.toLocaleString('en-US') + ' transactions\' worth');
    set(1, atDeploy.toLocaleString('en-US'), rows.find(r => r.d && r.t) ? dateTxt(rows.find(r => r.d && r.t).t * 1000) : 'the set-up');
    set(2, since.length && since[0].t ? agoLong(since[0].t) : '—', since.length ? since[0].what : 'none since deployment');
    const last = Math.ceil(rows.length / PAGE);
    admPage = Math.min(Math.max(1, admPage), last);
    const txBase = TXS[String(cur.chain).toLowerCase()];
    const when = (r) => { if (!r.t) return '—'; const d = new Date(r.t * 1000);
      return dateTxt(r.t * 1000) + '<span>' + (r.d ? '<i class="dep-tag">At deployment</i>' : d.toISOString().slice(11, 16) + ' UTC · ' + esc(agoLong(r.t))) + '</span>'; };
    const who = (r) => '<div class="adm-by">' + (r.role ? '<span class="rl"' + (r.also ? ' title="Also ' + esc(r.also.join(', ')) + '"' : '') + '>'
        + esc(r.role) + (r.also ? ' +' + r.also.length : '') + '</span>' : '')
      + (r.by ? `<a href="/address/?a=${esc(r.by)}" title="${esc(r.by)}">${esc(shortAddr(r.by))}</a>` : '')
      + (r.via ? `<a href="/address/?a=${esc(r.via)}" title="Signed by ${esc(r.via)}">via ${esc(shortAddr(r.via))}</a>` : '') + '</div>';
    $('admList').innerHTML = rows.slice((admPage - 1) * PAGE, admPage * PAGE).map(r => '<div class="adm">'
      + '<div class="act-when">' + when(r) + '</div>'
      + '<div class="adm-what"><b>' + esc(r.what) + '</b><span class="on">' + esc(r.on) + '</span>' + (r.detail ? '<span class="dt">' + esc(r.detail) + '</span>' : '') + '</div>'
      + who(r)
      + (txBase && r.tx ? `<a class="act-tx" href="${txBase}${esc(r.tx)}" target="_blank" rel="noopener" title="${esc(r.tx)}" aria-label="The transaction"><span class="m-hide">${esc(r.tx.slice(0, 6) + '…' + r.tx.slice(-4))} </span>↗</a>` : '<span></span>')
      + '</div>').join('');
    $('admPager').innerHTML = UI.pager({ total: rows.length, page: admPage, size: PAGE, noun: rows.length === 1 ? 'change' : 'changes' });
    $('admNote').innerHTML = 'What was changed in the vault and in the contracts that run it, its access manager, fee, withdraw and rewards managers and its own price oracle, read from their events on-chain: fuses and markets, roles and who may call what, fees, limits and caps. '
      + 'Executed by is who sent the transaction, or the contract with a role it went through (a Safe), with its roles at the time. The set-up made at deployment carries that moment.'
      + (adm.complete ? '' : ' Still being read back: earlier changes may yet appear.')
      + (adm.readAt ? ' Read ' + esc(UI.ago(Date.parse(adm.readAt) / 1000)) + '.' : '');
  }
  UI.onPage($('admPager'), (n) => { admPage = n; renderAdmin(); $('actionsSec').scrollIntoView({ block: 'start' }); });
  function renderActions() {
    $('admView').hidden = actKind !== 'admin';
    $('rebView').hidden = actKind === 'admin';
    if (actKind === 'admin') { renderAdmin(); return; }
    const list = acts.actions || [], set = (i, v, sub) => { const f = $('actFigures').querySelectorAll('.ui-figure')[i]; f.querySelector('.v').textContent = v; f.querySelector('.s').textContent = sub; };
    if (!list.length) {
      $('actFigures').hidden = true;
      $('actList').innerHTML = '<div class="empty-state">' + (acts.missing
        ? 'Not read yet: the rebalance scan reads the vaults above $10K once a day.'
        : 'No rebalances found: the vault has not moved its capital between markets since the scan began.') + '</div>';
      $('actPager').innerHTML = ''; $('actNote').textContent = '';
      return;
    }
    $('actFigures').hidden = false;
    const now = Date.now() / 1000, month = list.filter(a => a[0] && now - a[0] <= 30 * 86400);
    const oldest = list[list.length - 1][0];
    const partial = acts.count > list.length && oldest && now - oldest < 30 * 86400;
    set(0, acts.count.toLocaleString('en-US'), oldest ? 'since ' + dateTxt(oldest * 1000) : '');
    set(1, (partial ? '≥ ' : '') + usd(month.reduce((s, a) => s + (a[2] || 0), 0)), month.length.toLocaleString('en-US') + (month.length === 1 ? ' rebalance' : ' rebalances'));
    set(2, list[0][0] ? UI.ago(list[0][0]) : '—', list[0][0] ? dateTxt(list[0][0] * 1000) : '');
    const last = Math.ceil(list.length / PAGE);
    actionsPage = Math.min(Math.max(1, actionsPage), last);
    const txBase = TXS[String(cur.chain).toLowerCase()];
    const when = (ts) => { if (!ts) return '—'; const d = new Date(ts * 1000);
      return dateTxt(ts * 1000) + '<span>' + d.toISOString().slice(11, 16) + ' UTC</span>'; };
    $('actList').innerHTML = list.slice((actionsPage - 1) * PAGE, actionsPage * PAGE).map(([ts, tx, vol, moves]) => '<div class="act">'
      + '<div class="act-when">' + when(ts) + '</div>'
      + '<div class="act-moves">' + moves.map(([pi, out, v]) => `<span class="mv"><i>${out ? '↗' : '↙'}</i>${esc(acts.protocols[pi] || '?')}<b>${usd(v)}</b></span>`).join('') + '</div>'
      + '<div class="act-vol">' + usd(vol) + '</div>'
      + (txBase ? `<a class="act-tx" href="${txBase}${tx}" target="_blank" rel="noopener" title="${esc(tx)}" aria-label="The transaction"><span class="m-hide">${esc(tx.slice(0, 6) + '…' + tx.slice(-4))} </span>↗</a>` : '<span></span>')
      + '</div>').join('');
    $('actPager').innerHTML = UI.pager({ total: list.length, page: actionsPage, size: PAGE, noun: 'rebalances' });
    $('actNote').innerHTML = '↗ left the vault, ↙ came into it: a market by its protocol, a token by its symbol. Each rebalance is read from the vault\'s token transfers on-chain, deposits and withdrawals left out, and what it moved is counted once, the larger of what left and what came in.'
      + (acts.count > list.length ? ' The newest ' + list.length.toLocaleString('en-US') + ' of ' + acts.count.toLocaleString('en-US') + ' are here; every one is on <a href="/address/?a=' + cur.address.toLowerCase() + '">its Address page</a>.' : '')
      + (acts.scannedAt ? ' Scanned ' + UI.ago(Date.parse(acts.scannedAt) / 1000) + '.' : '');
  }
  UI.onPage($('actPager'), (n) => { actionsPage = n; renderActions(); $('actionsSec').scrollIntoView({ block: 'start' }); });
  $('actionsCsv').addEventListener('click', () => {
    if (acts && actKind === 'admin') {
      const rows = (acts.admin && acts.admin.rows) || [];
      if (!rows.length) return;
      UI.csv('fusion-' + slug() + '-curator-changes-' + stamp(), [['time_utc', 'at_deployment', 'what', 'detail', 'contract', 'executed_by', 'role', 'via', 'tx']]
        .concat(rows.map(r => [r.t ? new Date(r.t * 1000).toISOString() : '', r.d ? 'yes' : '', r.what, r.detail, r.on, r.by || '', [r.role].concat(r.also || []).filter(Boolean).join('; '), r.via || '', r.tx || ''])));
      return;
    }
    if (!acts || !(acts.actions || []).length) return;
    UI.csv('fusion-' + slug() + '-curator-actions-' + stamp(), [['time_utc', 'tx', 'moved_usd', 'moves']]
      .concat(acts.actions.map(([ts, tx, vol, moves]) => [ts ? new Date(ts * 1000).toISOString() : '', tx, vol,
        moves.map(([pi, out, v]) => (out ? 'out ' : 'in ') + (acts.protocols[pi] || '?') + ' ' + v).join('; ')])));
  });

  // Total value managed: everything in the markets (supplied, and held as
  // collateral); the TVL is that less what is borrowed.
  function managed(f) {
    const ms = (f && f.markets && f.markets.markets) || [];
    if (!ms.length) return null;
    let assets = 0, debt = 0;
    for (const m of ms) {
      if (m.positions && m.positions.length) { assets += m.supplyUsd || 0; debt += m.borrowUsd || 0; }
      else if (m.netUsd > 0) assets += m.netUsd;
    }
    return { assets, debt, net: assets - debt };
  }
  function tags(f) {
    const v = cur, t = [];
    const ic = FS && FS.chainIcon ? FS.chainIcon(v.chain) : null;
    t.push(`<span class="xp-tag">${ic ? `<img class="chain${ic.ink ? ' ink' : ''}" src="${esc(ic.src)}" alt="" width="16" height="16">` : ''}${esc(chainName(v.chain))}</span>`);
    const tok = FS && FS.tokenIcon ? FS.tokenIcon(v.token) : null;
    t.push(`<span class="xp-tag">${tok ? `<img src="${esc(tok)}" alt="" width="16" height="16">` : ''}${esc(v.token)}</span>`);
    const c = curatorOf(v.name);
    if (c) t.push(`<span class="xp-tag">${esc(c)}</span>`);
    const m = managed(f);
    if (m && m.net > 0 && m.assets / m.net >= 1.05) t.push(`<span class="xp-tag lev">${(m.assets / m.net).toFixed(1)}× leverage</span>`);
    t.push(`<span class="xp-tag addr">${esc(shortAddr(v.address))}<button type="button" id="copyAddr" aria-label="Copy the address" title="Copy the address">`
      + '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.75"/><path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5"/></svg></button></span>');
    $('tags').innerHTML = t.join('');
    $('tags').hidden = false;
    $('copyAddr').addEventListener('click', () => {
      if (navigator.clipboard) navigator.clipboard.writeText(v.address).then(() => { $('copyAddr').title = 'Copied'; }).catch(() => {});
    });
  }

  // ---- Figures -------------------------------------------------------------------
  const series = (s) => (s && Array.isArray(s.v) ? s : null);
  // The share price's yearly pace between two days, or null.
  function pace(sp, i0, i1) {
    const a = sp.v[i0], b = sp.v[i1];
    if (!(a > 0) || !(b > 0) || i1 <= i0) return null;
    const r = Math.pow(b / a, 365 / (i1 - i0)) - 1;
    return Number.isFinite(r) ? r * 100 : null;
  }
  // The last day with a share price, and the first within n days before it.
  function trailing(sp, n) {
    let end = sp.v.length - 1;
    while (end >= 0 && !(sp.v[end] > 0)) end--;
    if (end < 1) return null;
    let start = Math.max(0, end - n);
    while (start < end && !(sp.v[start] > 0)) start++;
    return end - start >= Math.min(n, 7) ? pace(sp, start, end) : null;
  }
  function figures(f) {
    const figs = document.querySelectorAll('#figures .ui-figure');
    const set = (i, v, s) => { figs[i].querySelector('.v').textContent = v; figs[i].querySelector('.s').textContent = s; };
    if (!f) { figs.forEach(x => { x.querySelector('.v').textContent = ''; x.querySelector('.s').innerHTML = '&nbsp;'; }); return; }
    const v = cur, sp = series(f.days && f.days.sharePrice);
    const p30 = sp ? trailing(sp, 30) : null;
    set(0, v.apy != null ? pctTxt(Number(v.apy)) : '—', p30 != null ? '30-day: ' + pctTxt(p30) : 'as IPOR reports it');
    const m = managed(f), mk = f.markets;
    set(1, m ? usd(m.assets) : '—', m ? (m.debt > 0 ? usd(m.debt) + ' of it borrowed' : 'nothing borrowed') : 'markets not read yet');
    set(2, usd(v.tvl), mk && mk.totalAssets != null ? amount(mk.totalAssets) + ' ' + v.token : v.token + ' deposited');
    const h = f.holders, hd = h && series(h.days);
    let since = '';
    if (hd && hd.v.length > 30) {
      const now = hd.v[hd.v.length - 1], then = hd.v[hd.v.length - 31];
      if (now != null && then != null) since = now === then ? 'unchanged in 30 days' : (now > then ? '+' : '−') + Math.abs(now - then) + ' in 30 days';
    }
    set(3, h && h.total != null ? h.total.toLocaleString('en-US') : '—', h ? since || 'holding shares' : 'not tracked yet');
  }

  // ---- Charts ----------------------------------------------------------------------
  const CONFIG = { displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false, showTips: false };
  const plotlyReady = new Promise((resolve, reject) => {
    const tag = $('plotlyJs');
    const settle = () => (window.Plotly ? resolve() : reject(new Error('no Plotly')));
    if (window.Plotly || !tag || tag.dataset.state) return settle();
    tag.addEventListener('load', settle);
    tag.addEventListener('error', () => reject(new Error('no Plotly')));
  });
  const rangeDays = (r) => (r === 'all' ? Infinity : Number(r));
  // The layout on screen (FusionChart.fit draws its axes), or for an image:
  // light, its own dates under the plot.
  const LAYOUT = (forExport, range) => ({
    autosize: true, margin: { l: 70, r: 20, t: 20, b: 50 },
    plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Geist, -apple-system, sans-serif', color: forExport ? '#5E5E6B' : cssVar('--text-2', '#5E5E6B'), size: 12 },
    xaxis: Object.assign({ type: 'date', showgrid: false }, forExport ? { tickformat: range === '30' || range === '90' ? '%b %-d' : "%b '%y", nticks: 6, ticks: 'outside', ticklen: 6, tickcolor: 'rgba(0,0,0,0)' } : {}),
    yaxis: { showgrid: true, zeroline: false, gridcolor: forExport ? '#E5E5EA' : undefined, griddash: forExport ? '4px,8px' : undefined },
    showlegend: false, hovermode: 'x unified', hoverdistance: -1, spikedistance: -1, dragmode: false,
  });
  async function ready(gd) {
    try { await plotlyReady; return true; } catch { gd.innerHTML = '<div class="ui-empty">The chart library (cdn.plot.ly) did not load.</div>'; return false; }
  }
  const empty = (gd, text) => { if (window.Plotly) Plotly.purge(gd); gd.innerHTML = '<div class="empty-state">' + esc(text) + '</div>'; };

  // Performance: the APY the share price made over each week before a day
  // (a year's worth), the share price, or the TVL.
  function perfPoints(view) {
    const d = file && file.days;
    if (view === 'tvl' || view === 'assets') {
      const t = series(d && (view === 'assets' ? d.assets : d.tvl));
      return t ? t.v.map((v, i) => [t.from + i, v]) : [];
    }
    const sp = series(d && d.sharePrice);
    if (!sp) return [];
    if (view === 'sp') return sp.v.map((v, i) => [sp.from + i, v]).filter(p => p[1] > 0);
    const out = [];
    for (let i = 7; i < sp.v.length; i++) {
      let j = i - 7;
      while (j > i - 14 && j > 0 && !(sp.v[j] > 0)) j--;
      const r = sp.v[i] > 0 ? pace(sp, j, i) : null;
      // A move no yield vault makes (over 5% a day) is a reading's fault.
      if (r != null && Math.abs(sp.v[i] / sp.v[j] - 1) <= 0.05 * (i - j)) out.push([sp.from + i, r]);
    }
    return out;
  }
  // The chart's figure, or null when the range has too little to draw.
  // TVL in dollars, or in the vault's asset when that is picked and read.
  const inAsset = () => perfView === 'tvl' && tvlUnit === 'asset' && !!(file && file.days && file.days.assets);
  function perfFigure(forExport) {
    const all = perfPoints(inAsset() ? 'assets' : perfView);
    const from = all.length ? all[all.length - 1][0] - rangeDays(perfRange) + 1 : 0;
    const pts = all.filter(p => p[0] >= from && p[1] != null);
    if (pts.length < 2) return null;
    const c = cssVar('--accent', '#8429FF');
    const traces = [{ type: 'scatter', mode: 'lines', name: { apy: 'APY', sp: 'Share price', tvl: 'TVL' }[perfView] || 'Value', x: pts.map(p => iso(p[0])), y: pts.map(p => p[1]),
      line: { color: c, width: 2 }, fill: perfView === 'tvl' ? 'tozeroy' : 'none', fillcolor: perfView === 'tvl' ? cssVar('--accent-bg', 'rgba(132,41,255,0.08)') : undefined }];
    const layout = LAYOUT(forExport, perfRange);
    layout.yaxis.tickformat = perfView === 'apy' ? '.1f' : perfView === 'sp' ? '.4~f' : inAsset() ? ',.3~s' : '$,.2~s';
    if (perfView === 'apy') layout.yaxis.ticksuffix = '%';
    if (perfView === 'tvl') layout.yaxis.rangemode = 'tozero';
    return { traces, layout };
  }
  async function drawPerf() {
    const gd = $('perfChart');
    showUnit();
    $('perfNote').textContent = perfView === 'apy' ? 'Each day, the share price\'s pace over the week before it, a year\'s worth, after fees.'
      : perfView === 'sp' ? 'What one share is worth in ' + cur.token + ', after fees.'
      : inAsset() ? 'Total value locked, in ' + cur.token + ', at a reading a day.' : 'Total value locked, in dollars, at a reading a day.';
    const f = perfFigure(false);
    if (!f) return empty(gd, file && file.days ? 'Not enough history in this range yet.' : 'No history yet: the vault\'s first daily readings fill this in.');
    if (!(await ready(gd))) return;
    gd.querySelectorAll(':scope > .empty-state, :scope > .ui-empty').forEach(n => n.remove());
    await Plotly.react(gd, FusionChart.quiet(FusionChart.soft(f.traces)), FusionChart.fit(f.layout, f.traces), CONFIG);
    FusionChart.glide(gd, (p) => {
      const y = p[0].y;
      const val = perfView === 'apy' ? pctTxt(y) : perfView === 'sp' ? y.toFixed(6) + ' ' + esc(cur.token) : inAsset() ? amount(y) + ' ' + esc(cur.token) : usd(y);
      return FusionChart.when(p[0].x) + '<div class="hv-big">' + val + '</div>';
    });
  }

  // Allocation: each market's dollars on the days read, stacked.
  const PALETTE = () => [cssVar('--accent', '#8429FF'), cssVar('--chart-2', '#009689'), cssVar('--chart-1', '#F54900'), cssVar('--chart-4', '#FFB900'),
    cssVar('--chart-3', '#104E64'), cssVar('--chart-5', '#FE9A00'), '#94A3B8', '#CBD5E1'];
  // Markets by their largest balance in the range, the biggest at the bottom.
  function allocFigure(forExport) {
    const a = file && file.allocation, days = (a && a.days) || [];
    const last = days.length ? days[days.length - 1][0] : 0;
    const inRange = days.filter(([d]) => d >= last - rangeDays(allocRange) + 1);
    if (inRange.length < 2) return null;
    const peak = {};
    for (const [, m] of inRange) for (const [id, v] of Object.entries(m)) peak[id] = Math.max(peak[id] || 0, v);
    const ids = Object.keys(peak).filter(id => peak[id] > 0).sort((x, y) => peak[y] - peak[x]);
    const pal = PALETTE();
    const name = (id) => (a.names && a.names[id]) || 'Market ' + id;
    const traces = ids.map((id, k) => ({ type: 'scatter', mode: 'lines', name: name(id), stackgroup: 'one',
      x: inRange.map(([d]) => iso(d)), y: inRange.map(([, m]) => m[id] || 0),
      line: { color: pal[k % pal.length], width: 0.5 }, fillcolor: pal[k % pal.length] }));
    const layout = LAYOUT(forExport, allocRange);
    layout.yaxis.tickformat = '$,.2~s';
    layout.yaxis.rangemode = 'tozero';
    if (forExport) Object.assign(layout, { showlegend: true, legend: { orientation: 'h', x: 0, y: 1.12, font: { size: 12 } }, margin: { l: 70, r: 20, t: 50, b: 50 } });
    return { traces, layout, ids, name, pal, inRange };
  }
  async function drawAlloc() {
    const gd = $('allocChart'), a = file && file.allocation, days = (a && a.days) || [];
    $('allocKey').innerHTML = '';
    $('allocNote').textContent = days.length ? 'Each market\'s balance as the vault keeps it, in dollars, at a reading a day for the last 120 days and a week apart before.' : '';
    const f = allocFigure(false);
    if (!f) return empty(gd, days.length ? 'The history is still being read: a few days at a time, newest first.' : 'No allocation history yet: the markets are read every six hours.');
    if (!(await ready(gd))) return;
    gd.querySelectorAll(':scope > .empty-state, :scope > .ui-empty').forEach(n => n.remove());
    $('allocKey').innerHTML = f.ids.map((id, k) => `<span><i style="background:${f.pal[k % f.pal.length]}"></i>${esc(f.name(id))}</span>`).join('');
    await Plotly.react(gd, FusionChart.quiet(f.traces), FusionChart.fit(f.layout, f.traces), CONFIG);
    FusionChart.glide(gd, (pts) => {
      const total = pts.reduce((s, p) => s + (p.y || 0), 0);
      return FusionChart.when(pts[0].x) + pts.filter(p => p.y > 0).map(p => FusionChart.row(p.data.fillcolor, p.data.name, usd(p.y))).join('')
        + FusionChart.row(null, 'Total', usd(total));
    });
  }

  // ---- Exports ---------------------------------------------------------------------------
  // An image at the chart's own size or a fixed one, and the numbers behind it.
  const SHAPES = { '43': [680, 510], square: [480, 480] };
  const exportSize = { perf: '43', alloc: '43' };
  const slug = () => (cur ? cur.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'vault');
  const stamp = () => new Date().toISOString().slice(0, 10);
  async function exportPng(key) {
    if (!file) return;
    // Built in the light theme's colours: the image is on white.
    const f = FusionChart.inLight(() => (key === 'perf' ? perfFigure(true) : allocFigure(true)));
    if (!f) return;
    await plotlyReady;
    const gd = $(key === 'perf' ? 'perfChart' : 'allocChart'), shape = SHAPES[exportSize[key]];
    const traces = key === 'perf' ? FusionChart.quiet(FusionChart.soft(f.traces)) : FusionChart.quiet(f.traces);
    // The image says what it is: the vault and the chart, the range, what a
    // point or a band stands for.
    const range = key === 'perf' ? perfRange : allocRange;
    const span = range === 'all' ? 'All history' : range === '365' ? 'Last 12 months' : 'Last ' + range + ' days';
    const title = cur.name + ': ' + (key === 'alloc' ? 'allocation by market' : { apy: 'APY', sp: 'share price', tvl: 'TVL' }[perfView]);
    const what = key === 'alloc' ? 'each band is a market\'s balance in dollars, '
        + (range === '30' || range === '90' ? 'read once a day' : 'read daily over the last 120 days, weekly before')
      : perfView === 'apy' ? 'each point is a day: the share price\'s pace over the week before, a year\'s worth'
      : perfView === 'sp' ? 'each point is a day: what one share is worth in ' + cur.token
      : inAsset() ? 'each point is a day\'s TVL in ' + cur.token : 'each point is a day\'s TVL in dollars';
    await FusionChart.png({ data: traces, layout: f.layout }, { width: shape ? shape[0] : gd.clientWidth, height: shape ? shape[1] : gd.clientHeight,
      title, subtitle: span + ' · ' + what,
      dots: $(key + 'Dots').checked, filename: 'fusion-' + slug() + '-' + (key === 'perf' ? perfView : 'allocation') + '-' + (key === 'perf' ? perfRange : allocRange) + '-' + stamp() + '.png' });
  }
  function exportCsv(key) {
    if (!file) return;
    if (key === 'perf') {
      const by = new Map();
      for (const [view, col] of [['apy', 1], ['sp', 2], ['tvl', 3], ['assets', 4]]) for (const [d, v] of perfPoints(view)) {
        if (!by.has(d)) by.set(d, [iso(d), '', '', '', '']);
        by.get(d)[col] = v == null ? '' : view === 'sp' ? v.toFixed(6) : view === 'apy' ? v.toFixed(3) : view === 'assets' ? String(v) : v.toFixed(0);
      }
      const rows = [['date', 'apy_7d_pct', 'share_price', 'tvl_usd', 'tvl_' + String(cur.token).toLowerCase()]].concat([...by.keys()].sort((a, b) => a - b).map(d => by.get(d)));
      return UI.csv('fusion-' + slug() + '-performance-' + stamp(), rows);
    }
    const a = file.allocation, days = (a && a.days) || [];
    const ids = [...new Set(days.flatMap(([, m]) => Object.keys(m)))];
    const name = (id) => (a.names && a.names[id]) || 'Market ' + id;
    const rows = [['date'].concat(ids.map(name))].concat(days.map(([d, m]) => [iso(d)].concat(ids.map(id => (m[id] != null ? String(m[id]) : '')))));
    UI.csv('fusion-' + slug() + '-allocation-' + stamp(), rows);
  }

  // ---- Markets ------------------------------------------------------------------------
  function markets(f) {
    const body = $('markets').querySelector('tbody');
    const ms = ((f && f.markets && f.markets.markets) || []).slice().sort((a, b) => Math.abs(b.netUsd || 0) - Math.abs(a.netUsd || 0));
    const phone = $('marketsList');
    if (!ms.length) {
      body.innerHTML = '<tr><td colspan="6" class="dim">Not read yet: the markets are read every six hours.</td></tr>';
      phone.innerHTML = '<div class="empty-state">Not read yet: the markets are read every six hours.</div>';
      $('marketsNote').textContent = '';
      return;
    }
    // A phone's blocks: the market and its net, what it holds, what it owes,
    // then each position, a line each.
    const blocks = [];
    const line = (cls, left, right) => `<div class="l ${cls}"><span>${left}</span><span>${right}</span></div>`;
    const at = (v, apy) => `${usd(v)}${apy != null ? ' · ' + pctTxt(apy) : ''}`;
    const m = managed(f);
    const netApy = (a, aApy, l, lApy) => (a - l > 0 && aApy != null && (l === 0 || lApy != null) ? (a * aApy - l * (lApy || 0)) / (a - l) : null);
    const money = (v) => (v > 0 ? usd(v) : '—');
    const lev = m.net > 0 && m.assets / m.net >= 1.05 ? (m.assets / m.net).toFixed(2) + '× leverage' : '';
    const rows = [`<tr class="total"><td>All markets${lev ? ` <span class="share">· ${lev}</span>` : ''}</td>`
      + `<td class="n">${money(m.assets)}</td><td class="n"></td><td class="n">${money(m.debt)}</td><td class="n"></td><td class="n"></td></tr>`];
    blocks.push(`<div class="mk-item total">${line('l1', 'All markets', lev)}`
      + line('', '<span class="k">Assets</span>', money(m.assets)) + (m.debt > 0 ? line('', '<span class="k">Owed</span>', money(m.debt)) : '') + '</div>');
    for (const x of ms) {
      const lending = x.positions && x.positions.length;
      const assets = lending ? x.supplyUsd || 0 : Math.max(0, x.netUsd || 0);
      const debt = lending ? x.borrowUsd || 0 : 0;
      const share = m.net > 0 && x.netUsd != null ? (100 * x.netUsd / m.net) : null;
      rows.push(`<tr><td><span class="mk">${esc(x.name)}${share != null ? `<span class="share">${share.toFixed(1)}%</span>` : ''}</span></td>`
        + `<td class="n">${money(assets)}</td><td class="n">${pctTxt(x.supplyApy)}</td>`
        + `<td class="n">${money(debt)}</td><td class="n">${debt > 0 ? pctTxt(x.borrowApy) : '—'}</td>`
        + `<td class="n">${pctTxt(netApy(assets, x.supplyApy, debt, x.borrowApy))}</td></tr>`);
      const net = netApy(assets, x.supplyApy, debt, x.borrowApy);
      const b = [line('l1', esc(x.name) + (share != null ? `<i>${share.toFixed(1)}%</i>` : ''), net != null ? 'Net ' + pctTxt(net) : ''),
        line('', '<span class="k">Assets</span>', assets > 0 ? at(assets, x.supplyApy) : '—')];
      if (debt > 0) b.push(line('', '<span class="k">Owed</span>', at(debt, x.borrowApy)));
      // What it holds, then what it owes, a market (Morpho's) at a time.
      const order = (p) => (p.side === 'borrow' ? 1 : 0);
      if (lending) for (const p of x.positions.slice().sort((a, b) => String(a.market || '').localeCompare(String(b.market || '')) || order(a) - order(b))) {
        const side = { supply: 'supplied', collateral: 'collateral', borrow: 'borrowed' }[p.side] || p.side;
        const isDebt = p.side === 'borrow';
        rows.push(`<tr class="pos"><td>${esc(p.market ? p.market + ' · ' : '')}${esc(p.asset || '?')} <span class="side">${side}</span></td>`
          + `<td class="n">${isDebt ? '' : usd(p.usd)}</td><td class="n">${isDebt ? '' : pctTxt(p.apy)}</td>`
          + `<td class="n">${isDebt ? usd(p.usd) : ''}</td><td class="n">${isDebt ? pctTxt(p.apy) : ''}</td><td class="n"></td></tr>`);
        b.push(line('p', `${esc(p.asset || '?')} <span class="k">${side}</span>`, at(p.usd, p.apy)));
      }
      blocks.push(`<div class="mk-item">${b.join('')}</div>`);
    }
    body.innerHTML = rows.join('');
    phone.innerHTML = blocks.join('');
    $('marketsNote').textContent = 'Read ' + UI.ago(Date.parse(f.markets.readAt) / 1000) + '. A loop\'s collateral earns its own yield, measured against the token borrowed; an APY left empty had nothing to measure it by.';
  }

  // ---- Capacity ----------------------------------------------------------------------------
  function capacity(f) {
    const mk = f && f.markets, sec = $('capSec');
    sec.hidden = !(mk && mk.cap > 0 && mk.totalAssets != null);
    if (sec.hidden) return;
    const sym = cur.token, used = Math.min(1, mk.totalAssets / mk.cap), left = Math.max(0, mk.cap - mk.totalAssets);
    $('capLeft').innerHTML = left > 0 ? '<b>' + amount(left) + ' ' + esc(sym) + '</b> left before the cap' : '<b>The cap is reached</b>';
    $('capPct').textContent = (used * 100).toFixed(used >= 0.995 && used < 1 ? 1 : 0) + '% used';
    $('capBar').classList.toggle('full', used >= 0.95);
    $('capBar').firstElementChild.style.width = (used * 100).toFixed(2) + '%';
    $('capIn').textContent = 'Deposits: ' + amount(mk.totalAssets) + ' ' + sym;
    $('capMax').textContent = 'Cap: ' + amount(mk.cap) + ' ' + sym;
  }

  // ---- About -------------------------------------------------------------------------------
  function facts(f) {
    const v = cur, out = [];
    const add = (k, html) => out.push(`<div><dt>${esc(k)}</dt><dd>${html}</dd></div>`);
    add('Address', `<span class="mono">${esc(shortAddr(v.address))}</span>`);
    add('Network', esc(chainName(v.chain)));
    add('Asset', esc(v.token) + (v.assetAddress ? ` <span class="mono muted">${esc(shortAddr(v.assetAddress))}</span>` : ''));
    add('Curator', esc(curatorOf(v.name) || '—'));
    if (f.deployedAt) add('Deployed', esc(dateTxt(Date.parse(f.deployedAt))));
    const fee = f.fees;
    if (fee) {
      add('Performance fee', fee.perf != null ? esc(fee.perf + '%') + (fee.daoPerf != null ? ` <span class="muted">· DAO ${esc(fee.daoPerf + '%')}</span>` : '') : '—');
      add('Management fee', fee.mgmt != null ? esc(fee.mgmt + '%') + (fee.daoMgmt != null ? ` <span class="muted">· DAO ${esc(fee.daoMgmt + '%')}</span>` : '') : '—');
    }
    const links = [];
    const chain = String(v.chain).toLowerCase();
    links.push(`<a href="https://app.ipor.io/fusion/${encodeURIComponent(chain)}/${v.address.toLowerCase()}" target="_blank" rel="noopener">IPOR app ↗</a>`);
    if (EXPLORERS[chain]) links.push(`<a href="${EXPLORERS[chain][1]}${v.address.toLowerCase()}" target="_blank" rel="noopener">${EXPLORERS[chain][0]} ↗</a>`);
    links.push(`<a href="https://debank.com/profile/${v.address.toLowerCase()}" target="_blank" rel="noopener">DeBank ↗</a>`);
    add('Links', links.join(' · '));
    $('facts').innerHTML = out.join('');
  }

  // ---- Controls ------------------------------------------------------------------------------
  function seg(id, on) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      on(b.dataset.v);
    });
  }
  seg('perfSize', (v) => { exportSize.perf = v; });
  seg('allocSize', (v) => { exportSize.alloc = v; });
  $('perfPng').addEventListener('click', () => exportPng('perf'));
  $('allocPng').addEventListener('click', () => exportPng('alloc'));
  $('perfCsv').addEventListener('click', () => exportCsv('perf'));
  $('allocCsv').addEventListener('click', () => exportCsv('alloc'));
  // Back: to the search the vault was picked from, or to the start page when
  // the vault was opened from a link.
  $('back').href = location.pathname;
  $('back').addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (history.state && history.state.fromHome) history.back();
    else { history.pushState(null, '', location.pathname); route(); window.scrollTo({ top: 0 }); }
  });
  seg('perfView', (v) => { perfView = v; if (file) drawPerf(); });
  // The TVL's unit: shown with TVL, named by the vault's asset, when it is read.
  function showUnit() {
    const has = !!(file && file.days && file.days.assets);
    $('tvlUnit').hidden = perfView !== 'tvl' || !has;
    $('tvlUnitAsset').textContent = cur ? cur.token : '';
  }
  seg('tvlUnit', (v) => { tvlUnit = v; if (file) drawPerf(); });
  seg('perfRange', (v) => { perfRange = v; if (file) drawPerf(); });
  seg('allocRange', (v) => { allocRange = v; if (file) drawAlloc(); });
  const redraw = () => { if (file && tab === 'perf') { drawPerf(); drawAlloc(); } };
  window.addEventListener('fusion:theme', redraw);
  FusionChart.onChange(redraw);
  // The picks and the list's rows are links: an ordinary press stays here.
  $('picks').addEventListener('click', (e) => {
    const a = e.target.closest('a.xp-opt');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    history.pushState({ fromHome: true }, '', a.getAttribute('href'));
    route();
    window.scrollTo({ top: 0 });
  });

  // ---- Load ----------------------------------------------------------------------------------
  fetch('/ipor-vaults.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    vaults = ((j && j.vaults) || []).filter(v => v.address && v.name)
      .map(v => Object.assign({}, v, { tvl: Number(v.tvl) || 0 }))
      .sort((a, b) => b.tvl - a.tvl);
    if (!vaults.length) { $('picks').innerHTML = '<div class="ui-error">The vault list did not load.</div>'; return; }
    route();
    if (document.activeElement === input) open();
  });
})();
