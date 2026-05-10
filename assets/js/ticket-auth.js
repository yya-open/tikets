(function () {
  const KEY = "ticket_edit_key";
  const SET_AT = "ticket_edit_key_set_at";
  function getStore() {
    try { return window.sessionStorage; } catch { return null; }
  }

  function clearAll() {
    const store = getStore();
    if (!store) return;
    try { store.removeItem(KEY); } catch {}
    try { store.removeItem(SET_AT); } catch {}
  }

  function get() {
    try {
      const store = getStore();
      if (!store) return "";
      return store.getItem(KEY) || "";
    } catch {
      return "";
    }
  }

  function set(value) {
    try {
      const store = getStore();
      if (!store) return;
      store.setItem(KEY, String(value || ""));
      store.setItem(SET_AT, new Date().toISOString());
    } catch {}
  }

  function clear() {
    clearAll();
  }

  function getSetAt() {
    try {
      const store = getStore();
      if (!store) return "";
      return store.getItem(SET_AT) || "";
    } catch {
      return "";
    }
  }

  function setSetAtNow() {
    try {
      const store = getStore();
      if (store) store.setItem(SET_AT, new Date().toISOString());
    } catch {}
  }

  function clearSetAt() {
    try {
      const store = getStore();
      if (store) store.removeItem(SET_AT);
    } catch {}
  }

  window.TicketAuth = { get, set, clear, getSetAt, setSetAtNow, clearSetAt };
})();
