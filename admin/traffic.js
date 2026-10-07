// admin/traffic.js — the Traffic page: who visits the site, from the beacon
// every public page sends (track.js → /api/log → a private gist), read back
// from /api/logs, newest first.
//
// Hiding a city: every entry from Wrocław, the owner's own, is hidden from
// the whole page, whichever browser it came from.
//
// Leaving a visitor out: a visitor is a browser (track.js keeps one id per
// browser). This browser's own id is track.js's, so "Leave my visits out" is
// one switch; any other visitor (a phone of yours, a bot) is ticked in the
// Visitors table. A visitor left out is out of everything but that table,
// where it can be ticked back in.
//
// Both choices are kept in this browser, with their switches at the foot of
// the page.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const DAY = 864e5, HOUR = 36e5;
  const ME_KEY = 'fusionstats_session';            // this browser's visitor id (track.js)
  const IGNORE_KEY = 'fusionstats_admin_ignore';   // the visitors left out, this browser's choice
  const CITY = 'Wrocław';                          // hidden, unless this browser shows it:
  const CITY_KEY = 'fusionstats_admin_show_city';  // '1' once it does
  const PAGE = 25;
  const RANGE_DAYS = { 1: 1, 7: 7, 30: 30, all: Infinity };
  const RANGE_WORDS = { 1: 'the last 24 hours', 7: 'the last 7 days', 30: 'the last 30 days', all: 'all the log' };

  let log = [], rows = [];   // the whole log; what the page counts, the hidden city aside
  let range = '30', fPage = '', fCountry = '', fDevice = '';
  let viewsPage = 1, visitorsPage = 1;

  const me = (() => { try { return localStorage.getItem(ME_KEY) || null; } catch { return null; } })();
  let ignored = new Set((() => { try { return JSON.parse(localStorage.getItem(IGNORE_KEY) || '[]'); } catch { return []; } })());
  const saveIgnored = () => { try { localStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored])); } catch {} };
  let hideCity = (() => { try { return localStorage.getItem(CITY_KEY) !== '1'; } catch { return true; } })();

  // ---- The words for a row ---------------------------------------------------
  const short = (id) => String(id || '').slice(0, 8) || '—';
  const ts = (r) => Date.parse(r.ts);
  // A page by its address, its query left aside: "/explorer", "/".
  const pageOf = (r) => { const p = String(r.path || '/').split(/[?#]/)[0].replace(/\/+$/, ''); return p || '/'; };
  // Vercel sends the city percent-encoded ("Wroc%C5%82aw").
  const cityOf = (r) => { if (!r.city) return ''; try { return decodeURIComponent(r.city); } catch { return r.city; } };
  // "Wrocław", "Wroclaw", "WROCŁAW" alike (ł is a letter of its own, not l with a mark).
  const fold = (s) => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const inCity = (r) => fold(cityOf(r)) === fold(CITY);
  const hide = () => { rows = hideCity ? log.filter(r => !inCity(r)) : log; };
  const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
  const countryName = (cc) => { if (!cc) return 'Unknown'; try { return (regionNames && regionNames.of(cc)) || cc; } catch { return cc; } };
  const flag = (cc) => {
    if (!cc || cc.length !== 2) return '';
    const A = 0x1F1E6, c = cc.toUpperCase();
    return String.fromCodePoint(A + c.charCodeAt(0) - 65, A + c.charCodeAt(1) - 65);
  };
  const where = (r) => (r.country ? `<span class="fl">${flag(r.country)}</span>` : '') + esc(cityOf(r) || countryName(r.country));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // The log named an iPhone's system macOS until it learned better (its
  // browser says "like Mac OS X"); a phone or a tablet on macOS is iOS.
  const osOf = (r) => (r.os === 'macOS' && r.device && r.device !== 'desktop' ? 'iOS' : r.os);
  const kit = (r) => [r.device && cap(r.device), r.browser, osOf(r)].filter(Boolean).join(' · ');
  const ago = (t) => UI.ago(t / 1000);
  const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  // Where a visit came from: the beacon sends the referring site since it
  // began to (ref), "" for a visit typed in or from a bookmark.
  const sourceOf = (r) => (r.ref === undefined ? null : r.ref ? r.ref.replace(/^www\./, '') : 'Direct');
  const num = (n) => n.toLocaleString('en-US');

  // ---- What is counted ---------------------------------------------------------
  const since = () => (range === 'all' ? 0 : Date.now() - RANGE_DAYS[range] * DAY);
  const filtered = (from, to) => rows.filter(r => {
    const t = ts(r);
    return t >= from && t < to && (!fPage || pageOf(r) === fPage) && (!fCountry || r.country === fCountry) && (!fDevice || r.device === fDevice);
  });
  const counted = (list) => list.filter(r => !ignored.has(r.session_id));

  // ---- At the foot: the hidden city, and you -----------------------------------------
  function meBar() {
    const views = (n) => `<b>${num(n)}</b> ${n === 1 ? 'view' : 'views'}`;
    const inIt = log.filter(inCity).length;
    const city = `<div class="me-line"><span>Entries from <b>${esc(CITY)}</b> are ${hideCity ? 'hidden from everything on this page' : 'shown'}: ${inIt ? views(inIt) : 'none'} in the log.</span>`
      + `<label class="switch"><input type="checkbox" id="hideCity"${hideCity ? ' checked' : ''}><i></i>Hide ${esc(CITY)}</label></div>`;
    const others = [...ignored].filter(id => id !== me);
    const mine = me ? log.filter(r => r.session_id === me).length : 0;
    const left = me
      ? `This browser is visitor <span class="mono">${esc(short(me))}</span>, ${views(mine)} in the log.`
      : 'This browser has no visitor id yet: it gets one on its first visit to any page. Tick your devices in Visitors above.';
    const also = others.length
      ? `<span class="also">Also left out: ${others.map(id => `<span class="chip">${esc(short(id))}<button type="button" data-back="${esc(id)}" aria-label="Count ${esc(short(id))} again" title="Count it again">×</button></span>`).join('')}</span>`
      : '';
    const sw = me ? `<label class="switch"><input type="checkbox" id="leaveMe"${ignored.has(me) ? ' checked' : ''}><i></i>Leave my visits out</label>` : '';
    $('meBar').innerHTML = city + `<div class="me-line"><span>${left}</span>${also}${sw}</div>`;
  }
  $('meBar').addEventListener('change', (e) => {
    if (e.target.id === 'hideCity') {
      hideCity = e.target.checked;
      try { if (hideCity) localStorage.removeItem(CITY_KEY); else localStorage.setItem(CITY_KEY, '1'); } catch {}
      hide(); fillFilters(); render();
      return;
    }
    if (e.target.id !== 'leaveMe') return;
    if (e.target.checked) ignored.add(me); else ignored.delete(me);
    saveIgnored(); render();
  });
  $('meBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-back]');
    if (!b) return;
    ignored.delete(b.dataset.back); saveIgnored(); render();
  });

  // ---- Figures -----------------------------------------------------------------------
  function figures(list, prev) {
    const set = (i, v, s) => { const f = $('figures').querySelectorAll('.ui-figure')[i]; f.querySelector('.v').textContent = v; f.querySelector('.s').textContent = s || ' '; };
    const visitors = new Map();
    for (const r of list) visitors.set(r.session_id, (visitors.get(r.session_id) || 0) + 1);
    // Against the same span just before, when the log reaches back that far.
    const first = log.length ? ts(log[log.length - 1]) : Date.now();
    const vsPrev = range !== 'all' && first <= since() - RANGE_DAYS[range] * DAY / 2 && prev.length
      ? Math.round((list.length / prev.length - 1) * 100) : null;
    set(0, num(list.length), vsPrev == null ? (range === 'all' ? 'since ' + new Date(first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : RANGE_WORDS[range])
      : (vsPrev >= 0 ? '+' : '') + vsPrev + '% on the ' + (range === '1' ? 'day' : range + ' days') + ' before');
    // New: first seen in the log within the range.
    const firstSeen = new Map();
    for (let i = log.length - 1; i >= 0; i--) if (!firstSeen.has(log[i].session_id)) firstSeen.set(log[i].session_id, ts(log[i]));
    const fresh = [...visitors.keys()].filter(id => firstSeen.get(id) >= since()).length;
    set(1, num(visitors.size), range === 'all' ? 'in the whole log' : num(fresh) + ' new');
    const one = [...visitors.values()].filter(n => n === 1).length;
    set(2, visitors.size ? (list.length / visitors.size).toFixed(1) : '—', visitors.size ? Math.round(one / visitors.size * 100) + '% saw one page' : '');
    const top = tally(list, pageOf)[0];
    set(3, top ? top[0] : '—', top ? num(top[1]) + ' views · ' + Math.round(top[1] / list.length * 100) + '%' : '');
  }
  const tally = (list, key) => {
    const m = new Map();
    for (const r of list) { const k = key(r); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ---- The chart: views a day (an hour, over 24 hours), visitors with them ---------
  const plotlyReady = new Promise((resolve, reject) => {
    const tag = $('plotlyJs');
    const settle = () => (window.Plotly ? resolve() : reject(new Error('no Plotly')));
    if (window.Plotly || !tag || tag.dataset.state) return settle();
    tag.addEventListener('load', settle);
    tag.addEventListener('error', () => reject(new Error('no Plotly')));
  });
  const CONFIG = { displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false, showTips: false };
  const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || f;
  function buckets(list) {
    const hourly = range === '1';
    const step = hourly ? HOUR : DAY;
    const end = Math.floor(Date.now() / step) * step;
    const start = range === 'all'
      ? Math.floor((list.length ? ts(list[list.length - 1]) : Date.now()) / step) * step
      : end - (RANGE_DAYS[range] * DAY / step - 1) * step;
    const out = [];
    for (let t = start; t <= end; t += step) out.push({ t, views: 0, who: new Set() });
    for (const r of list) {
      const i = Math.floor((Math.floor(ts(r) / step) * step - start) / step);
      if (i >= 0 && i < out.length) { out[i].views++; out[i].who.add(r.session_id); }
    }
    return { out, hourly, step };
  }
  async function chart(list) {
    const gd = $('chart');
    const { out, hourly, step } = buckets(list);
    $('chartTitle').textContent = hourly ? 'Views an hour' : 'Views a day';
    $('chartNote').textContent = 'Bars: page views. Line: visitors, each counted once ' + (hourly ? 'an hour' : 'a day') + '.';
    try { await plotlyReady; } catch { gd.innerHTML = '<div class="ui-empty">The chart library (cdn.plot.ly) did not load.</div>'; return; }
    gd.querySelectorAll(':scope > .ui-empty').forEach(n => n.remove());
    const x = out.map(b => new Date(b.t + step / 2).toISOString());
    const accent = cssVar('--accent', '#8429FF'), line = cssVar('--text-2', '#5E5E6B');
    // Thin bars across the whole plot, as on every chart here.
    const plotW = Math.max(200, gd.clientWidth - (FusionChart.compact() ? 16 : 80));
    const fill = Math.min(0.56, 8 * out.length / plotW);
    const traces = [
      { type: 'bar', name: 'Views', x, y: out.map(b => b.views), width: step * fill, marker: { color: accent }, customdata: out.map(b => b.who.size) },
      { type: 'scatter', mode: 'lines', name: 'Visitors', x, y: out.map(b => b.who.size), line: { color: line, width: 1.75, shape: 'spline', smoothing: 0.6 } },
    ];
    const layout = {
      autosize: true, margin: { l: 70, r: 20, t: 20, b: 50 },
      plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Geist, -apple-system, sans-serif', color: cssVar('--text-2', '#5E5E6B'), size: 12 },
      xaxis: { type: 'date', tickformat: hourly ? '%H:%M' : '%b %-d', nticks: 6, showgrid: false, ticks: 'outside', ticklen: 6, tickcolor: 'rgba(0,0,0,0)', showline: false },
      yaxis: { tickformat: ',d', rangemode: 'tozero', showgrid: true, gridcolor: cssVar('--line', '#EEE'), griddash: '4px,8px', zeroline: false },
      showlegend: false, hovermode: 'x unified', hoverdistance: -1, spikedistance: -1, dragmode: false, barmode: 'overlay',
    };
    await Plotly.react(gd, FusionChart.quiet(FusionChart.soft(traces)), FusionChart.fit(layout, traces), CONFIG);
    FusionChart.glide(gd, (pts) => {
      const p = pts.find(q => q.data.type === 'bar') || pts[0];
      const t = Date.parse(p.x) - step / 2;
      const head = hourly ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        : new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return '<div class="hv-when">' + head + '</div>' + FusionChart.row(accent, 'Views', num(p.y)) + FusionChart.row(line, 'Visitors', num(p.customdata || 0));
    });
  }

  // ---- Breakdowns: pages, countries, sources, devices, browsers, systems ---------
  const CARDS = [
    { title: 'Pages', key: pageOf, filter: 'page', label: (k) => esc(k) },
    { title: 'Countries', key: (r) => r.country || null, filter: 'country', label: (k) => `<span class="fl">${flag(k)}</span>${esc(countryName(k))}` },
    { title: 'Cities', key: (r) => (r.city ? cityOf(r) + '|' + (r.country || '') : null), label: (k) => { const [c, cc] = k.split('|'); return `<span class="fl">${flag(cc)}</span>${esc(c)}`; } },
    { title: 'Sources', key: sourceOf, label: (k) => esc(k), none: 'Recorded from now on: the beacon now sends where a visit came from.' },
    { title: 'Devices', key: (r) => r.device || null, filter: 'device', label: (k) => esc(k.charAt(0).toUpperCase() + k.slice(1)) },
    { title: 'Browsers and systems', key: (r) => [r.browser, osOf(r)].filter(Boolean).join(' on ') || null, label: (k) => esc(k) },
  ];
  const SHOWN = 6;
  function cards(list) {
    $('cards').innerHTML = CARDS.map((c, ci) => {
      const t = tally(list, c.key), total = t.reduce((s, x) => s + x[1], 0);
      if (!t.length) return `<div class="card"><h3>${c.title}</h3><div class="none">${c.none || 'Nothing in this range.'}</div></div>`;
      const on = c.filter === 'page' ? fPage : c.filter === 'country' ? fCountry : c.filter === 'device' ? fDevice : '';
      const items = t.slice(0, SHOWN).map(([k, n]) => `<li${c.filter ? ` class="pick${k === on ? ' on' : ''}" data-card="${ci}" data-k="${esc(k)}" title="Show only this"` : ''}>`
        + `<span class="nm">${c.label(k)}</span><span class="ct"><b>${num(n)}</b> · ${Math.round(n / total * 100)}%</span>`
        + `<span class="bar" style="width:${Math.max(2, n / t[0][1] * 100).toFixed(1)}%"></span></li>`).join('');
      const more = t.length > SHOWN ? `<li class="more">and ${num(t.length - SHOWN)} more</li>` : '';
      return `<div class="card"><h3>${c.title}</h3><ul class="rank">${items}${more}</ul></div>`;
    }).join('');
  }
  // A row in Pages, Countries or Devices narrows everything to it; again, back.
  $('cards').addEventListener('click', (e) => {
    const li = e.target.closest('li.pick');
    if (!li) return;
    const c = CARDS[+li.dataset.card], k = li.dataset.k;
    const sel = $(c.filter === 'page' ? 'fPage' : c.filter === 'country' ? 'fCountry' : 'fDevice');
    sel.value = sel.value === k ? '' : k;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ---- Recent views: the main table, 25 a page ----------------------------------------
  function views(list) {
    const last = Math.max(1, Math.ceil(list.length / PAGE));
    viewsPage = Math.min(Math.max(1, viewsPage), last);
    const page = list.slice((viewsPage - 1) * PAGE, viewsPage * PAGE);
    const youTag = (r) => (r.session_id === me ? '<span class="you">you</span>' : '');
    $('views').querySelector('tbody').innerHTML = page.length ? page.map(r => `<tr>
        <td title="${esc(new Date(ts(r)).toLocaleString())}">${esc(ago(ts(r)))}</td>
        <td class="path" title="${esc(r.path || '/')}">${esc(r.path || '/')}</td>
        <td>${where(r)}</td>
        <td>${esc(kit(r))}</td>
        <td><span class="mono">${esc(short(r.session_id))}</span>${youTag(r)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="dim">No views in this range.</td></tr>';
    // A phone: the page and when, then where from, the device and the visitor.
    $('viewsList').innerHTML = page.length ? page.map(r => `<div class="it view-row">
        <div class="l"><span class="nm">${esc(r.path || '/')}</span><span>${esc(ago(ts(r)))}</span></div>
        <div class="l"><span>${where(r)}${r.device ? ' · ' + esc(cap(r.device)) : ''}</span><span class="mono">${esc(short(r.session_id))}</span></div></div>`).join('')
      : '<div class="empty-state">No views in this range.</div>';
    $('viewsPager').innerHTML = UI.pager({ total: list.length, page: viewsPage, size: PAGE, noun: 'views' });
  }
  UI.onPage($('viewsPager'), (n) => { viewsPage = n; render(); $('viewsSec').scrollIntoView({ block: 'start' }); });

  // ---- Visitors: every one in range, the left-out ones too (to tick back in) ---------
  function visitors(list) {
    const by = new Map();
    for (const r of list) {
      let v = by.get(r.session_id);
      if (!v) by.set(r.session_id, v = { id: r.session_id, last: ts(r), first: ts(r), views: 0, pages: new Set(), row: r });
      v.views++; v.pages.add(pageOf(r));
      if (ts(r) < v.first) v.first = ts(r);
    }
    const all = [...by.values()].sort((a, b) => (ignored.has(a.id) - ignored.has(b.id)) || b.last - a.last);
    const last = Math.max(1, Math.ceil(all.length / PAGE));
    visitorsPage = Math.min(Math.max(1, visitorsPage), last);
    const page = all.slice((visitorsPage - 1) * PAGE, visitorsPage * PAGE);
    const name = (v) => `<span class="mono">${esc(short(v.id))}</span>${v.id === me ? '<span class="you">you</span>' : ''}`;
    const tick = (v) => `<input type="checkbox" data-out="${esc(v.id)}"${ignored.has(v.id) ? ' checked' : ''} aria-label="Leave ${esc(short(v.id))} out">`;
    $('visitors').querySelector('tbody').innerHTML = page.length ? page.map(v => `<tr${ignored.has(v.id) ? ' class="out"' : ''}>
        <td>${name(v)}</td>
        <td title="${esc(new Date(v.last).toLocaleString())}">${esc(ago(v.last))}</td>
        <td class="n">${num(v.views)}</td>
        <td class="n">${num(v.pages.size)}</td>
        <td>${where(v.row)}</td>
        <td>${esc(kit(v.row))}</td>
        <td class="n">${tick(v)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="dim">No visitors in this range.</td></tr>';
    $('visitorsList').innerHTML = page.length ? page.map(v => `<div class="it visitor-row${ignored.has(v.id) ? ' out' : ''}">
        <div class="l"><span class="nm">${name(v)}</span><span>${esc(ago(v.last))}</span></div>
        <div class="l"><span>${num(v.views)} ${v.views === 1 ? 'view' : 'views'} · ${where(v.row)}</span><label>${tick(v)}Leave out</label></div></div>`).join('')
      : '<div class="empty-state">No visitors in this range.</div>';
    $('visitorsPager').innerHTML = UI.pager({ total: all.length, page: visitorsPage, size: PAGE, noun: 'visitors' });
  }
  UI.onPage($('visitorsPager'), (n) => { visitorsPage = n; render(); $('visitorsSec').scrollIntoView({ block: 'start' }); });
  $('visitorsSec').addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.out;
    if (!id) return;
    if (e.target.checked) ignored.add(id); else ignored.delete(id);
    saveIgnored(); render();
  });

  // ---- Filters' choices, from the log -------------------------------------------------
  function fillFilters() {
    const keep = (sel, items) => {
      const cur = sel.value;
      sel.innerHTML = sel.options[0].outerHTML + items.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
      sel.value = items.some(([v]) => v === cur) ? cur : '';
    };
    const base = counted(rows);
    keep($('fPage'), tally(base, pageOf).map(([p, n]) => [p, p + ' (' + num(n) + ')']));
    keep($('fCountry'), tally(base, (r) => r.country || null).map(([c]) => [c, flag(c) + ' ' + countryName(c)]));
  }

  // ---- All of it ----------------------------------------------------------------------
  function render() {
    const now = Date.now(), from = since();
    const list = counted(filtered(from, now + 60e3));
    const prev = range === 'all' ? [] : counted(filtered(from - RANGE_DAYS[range] * DAY, from));
    meBar();
    figures(list, prev);
    chart(list);
    cards(list);
    views(list);
    visitors(filtered(from, now + 60e3));
  }

  document.querySelector('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === range) return;
    range = b.dataset.v;
    document.querySelectorAll('#range button').forEach(x => x.classList.toggle('on', x === b));
    viewsPage = visitorsPage = 1;
    render();
  });
  for (const [id, set] of [['fPage', (v) => { fPage = v; }], ['fCountry', (v) => { fCountry = v; }], ['fDevice', (v) => { fDevice = v; }]]) {
    $(id).addEventListener('change', (e) => { set(e.target.value); viewsPage = visitorsPage = 1; render(); });
  }
  window.addEventListener('fusion:theme', () => log.length && render());
  FusionChart.onChange(() => log.length && render());

  let loadedAt = 0;
  const stamp = () => { if (loadedAt) $('status').innerHTML = 'Updated <span class="ago">' + esc(ago(loadedAt)) + '</span>'; };
  setInterval(stamp, 60000);
  async function load() {
    $('status').textContent = 'Loading…';
    try {
      const res = await fetch('/api/logs?limit=5000', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (json.error === 'storage_not_configured') { $('setup').hidden = false; $('dash').hidden = true; $('status').textContent = 'Not set up'; return; }
      if (!json.ok) throw new Error(json.error ? json.error + (json.detail ? ': ' + json.detail : '') : 'HTTP ' + res.status);
      log = (json.rows || []).filter(r => r && r.ts && !isNaN(Date.parse(r.ts))).sort((a, b) => ts(b) - ts(a));
      hide();
      loadedAt = Date.now(); stamp();
      $('error').hidden = true; $('dash').hidden = false;
      fillFilters();
      render();
    } catch (e) {
      $('error').hidden = false;
      $('error').textContent = 'The log did not load (' + e.message + ').';
      $('status').textContent = 'Not loaded';
    }
  }
  $('refresh').addEventListener('click', load);
  load();
})();
