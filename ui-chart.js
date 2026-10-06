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

  window.FusionChart = { fit, compact, onChange };
})();
