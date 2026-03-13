// ===== 视图模式：工单 / 回收站 =====
const VIEW_MODE_STORAGE = (window.TicketConfig && window.TicketConfig.storageKeys && window.TicketConfig.storageKeys.viewMode) || "ticket_view_mode";
var viewMode = "active"; // 'active' | 'trash'

function loadViewMode() {
  try {
    const v = (localStorage.getItem(VIEW_MODE_STORAGE) || "active").toLowerCase();
    viewMode = (v === "trash") ? "trash" : "active";
  } catch {
    viewMode = "active";
  }
}
function saveViewMode() {
  try { localStorage.setItem(VIEW_MODE_STORAGE, viewMode); } catch {}
}
function updateViewModeUI() {
  const btn = document.getElementById("trashToggleBtn");
  const pill = document.getElementById("viewModePill");
  if (btn) btn.textContent = viewMode === "trash" ? "返回工单" : "回收站";
  if (pill) {
    pill.textContent = viewMode === "trash" ? "回收站" : "工单";
    pill.classList.remove("on", "off");
    pill.classList.add(viewMode === "trash" ? "off" : "on");
  }
}
async function toggleTrashView() {
  viewMode = viewMode === "trash" ? "active" : "trash";
  saveViewMode();
  updateViewModeUI();
  await reloadAndRender({ showLoadedToast: true });
}

// ===== 写入口令（仅保护写操作） =====
const EDIT_KEY_STORAGE = "ticket_edit_key";
const EDIT_KEY_SET_AT_STORAGE = "ticket_edit_key_set_at";

function getEditKey() {
  if (window.TicketAuth && typeof window.TicketAuth.get === "function") return window.TicketAuth.get();
  try { return sessionStorage.getItem(EDIT_KEY_STORAGE) || ""; } catch { return ""; }
}
function setEditKey(key) {
  if (window.TicketAuth && typeof window.TicketAuth.set === "function") return window.TicketAuth.set(key);
  try { sessionStorage.setItem(EDIT_KEY_STORAGE, String(key || "")); } catch {}
}
function clearEditKey() {
  if (window.TicketAuth && typeof window.TicketAuth.clear === "function") return window.TicketAuth.clear();
  try { sessionStorage.removeItem(EDIT_KEY_STORAGE); } catch {}
}
function getEditKeySetAt() {
  if (window.TicketAuth && typeof window.TicketAuth.getSetAt === "function") return window.TicketAuth.getSetAt();
  try { return sessionStorage.getItem(EDIT_KEY_SET_AT_STORAGE) || ""; } catch { return ""; }
}
function setEditKeySetAtNow() {
  if (window.TicketAuth && typeof window.TicketAuth.setSetAtNow === "function") return window.TicketAuth.setSetAtNow();
  try { sessionStorage.setItem(EDIT_KEY_SET_AT_STORAGE, new Date().toISOString()); } catch {}
}
function clearEditKeySetAt() {
  if (window.TicketAuth && typeof window.TicketAuth.clearSetAt === "function") return window.TicketAuth.clearSetAt();
  try { sessionStorage.removeItem(EDIT_KEY_SET_AT_STORAGE); } catch {}
}

let __editKeyWaiters = [];
function resolveEditKeyWaiters(value) {
  try {
    __editKeyWaiters.forEach((r) => r(value));
  } finally {
    __editKeyWaiters = [];
  }
}

function updateEditKeyStatus() {
  const key = getEditKey();
  const on = !!key;
  const setAt = formatISOToLocal(getEditKeySetAt());

  const applyPill = (el) => {
    if (!el) return;
    el.classList.remove("on", "off");
    el.classList.add(on ? "on" : "off");
    el.textContent = on ? "已设置" : "未设置";
  };

  applyPill(document.getElementById("editKeyStatus"));
  applyPill(document.getElementById("editKeyStatus2"));

  const el1 = document.getElementById("editKeySetAt");
  const el2 = document.getElementById("editKeySetAt2");
  if (el1) el1.textContent = on ? setAt : "-";
  if (el2) el2.textContent = on ? setAt : "-";

  const btn = document.getElementById("btnOneClick");
  if (btn) btn.disabled = !on;
}

function openKeyModal() {
  const modal = document.getElementById("keyModal");
  if (!modal) return;
  modal.classList.add("show");
  const input = document.getElementById("editKeyInput");
  if (input) input.value = getEditKey() || "";
  const show = document.getElementById("editKeyShow");
  if (show) show.checked = false;
  if (input) input.type = "password";
  updateEditKeyStatus();
  if (input) input.focus();
}

function closeKeyModal() {
  const modal = document.getElementById("keyModal");
  if (!modal) return;
  modal.classList.remove("show");
  resolveEditKeyWaiters(getEditKey() || "");
}

function onKeyModalMaskClick(e) {
  if (e.target && e.target.id === "keyModal") closeKeyModal();
}

function toggleEditKeyVisibility() {
  const input = document.getElementById("editKeyInput");
  const show = document.getElementById("editKeyShow");
  if (!input || !show) return;
  input.type = show.checked ? "text" : "password";
}

function saveEditKeyFromUI() {
  const input = document.getElementById("editKeyInput");
  const key = (input ? input.value : "").trim();
  if (!key) {
    clearEditKey();
    clearEditKeySetAt();
    updateEditKeyStatus();
    resolveEditKeyWaiters("");
    if (typeof showToast === "function") showToast("已清除写入口令。", "success");
    return;
  }
  setEditKey(key);
  setEditKeySetAtNow();
  updateEditKeyStatus();
  resolveEditKeyWaiters(key);
  if (typeof showToast === "function") showToast("写入口令已保存（仅当前浏览器）。", "success");
}

function clearEditKeyFromUI() {
  clearEditKey();
  clearEditKeySetAt();
  const input = document.getElementById("editKeyInput");
  if (input) input.value = "";
  updateEditKeyStatus();
  resolveEditKeyWaiters("");
  if (typeof showToast === "function") showToast("已清除写入口令。", "success");
}

async function ensureEditKey() {
  const existing = getEditKey();
  if (existing) return existing;
  openKeyModal();
  if (typeof showToast === "function") showToast("请先设置写入口令后再执行写操作。", "warning");
  return await new Promise((resolve) => {
    __editKeyWaiters.push(resolve);
  });
}

async function testEditKey() {
  const key = getEditKey();
  if (!key) {
    openKeyModal();
    if (typeof showToast === "function") showToast("请先设置写入口令，再进行测试。", "warning");
    return;
  }
  try {
    const res = await fetch("/api/auth-test", {
      method: "GET",
      headers: { "X-EDIT-KEY": key },
      cache: "no-store",
    });
    if (res.ok) {
      if (typeof showToast === "function") showToast("口令测试通过 ✅", "success");
    } else if (res.status === 401) {
      clearEditKey();
      clearEditKeySetAt();
      updateEditKeyStatus();
      if (typeof showToast === "function") showToast("口令错误（401），请重新设置。", "error");
      openKeyModal();
    } else if (res.status === 500) {
      if (typeof showToast === "function") showToast("服务端未配置 EDIT_KEY（500）。", "error");
    } else {
      if (typeof showToast === "function") showToast(`测试失败：${res.status}`, "error");
    }
  } catch (e) {
    if (typeof showToast === "function") showToast("无法连接服务端进行测试。", "error");
  }
}

async function authedFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const needAuth = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (!needAuth) return fetch(url, options);

  const key = await ensureEditKey();
  const headers = new Headers(options.headers || {});
  if (key) headers.set("X-EDIT-KEY", key);

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    clearEditKey();
    updateEditKeyStatus();
    if (typeof showToast === "function") showToast("写入口令错误，请重新输入。", "error");
  } else if (res.status === 500) {
    try {
      const t = await res.clone().text();
      if (/EDIT_KEY|misconfigured/i.test(t)) {
        if (typeof showToast === "function") showToast("服务端未配置 EDIT_KEY。", "error");
      }
    } catch {
    }
  }
  return res;
}

function isNoKeyError(err) {
  const msg = String((err && err.message) || err || "");
  return /\b401\b/.test(msg) || /Unauthorized/i.test(msg);
}
