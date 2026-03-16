(function () {
  const KEY = "ticket_edit_key";
  const SET_AT = "ticket_edit_key_set_at";
  const store = window.localStorage;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function isExpired() {
    try {
      const setAt = store.getItem(SET_AT);
      if (!setAt) return true;
      const ts = new Date(setAt).getTime();
      if (!Number.isFinite(ts)) return true;
      return (Date.now() - ts) > TTL_MS;
    } catch {
      return true;
    }
  }

  function clearAll() {
    try { store.removeItem(KEY); } catch {}
    try { store.removeItem(SET_AT); } catch {}
  }

  function get() {
    try {
      if (isExpired()) {
        clearAll();
        return "";
      }
      return store.getItem(KEY) || "";
    } catch {
      return "";
    }
  }

  function set(value) {
    try {
      store.setItem(KEY, String(value || ""));
      store.setItem(SET_AT, new Date().toISOString());
    } catch {}
  }

  function clear() {
    clearAll();
  }

  function getSetAt() {
    try {
      if (isExpired()) {
        clearAll();
        return "";
      }
      return store.getItem(SET_AT) || "";
    } catch {
      return "";
    }
  }

  function setSetAtNow() {
    try { store.setItem(SET_AT, new Date().toISOString()); } catch {}
  }

  function clearSetAt() {
    try { store.removeItem(SET_AT); } catch {}
  }

  window.TicketAuth = { get, set, clear, getSetAt, setSetAtNow, clearSetAt };
})();
