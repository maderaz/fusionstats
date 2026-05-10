// Beacon: fire one POST to /api/log per page view, including a stable
// per-browser session id. Loaded with `defer` from every public HTML page.
// Skips itself on /admin (we don't want admin traffic flooding the table).
(function () {
  if (location.pathname.startsWith('/admin')) return;
  try {
    const KEY = 'fusionstats_session';
    let sid = localStorage.getItem(KEY);
    if (!sid) {
      sid = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(KEY, sid);
    }
    const payload = JSON.stringify({
      path: location.pathname + location.search,
      sessionId: sid,
    });
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
})();
