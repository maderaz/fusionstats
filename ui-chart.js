// ui-chart.js — what the site's Plotly charts share.
//
// Every chart with axes is drawn the same way, on a phone and on a desktop:
// the plot runs the full width of its box, on the box's faint dots, which stop
// at the plot's edges. The y labels sit just inside its left edge, small and
// under the data. Under the plot, outside the dots, three dates: the first,
// the middle and the last (frame(), called by glide() after every draw).
// Exact values are what the hover is for.
//
//   layout = FusionChart.fit(layout)    a copy of layout, drawn that way
//   FusionChart.frame(gd)               the dots fitted to the plot, the dates
//                                       under it (glide() calls it)
//   FusionChart.compact()               true on a phone: the page's content
//                                       column (.ui-page) 560px or narrower,
//                                       where its CSS goes to the phone layout
//   FusionChart.onChange(fn)            fn() when the column crosses that width
//                                       (a phone turned sideways): redraw
//   FusionChart.glide(gd, describe)     the page's own hover (see below)
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

  // The strip under the plot that holds the dates.
  const DATE_ROW = 24;

  function fit(layout) {
    const out = clone(layout);
    // Only charts with axes: a pie keeps its own margins.
    if (!Object.keys(out).some(k => /^[xy]axis\d*$/.test(k))) return out;
    const phone = compact();
    const muted = cssVar('--text-3', cssVar('--text-secondary', '#9A9AA6'));
    // A key above the plot keeps the room the page gave it.
    const keyOnTop = out.showlegend && out.legend && (out.legend.y == null || out.legend.y >= 1);
    out.margin = { l: 0, r: 0, t: keyOnTop ? ((out.margin && out.margin.t) || 30) : 12, b: DATE_ROW, pad: 0 };
    const small = (f) => Object.assign({}, f, { size: phone ? 10 : 11, color: muted });
    for (const k of Object.keys(out)) {
      if (!/^xaxis\d*$/.test(k)) continue;
      // The dates are frame()'s: three of them, under the dots.
      Object.assign(out[k], { automargin: false, showticklabels: false, ticks: '', ticklen: 0, showline: false, showgrid: false });
    }
    for (const k of Object.keys(out)) {
      if (!/^yaxis\d*$/.test(k)) continue;
      Object.assign(out[k], {
        automargin: false, ticks: '', ticklen: 0, nticks: phone ? 5 : 6,
        // Inside the plot, just above the level they name, under the bars
        // and lines: the data covers them. Above, not on it: a label on the
        // zero line read as "-$0". 'allow': Plotly's overflow check would
        // hide labels that sit inside.
        ticklabelposition: 'inside top', ticklabeloverflow: 'allow', ticklabelstandoff: 4, layer: 'below traces',
        // Faint dashed rules at the labelled levels, under everything.
        showline: false, showgrid: true, gridcolor: cssVar('--line', 'rgba(127, 127, 127, 0.16)'), griddash: '4px,8px', gridwidth: 1,
        tickfont: small(out[k].tickfont),
      });
    }
    return out;
  }

  // The plot's square on its box: the dots stop at its edges (the box's
  // --plot-t and --plot-b, in ui.css), and the dates go under it. The data's
  // own first and last x on screen, not the axis's padding, and not a line's
  // zero start (customdata 'anchor'), which is no reading.
  function frame(gd) {
    if (typeof gd === 'string') gd = document.getElementById(gd);
    const fl = gd && gd._fullLayout;
    if (!fl || !fl.xaxis || !fl._size) return;
    const box = gd.closest('.ui-chart') || gd;
    const sz = fl._size;
    box.style.setProperty('--plot-t', sz.t + 'px');
    box.style.setProperty('--plot-b', Math.max(0, fl.height - sz.t - sz.h) + 'px');
    let row = box.querySelector(':scope > .ui-dates');
    if (!row) {
      row = document.createElement('div');
      row.className = 'ui-dates';
      row.setAttribute('aria-hidden', 'true');
      box.appendChild(row);
    }
    row.innerHTML = dates(gd).map(t => '<span>' + esc(t) + '</span>').join('');
    // One series: its labels and dates in its colour. Several: muted.
    const inks = new Set();
    for (const t of gd._fullData || []) {
      if (t.visible !== true || t.hoverinfo === 'skip' && t.mode === 'markers') continue;
      const c = t.type === 'bar' ? t.marker && t.marker.color : t.line && t.line.width > 0 && t.line.color;
      if (typeof c === 'string') inks.add(c);
    }
    if (inks.size === 1) box.style.setProperty('--chart-ink', [...inks][0]); else box.style.removeProperty('--chart-ink');
    // A soft glow of each line's own colour under it, when there are few.
    const drawn = [...gd.querySelectorAll('.scatterlayer .trace path.js-line')]
      .filter(pth => (parseFloat(pth.style.strokeWidth) || 0) > 0.5 && pth.style.stroke);
    drawn.forEach(pth => { pth.style.filter = drawn.length <= 3 ? 'drop-shadow(0 7px 9px ' + alpha(pth.style.stroke, 0.28) + ')' : ''; });
    // A zoom (desktop) changes what is on screen.
    if (!gd.__framed && gd.on) { gd.__framed = true; gd.on('plotly_relayout', () => frame(gd)); }
  }

  function dates(gd) {
    const xa = gd._fullLayout.xaxis;
    const lim = (xa.range || []).map(v => xa.r2l(v));
    const [r0, r1] = [Math.min(...lim), Math.max(...lim)];
    let lo = Infinity, hi = -Infinity;
    for (const t of gd._fullData || []) {
      if (t.visible === false || t.visible === 'legendonly' || !t.x) continue;
      const cd = Array.isArray(t.customdata) ? t.customdata : null;
      for (let i = 0; i < t.x.length; i++) {
        if (cd && cd[i] === 'anchor') continue;
        const l = xa.d2l(t.x[i]);
        if (!Number.isFinite(l) || l < r0 || l > r1) continue;
        if (l < lo) lo = l;
        if (l > hi) hi = l;
      }
    }
    if (!(hi >= lo)) return [];
    const mid = (lo + hi) / 2;
    if (xa.type === 'date') {
      const day = 864e5, span = hi - lo;
      const o = span > 120 * day ? { month: 'short', year: 'numeric' }
        : span > 2 * day ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
      const f = (ms) => new Date(ms).toLocaleString('en-US', Object.assign({ timeZone: 'UTC' }, o));
      return [f(lo), f(mid), f(hi)];
    }
    if (xa.type === 'category' || xa.type === 'multicategory') {
      const c = xa._categories || [];
      return [lo, mid, hi].map(v => String(c[Math.round(v)] == null ? '' : c[Math.round(v)]));
    }
    return [lo, mid, hi].map(v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
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
      if (at.length) out.push({ type: 'scatter', mode: 'markers', hoverinfo: 'skip', showlegend: false, meta: { of: -1 },
        x: at.map(i => t.x[i]), y: at.map(i => t.y[i]),
        marker: { size: 10, color: (t.line && t.line.color) || cssVar('--accent', '#8429FF'), line: { color: cssVar('--bg', '#fff'), width: 2 } } });
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
    if (!gd.__hvLeave) { gd.addEventListener('mouseleave', () => gd.__hv && gd.__hv.off()); gd.__hvLeave = true; }
    frame(gd);
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

  window.FusionChart = { fit, compact, onChange, quiet, soft, slot, glide, frame, when, row, cssVar, png };
})();
