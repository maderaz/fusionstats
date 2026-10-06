// ui-chart.js — what the site's Plotly charts share.
//
// On a phone a chart's axis labels took a third of its width and a fifth of
// its height: the plot itself was left a third of the box. FusionChart.fit()
// gives the box back to the plot there: the y labels sit inside the plot on
// faint gridlines, the x labels are small and few, and the margins are gone.
// Exact values are what the hover is for.
//
//   layout = FusionChart.fit(layout)    a copy of layout, fitted to the screen
//   FusionChart.compact()               true on a phone
//   FusionChart.onChange(fn)            fn() when the screen crosses that width
//                                       (a phone turned sideways): redraw
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
    out.margin = { l: 0, r: 0, t: 8, b: 22, pad: 0 };
    const small = (f) => Object.assign({}, f, { size: 10, color: muted });
    for (const k of Object.keys(out)) {
      if (!/^xaxis\d*$/.test(k)) continue;
      Object.assign(out[k], { automargin: false, ticks: '', ticklen: 0, nticks: 4, tickfont: small(out[k].tickfont) });
    }
    for (const k of Object.keys(out)) {
      if (!/^yaxis\d*$/.test(k)) continue;
      Object.assign(out[k], {
        automargin: false, ticks: '', ticklen: 0, nticks: 4,
        ticklabelposition: 'inside', showline: false, zeroline: false,
        showgrid: true, gridcolor: grid, griddash: 'dot', gridwidth: 1,
        tickfont: small(out[k].tickfont),
      });
    }
    return out;
  }

  const listeners = [];
  const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  if (mq.addEventListener) mq.addEventListener('change', changed); else if (mq.addListener) mq.addListener(changed);

  window.FusionChart = { fit, compact, onChange: (fn) => listeners.push(fn) };
})();
