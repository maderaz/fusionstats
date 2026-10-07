// Beacon: fire one POST to /api/log per page view, including a stable
// per-browser session id. Loaded with `defer` from every public HTML page.
// Skips itself on /admin (we don't want admin traffic flooding the table).
// A page prerendered ahead of a click (nav.js) counts once it is shown, and
// not at all if it never is.
(function () {
  if (location.pathname.startsWith('/admin')) return;
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', send, { once: true });
  } else {
    send();
  }

  function send() {
    try {
      const KEY = 'fusionstats_session';
      let sid = localStorage.getItem(KEY);
      if (!sid) {
        sid = (crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem(KEY, sid);
      }
      // Where the visit came from: another site's host, or '' for none (typed
      // in, a bookmark). A step within the site sends nothing: it isn't a source.
      let ref = '';
      try { if (document.referrer) ref = new URL(document.referrer).host; } catch {}
      const body = { path: location.pathname + location.search, sessionId: sid };
      if (ref !== location.host) body.ref = ref;
      const payload = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/log', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/log', {
          method: 'POST',
          body: payload,
          headers: { 'content-type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
      }
    } catch { /* never let analytics break the page */ }
  }
})();
