(function () {
  async function buildHttpError(res, action) {
    const err = new Error(`${action} failed: ${res ? res.status : "no_response"}`);
    err.status = res && res.status;
    if (res) {
      try { err.data = await res.clone().json(); } catch {
        try { err.data = await res.clone().text(); } catch {}
      }
      const code = err.data && typeof err.data === 'object' ? err.data.code : '';
      if (code) err.code = code;
    }
    return err;
  }

  async function ensureOk(res, action) {
    if (!res || !res.ok) throw await buildHttpError(res, action);
    return res;
  }

  async function loadMeta(viewMode) {
    const sp = new URLSearchParams();
    if (viewMode === 'trash') sp.set('trash', '1');
    const res = await fetch(`/api/stats?${sp.toString()}`);
    await ensureOk(res, 'meta stats');
    return await res.json();
  }

  async function loadTickets(searchParams) {
    const query = searchParams instanceof URLSearchParams ? searchParams.toString() : String(searchParams || '');
    const res = await window.TicketApi.authedFetch(`/api/tickets?${query}`);
    await ensureOk(res, 'load tickets');
    return await res.json();
  }

  async function loadStats(searchParams) {
    const query = searchParams instanceof URLSearchParams ? searchParams.toString() : String(searchParams || '');
    const res = await fetch(`/api/stats?${query}`);
    await ensureOk(res, 'load stats');
    return await res.json();
  }

  async function loadTicketTypes({ includeDisabled = false } = {}) {
    const sp = new URLSearchParams();
    if (includeDisabled) sp.set('includeDisabled', '1');
    const res = await fetch(`/api/dictionaries/types?${sp.toString()}`);
    await ensureOk(res, 'load ticket types');
    return await res.json();
  }

  async function createTicketType(payload) {
    const res = await window.TicketApi.authedFetch('/api/dictionaries/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    await ensureOk(res, 'create ticket type');
    return await res.json().catch(() => ({}));
  }

  async function updateTicketType(id, payload) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/dictionaries/types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    await ensureOk(res, 'update ticket type');
    return await res.json().catch(() => ({}));
  }

  async function disableTicketType(id) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/dictionaries/types/${id}`, { method: 'DELETE' });
    await ensureOk(res, 'disable ticket type');
    return await res.json().catch(() => ({}));
  }

  async function runAdminMigrate() {
    const res = await window.TicketApi.authedFetch('/api/admin/migrate', { method: 'POST', authScope: 'admin' });
    await ensureOk(res, 'admin migrate');
    return await res.json().catch(() => ({}));
  }

  async function createTicket(payload) {
    const res = await window.TicketApi.authedFetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    await ensureOk(res, 'create ticket');
    return await res.json().catch(() => ({}));
  }

  async function updateTicket(id, payload) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return res;
  }

  async function deleteTicket(id) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/tickets/${id}`, { method: 'DELETE' });
    await ensureOk(res, 'delete ticket');
    return await res.json().catch(() => ({}));
  }

  async function restoreTicket(id) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/tickets/${id}/restore`, { method: 'PUT' });
    await ensureOk(res, 'restore ticket');
    return await res.json().catch(() => ({}));
  }

  async function hardDeleteTicket(id) {
    const apiFetch = (window.TicketApi && typeof window.TicketApi.authedFetch === 'function') ? window.TicketApi.authedFetch.bind(window.TicketApi) : (typeof window.authedFetch === 'function' ? window.authedFetch : fetch);
    const res = await apiFetch(`/api/tickets/${id}/hard`, { method: 'DELETE' });
    await ensureOk(res, 'hard delete ticket');
    return await res.json().catch(() => ({}));
  }

  async function batchUpdate(ids, updates) {
    const res = await window.TicketApi.authedFetch('/api/tickets/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, updates })
    });
    await ensureOk(res, 'batch update');
    return await res.json().catch(() => ({}));
  }

  window.TicketService = {
    loadMeta,
    loadTickets,
    loadStats,
    loadTicketTypes,
    createTicketType,
    updateTicketType,
    disableTicketType,
    runAdminMigrate,
    createTicket,
    updateTicket,
    batchUpdate,
    deleteTicket,
    restoreTicket,
    hardDeleteTicket,
  };
})();
