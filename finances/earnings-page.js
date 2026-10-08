// finances/earnings-page.js — DAO Earnings and Curator Earnings: one page,
// two readers (<body data-kind="dao" | "curator">).
//
// The history is earnings-daily.json (tools/build-earnings.js): what each
// earned in fees, day by day, from every vault's own share price and TVL.
// "Annualized" is Key Metrics' figure, the year ahead at today's TVL and APY
// (earnings.js, from ipor-vaults.json and dao-fees.json), so the two pages
// and Key Metrics never disagree about it.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KIND = document.body.dataset.kind === 'curator' ? 'curator' : 'dao';
  const DAY = 864e5;
  const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || f;
  // Green, as Key Metrics writes the earnings figures.
  const color = () => cssVar('--pos', '#16A34A');
  const usd = (v) => UI.usd(v);
  const whole = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const date = (day, o) => new Date(day * DAY).toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, o));
  const iso = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const monthOf = (day, month) => new Date(day * DAY).toLocaleDateString('en-US', { month, year: 'numeric', timeZone: 'UTC' });
  const RANGES = { 90: 90, 365: 365, all: Infinity };
  const BAR_PX = 8;

  let file = null, view = 'weekly', range = 'all', size = '43';
  // The first day this page earned: the curators' fees start months after the
  // DAO's (Mar 2025 against Oct 2024), and a chart or a total reaching back
  // before it would open on empty weeks.
  let firstDay = 0;

  // ---- The numbers ---------------------------------------------------------
  const series = () => (file ? file[KIND] : []);
  const sumLast = (n) => { const s = series(); return s.slice(Math.max(0, s.length - n)).reduce((a, v) => a + v, 0); };
  // The first day the range shows.
  const start = () => Math.max(firstDay, file.maxDay - RANGES[range] + 1);

  // Bars: { first, last, sum, open }, oldest first. A bar shows whole when
  // any of it is in the range; open is the month still under way.
  function months() {
    const out = [];
    series().forEach((v, k) => {
      const d = file.minDay + k, t = new Date(d * DAY);
      if (d < firstDay) return;
      const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
      let m = out[out.length - 1];
      if (!m || m.key !== key) out.push(m = { key, first: d, last: d, sum: 0 });
      m.last = d; m.sum += v;
    });
    const end = new Date(file.maxDay * DAY);
    const monthEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0) / DAY;
    if (out.length) out[out.length - 1].open = file.maxDay < monthEnd;
    return out.filter(m => m.last >= start());
  }
  // Weeks ending on the newest day.
  function weeks() {
    const s = series(), out = [];
    for (let last = file.maxDay; last >= start(); last -= 7) {
      const first = Math.max(firstDay, last - 6);
      out.unshift({ first, last, sum: s.slice(first - file.minDay, last - file.minDay + 1).reduce((a, v) => a + v, 0) });
    }
    return out;
  }
  // The running total since the first day, over the range's days.
  function cumulative() {
    const s = series(), from = start() - file.minDay;
    let run = s.slice(0, from).reduce((a, v) => a + v, 0);
    return s.slice(from).map((v, k) => [file.minDay + from + k, (run += v)]);
  }

  // ---- Figures -------------------------------------------------------------
  function figures(annual) {
    const figs = document.querySelectorAll('#figures .ui-figure');
    const set = (i, v, s) => { figs[i].querySelector('.v').textContent = v; figs[i].querySelector('.s').textContent = s; };
    const n = series().length;
    set(0, annual ? usd(annual[KIND].total) : '—', annual ? 'at today’s TVL and APY' : 'fee terms not read yet');
    set(1, usd(sumLast(30)), 'about ' + whole(sumLast(30) / 30) + ' a day');
    set(2, usd(sumLast(365)), 'since ' + date(Math.max(firstDay, file.maxDay - Math.min(n, 365) + 1), { year: 'numeric' }));
    set(3, usd(sumLast(n)), 'since ' + date(firstDay, { year: 'numeric' }));
  }

  // ---- Chart ---------------------------------------------------------------
  const CONFIG = { displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false, showTips: false };
  // width: the chart's, to keep a few bars from turning into slabs.
  function figure(forExport, width) {
    const c = color();
    let traces, xaxis = { type: 'date', tickformat: range === '90' ? '%b %-d' : "%b '%y", nticks: 6 };
    if (view === 'cumulative') {
      const d = cumulative();
      traces = [{ type: 'scatter', mode: 'lines', name: 'Earned', x: d.map(p => iso(p[0])), y: d.map(p => p[1]),
        line: { color: c, width: 2 }, fill: 'tozeroy', fillcolor: tint(c, 0.1) }];
    } else {
      const monthly = view === 'monthly', b = monthly ? months() : weeks();
      // Thin bars, as on every chart here, spread over the whole plot: each
      // at most BAR_PX wide however few there are, the gaps taking the rest.
      // The plot is the chart less the y labels' gutter (on a phone screen
      // the labels sit inside the plot; an image keeps its gutter).
      const plotW = Math.max(200, width - (!forExport && FusionChart.compact() ? 16 : 80));
      const fill = Math.min(0.56, BAR_PX * b.length / plotW);
      // A month is a named place on its axis; a week sits at its middle day.
      // The month under way is paler.
      traces = [{ type: 'bar', name: 'Earned', y: b.map(p => p.sum),
        x: b.map(p => (monthly ? monthOf(p.first, 'short') : iso(p.last - 3))),
        width: monthly ? fill : 7 * DAY * fill,
        customdata: b.map(p => [p.first, p.last, p.open ? 1 : 0]),
        marker: { color: c, opacity: b.map(p => (p.open ? 0.45 : 1)) } }];
      if (monthly) xaxis = { type: 'category' };
    }
    const layout = {
      autosize: true,
      margin: { l: 70, r: 20, t: 20, b: 50 },
      plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Geist, -apple-system, sans-serif', color: forExport ? '#5E5E6B' : cssVar('--text-2', '#5E5E6B'), size: 12 },
      xaxis: Object.assign(xaxis, { showgrid: false, ticks: 'outside', ticklen: 6, tickcolor: 'rgba(0,0,0,0)', showline: false }),
      yaxis: { tickformat: '$,.2~s', rangemode: 'tozero', showgrid: false, zeroline: false },
      showlegend: false, hovermode: 'x unified', hoverdistance: -1, spikedistance: -1, dragmode: false,
    };
    return { traces, layout };
  }
  function tint(c, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function describe(pts) {
    const p = pts[0];
    const sub = (t) => '<div class="hv-when" style="margin:1px 0 0">' + t + '</div>';
    if (view === 'cumulative') return FusionChart.when(p.x) + '<div class="hv-big">' + whole(p.y) + '</div>' + sub('earned in all');
    const [first, last, open] = p.customdata || [];
    if (first == null) return '';
    const big = '<div class="hv-big">' + whole(p.y) + '</div>';
    if (view === 'weekly') {
      const y = { year: 'numeric' };
      return '<div class="hv-when">' + date(first) + ' – ' + date(last, y) + '</div>' + big;
    }
    // A month read in part (the first, or the one under way) says which days.
    const month = monthOf(first, 'long');
    const full = new Date(first * DAY).getUTCDate() === 1 && new Date((last + 1) * DAY).getUTCDate() === 1;
    return '<div class="hv-when">' + month + '</div>' + big
      + (full ? '' : sub(date(first) + '–' + new Date(last * DAY).getUTCDate() + (open ? ' so far' : '')));
  }
  const plotlyReady = new Promise((resolve, reject) => {
    const tag = $('plotlyJs');
    const settle = () => (window.Plotly ? resolve() : reject(new Error('no Plotly')));
    if (window.Plotly || !tag || tag.dataset.state) return settle();
    tag.addEventListener('load', settle);
    tag.addEventListener('error', () => reject(new Error('no Plotly')));
  });
  const TITLES = { monthly: 'Earned per month', weekly: 'Earned per week', cumulative: 'Earned in all' };
  async function draw() {
    const gd = $('chart');
    if (!file) return;
    $('chartTitle').textContent = TITLES[view];
    try { await plotlyReady; } catch { gd.innerHTML = '<div class="ui-empty">The chart library (cdn.plot.ly) did not load.</div>'; return; }
    gd.querySelectorAll(':scope > .ui-empty').forEach(n => n.remove());
    const f = figure(false, gd.clientWidth);
    await Plotly.react(gd, FusionChart.quiet(FusionChart.soft(f.traces)), FusionChart.fit(f.layout, f.traces), CONFIG);
    FusionChart.glide(gd, describe);
  }

  // ---- Exports -------------------------------------------------------------
  const SHAPES = { '43': [680, 510], square: [480, 480] };
  async function png() {
    if (!file) return;
    await plotlyReady;
    const gd = $('chart');
    const shape = SHAPES[size];
    const w = shape ? shape[0] : gd.clientWidth, h = shape ? shape[1] : gd.clientHeight;
    const f = FusionChart.inLight(() => figure(true, w));   // light colours: the image is on white
    // The image says what it is: the chart's title, the range, what a bar is.
    const who = KIND === 'dao' ? 'DAO Earnings' : 'Curator Earnings';
    const span = range === 'all' ? 'All time, since ' + date(firstDay, { year: 'numeric' }) : range === '365' ? 'Last 12 months' : 'Last 90 days';
    const what = view === 'weekly' ? 'each bar is a week\'s fees' : view === 'monthly' ? 'each bar is a month\'s fees, the month under way paler'
      : 'the line is everything earned to each day';
    await FusionChart.png({ data: FusionChart.quiet(FusionChart.soft(f.traces)), layout: f.layout }, {
      width: w, height: h, dots: $('pngDots').checked,
      title: who + ': ' + TITLES[view].toLowerCase(), subtitle: span + ' · ' + what,
      filename: 'fusion-' + KIND + '-earnings-' + view + '-' + range + '-' + new Date().toISOString().slice(0, 10) + '.png' });
  }
  function csv() {
    if (!file) return;
    let run = 0;
    const rows = [['date', 'earned_usd', 'earned_in_all_usd']];
    series().forEach((v, k) => { if (file.minDay + k < firstDay) return; run += v; rows.push([iso(file.minDay + k), v.toFixed(2), run.toFixed(2)]); });
    UI.csv('fusion-' + KIND + '-earnings-daily-' + new Date().toISOString().slice(0, 10), rows);
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
  const get = (f) => fetch('/' + f).then(r => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get('earnings-daily.json'), get('ipor-vaults.json'), get('dao-fees.json')]).then(([e, ipor, fees]) => {
    if (!e || !Array.isArray(e[KIND]) || !e[KIND].length) {
      $('body').innerHTML = '<div class="empty-state">No earnings history yet. It is built from the vaults’ TVL snapshots and fee terms '
        + 'each time either updates, and the next update fills this page.</div>';
      return;
    }
    file = e;
    firstDay = e.minDay + Math.max(0, (e[KIND] || []).findIndex(v => v > 0));
    const annual = ipor && fees ? FusionEarnings.annualized(ipor.vaults || [], fees.vaults || {}) : null;
    figures(annual);
    // "Updated 2h ago" at the masthead's right, as on Key Metrics and Stocks,
    // kept current while the page is open.
    const updated = () => { $('status').innerHTML = 'Updated <span class="ago">' + UI.ago(Date.parse(e.updatedAt) / 1000) + '</span>'; };
    updated();
    setInterval(updated, 60000);
    const v = e.vaults || {}, big = v.withoutPeak && v.withoutPeak[0];
    $('coverage').textContent = 'From the ' + v.counted + ' vaults with fee terms on file, '
      + date(e.minDay, { year: 'numeric' }) + ' to ' + date(e.maxDay, { year: 'numeric' }) + '.'
      + (v.without ? ' ' + v.without + ' more have none on file yet and are left out'
        + (big ? '; the largest held ' + usd(big.peak) + ' at its peak' : '') + '.' : '');
    draw();
  });
})();
