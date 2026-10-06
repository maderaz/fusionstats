// ui-chart.js — what the site's Plotly charts share.
//
// Every chart with axes is laid out as the reference (shadcn's line-charts-9,
// Recharts): margins of 20 above and 10 to the right, the y axis in a 60px
// gutter on the left, its labels ending 21px short of the plot (Recharts'
// tickSize 6 and tickMargin 15), and under the plot five dates, the first and
// the last at the data's own ends and kept inside it. The plot runs from the
// first reading to the last, with no dead space either side, up to a round
// level above the highest (five levels, as Recharts' nice ticks), each a
// faint dashed rule. The faint dots fill the plot's square and stop at its
// edges. On a phone the labels go inside the plot, under the data, and the
// dates are three. Exact values are what the hover is for.
//
//   layout = FusionChart.fit(layout, traces)
//                                       a copy of layout, drawn that way; the
//                                       traces it will draw give its ranges
//   FusionChart.frame(gd)               the dots fitted to the plot, the dates
//                                       under it (glide() calls it)
//   FusionChart.compact()               true on a phone: the page's content
//                                       column (.ui-page) 560px or narrower,
//                                       where its CSS goes to the phone layout
//   FusionChart.onChange(fn)            fn() when the column crosses that width
//                                       (a phone turned sideways): redraw
//   FusionChart.glide(gd, describe)     the page's own hover (see below)
//   FusionChart.touch(gd)               a finger slid across the plot moves it
//   FusionChart.quiet(traces)           traces that report hovers, draw none
//   FusionChart.soft(traces)            the marks drawn soft and lean (below)
//   FusionChart.png(fig, { width, height, dots, filename })
//                                       download a chart as an image
//
// Exports draw the layout as it was before fit(), whatever the screen: keep
// it and hand it to Plotly.toImage.
(function () {
  'use strict';
  if (window.FusionChart) return;

  // The column, not the window, as the page's CSS (@container on .ui-page):
  // at a 600px window the column, less the page's margins, is 552px, and the
  // tables are already in their phone layout. Without a .ui-page, the window.
  const PHONE = 560;
  const mq = window.matchMedia('(max-width: ' + PHONE + 'px)');
  let page = null;
  function column() {
    if (!page || !page.isConnected) page = document.querySelector('.ui-page');
    if (!page) return null;
    const cs = getComputedStyle(page);
    return page.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }
  const compact = () => { const w = column(); return w == null ? mq.matches : w <= PHONE; };
  const cssVar = (name, fallback) =>
    (getComputedStyle(document.documentElement).getPropertyValue(name) || fallback || '').trim() || fallback;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // The reference's measures. gap: from the plot's edge to its labels.
  // Desktop: Recharts' margin (top 20, right 10, left 5) and its 60px y axis;
  // under the plot its 30px x axis and 20 of margin. Phone: the labels inside.
  const DESK = { t: 20, r: 10, l: 65, b: 50, gap: 21, font: 12, dates: 5 };
  const HAND = { t: 20, r: 8, l: 8, b: 34, gap: 10, font: 11, dates: 3 };
  const measures = () => (compact() ? HAND : DESK);

  const visible = (t) => t && t.visible !== false && t.visible !== 'legendonly';
  const axisKey = (id) => id.charAt(0) + 'axis' + id.slice(1);   // 'x2' → 'xaxis2'

  // A round step for a span cut in four (five levels), as Recharts' nice
  // ticks: 1, 2, 2.5, 3, 4, 5, 6, 8 or 10 of a power of ten.
  function niceStep(rough) {
    if (!(rough > 0) || !Number.isFinite(rough)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / p;
    return p * [1, 2, 2.5, 3, 4, 5, 6, 8, 10].find(n => f <= n + 1e-9);
  }
  function niceRange(lo, hi) {
    if (!(hi > lo)) { const d = Math.abs(hi) * 0.05 || 1; lo -= d; hi += d; }
    let step = niceStep((hi - lo) / 4);
    let a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    // Rounding both ends can leave six or more levels: the next step up.
    if ((b - a) / step > 5) { step = niceStep(step * 1.01 + 1e-12); a = Math.floor(lo / step + 1e-9) * step; b = Math.ceil(hi / step - 1e-9) * step; }
    return { a, b, step };
  }

  // The data's own extent on each axis. A line runs from its first reading to
  // its last; a bar takes its whole slot. A missing reading (a page's blank
  // lead-in) takes no room. Stacks count by their totals.
  function extents(traces, layout) {
    const xs = {}, ys = {}, sums = {};
    const barStack = layout.barmode === 'stack' || layout.barmode === 'relative';
    const grow = (o, k, lo, hi) => { const e = o[k] || (o[k] = { lo: Infinity, hi: -Infinity, like: undefined }); e.lo = Math.min(e.lo, lo); e.hi = Math.max(e.hi, hi); return e; };
    for (const t of traces || []) {
      if (!visible(t) || !Array.isArray(t.x) || !Array.isArray(t.y) || t.orientation === 'h') continue;
      if (t.type && !/^(scatter|scattergl|bar)$/.test(t.type)) continue;
      const xa = t.xaxis || 'x', ya = t.yaxis || 'y', bar = t.type === 'bar';
      const slot = bar ? (spacing(t.x) || 0) : 0;
      const stack = bar && barStack ? 'bars' : t.stackgroup;
      for (let i = 0; i < t.x.length; i++) {
        const y = t.y[i];
        if (y == null || y === '' || !Number.isFinite(+y)) continue;
        const x = toNum(t.x[i]);
        if (Number.isFinite(x)) { const e = grow(xs, xa, x - slot / 2, x + slot / 2); if (e.like === undefined) e.like = t.x[i]; }
        if (stack) {
          const m = sums[ya + '|' + stack] || (sums[ya + '|' + stack] = { ya, at: new Map() });
          const cur = m.at.get(x) || [0, 0];
          if (+y >= 0) cur[0] += +y; else cur[1] += +y;
          m.at.set(x, cur);
        } else grow(ys, ya, +y, +y);
        if (bar) grow(ys, ya, 0, 0);
      }
    }
    for (const m of Object.values(sums)) for (const [pos, neg] of m.at.values()) grow(ys, m.ya, neg, pos);
    return { xs, ys };
  }

  // d3's ".2s" writes zero as "0.0" and a million as "1.0M": "~" drops the
  // trailing zeros ("$0", "$1M", "$1.2M").
  const trim = (f) => (typeof f === 'string' ? f.replace(/\.(\d+)([sfrgep%])/, (m, d, k) => '.' + d + '~' + k).replace(/~~/g, '~') : f);

  function fit(layout, traces) {
    const out = clone(layout);
    // Only charts with axes: a pie keeps its own margins.
    if (!Object.keys(out).some(k => /^[xy]axis\d*$/.test(k))) return out;
    const phone = compact(), M = measures();
    const muted = cssVar('--text-3', cssVar('--text-secondary', '#9A9AA6'));
    const sans = cssVar('--sans', '');
    if (sans) out.font = Object.assign({}, out.font, { family: sans });
    // A key above the plot keeps the room the page gave it.
    const keyOnTop = out.showlegend && out.legend && (out.legend.y == null || out.legend.y >= 1);
    out.margin = { l: M.l, r: M.r, t: keyOnTop ? ((out.margin && out.margin.t) || 30) : M.t, b: M.b, pad: 0 };
    const { xs, ys } = traces ? extents(traces, out) : { xs: {}, ys: {} };
    const normed = (traces || []).some(t => visible(t) && t.groupnorm);
    for (const k of Object.keys(out)) {
      const m = k.match(/^xaxis(\d*)$/);
      if (!m) continue;
      const ax = out[k];
      // The dates are frame()'s: five under the plot (three on a phone).
      Object.assign(ax, { automargin: false, showticklabels: false, ticks: '', ticklen: 0, showline: false, showgrid: false, zeroline: false });
      // From the first reading to the last: no dead space either side.
      const e = xs['x' + m[1]];
      const own = ax.range || ax.type === 'category' || ax.type === 'multicategory' || ax.autorange === 'reversed';
      if (!own && e && e.hi >= e.lo) {
        const pad = e.hi > e.lo ? 0 : 864e5 / 2;
        ax.range = [fromNum(e.lo - pad, e.like), fromNum(e.hi + pad, e.like)];
        ax.autorange = false;
      }
    }
    for (const k of Object.keys(out)) {
      const m = k.match(/^yaxis(\d*)$/);
      if (!m) continue;
      const ax = out[k];
      Object.assign(ax, {
        ticks: '', ticklen: 0, showline: false, zeroline: false, layer: 'below traces',
        // Faint dashed rules at the labelled levels, under everything.
        showgrid: true, gridcolor: cssVar('--line', 'rgba(127, 127, 127, 0.16)'), griddash: '4px,8px', gridwidth: 1,
        tickfont: Object.assign({}, ax.tickfont, { size: M.font, color: muted }),
        tickformat: trim(ax.tickformat),
      }, phone ? {
        // Inside the plot, just above the level they name, under the bars
        // and lines: the data covers them. Above, not on it: a label on the
        // zero line read as "-$0". 'allow': Plotly's overflow check would
        // hide labels that sit inside.
        automargin: false, ticklabelposition: 'inside top', ticklabeloverflow: 'allow', ticklabelstandoff: 4,
      } : {
        // In the gutter, right-aligned, 21px short of the plot; a label too
        // wide for the gutter widens it.
        automargin: true, ticklabelposition: 'outside', ticklabelstandoff: M.gap - 1,   // Plotly adds 1
      });
      // Five round levels from zero (or the lowest reading) to just above the
      // highest. A log, reversed or percent-of-total axis keeps Plotly's own.
      const e = ys['y' + m[1]];
      const own = ax.range || ax.type === 'log' || ax.type === 'category' || ax.autorange === 'reversed' || normed;
      if (!own && e && Number.isFinite(e.lo) && Number.isFinite(e.hi)) {
        let lo = e.lo, hi = e.hi;
        if (ax.rangemode === 'tozero' || ax.rangemode === 'nonnegative') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
        if (ax.rangemode === 'nonnegative') lo = Math.max(0, lo);
        const r = niceRange(lo, hi);
        Object.assign(ax, { range: [r.a, r.b], autorange: false, tickmode: 'linear', tick0: r.a, dtick: r.step });
        delete ax.nticks;
        // A series that crosses zero keeps a quiet zero line.
        if (r.a < 0 && r.b > 0) Object.assign(ax, { zeroline: true, zerolinecolor: cssVar('--line-strong', 'rgba(127, 127, 127, 0.3)'), zerolinewidth: 1 });
      } else if (!ax.nticks && !ax.dtick && !ax.tickvals) ax.nticks = 5;
    }
    return out;
  }

  // The plot's square on its box: the dots stop at its edges (the box's
  // --plot-t, -b, -l and -r, in ui.css), and the dates go under it. One series
  // labels its levels and dates in its own colour; a few lines glow.
  function frame(gd) {
    if (typeof gd === 'string') gd = document.getElementById(gd);
    const fl = gd && gd._fullLayout;
    if (!fl || !fl.xaxis || !fl._size) return;
    const box = gd.closest('.ui-chart') || gd;
    const sz = fl._size, M = measures();
    box.style.setProperty('--plot-t', sz.t + 'px');
    box.style.setProperty('--plot-b', Math.max(0, fl.height - sz.t - sz.h) + 'px');
    box.style.setProperty('--plot-l', sz.l + 'px');
    box.style.setProperty('--plot-r', Math.max(0, fl.width - sz.l - sz.w) + 'px');
    let row = box.querySelector(':scope > .ui-dates');
    if (!row) {
      row = document.createElement('div');
      row.className = 'ui-dates';
      row.setAttribute('aria-hidden', 'true');
      box.appendChild(row);
    }
    place(row, dates(gd, M.dates), sz, M);
    const inks = new Set();
    for (const t of gd._fullData || []) {
      if (t.visible !== true || t.hoverinfo === 'skip' && t.mode === 'markers') continue;
      const c = t.type === 'bar' ? t.marker && t.marker.color : t.line && t.line.width > 0 && t.line.color;
      if (typeof c === 'string') inks.add(c);
    }
    if (inks.size === 1) box.style.setProperty('--chart-ink', [...inks][0]); else box.style.removeProperty('--chart-ink');
    // The reference's glow: the line's own colour, 4px right and 6px down,
    // blurred wide. Only when there are few lines.
    const drawn = [...gd.querySelectorAll('.scatterlayer .trace path.js-line')]
      .filter(pth => (parseFloat(pth.style.strokeWidth) || 0) > 0.5 && pth.style.stroke);
    drawn.forEach(pth => { pth.style.filter = drawn.length <= 3 ? 'drop-shadow(4px 6px 14px ' + alpha(pth.style.stroke, 0.35) + ')' : ''; });
    // A zoom (desktop) changes what is on screen.
    if (!gd.__framed && gd.on) { gd.__framed = true; gd.on('plotly_relayout', () => frame(gd)); }
    // Plotly redraws to fit only when the window changes size. A box that
    // changes on its own (the sidebar arriving after a chart is drawn, a
    // phone turned) would leave the plot and its dates at the old width, past
    // the edge: redraw to the box, then place the dates again.
    if (!gd.__sized && window.ResizeObserver && window.Plotly && Plotly.Plots) {
      gd.__sized = true;
      let w = gd.clientWidth, queued = false;
      new ResizeObserver(() => {
        if (queued || !gd._fullLayout || Math.abs(gd.clientWidth - w) < 1) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          w = gd.clientWidth;
          Promise.resolve(Plotly.Plots.resize(gd)).then(() => frame(gd)).catch(() => {});
        });
      }).observe(gd);
    }
  }

  // The dates, under their own x, 'gap' below the plot. The first and the last
  // stay inside the plot (Recharts' preserveStartEnd); one that would run into
  // its neighbour is left out.
  function place(row, marks, sz, M) {
    row.style.top = (sz.t + sz.h + M.gap) + 'px';
    row.innerHTML = marks.map(m => '<span>' + esc(m.text) + '</span>').join('');
    const spans = [...row.children];
    const left = sz.l, right = sz.l + sz.w;
    const at = spans.map((el, i) => {
      const w = el.offsetWidth, c = marks[i].px;
      let x = c - w / 2;
      if (i === 0) x = Math.max(left, x);
      if (i === spans.length - 1) x = Math.min(right - w, x);
      return { el, x, w };
    });
    let prev = null;
    at.forEach((a, i) => {
      const last = i === at.length - 1;
      if (prev && a.x < prev.x + prev.w + 10) {
        if (!last) { a.el.remove(); return; }
        if (prev.el !== at[0].el) prev.el.remove();
      }
      a.el.style.transform = 'translateX(' + Math.round(a.x) + 'px)';
      prev = a;
    });
  }

  // Up to n of the data's own x positions, spread evenly from the first to the
  // last on screen, each with its date. Readings only: not a curve's drawn
  // points, not a line's zero start (customdata 'anchor'), not a blank.
  function dates(gd, n) {
    const xa = gd._fullLayout.xaxis;
    const lim = (xa.range || []).map(v => xa.r2l(v));
    const [r0, r1] = [Math.min(...lim), Math.max(...lim)];
    const set = new Set();
    for (const t of gd._fullData || []) {
      if (t.visible !== true || !t.x || t.hoverinfo === 'skip') continue;
      const cd = Array.isArray(t.customdata) ? t.customdata : null;
      for (let i = 0; i < t.x.length; i++) {
        if (cd && cd[i] === 'anchor') continue;
        if (t.y && (t.y[i] == null || t.y[i] === '')) continue;
        const l = xa.d2l(t.x[i]);
        if (Number.isFinite(l) && l >= r0 - 1e-6 && l <= r1 + 1e-6) set.add(l);
      }
    }
    const all = [...set].sort((a, b) => a - b);
    if (!all.length) return [];
    const lo = all[0], hi = all[all.length - 1];
    const picks = [];
    for (let k = 0; k < n; k++) {
      const target = n === 1 ? lo : lo + (hi - lo) * k / (n - 1);
      let best = all[0];
      for (const v of all) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
      if (!picks.includes(best)) picks.push(best);
    }
    const label = labeller(xa, hi - lo);
    return picks.map(l => ({ px: xa._offset + xa.l2p(l), text: label(l) }));
  }
  function labeller(xa, span) {
    if (xa.type === 'date') {
      const day = 864e5;
      const o = span > 300 * day ? { month: 'short', year: 'numeric' }
        : span > 2 * day ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
      return (l) => new Date(l).toLocaleString('en-US', Object.assign({ timeZone: 'UTC' }, o));
    }
    if (xa.type === 'category' || xa.type === 'multicategory') {
      const c = xa._categories || [];
      return (l) => String(c[Math.round(l)] == null ? '' : c[Math.round(l)]);
    }
    return (l) => Number(l).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // Listeners hear of it when compact() flips, whether the window or only the
  // column changed (the column is watched once the page has one).
  const listeners = [];
  let was = null, watching = null;
  function check() {
    const now = compact();
    if (was === null || now === was) { was = now; return; }
    was = now;
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function watch() {
    check();
    if (watching || !window.ResizeObserver) return;
    const el = document.querySelector('.ui-page');
    if (!el) return;
    watching = new ResizeObserver(check);
    watching.observe(el);
  }
  if (mq.addEventListener) mq.addEventListener('change', check); else if (mq.addListener) mq.addListener(check);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  const onChange = (fn) => { listeners.push(fn); watch(); };

  // Traces report where the pointer is, but draw no label of their own. A
  // trace that takes no hover at all (soft()'s drawn curves) keeps 'skip'.
  const quiet = (traces) => traces.map(t => {
    const q = Object.assign({}, t, { hoverinfo: t.hoverinfo === 'skip' ? 'skip' : 'none' });
    delete q.hovertemplate;
    return q;
  });

  // ---- Soft, lean marks -----------------------------------------------------
  // No sharp edges, nothing heavy:
  //   bars   rounded ends, about half of their slot wide (the rest is air)
  //   lines  2px, a smooth curve through every reading that never overshoots
  //          it (monotone cubic: no dip before a jump, no bump past a peak),
  //          round joins, a glow of their own colour under them (frame()),
  //          and on a chart with one line a ringed dot on its highest and
  //          lowest reading. Steps stay steps; a stacked area stays Plotly's.
  // A smoothed line is drawn by a twin made of the curve's points, which
  // takes no hover; the trace itself stays, invisible, so the hover and the
  // page's describe() still get the readings. Every trace out carries
  // meta.of, the index of the trace it came from, for index-based restyles.
  const BAR_FILL = 0.56;
  const CURVE_STEPS = 8;
  const isLine = (t) => (!t.type || t.type === 'scatter') && String(t.mode || 'lines').includes('lines');
  const isStep = (t) => t.line && /^(hv|vh|hvh|vhv)$/.test(t.line.shape || '');
  // A position as a number: a Date or a date string (Plotly's wall time, read
  // field by field as UTC) as ms, a number as itself; and back, in the form
  // the trace had.
  function toNum(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : NaN;
  }
  function fromNum(n, like) {
    if (like instanceof Date) return new Date(n);
    if (typeof like === 'number') return n;
    return new Date(n).toISOString().slice(0, 19).replace('T', ' ');
  }
  function spacing(xs) {
    const d = [];
    for (let i = 1; i < xs.length; i++) { const v = toNum(xs[i]) - toNum(xs[i - 1]); if (v > 0) d.push(v); }
    if (!d.length) return null;
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
  }

  // Fritsch–Carlson: the tangents a cubic needs to pass through every point
  // without leaving the range between neighbours.
  function monotone(xs, ys) {
    const n = xs.length;
    if (n < 3) return { x: xs.slice(), y: ys.slice() };
    const h = [], m = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; m[i] = h[i] ? (ys[i + 1] - ys[i]) / h[i] : 0; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], r = a * a + b * b;
      if (r > 9) { const k = 3 / Math.sqrt(r); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    const X = [], Y = [];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < CURVE_STEPS; k++) {
        const u = k / CURVE_STEPS, u2 = u * u, u3 = u2 * u;
        X.push(xs[i] + u * h[i]);
        Y.push((2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h[i] * t[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h[i] * t[i + 1]);
      }
    }
    X.push(xs[n - 1]); Y.push(ys[n - 1]);
    return { x: X, y: Y };
  }

  // The curve through a line's readings, run by run: a gap (null) stays a gap.
  function curve(t) {
    const xs = t.x || [], ys = t.y || [];
    const X = [], Y = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const c = monotone(run.map(i => toNum(xs[i])), run.map(i => +ys[i]));
      c.x.forEach((v, k) => { X.push(fromNum(v, xs[run[0]])); Y.push(c.y[k]); });
      run = [];
    };
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null || !Number.isFinite(+ys[i]) || !Number.isFinite(toNum(xs[i]))) {
        flush();
        if (X.length && Y[Y.length - 1] !== null) { X.push(xs[i]); Y.push(null); }
      } else run.push(i);
    }
    flush();
    return { x: X, y: Y };
  }

  function soft(traces) {
    const out = [];
    const smooth = traces.filter(t => isLine(t) && !isStep(t) && !t.stackgroup && t.fill !== 'tonexty');
    traces.forEach((t, of) => {
      const meta = Object.assign({}, t.meta, { of });
      if (t.type === 'bar') {
        const b = Object.assign({}, t, { meta, marker: Object.assign({}, t.marker, { cornerradius: '45%', line: { width: 0 } }) });
        const dx = t.width == null && t.orientation !== 'h' && t.x && t.x.length > 1 ? spacing(t.x) : null;
        if (dx) b.width = dx * BAR_FILL;
        out.push(b);
        return;
      }
      if (!isLine(t)) { out.push(Object.assign({}, t, { meta })); return; }
      const line = Object.assign({}, t.line, { width: Math.min((t.line && t.line.width) || 2, 2) });
      if (!smooth.includes(t)) { out.push(Object.assign({}, t, { meta, line })); return; }
      // The drawn curve, then the readings it passes through (invisible).
      const c = curve(t);
      const twin = Object.assign({}, t, { meta, x: c.x, y: c.y, customdata: undefined, hoverinfo: 'skip', showlegend: false,
        line: Object.assign({}, line, { shape: 'linear' }) });
      delete twin.hovertemplate;
      out.push(twin);
      out.push(Object.assign({}, t, { meta, fill: 'none', line: Object.assign({}, line, { width: 0 }) }));
    });
    // One line: a ringed dot on its highest and lowest reading.
    if (smooth.length === 1 && !traces.some(t => t.type === 'bar')) {
      const t = smooth[0], cd = Array.isArray(t.customdata) ? t.customdata : [];
      let hi = -1, lo = -1;
      (t.y || []).forEach((v, i) => {
        if (v == null || !Number.isFinite(+v) || cd[i] === 'anchor') return;
        if (hi < 0 || +v > +t.y[hi]) hi = i;
        if (lo < 0 || +v < +t.y[lo]) lo = i;
      });
      const at = [...new Set([hi, lo])].filter(i => i >= 0);
      if (at.length) out.push({ type: 'scatter', mode: 'markers', hoverinfo: 'skip', showlegend: false, meta: { of: -1 }, cliponaxis: false,
        x: at.map(i => t.x[i]), y: at.map(i => t.y[i]),
        marker: { size: 12, color: (t.line && t.line.color) || cssVar('--accent', '#8429FF'), line: { color: '#fff', width: 2 } } });
    }
    return out;
  }

  // A bar chart's day, lit as on Activity: a rounded slot behind the bars
  // that glides from day to day, empty days included, while every other bar
  // steps back. pts: the hovered points, or null when the pointer leaves.
  function slot(gd, pts) {
    let el = gd.querySelector(':scope > .hv-slot');
    const bars = pts ? pts.filter(p => p.data.type === 'bar') : [];
    gd.querySelectorAll('.barlayer .point.hv-pt').forEach(n => n.classList.remove('hv-pt'));
    if (!bars.length) {
      gd.classList.remove('hv-live');
      if (el) el.classList.remove('on');
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'hv-slot';
      gd.insertBefore(el, gd.firstChild);
    }
    const fl = gd._fullLayout, sz = fl._size, xa = fl.xaxis;
    const p0 = bars[0], xs = p0.data.x || [], i = p0.pointNumber;
    const x = xa.l2p(xa.d2l(xs[i]));
    const nb = xs[i + 1] != null ? xs[i + 1] : xs[i - 1];
    const w = Math.max(6, nb != null ? Math.abs(xa.l2p(xa.d2l(nb)) - x) : 24);
    if (!el.classList.contains('on')) el.classList.add('hv-jump');
    el.style.width = w + 'px';
    el.style.height = sz.h + 'px';
    el.style.transform = 'translate(' + (xa._offset + x - w / 2) + 'px,' + sz.t + 'px)';
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('hv-jump')));
    gd.classList.add('hv-live');
    // The hovered bar of each bar trace stays lit.
    const order = (gd._fullData || []).filter(t => t.type === 'bar' && t.visible === true).map(t => t.index);
    const groups = gd.querySelectorAll('.barlayer .trace');
    bars.forEach(p => {
      const g = groups[order.indexOf(p.fullData.index)];
      const node = g && g.querySelectorAll('.point')[p.pointNumber];
      if (node) node.classList.add('hv-pt');
    });
  }

  // The hover, the page's own rather than Plotly's: a hairline that glides to
  // the nearest point, a ringed dot on each line, and a bubble beside them
  // (ui.css .hv). The layout wants hovermode 'x unified', hoverdistance -1.
  // describe(points) returns the bubble's HTML. Call again after each redraw.
  function glide(gd, describe) {
    if (typeof gd === 'string') gd = document.getElementById(gd);
    if (!gd || !gd._fullLayout || !gd.on) return;
    let hv = gd.querySelector(':scope > .hv');
    if (!hv) {
      hv = document.createElement('div');
      hv.className = 'hv';
      hv.innerHTML = '<div class="hv-line"></div><div class="hv-dots"></div><div class="hv-bubble"></div>';
      gd.appendChild(hv);
    }
    if (gd.__hv) { gd.removeListener('plotly_hover', gd.__hv.on); gd.removeListener('plotly_unhover', gd.__hv.off); }
    let live = false;
    const off = () => { live = false; const h = gd.querySelector(':scope > .hv'); if (h) h.classList.remove('hv-on'); slot(gd, null); };
    const on = (ev) => {
      const h = gd.querySelector(':scope > .hv');
      // A line's zero start (customdata 'anchor') shapes the line; it is not
      // a reading, so the hover passes over it.
      const pts = (ev.points || []).filter(p => p.y != null && p.x != null && p.data.visible !== 'legendonly'
        && p.customdata !== 'anchor');
      if (!h || !pts.length) return off();
      slot(gd, pts);
      const fl = gd._fullLayout, sz = fl._size, xa = fl.xaxis, ya = fl.yaxis;
      const x = xa._offset + xa.l2p(xa.d2l(pts[0].x));
      if (!live) h.classList.add('hv-jump');
      const line = h.querySelector('.hv-line');
      line.style.height = sz.h + 'px';
      line.style.transform = 'translate(' + x + 'px,' + sz.t + 'px)';
      const dots = h.querySelector('.hv-dots');
      const lines = pts.filter(p => p.data.type !== 'bar' && !p.data.stackgroup);
      while (dots.children.length < lines.length) dots.appendChild(Object.assign(document.createElement('span'), { className: 'hv-dot' }));
      [...dots.children].forEach((d, i) => {
        const p = lines[i];
        if (!p) { d.style.display = 'none'; return; }
        d.style.display = '';
        d.style.color = (p.data.line && p.data.line.color) || (p.data.marker && p.data.marker.color) || 'currentColor';
        d.style.transform = 'translate(' + x + 'px,' + (ya._offset + ya.l2p(ya.d2l(p.y))) + 'px)';
      });
      const b = h.querySelector('.hv-bubble');
      b.innerHTML = describe(pts);
      const bw = b.offsetWidth, bh = b.offsetHeight;
      const right = x + 16 + bw <= sz.l + sz.w + 8;
      const bx = right ? x + 16 : x - 16 - bw;
      const top = gd.getBoundingClientRect().top;
      const py = ev.event && ev.event.clientY != null ? ev.event.clientY - top : sz.t + sz.h / 3;
      const by = Math.max(sz.t - 6, Math.min(py - bh / 2, sz.t + sz.h - bh + 6));
      b.style.transform = 'translate(' + Math.max(0, bx) + 'px,' + by + 'px)';
      h.classList.add('hv-on');
      if (!live) { live = true; requestAnimationFrame(() => requestAnimationFrame(() => h.classList.remove('hv-jump'))); }
    };
    gd.on('plotly_hover', on);
    gd.on('plotly_unhover', off);
    gd.__hv = { on, off };
    touch(gd);
    if (!gd.__hvLeave) { gd.addEventListener('mouseleave', () => gd.__hv && gd.__hv.off()); gd.__hvLeave = true; }
    frame(gd);
  }

  // A finger slid across the plot moves the hover with it: Plotly on its own
  // answers a tap and then holds that point until the next one. The chart
  // keeps sideways moves; up and down still scroll the page.
  function touch(gd) {
    if (!gd || gd.__hvTouch) return;
    gd.__hvTouch = true;
    gd.style.touchAction = 'pan-y';
    // Plotly hovers only on a mouse moving over its plot: the finger's
    // position is handed to it as one, kept inside the plot.
    const follow = (e) => {
      if (e.pointerType !== 'touch' || !gd._fullLayout) return;
      const drag = gd.querySelector('.nsewdrag');
      if (!drag) return;
      const r = drag.getBoundingClientRect();
      const clientX = Math.max(r.left + 1, Math.min(r.right - 1, e.clientX));
      const clientY = Math.max(r.top + 1, Math.min(r.bottom - 1, e.clientY));
      drag.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY, view: window }));
    };
    gd.addEventListener('pointerdown', follow);
    gd.addEventListener('pointermove', follow);
    // Plotly's own touch handling would take the finger for a drag and drop
    // the hover: the touch stops at the chart, the pointer events above do
    // the work.
    for (const t of ['touchstart', 'touchmove', 'touchend']) gd.addEventListener(t, (e) => e.stopPropagation(), { capture: true, passive: true });
  }

  // A CSS colour with its alpha set ('rgb(1, 2, 3)' or '#rrggbb').
  function alpha(c, a) {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b] = m[1].split(',').map(v => v.trim()); return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')'; }
    const h = String(c).match(/^#([0-9a-f]{6})$/i);
    if (h) { const n = parseInt(h[1], 16); return 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')'; }
    return c;
  }

  // The bubble's pieces: a date line, and a keyed row.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function when(x, hourly) {
    const m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    const d = m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))) : new Date(x);
    const o = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    if (hourly) Object.assign(o, { hour: '2-digit', minute: '2-digit', hour12: false });
    return '<div class="hv-when">' + d.toLocaleString('en-US', o) + '</div>';
  }
  const row = (color, label, value) => '<div class="hv-row"><span class="hv-k">'
    + (color ? '<span class="hv-sw" style="background:' + color + '"></span>' : '') + esc(label)
    + '</span><span class="hv-v">' + value + '</span></div>';

  // A chart as a PNG for a deck or a doc: Plotly's transparent render over
  // the dot grid it sits on (when dots), at twice the display size. fig is
  // { data, layout } with the layout built for export (light axes).
  function png(fig, { width, height, dots = true, filename = 'chart.png' }) {
    const scale = 2, w = width * scale, h = height * scale;
    // Display size and scale 2, not twice the size at scale 1: Plotly keeps
    // the layout's font sizes, and the labels would come out half-size.
    return Plotly.toImage(fig, { format: 'png', width, height, scale }).then(url => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        if (dots) {
          // The 14px grid on screen, its pitch scaled to the image.
          const pitch = Math.max(14, Math.round(w / 96));
          c.fillStyle = '#191717';
          c.globalAlpha = 0.18;
          for (let y = h - pitch / 2; y > 0; y -= pitch) {
            for (let x = pitch / 2; x < w; x += pitch) { c.beginPath(); c.arc(x, y, Math.max(1, pitch / 14), 0, Math.PI * 2); c.fill(); }
          }
          c.globalAlpha = 1;
        }
        c.drawImage(img, 0, 0, w, h);
        cv.toBlob((blob) => {
          const href = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href; a.download = filename;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(href), 0);
          resolve();
        }, 'image/png');
      };
      img.onerror = () => resolve();
      img.src = url;
    }));
  }

  window.FusionChart = { fit, compact, onChange, quiet, soft, slot, glide, touch, frame, when, row, cssVar, png };
})();
