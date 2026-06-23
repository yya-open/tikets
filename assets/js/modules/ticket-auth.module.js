const KEY = "ticket_edit_key";
const SET_AT = "ticket_edit_key_set_at";
const ADMIN_KEY = "ticket_admin_key";
const ADMIN_SET_AT = "ticket_admin_key_set_at";

function getStore() {
  try { return window.sessionStorage; } catch { return null; }
}

function clearPair(valueKey, setAtKey) {
  const store = getStore();
  if (!store) return;
  try { store.removeItem(valueKey); } catch {}
  try { store.removeItem(setAtKey); } catch {}
}

function getValue(valueKey) {
  try {
    const store = getStore();
    if (!store) return "";
    return store.getItem(valueKey) || "";
  } catch {
    return "";
  }
}

function setValue(valueKey, setAtKey, value) {
  try {
    const store = getStore();
    if (!store) return;
    store.setItem(valueKey, String(value || ""));
    store.setItem(setAtKey, new Date().toISOString());
  } catch {}
}

function getSetAtValue(setAtKey) {
  try {
    const store = getStore();
    if (!store) return "";
    return store.getItem(setAtKey) || "";
  } catch {
    return "";
  }
}

function setSetAtValue(setAtKey) {
  try {
    const store = getStore();
    if (store) store.setItem(setAtKey, new Date().toISOString());
  } catch {}
}

function clearSetAtValue(setAtKey) {
  try {
    const store = getStore();
    if (store) store.removeItem(setAtKey);
  } catch {}
}

export function get() {
  return getValue(KEY);
}

export function set(value) {
  setValue(KEY, SET_AT, value);
}

export function clear() {
  clearPair(KEY, SET_AT);
}

export function getSetAt() {
  return getSetAtValue(SET_AT);
}

export function setSetAtNow() {
  setSetAtValue(SET_AT);
}

export function clearSetAt() {
  clearSetAtValue(SET_AT);
}

export function getAdmin() {
  return getValue(ADMIN_KEY);
}

export function setAdmin(value) {
  setValue(ADMIN_KEY, ADMIN_SET_AT, value);
}

export function clearAdmin() {
  clearPair(ADMIN_KEY, ADMIN_SET_AT);
}

export function getAdminSetAt() {
  return getSetAtValue(ADMIN_SET_AT);
}

export function setAdminSetAtNow() {
  setSetAtValue(ADMIN_SET_AT);
}

export function clearAdminSetAt() {
  clearSetAtValue(ADMIN_SET_AT);
}

export const TicketAuth = {
  get,
  set,
  clear,
  getSetAt,
  setSetAtNow,
  clearSetAt,
  getAdmin,
  setAdmin,
  clearAdmin,
  getAdminSetAt,
  setAdminSetAtNow,
  clearAdminSetAt,
};

export function installTicketAuth(target = window) {
  target.TicketAuth = TicketAuth;
  return TicketAuth;
}
