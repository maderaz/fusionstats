// ui.js — the behaviour behind ui.css's components, for every page.
//
//   UI.esc(s)                      text made safe for innerHTML
//   UI.usd(n)                      $1.23M, $45.6K, $789
//   UI.num(n, digits)              1,234.56
//   UI.short(addr)                 0x1234…abcd
//   UI.ago(unixSeconds)            "3h ago"
//   UI.chain(id)                   a network's mark and name (.ui-chain)
//   UI.pager({ total, page, size, noun })
//                                  Activity's pager; its buttons carry data-page
//   UI.onPage(el, fn)              fn(page) when a pager button in el is used
//   UI.tip(text)                   an ⓘ whose text shows in the bubble
//
// The ⓘ bubble needs nothing more: any .ui-tip[data-tip] on the page opens it
// on hover (mouse), tap (touch) or focus (keyboard).
(function () {
  'use strict';
  if (window.UI) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function usd(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + a.toFixed(a >= 100 ? 0 : 2);
  }
  const num = (n, d = 0) => (n == null || !isFinite(n) ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const short = (a) => (a ? String(a).slice(0, 6) + '…' + String(a).slice(-4) : '—');

  function ago(ts) {
    if (!ts) return '—';
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 60) return Math.round(s / 86400) + 'd ago';
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function chain(id) {
    const FS = window.FusionSelect;
    const name = FS ? FS.chainName(id) : String(id || '');
    const icon = FS && FS.chainIcon ? FS.chainIcon(id) : null;
    const mark = icon
      ? `<img src="${esc(icon.src)}" alt=""${icon.ink ? ' class="ink"' : ''} width="16" height="16" decoding="async">`
      : `<span class="ui-chain-mono" aria-hidden="true">${esc(name.length <= 3 ? name : name[0])}</span>`;
    return `<span class="ui-chain">${mark}<span>${esc(name)}</span></span>`;
  }

  // Pages: a window around the current one, plus the first and the last.
  function pager({ total, page, size, noun }) {
    const last = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, page), last);
    const start = total ? (p - 1) * size + 1 : 0, end = Math.min(p * size, total);
    const nums = [...new Set([1, p - 1, p, p + 1, last])].filter(n => n >= 1 && n <= last).sort((a, b) => a - b);
    let list = '', prev = 0;
    for (const n of nums) {
      if (n - prev > 1) list += '<span class="pg-gap">…</span>';
      list += `<button type="button" class="pg-num${n === p ? ' on' : ''}" data-page="${n}"${n === p ? ' aria-current="page"' : ''}>${n}</button>`;
      prev = n;
    }
    const f = (n) => n.toLocaleString('en-US');
    if (last <= 1) return total ? `<nav class="ui-pager" aria-label="Pages"><span class="pg-range">${f(total)} ${esc(noun || '')}</span></nav>` : '';
    return `<nav class="ui-pager" aria-label="Pages">
      <span class="pg-range"><span class="pg-span">${f(start)}–${f(end)} of </span>${f(total)} ${esc(noun || '')}</span>
      <div class="pg-ctrls">
        <button type="button" class="pg-step" data-page="${p - 1}"${p > 1 ? '' : ' disabled'} aria-label="Previous page">Prev</button>
        <span class="pg-nums">${list}</span>
        <span class="pg-of">Page ${f(p)} of ${f(last)}</span>
        <button type="button" class="pg-step next" data-page="${p + 1}"${p < last ? '' : ' disabled'} aria-label="Next page">Next</button>
      </div>
    </nav>`;
  }
  function onPage(el, fn) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.ui-pager button[data-page]');
      if (!b || b.disabled || b.classList.contains('on')) return;
      fn(+b.dataset.page);
    });
  }

  const tip = (text) => `<span class="ui-tip" tabindex="0" role="img" aria-label="${esc(text)}" data-tip="${esc(text)}">ⓘ</span>`;

  // One bubble serves every ⓘ, placed against the window so no card or
  // screen edge cuts it off. Hover is for a mouse; a tap opens it.
  function tips() {
    const bubble = document.createElement('div');
    bubble.className = 'ui-tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);
    let current = null;
    const show = (el) => {
      current = el;
      bubble.textContent = el.getAttribute('data-tip');
      bubble.style.left = '0px'; bubble.style.top = '0px';
      const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      bubble.style.left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), vw - b.width - 8) + 'px';
      bubble.style.top = (r.top - b.height - 8 >= 8 ? r.top - b.height - 8 : r.bottom + 8) + 'px';
      bubble.classList.add('show');
    };
    const hide = () => { current = null; bubble.classList.remove('show'); };
    const tipOf = (t) => (t && t.closest ? t.closest('.ui-tip[data-tip]') : null);
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = tipOf(e.target);
      if (el) { if (el !== current) show(el); } else if (current) hide();
    });
    document.addEventListener('focusin', (e) => { const el = tipOf(e.target); if (el) show(el); });
    document.addEventListener('focusout', (e) => { if (tipOf(e.target)) hide(); });
    // Inside a filter cell a tap would also open its list; the tip is what was asked for.
    document.addEventListener('click', (e) => {
      const el = tipOf(e.target);
      if (el) { e.preventDefault(); e.stopPropagation(); show(el); } else if (current) hide();
    }, true);
    window.addEventListener('scroll', () => { if (current) hide(); }, { passive: true });
  }
  if (document.body) tips(); else document.addEventListener('DOMContentLoaded', tips);

  window.UI = { esc, usd, num, short, ago, chain, pager, onPage, tip };
})();
