// copy-md.js — "Copy as .md", at the top right of every page on a desktop:
// the page as Markdown, on the clipboard. What the page shows, in reading
// order: its headings and text, its figures, its filters and switches as
// they are set, its tables and lists as far as they are on screen (a table's
// page, not its other pages), and each chart as a table of every point it
// draws. Not what is hidden: a closed tooltip or section, the phone's
// layout, the menu, the buttons.
//
// nav.js loads it on a desktop (wider than 900px). A Plotly chart is read
// from its data, its drawing aids left out (hoverinfo 'skip', see
// ui-chart.js soft). A chart a page draws itself gives its points through
//   el.mdPoints = () => [{ label, rows: [[name, value], …] }, …]
// and a small chart in a row (a sparkline) through
//   <svg data-md-points="1.0012,1.0019,…" data-md-name="Share price">
// which its table follows with each row's points. Rows a page draws as a
// grid of cells (a "…head" row, then rows of the same cells) are a table.
(function () {
  'use strict';
  if (window.FusionCopyMd) return;

  const ICON_COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.4v-.2A1.7 1.7 0 0 0 8.8 1.5H4.2A1.7 1.7 0 0 0 2.5 3.2v4.6a1.7 1.7 0 0 0 1.7 1.7h.3"/></svg>';
  const ICON_DONE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6"/></svg>';
  const LABEL = 'Copy as .md';

  // ---- What counts as shown ------------------------------------------------------
  // Never words: the menu, this button, controls, drawings, a pager's buttons,
  // and what only shows on hover (tooltips, a chart's hover bubble).
  const NEVER = [
    'script', 'style', 'noscript', 'template', 'link', 'meta', '[hidden]', '[aria-hidden="true"]',
    '#fnav-root', '.md-copy', '.info-tip', '.ui-tip', '.hv', '.hv-line', '.hv-slot', '.fs-pop', '.fs-scrim',
  ].join(',');
  const SKIP = NEVER + ',' + [
    'svg', 'canvas', 'img', 'picture', 'video', 'audio', 'iframe', 'object',
    'button', 'input', 'textarea', 'select', 'option', '.ui-btn', '.xp-back', '.pg-ctrls', '.pg-nums', '.pg-gap',
  ].join(',');
  const css = (el) => getComputedStyle(el);
  function shown(el) {
    const s = css(el);
    if (s.display === 'contents') return true;
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    // For screen readers only: clipped to nothing.
    if (s.clipPath === 'inset(50%)' || (s.position === 'absolute' && s.overflow === 'hidden' && el.offsetWidth <= 1 && el.offsetHeight <= 1)) return false;
    return true;
  }
  const skipped = (el) => el.matches(SKIP) || !shown(el);
  const tidy = (s) => String(s).replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const cell = (s) => tidy(s).replace(/\|/g, '\\|');
  const isRow = (s) => (s.display === 'flex' || s.display === 'grid' || s.display === 'inline-flex' || s.display === 'inline-grid') && !/column/.test(s.flexDirection);
  const cased = (t, how) => (how === 'uppercase' ? t.toUpperCase() : how === 'lowercase' ? t.toLowerCase()
    : how === 'capitalize' ? t.replace(/(^|[\s(“"'-])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase()) : t);
  const px = (v) => parseFloat(v) || 0;

  // The words in an element, on one line: as the page sets them (its case),
  // things side by side in a row (a flex or grid row's items) apart with
  // " · ", boxes in a line of words, and words spaced by a margin, apart.
  function words(el, avoid, loose) {
    let out = '';
    const s = css(el), row = isRow(s);
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { out += cased(n.nodeValue, s.textTransform); continue; }
      if (n.nodeType !== 1 || (avoid && avoid.has(n))) continue;
      if (n.tagName === 'BR') { out += ' '; continue; }
      const box = n.tagName === 'INPUT' && (n.type === 'checkbox' || n.type === 'radio') && shown(n) ? (n.checked ? '[x]' : '[ ]') : null;
      if (box == null && (loose ? n.matches(NEVER) || !shown(n) : skipped(n))) continue;
      const t = box != null ? box : words(n, avoid, loose);
      if (!t.trim()) continue;
      const ns = css(n), d = ns.display;
      if (row && out.trim()) out = out.trimEnd() + ' · ' + t.trim();
      else if (d !== 'inline' && d !== 'contents') out = (out.trim() ? out.trimEnd() + ' ' : '') + t.trim() + ' ';
      else {
        if ((px(ns.marginLeft) > 0 || px(ns.paddingLeft) > 0) && out && !/\s$/.test(out)) out += ' ';
        out += t;
        if (px(ns.marginRight) > 0 || px(ns.paddingRight) > 0) out += ' ';
      }
    }
    out = out.replace(/\s+/g, ' ');
    // A first letter the page capitalises with ::first-letter.
    if (s.display !== 'inline') {
      const first = getComputedStyle(el, '::first-letter').textTransform;
      if (first && first !== 'none' && first !== s.textTransform) out = out.replace(/\p{L}/u, (c) => cased(c, first));
    }
    return out;
  }
  const text = (el, avoid) => tidy(words(el, avoid));
  // A head row's words: its sort buttons' too.
  const label = (el) => tidy(words(el, null, true));

  // ---- Charts ------------------------------------------------------------------------
  const num = (v) => {
    if (v == null || v === '') return '';
    const n = +v;
    if (!Number.isFinite(n)) return tidy(v);
    return Number.isInteger(n) ? String(n) : String(+n.toPrecision(10));
  };
  // Dates as Plotly draws them: their own digits, no time zone; the time
  // only where two points fall on one day.
  function dates(xs) {
    const iso = xs.map(x => (x instanceof Date ? x.toISOString() : typeof x === 'number' ? new Date(x).toISOString() : String(x))
      .replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/, ''));
    const days = new Set(iso.map(s => s.slice(0, 10)));
    return days.size === iso.length ? iso.map(s => s.slice(0, 10)) : iso.map(s => s.slice(0, 16));
  }
  const axisKey = (id) => String(id || '').replace(/^([xy])(\d*)$/, '$1axis$2');
  const titleText = (t) => tidy(String((t && typeof t === 'object' ? t.text : t) || '').replace(/<[^>]+>/g, ' '));
  function plotTables(gd, name) {
    const full = gd._fullData || [], fl = gd._fullLayout || {}, lay = gd.layout || {};
    const traces = (gd.data || []).map((t, i) => ({ t, f: full[i] || t }))
      .filter(({ t, f }) => f.visible !== false && f.visible !== 'legendonly' && t.hoverinfo !== 'skip');
    const blocks = [];
    // A pie: a share a slice.
    for (const { t } of traces.filter(o => o.t.type === 'pie')) {
      const vals = (t.values || []).map(Number), sum = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
      const rows = (t.labels || []).map((l, k) => [cell(l), num(vals[k]), sum ? String(+(vals[k] / sum * 100).toFixed(2)) + '%' : '']);
      blocks.push(table(['Label', cell(t.name || name || 'Value'), 'Share'], rows));
    }
    // The rest: each point by its x (its y, for bars lying down); traces
    // over the same points share a table.
    const groups = [];
    for (const { t, f } of traces.filter(o => o.t.type !== 'pie')) {
      const flat = t.orientation === 'h';
      const keys = (flat ? t.y : t.x) || [], vals = (flat ? t.x : t.y) || [];
      if (!keys.length) continue;
      const cd = Array.isArray(t.customdata) ? t.customdata : [];
      const pts = [];
      keys.forEach((k, j) => { if (cd[j] !== 'anchor' && k != null) pts.push([k, vals[j]]); });   // not the zero a line rises from
      const ka = axisKey(flat ? (f.yaxis || 'y') : (f.xaxis || 'x')), va = axisKey(flat ? (f.xaxis || 'x') : (f.yaxis || 'y'));
      const kaxis = fl[ka] || {}, vaxis = fl[va] || {};
      const sig = (kaxis.type || '') + '|' + pts.map(p => String(p[0])).join('\u0001');
      let g = groups.find(x => x.sig === sig);
      if (!g) groups.push(g = { sig, kaxis, title: titleText((lay[ka] || {}).title), keys: pts.map(p => p[0]), cols: [] });
      const unit = vaxis.tickprefix ? vaxis.tickprefix.trim() : vaxis.ticksuffix ? vaxis.ticksuffix.trim() : '';
      g.cols.push({ name: tidy(t.name || ''), unit, vals: pts.map(p => p[1]), pct: /%/.test(vaxis.tickformat || '') });
    }
    for (const g of groups) {
      const isDate = g.kaxis.type === 'date';
      const ks = isDate ? dates(g.keys) : g.keys.map(k => cell(k));
      const head = [cell(g.title || (isDate ? (ks[0] && ks[0].length > 10 ? 'Time' : 'Date') : 'Label'))]
        .concat(g.cols.map((c, k) => cell(c.name || (g.cols.length === 1 ? name || 'Value' : 'Series ' + (k + 1)))
          + (c.pct ? ' (%)' : c.unit ? ' (' + c.unit + ')' : '')));
      const val = (c, j) => (c.pct && c.vals[j] != null && c.vals[j] !== '' && Number.isFinite(+c.vals[j]) ? num(+c.vals[j] * 100) : num(c.vals[j]));
      const rows = ks.map((k, j) => [k].concat(g.cols.map(c => val(c, j)))).filter(r => r.slice(1).some(v => v !== ''));
      if (rows.length) blocks.push(table(head, rows));
    }
    return blocks;
  }
  // A chart a page draws itself: its points, as its hover shows them (words
  // only: a value may come as a bit of HTML, read here without running it).
  const plain = (v) => (/[<&]/.test(String(v)) ? new DOMParser().parseFromString(String(v), 'text/html').body.textContent : String(v == null ? '' : v));
  function pointTables(el) {
    let pts = [];
    try { pts = el.mdPoints() || []; } catch { return []; }
    if (!pts.length) return [];
    const names = [];
    pts.forEach(p => (p.rows || []).forEach(([k]) => { k = tidy(plain(k)); if (k && !names.includes(k)) names.push(k); }));
    const rows = pts.map(p => [cell(plain(p.label))].concat(names.map(n => { const r = (p.rows || []).find(([k]) => tidy(plain(k)) === n); return r ? cell(plain(r[1])) : ''; })));
    return [table([cell(el.mdLabel || 'When')].concat(names.map(cell)), rows)];
  }
  // The chart's name: its own title, or the heading it sits under.
  function titleOf(el) {
    const own = titleText(el.layout && el.layout.title);
    if (own) return own;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      for (let s = a.previousElementSibling; s; s = s.previousElementSibling) {
        const h = s.matches('h1,h2,h3,h4,h5,h6,.flow-chart-header') ? s : s.querySelector('h2,h3,h4,h5,h6,.flow-chart-title');
        if (h && shown(h)) { const t = text(h); if (t) return t; }
      }
    }
    return '';
  }
  function chart(el) {
    const name = titleOf(el);
    const tables = typeof el.mdPoints === 'function' ? pointTables(el) : plotTables(el, name);
    return tables.length ? { name, md: tables.join('\n\n') } : null;
  }

  // ---- Tables, lists, figures, fields -------------------------------------------------
  function table(head, rows) {
    const n = Math.max(head.length, ...rows.map(r => r.length));
    const pad = (r) => r.concat(Array(Math.max(0, n - r.length)).fill(''));
    return [pad(head), Array(n).fill('---'), ...rows.map(pad)].map(r => '| ' + r.join(' | ') + ' |').join('\n');
  }
  // A table with what its rows hold: a column with no words in any row (a
  // column of icons) left out, and a sparkline's points after it.
  function tableOf(head, rows, sparks) {
    rows = rows.filter(r => r.some(Boolean));
    if (!rows.length && !head) return '';
    if (!head) head = rows[0].map(() => '');
    const n = Math.max(head.length, ...rows.map(r => r.length));
    const keep = [...Array(n).keys()].filter(i => !rows.length || rows.some(r => r[i]));
    let out = table(keep.map(i => head[i] || ''), rows.map(r => keep.map(i => r[i] || '')));
    if (sparks.length) {
      out += '\n\n**' + cell(sparks[0].name) + ', row by row**\n\n'
        + sparks.map(s => '- ' + s.row + ': ' + s.points.split(',').map(num).join(', ')).join('\n');
    }
    return out;
  }
  const sparkOf = (row, first) => {
    const s = row.querySelector('svg[data-md-points]');
    return s ? { name: s.getAttribute('data-md-name') || 'Points', points: s.getAttribute('data-md-points'), row: first } : null;
  };
  function tableBlock(t) {
    const all = [...t.rows].filter(r => shown(r));
    let head = all.filter(r => r.parentElement === t.tHead).pop() || null;
    const body = all.filter(r => r.parentElement !== t.tHead);
    if (!head && body.length && [...body[0].cells].every(c => c.tagName === 'TH')) head = body.shift();
    const cells = (r) => [...r.cells].filter(c => shown(c)).flatMap(c => [cell(text(c))].concat(Array(Math.max(0, (c.colSpan || 1) - 1)).fill('')));
    const rows = body.map(cells);
    const sparks = body.map((r, i) => sparkOf(r, rows[i].find(Boolean) || '')).filter(Boolean);
    return tableOf(head ? cells(head) : null, rows, sparks);
  }
  // Rows drawn as a grid of cells: a row's cells are its children, shown.
  function cellsOf(el) {
    if (!isRow(css(el))) return null;
    const c = [...el.children].filter(k => !k.matches(NEVER) && shown(k));
    return c.length >= 3 ? c : null;
  }
  const isHead = (el) => /(^|[\s-])\w*head\b/.test(el.className || '') || el.getAttribute('role') === 'row' && !!el.querySelector('[role="columnheader"]');
  // A box whose children are rows of the same cells (and maybe a head row).
  function gridRows(box) {
    const kids = [...box.children].filter(k => !k.matches(NEVER) && shown(k));
    if (kids.length < 2) return null;
    const shapes = kids.map(cellsOf);
    const count = {};
    shapes.forEach(c => { if (c) count[c.length] = (count[c.length] || 0) + 1; });
    const n = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (!n || count[n] < 2 || count[n] < kids.length * 0.6) return null;
    const rows = kids.filter((k, i) => shapes[i] && shapes[i].length === n);
    if (rows.some(r => isChoice(r) || isField(r))) return null;   // a row of buttons, a filter
    // Two rows of one kind at least, its head aside (a log entry's head and
    // body are not a table).
    const kinds = {};
    rows.filter(r => !isHead(r)).forEach(r => { kinds[r.className] = (kinds[r.className] || 0) + 1; });
    if (!Object.values(kinds).some(c => c >= 2)) return null;
    // Rows of words only: not a layout of cards, figures, charts.
    if (rows.some(r => r.querySelector('h1,h2,h3,h4,h5,h6,table,ul,ol,.js-plotly-plot,.ui-figure,.stat,.stat-card'))) return null;
    return { kids, rows, n };
  }
  function gridBlock(g, outsideHead) {
    let head = outsideHead || null;
    let rows = g.rows;
    if (!head && isHead(rows[0])) { head = rows[0]; rows = rows.slice(1); }
    const cellsText = (r) => cellsOf(r).map(c => cell(text(c)));
    const headText = head ? cellsOf(head).map(c => cell(label(c))) : null;
    const body = rows.map(cellsText);
    // A row's name: its first cell's title (the full name), or its words.
    const nameOf = (r, i) => { const c = cellsOf(r)[0], t = c && c.querySelector('[title]'); return tidy((c && c.getAttribute('title')) || (t && t.getAttribute('title')) || body[i].find(Boolean) || ''); };
    const sparks = rows.map((r, i) => sparkOf(r, nameOf(r, i))).filter(Boolean);
    return tableOf(headText, body, sparks);
  }
  // A box of three or more items of one kind holding a few words each (a
  // list drawn with divs): one line an item.
  function repeats(box) {
    const kids = [...box.children].filter(k => !k.matches(NEVER) && shown(k));
    if (kids.length < 3) return null;
    const kind = (k) => k.tagName + '.' + (k.classList[0] || '');
    const count = {};
    kids.forEach(k => { count[kind(k)] = (count[kind(k)] || 0) + 1; });
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (count[top] < kids.length * 0.8 || !kids[0].className) return null;
    const items = kids.filter(k => kind(k) === top);
    if (items.some(k => /^inline/.test(css(k).display) || k.matches(BLOCKY) || k.querySelector(BLOCKY + ',label select') || isChart(k) || text(k).length > 240)) return null;
    return items;
  }
  function listBlock(list, depth) {
    const items = [...list.children].filter(li => li.tagName === 'LI' && shown(li));
    const lines = [];
    items.forEach((li, k) => {
      const subs = [...li.children].filter(c => /^(UL|OL)$/.test(c.tagName));
      const t = text(li, new Set(subs));
      if (!t && !subs.length) return;
      lines.push('  '.repeat(depth) + (list.tagName === 'OL' ? (k + 1) + '. ' : '- ') + t);
      subs.forEach(s => { if (shown(s)) lines.push(listBlock(s, depth + 1)); });
    });
    return lines.filter(Boolean).join('\n');
  }
  // A figure: its name, its number, the line under it.
  function figure(el) {
    const parts = [...el.children].filter(c => !skipped(c)).map(c => text(c)).filter(Boolean);
    if (!parts.length) return '';
    const [k, v, ...rest] = parts;
    return v == null ? '- ' + k : '- **' + k + ':** ' + v + (rest.length ? ' (' + rest.join(' · ') + ')' : '');
  }
  // A filter or a switch, as it is set: "**Page:** All pages", "[x] Leave my visits out".
  function field(el) {
    const sel = el.querySelector('select');
    if (sel) {
      const name = el.querySelector('.ui-filter-label, .filter-label');
      const o = sel.options[sel.selectedIndex];
      const value = o ? tidy(o.dataset.label || o.textContent) : '';
      return '**' + (name ? text(name) : tidy(sel.getAttribute('aria-label') || 'Choice')) + ':** ' + value;
    }
    const box = el.querySelector('input[type=checkbox], input[type=radio]');
    if (box) return (box.checked ? '[x] ' : '[ ] ') + text(el).replace(/^\[[ x]\]\s*/, '');
    const input = el.querySelector('input');
    const name = text(el) || tidy(input && (input.getAttribute('aria-label') || input.placeholder) || '');
    return input && tidy(input.value) ? '**' + name + ':** ' + tidy(input.value) : '';
  }
  // A row of buttons with one lit (a range, a tab): its name and the lit one.
  function choice(el) {
    const on = el.querySelector('.on, .active, [aria-pressed="true"], [aria-selected="true"], [aria-checked="true"]');
    if (!on || !shown(on)) return '';
    const name = el.getAttribute('aria-label') || (el.getAttribute('role') === 'tablist' ? 'Tab' : 'View');
    return '**' + tidy(name) + ':** ' + text(on);
  }
  const isChoice = (el) => el.matches('.ui-seg, .seg, [role="group"], [role="tablist"], [role="radiogroup"]') && !!el.querySelector('button, [role="tab"]');
  const isField = (el) => el.tagName === 'LABEL' && !!el.querySelector('select, input');
  const TEXTY = /^(text|search|number|url|email)$/;
  const isFigure = (el) => el.matches('.ui-figure, .stat-card, .stat');
  const isChart = (el) => el.classList.contains('js-plotly-plot') || typeof el.mdPoints === 'function';
  const BLOCKY = 'h1,h2,h3,h4,h5,h6,table,ul,ol,p,.js-plotly-plot,.ui-figure,.stat,.stat-card';
  // A title drawn by a class ("breakdown-title"), not a heading tag.
  const isTitle = (el) => [...el.classList].some(c => /(^|-)title$/.test(c)) && !el.querySelector(BLOCKY);

  // ---- The page --------------------------------------------------------------------
  function markdown(root) {
    const out = [];   // { kind, md }
    let line = '';
    const flush = () => { const t = tidy(line); line = ''; if (t) out.push({ kind: 'p', md: t }); };
    const push = (kind, md) => { flush(); if (md) out.push({ kind, md }); };
    const walk = (node) => {
      const g = node !== root && gridRows(node);
      if (g) {
        // Its head row, when it stands just before it ("mhead", then the rows).
        let prev = node.previousElementSibling;
        while (prev && (prev.matches(NEVER) || !shown(prev))) prev = prev.previousElementSibling;
        let outside = null;
        if (prev && isHead(prev) && (cellsOf(prev) || []).length === g.n) {
          outside = prev;
          if (out.length && prev._mdLine === out[out.length - 1]) out.pop();   // not twice
        }
        push('table', gridBlock(g, outside));
        g.kids.filter(k => !g.rows.includes(k)).forEach(k => { flush(); walk(k); flush(); });
        return;
      }
      const items = node !== root && repeats(node);
      if (items) {
        push('list', items.map(k => '- ' + text(k)).filter(l => l !== '- ').join('\n'));
        return;
      }
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { line += cased(n.nodeValue, css(node).textTransform); continue; }
        if (n.nodeType !== 1) continue;
        if (isChart(n)) {
          if (!shown(n)) continue;
          const c = chart(n);
          if (!c) continue;
          // Named, unless the line just above already names it.
          flush();
          const above = out.length ? out[out.length - 1].md.replace(/^#+\s*/, '') : '';
          push('chart', '**Chart data' + (c.name && above !== c.name ? ': ' + c.name : '') + '**\n\n' + c.md);
          continue;
        }
        if (isChoice(n)) { if (shown(n)) push('field', choice(n)); continue; }
        if (isField(n)) { if (shown(n)) push('field', field(n)); continue; }
        if (n.tagName === 'BR') { line += ' '; continue; }
        if (n.tagName === 'INPUT' && TEXTY.test(n.type) && shown(n)) {
          const name = (n.labels && n.labels[0] && text(n.labels[0])) || tidy(n.getAttribute('aria-label') || n.placeholder || '');
          if (tidy(n.value)) push('field', '**' + (name || 'Search') + ':** ' + tidy(n.value));
          continue;
        }
        if (n.tagName === 'LABEL' && n.control && TEXTY.test(n.control.type) && !n.contains(n.control)) continue;
        if (skipped(n)) continue;
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) { push('h', '#'.repeat(+tag[1]) + ' ' + text(n)); continue; }
        if (tag === 'TABLE') { push('table', tableBlock(n)); continue; }
        if (tag === 'UL' || tag === 'OL') { push('list', listBlock(n, 0)); continue; }
        if (isFigure(n)) { push('figure', figure(n)); continue; }
        if (isTitle(n)) { push('h', '### ' + text(n)); continue; }
        const s = css(n), d = s.display;
        if (d === 'inline' || d === 'contents') { walk(n); continue; }
        if (d.startsWith('inline')) { line += ' ' + text(n) + ' '; continue; }
        // Rows of cells, or items of one kind: a table, a list (walk works them out).
        if (gridRows(n) || repeats(n)) { flush(); walk(n); flush(); continue; }
        // A row of short things side by side (chips, a meta line, a head row): one line.
        if ((d === 'flex' || d === 'grid') && !/column/.test(s.flexDirection) && plainRow(n)) {
          push('p', text(n));
          n._mdLine = out[out.length - 1];
          continue;
        }
        flush(); walk(n); flush();
      }
    };
    walk(root);
    flush();
    // Figures side by side make one list; filters and switches, one line.
    const md = [];
    for (const b of out) {
      const last = md[md.length - 1];
      if (last && b.kind === last.kind && (b.kind === 'figure' || b.kind === 'field')) last.md += (b.kind === 'figure' ? '\n' : ' · ') + b.md;
      else md.push({ kind: b.kind, md: b.md });
    }
    return md.map(b => b.md).join('\n\n');
  }
  // A row whose items hold only words (no headings, tables, lists, charts).
  function plainRow(el) {
    const kids = [...el.children].filter(c => !skipped(c));
    return kids.length > 1 && kids.every(c => !c.matches(BLOCKY + ',input,select,textarea') && !c.querySelector(BLOCKY + ',input,select,textarea') && !isChart(c) && !isChoice(c) && !isField(c) && !gridRows(c));
  }

  function pageMd() {
    const root = document.querySelector('.ui-page') || document.querySelector('main') || document.querySelector('.page') || document.body;
    const when = new Date().toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return markdown(root) + '\n\n---\n\nSource: ' + location.href + ' (copied ' + when + ' UTC)\n';
  }

  // ---- The button ----------------------------------------------------------------------
  const STYLE = `
    .md-copy {
      position: absolute; right: 0; top: 0; z-index: 2;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 32px; padding: 0 12px;
      border: 1px solid var(--line-strong, #E4E4EA); border-radius: 9px;
      background: var(--bg, #fff); color: var(--text-2, #5E5E6B);
      font: 500 13px var(--sans, 'Geist', ui-sans-serif, system-ui, sans-serif); white-space: nowrap;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .md-copy:hover { background: var(--bg-subtle, #F7F7F9); color: var(--text, #0B0B0F); }
    .md-copy:focus-visible { outline: 2px solid var(--accent, #8429FF); outline-offset: 1px; }
    .md-copy svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .md-copy.done { color: var(--text, #0B0B0F); }
    .md-copy.done svg { color: var(--pos, #16A34A); }
    h1.md-room { margin-right: var(--md-room, 0px); }
    @media (max-width: 900px) { .md-copy { display: none; } h1.md-room { margin-right: 0; } }
    @media print { .md-copy { display: none; } }
  `;
  let btn = null;
  const mast = () => document.querySelector('.ui-masthead, header.masthead');
  function place() {
    const m = mast();
    if (!m || !btn) return;
    if (btn.parentNode !== m) m.appendChild(btn);
    if (css(m).position === 'static') m.style.position = 'relative';
    if (!btn.offsetWidth) return;
    // Level with the masthead's first line: the title, or a Back link above it.
    const anchor = [...m.querySelectorAll('.xp-back, h1')].find(e => shown(e) && e.getBoundingClientRect().height > 1);
    if (!anchor) return;
    let line = anchor.getBoundingClientRect();
    if (anchor.tagName === 'H1') {
      const r = document.createRange(); r.selectNodeContents(anchor);
      const first = [...r.getClientRects()].find(x => x.height > 0);
      if (first) line = { top: first.top, height: first.height };
    }
    const top = Math.round(line.top + line.height / 2 - m.getBoundingClientRect().top - btn.offsetHeight / 2) + 'px';
    if (btn.style.top !== top) btn.style.top = top;
    // A title on that line stops short of the button.
    m.querySelectorAll('h1.md-room').forEach(h => { if (h !== anchor) h.classList.remove('md-room'); });
    if (anchor.tagName === 'H1') {
      const room = (btn.offsetWidth + 16) + 'px';
      if (!anchor.classList.contains('md-room')) anchor.classList.add('md-room');
      if (anchor.style.getPropertyValue('--md-room') !== room) anchor.style.setProperty('--md-room', room);
    }
  }
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); };

  async function copy() {
    let md = '', ok = false;
    try { md = pageMd(); } catch (e) { md = ''; }
    if (md) {
      try { await navigator.clipboard.writeText(md); ok = true; } catch {
        const ta = document.createElement('textarea');
        ta.value = md; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch {}
        ta.remove();
      }
    }
    btn.classList.toggle('done', ok);
    btn.innerHTML = (ok ? ICON_DONE : ICON_COPY) + '<span aria-live="polite">' + (ok ? 'Copied' : 'Copy failed') + '</span>';
    clearTimeout(copy.t);
    copy.t = setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = ICON_COPY + '<span aria-live="polite">' + LABEL + '</span>'; }, 1800);
  }

  function boot() {
    const m = mast();
    if (!m) return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-copy';
    btn.title = 'Copy this page as Markdown: its text, and every chart\'s data points';
    btn.innerHTML = ICON_COPY + '<span aria-live="polite">' + LABEL + '</span>';
    btn.addEventListener('click', copy);
    m.appendChild(btn);
    btn.style.minWidth = btn.offsetWidth + 'px';   // "Copied" keeps its size
    place();
    if (window.ResizeObserver) new ResizeObserver(later).observe(m);
    if (window.MutationObserver) new MutationObserver((recs) => { if (recs.some(r => r.target !== btn && !btn.contains(r.target))) later(); })
      .observe(m, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    window.addEventListener('resize', later);
  }

  window.FusionCopyMd = { markdown: pageMd };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
