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
    const res = await fetch(`/api/stats?${sp.toString()}`, { cache: 'no-store' });
    await ensureOk(res, 'meta stats');
    return await res.json();
  }

  async function loadTickets(searchParams) {
    const query = searchParams instanceof URLSearchParams ? searchParams.toString() : String(searchParams || '');
    const res = await window.TicketApi.authedFetch(`/api/tickets?${query}`, { cache: 'no-store' });
    await ensureOk(res, 'load tickets');
    return await res.json();
  }

  async function loadStats(searchParams) {
    const query = searchParams instanceof URLSearchParams ? searchParams.toString() : String(searchParams || '');
    const res = await fetch(`/api/stats?${query}`, { cache: 'no-store' });
    await ensureOk(res, 'load stats');
    return await res.json();
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
    const res = await window.TicketApi.authedFetch(`/api/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return res;
  }

  async function deleteTicket(id) {
    const res = await window.TicketApi.authedFetch(`/api/tickets/${id}`, { method: 'DELETE' });
    await ensureOk(res, 'delete ticket');
    return await res.json().catch(() => ({}));
  }

  async function restoreTicket(id) {
    const res = await window.TicketApi.authedFetch(`/api/tickets/${id}/restore`, { method: 'PUT' });
    await ensureOk(res, 'restore ticket');
    return await res.json().catch(() => ({}));
  }

  async function hardDeleteTicket(id) {
    const res = await window.TicketApi.authedFetch(`/api/tickets/${id}/hard`, { method: 'DELETE' });
    await ensureOk(res, 'hard delete ticket');
    return await res.json().catch(() => ({}));
  }

  window.TicketService = {
    loadMeta,
    loadTickets,
    loadStats,
    createTicket,
    updateTicket,
    deleteTicket,
    restoreTicket,
    hardDeleteTicket,
  };
})();
