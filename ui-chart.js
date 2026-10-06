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
//   FusionChart.compact()               true on a phone: the page's content
//                                       column (.ui-page) 560px or narrower,
//                                       where its CSS goes to the phone layout
//   FusionChart.onChange(fn)            fn() when the column crosses that width
//                                       (a phone turned sideways): redraw
//   FusionChart.glide(gd, describe)     the page's own hover (see below)
//   FusionChart.quiet(traces)           traces that report hovers, draw none
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
      // A line's zero start (customdata 'anchor') shapes the line; it is not
      // a reading, so the hover passes over it.
      const pts = (ev.points || []).filter(p => p.y != null && p.x != null && p.data.visible !== 'legendonly'
        && p.customdata !== 'anchor');
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

  window.FusionChart = { fit, compact, onChange, quiet, glide, when, row, cssVar, png };
})();
