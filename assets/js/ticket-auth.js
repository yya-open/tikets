(function () {
  const KEY = "ticket_edit_key";
  const SET_AT = "ticket_edit_key_set_at";
  const store = window.sessionStorage;

  function get() {
    try { return store.getItem(KEY) || ""; } catch { return ""; }
  }
  function set(value) {
    try { store.setItem(KEY, String(value || "")); } catch {}
  }
  function clear() {
    try { store.removeItem(KEY); } catch {}
  }
  function getSetAt() {
    try { return store.getItem(SET_AT) || ""; } catch { return ""; }
  }
  function setSetAtNow() {
    try { store.setItem(SET_AT, new Date().toISOString()); } catch {}
  }
  function clearSetAt() {
    try { store.removeItem(SET_AT); } catch {}
  }

  window.TicketAuth = { get, set, clear, getSetAt, setSetAtNow, clearSetAt };
})();
