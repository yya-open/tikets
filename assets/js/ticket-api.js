(function () {
  function buildHeaders(headers) {
    return new Headers(headers || {});
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      err.response = res;
      throw err;
    }
    return data;
  }

  async function authedFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const needAuth = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    const headers = buildHeaders(options.headers || {});
    if (needAuth && window.TicketAuth) {
      const key = window.TicketAuth.get();
      if (!key) {
        const err = new Error('missing edit key');
        err.code = 'missing_edit_key';
        err.status = 401;
        throw err;
      }
      headers.set('X-EDIT-KEY', key);
    }
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      let payload = null;
      try { payload = await res.clone().json(); } catch {}
      if ((payload && payload.code === 'invalid_edit_key') || res.status === 403) {
        if (window.TicketAuth) {
          window.TicketAuth.clear();
          window.TicketAuth.clearSetAt && window.TicketAuth.clearSetAt();
        }
      }
    }
    return res;
  }

  window.TicketApi = { fetchJson, authedFetch };
})();
