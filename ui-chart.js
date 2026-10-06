// ui-chart.js — what the site's Plotly charts share.
//
// On a phone a chart's axis labels took a third of its width and a fifth of
// its height: the plot itself was left a third of the box. FusionChart.fit()
// gives the box back to the plot there: the y labels sit inside the plot on
// faint gridlines, the x labels inside along its foot, small and few, and the
// margins are gone.
// Exact values are what the hover is for.
//
//   layout = FusionChart.fit(layout)    a copy of layout, fitted to the screen
//   FusionChart.compact()               true on a phone
//   FusionChart.onChange(fn)            fn() when the screen crosses that width
//                                       (a phone turned sideways): redraw
//   FusionChart.glide(gd, describe)     the page's own hover (see below)
//   FusionChart.quiet(traces)           traces that report hovers, draw none
//
// Exports draw the layout as it was before fit(), whatever the screen: keep
// it and hand it to Plotly.toImage.
(function () {
  'use strict';
  if (window.FusionChart) return;

  const mq = window.matchMedia('(max-width: 560px)');
  const compact = () => mq.matches;
  const cssVar = (name, fallback) =>
    (getComputedStyle(document.documentElement).getPropertyValue(name) || fallback || '').trim() || fallback;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function fit(layout) {
    const out = clone(layout);
    // Only charts with axes: a pie keeps its own margins.
    if (!compact() || !Object.keys(out).some(k => /^[xy]axis\d*$/.test(k))) return out;
    const grid = cssVar('--line', 'rgba(127, 127, 127, 0.16)');
    const muted = cssVar('--text-3', cssVar('--text-secondary', '#9A9AA6'));
    // Both axes' labels inside the plot: the box is all chart.
    out.margin = { l: 0, r: 0, t: 8, b: 0, pad: 0 };
    const small = (f) => Object.assign({}, f, { size: 10, color: muted });
    for (const k of Object.keys(out)) {
      if (!/^xaxis\d*$/.test(k)) continue;
      Object.assign(out[k], {
        automargin: false, ticks: '', ticklen: 0, nticks: 4,
        ticklabelposition: 'inside', showline: false, tickfont: small(out[k].tickfont),
      });
    }
    for (const k of Object.keys(out)) {
      if (!/^yaxis\d*$/.test(k)) continue;
      Object.assign(out[k], {
        automargin: false, ticks: '', ticklen: 0, nticks: 6,
        // 'allow': with the x labels inside too, Plotly's overflow check
        // hides every y label though they sit well inside the plot.
        ticklabelposition: 'inside', ticklabeloverflow: 'allow', showline: false, zeroline: false,
        showgrid: true, gridcolor: grid, griddash: 'dot', gridwidth: 1,
        tickfont: small(out[k].tickfont),
      });
    }
    return out;
  }

  const listeners = [];
  const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  if (mq.addEventListener) mq.addEventListener('change', changed); else if (mq.addListener) mq.addListener(changed);

  // Traces report where the pointer is, but draw no label of their own.
  const quiet = (traces) => traces.map(t => { const q = Object.assign({}, t, { hoverinfo: 'none' }); delete q.hovertemplate; return q; });

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
    const off = () => { live = false; const h = gd.querySelector(':scope > .hv'); if (h) h.classList.remove('hv-on'); };
    const on = (ev) => {
      const h = gd.querySelector(':scope > .hv');
      const pts = (ev.points || []).filter(p => p.y != null && p.x != null && p.data.visible !== 'legendonly');
      if (!h || !pts.length) return off();
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

  window.FusionChart = { fit, compact, onChange: (fn) => listeners.push(fn), quiet, glide, when, row, cssVar };
})();
