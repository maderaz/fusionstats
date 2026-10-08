// protocol-tvl/tvl-page.js — Protocol TVL: what every Fusion vault holds
// together, day by day since the first deposits, from tvl-daily.json
// (tools/build-tvl-daily.js: each vault's on-chain TVL, summed by network).
// Laid out as the Finances pages: four figures, one chart, exports.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY = 864e5;
  const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || f;
  const usd = (v) => UI.usd(v);
  const whole = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const date = (day, o) => new Date(day * DAY).toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, o));
  const iso = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const RANGES = { 90: 90, 365: 365, all: Infinity };
  const name = (c) => (window.FusionSelect ? FusionSelect.chainName(c) : c);
  // A network's colour: its own where it has a well-known one.
  const CHAIN_COLORS = { base: '#2151F5', ethereum: '#8C8FE8', arbitrum: '#28A0F0' };

  let file = null, view = 'total', range = 'all', size = '43';
  let firstDay = 0, total = [], chains = [];   // chains: [{ id, label, s }], largest today first, "Other" last

  const start = () => Math.max(firstDay, file.anchorDay - RANGES[range] + 1);
  const at = (s, day) => s[day - file.minDay] || 0;

  function build() {
    const n = file.anchorDay - file.minDay + 1;
    const per = Object.entries(file.perChain || {});
    total = Array.from({ length: n }, (_, i) => per.reduce((a, [, s]) => a + (s[i] || 0), 0));
    // Vaults with no snapshot history are held flat at today's TVL across the
    // whole file (tvl-series.js), a floor of some $15K under every day. The
    // chart starts where real deposits first lift the total $10K above it.
    const floor = Math.min(...total);
    firstDay = file.minDay + Math.max(0, total.findIndex(v => v >= floor + 1e4));
    const now = (s) => s[n - 1] || 0;
    const top = per.slice().sort((a, b) => now(b[1]) - now(a[1])).slice(0, 3);
    const rest = per.filter(p => !top.includes(p));
    chains = top.map(([id, s]) => ({ id, label: name(id), s }));
    if (rest.length) chains.push({ id: 'other', label: 'Other', s: Array.from({ length: n }, (_, i) => rest.reduce((a, [, s]) => a + (s[i] || 0), 0)) });
  }

  // ---- Figures -------------------------------------------------------------
  function figures() {
    const figs = document.querySelectorAll('#figures .ui-figure');
    const set = (i, v, s) => { figs[i].querySelector('.v').textContent = v; figs[i].querySelector('.s').textContent = s; };
    const last = file.anchorDay, now = at(total, last);
    const live = Object.values(file.currentByChain || {}).filter(v => v >= 1000).length;
    set(0, usd(now), 'across ' + live + ' networks');
    const change = (days) => {
      const then = at(total, Math.max(firstDay, last - days));
      const d = now - then, pct = then > 0 ? (d / then) * 100 : null;
      return [(d < 0 ? '−' : '+') + usd(Math.abs(d)), pct == null ? '' : (pct < 0 ? '−' : '+') + Math.abs(pct).toFixed(1) + '% from ' + usd(then)];
    };
    const m = change(30), y = change(365);
    set(1, m[0], m[1]);
    set(2, y[0], y[1]);
    let hi = firstDay;
    for (let d = firstDay; d <= last; d++) if (at(total, d) > at(total, hi)) hi = d;
    set(3, usd(at(total, hi)), hi === last ? 'today' : 'on ' + date(hi, { year: 'numeric' }));
  }

  // ---- Chart ---------------------------------------------------------------
  const CONFIG = { displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false, showTips: false };
  const PALETTE = () => [cssVar('--chart-4', '#FFB900'), cssVar('--chart-2', '#009689'), '#94A3B8'];
  function colorOf(c, k) {
    if (CHAIN_COLORS[c.id]) return CHAIN_COLORS[c.id];
    if (c.id === 'other') return '#A1A1AA';
    return PALETTE()[k % PALETTE().length];
  }
  function tint(c, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function figure(forExport) {
    const from = start(), days = [];
    for (let d = from; d <= file.anchorDay; d++) days.push(d);
    const x = days.map(iso);
    let traces;
    if (view === 'total') {
      const c = cssVar('--accent', '#8429FF');
      traces = [{ type: 'scatter', mode: 'lines', name: 'TVL', x, y: days.map(d => at(total, d)), line: { color: c, width: 2 }, fill: 'tozeroy', fillcolor: tint(c, 0.1) }];
    } else {
      traces = chains.map((c, k) => ({ type: 'scatter', mode: 'lines', name: c.label, x, y: days.map(d => at(c.s, d)), stackgroup: 'tvl',
        line: { color: colorOf(c, k), width: 1 }, fillcolor: tint(colorOf(c, k), 0.55) }));
    }
    const layout = {
      autosize: true,
      margin: { l: 70, r: 20, t: 20, b: 50 },
      plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Geist, -apple-system, sans-serif', color: forExport ? '#5E5E6B' : cssVar('--text-2', '#5E5E6B'), size: 12 },
      xaxis: { type: 'date', tickformat: range === '90' ? '%b %-d' : "%b '%y", nticks: 6, showgrid: false, ticks: 'outside', ticklen: 6, tickcolor: 'rgba(0,0,0,0)', showline: false },
      yaxis: { tickformat: '$,.2~s', rangemode: 'tozero', showgrid: true, gridcolor: forExport ? '#E5E5EA' : cssVar('--line', '#EEE'), griddash: '4px,8px', zeroline: false },
      showlegend: false, hovermode: 'x unified', hoverdistance: -1, spikedistance: -1, dragmode: false,
    };
    return { traces, layout };
  }
  function describe(pts) {
    const head = FusionChart.when(pts[0].x);
    if (view === 'total') return head + '<div class="hv-big">' + whole(pts[0].y) + '</div>';
    const sum = pts.reduce((a, p) => a + (p.y || 0), 0);
    return head + pts.filter(p => p.y >= 1).map(p => FusionChart.row(p.data.line.color, p.data.name, usd(p.y))).join('') + FusionChart.row(null, 'Total', usd(sum));
  }
  function legend() {
    const el = $('legend');
    el.hidden = view !== 'chains';
    el.innerHTML = view === 'chains' ? chains.map((c, k) => `<span><i style="background:${colorOf(c, k)}"></i>${UI.esc(c.label)}</span>`).join('') : '';
  }
  const plotlyReady = new Promise((resolve, reject) => {
    const tag = $('plotlyJs');
    const settle = () => (window.Plotly ? resolve() : reject(new Error('no Plotly')));
    if (window.Plotly || !tag || tag.dataset.state) return settle();
    tag.addEventListener('load', settle);
    tag.addEventListener('error', () => reject(new Error('no Plotly')));
  });
  const TITLES = { total: 'Total value locked', chains: 'Total value locked, by network' };
  async function draw() {
    const gd = $('chart');
    if (!file) return;
    $('chartTitle').textContent = TITLES[view];
    legend();
    try { await plotlyReady; } catch { gd.innerHTML = '<div class="ui-empty">The chart library (cdn.plot.ly) did not load.</div>'; return; }
    gd.querySelectorAll(':scope > .ui-empty').forEach(n => n.remove());
    const f = figure(false);
    await Plotly.react(gd, FusionChart.quiet(FusionChart.soft(f.traces)), FusionChart.fit(f.layout, f.traces), CONFIG);
    FusionChart.glide(gd, describe);
  }

  // ---- Exports -------------------------------------------------------------
  const SHAPES = { '43': [680, 510], square: [480, 480] };
  async function png() {
    if (!file) return;
    await plotlyReady;
    const gd = $('chart'), shape = SHAPES[size];
    const w = shape ? shape[0] : gd.clientWidth, h = shape ? shape[1] : gd.clientHeight;
    const f = FusionChart.inLight(() => figure(true));
    const span = range === 'all' ? 'All time, since ' + date(firstDay, { year: 'numeric' }) : range === '365' ? 'Last 12 months' : 'Last 90 days';
    const what = view === 'total' ? 'the line is every vault\'s TVL together, a reading a day' : 'each band is a network\'s TVL, the three largest and the rest';
    await FusionChart.png({ data: FusionChart.quiet(FusionChart.soft(f.traces)), layout: f.layout }, {
      width: w, height: h, dots: $('pngDots').checked,
      title: 'Protocol TVL' + (view === 'chains' ? ' by network' : ''), subtitle: span + ' · ' + what,
      filename: 'fusion-protocol-tvl-' + view + '-' + range + '-' + new Date().toISOString().slice(0, 10) + '.png' });
  }
  function csv() {
    if (!file) return;
    const ids = Object.keys(file.perChain || {});
    const rows = [['date'].concat(ids.map(c => 'tvl_' + c + '_usd'), ['tvl_usd'])];
    for (let d = firstDay; d <= file.anchorDay; d++) rows.push([iso(d)].concat(ids.map(c => at(file.perChain[c], d).toFixed(0)), [at(total, d).toFixed(0)]));
    UI.csv('fusion-protocol-tvl-daily-' + new Date().toISOString().slice(0, 10), rows);
  }

  // ---- Controls ------------------------------------------------------------
  function seg(id, on) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      on(b.dataset.v);
    });
  }
  seg('view', (v) => { view = v; draw(); });
  seg('range', (v) => { range = v; draw(); });
  seg('pngSize', (v) => { size = v; });
  $('pngBtn').addEventListener('click', png);
  $('csvBtn').addEventListener('click', csv);
  window.addEventListener('fusion:theme', () => draw());
  FusionChart.onChange(() => draw());

  // ---- Load ----------------------------------------------------------------
  // Today is each vault's TVL as IPOR's API reports it now (ipor-vaults.json,
  // refreshed every run), the figure Key Metrics shows; the days before are
  // the on-chain snapshots, read once a day and so up to a day behind.
  const get = (f) => fetch('/' + f).then(r => (r.ok ? r.json() : null)).catch(() => null);
  function liveToday(j, ipor) {
    const vaults = (ipor && ipor.vaults) || [];
    if (!vaults.length) return;
    const live = {};
    for (const v of vaults) if (v.tvl > 0) { const c = String(v.chain || 'ethereum').toLowerCase(); live[c] = (live[c] || 0) + v.tvl; }
    const n = j.anchorDay - j.minDay + 1;
    for (const c of Object.keys(live)) if (!j.perChain[c]) j.perChain[c] = new Array(n).fill(0);
    for (const [c, s] of Object.entries(j.perChain)) s[n - 1] = live[c] || 0;
    j.currentByChain = live;
  }
  Promise.all([get('tvl-daily.json'), get('ipor-vaults.json')]).then(([j, ipor]) => {
    if (!j || !j.perChain || !Object.keys(j.perChain).length) {
      $('body').innerHTML = '<div class="empty-state">No TVL history yet: it is built from the vaults\' daily on-chain readings, and the next update fills this page.</div>';
      return;
    }
    liveToday(j, ipor);
    file = j;
    build();
    figures();
    const updated = () => { $('status').innerHTML = 'Updated <span class="ago">' + UI.ago(Date.parse(j.updatedAt) / 1000) + '</span>'; };
    updated();
    setInterval(updated, 60000);
    $('coverage').textContent = 'Every Fusion vault on the ' + Object.values(j.perChain).filter(s => s.some(v => v >= 1000)).length + ' networks that have held $1K or more, ' + date(firstDay, { year: 'numeric' }) + ' to ' + date(j.anchorDay, { year: 'numeric' }) + ', a reading a day.';
    draw();
  });
})();
