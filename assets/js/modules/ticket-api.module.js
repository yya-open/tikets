function buildHeaders(headers) {
  return new Headers(headers || {});
}

export async function fetchJson(url, options = {}) {
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

export async function authedFetch(url, options = {}) {
  const { authScope = "edit", authRequired = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const needAuth = authScope === "admin" || authRequired || ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  const headers = buildHeaders(fetchOptions.headers || {});
  const isAdminScope = authScope === "admin";
  let keySource = "";

  if (needAuth) {
    let key = "";
    if (isAdminScope) {
      key = window.TicketAuth && typeof window.TicketAuth.getAdmin === "function" ? window.TicketAuth.getAdmin() : "";
      if (key) keySource = "admin";
      if (!key && window.TicketAuth && typeof window.TicketAuth.get === "function") key = window.TicketAuth.get();
      if (key && !keySource) keySource = "edit-fallback";
      if (!key && typeof window.ensureAdminKey === "function") key = await window.ensureAdminKey();
      if (key && !keySource) keySource = "admin";
    } else {
      key = window.TicketAuth && typeof window.TicketAuth.get === "function" ? window.TicketAuth.get() : "";
      if (key) keySource = "edit";
      if (!key && window.TicketAuth && typeof window.TicketAuth.getAdmin === "function") key = window.TicketAuth.getAdmin();
      if (key && !keySource) keySource = "admin-fallback";
      if (!key && typeof window.ensureEditKey === "function") key = await window.ensureEditKey();
      if (key && !keySource) keySource = "edit";
    }
    if (!key) {
      const err = new Error(isAdminScope ? "missing admin key" : "missing edit key");
      err.code = isAdminScope ? "missing_admin_key" : "missing_edit_key";
      err.status = 401;
      throw err;
    }
    headers.set(isAdminScope ? "X-ADMIN-KEY" : "X-EDIT-KEY", key);
  }

  const res = await fetch(url, { ...fetchOptions, headers });
  if (res.status === 401 || res.status === 403) {
    let payload = null;
    try { payload = await res.clone().json(); } catch {}
    if (payload && payload.code === "invalid_admin_key") {
      if (window.TicketAuth) {
        window.TicketAuth.clearAdmin && window.TicketAuth.clearAdmin();
        window.TicketAuth.clearAdminSetAt && window.TicketAuth.clearAdminSetAt();
        if (keySource === "edit-fallback") {
          window.TicketAuth.clear && window.TicketAuth.clear();
          window.TicketAuth.clearSetAt && window.TicketAuth.clearSetAt();
        }
      }
      if (typeof window.updateEditKeyStatus === "function") window.updateEditKeyStatus();
      if (typeof window.showToast === "function" && needAuth) window.showToast("管理员口令错误，请重新输入。", "error");
    } else if ((payload && payload.code === "invalid_edit_key") || res.status === 401 || res.status === 403) {
      if (window.TicketAuth) {
        window.TicketAuth.clear && window.TicketAuth.clear();
        window.TicketAuth.clearSetAt && window.TicketAuth.clearSetAt();
      }
      if (typeof window.updateEditKeyStatus === "function") window.updateEditKeyStatus();
      if (typeof window.showToast === "function" && needAuth) window.showToast("口令错误，请重新输入。", "error");
    }
  } else if (res.status === 500) {
    try {
      const text = await res.clone().text();
      if (/EDIT_KEY|misconfigured/i.test(text) && typeof window.showToast === "function") {
        window.showToast("服务端未配置 EDIT_KEY 或 ADMIN_KEY。", "error");
      }
    } catch {}
  }
  return res;
}

export const TicketApi = { fetchJson, authedFetch };

export function installTicketApi(target = window) {
  target.TicketApi = TicketApi;
  target.fetchJson = fetchJson;
  target.authedFetch = authedFetch;
  return TicketApi;
}
