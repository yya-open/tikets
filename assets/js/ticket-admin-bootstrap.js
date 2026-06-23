// Admin workspace bootstrap.
(function () {
  let adminDataLoaded = false;

  function setAdminVisible(allowed) {
    const gate = document.getElementById("adminGate");
    const content = document.getElementById("adminContent");
    const lockBtn = document.getElementById("btnAdminLock");
    if (gate) gate.hidden = !!allowed;
    if (content) content.hidden = !allowed;
    if (lockBtn) lockBtn.hidden = !allowed;
  }

  function setGateMessage(text, tone) {
    const el = document.getElementById("adminGateMessage");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("success", "error");
    if (tone) el.classList.add(tone);
  }

  async function validateAdminKey(key) {
    if (!key) return false;
    const res = await fetch("/api/auth-test?scope=admin", {
      method: "GET",
      headers: { "X-ADMIN-KEY": key },
      cache: "no-store",
    });
    return res.ok;
  }

  async function loadAdminData() {
    try {
      if (window.TicketHealth) {
        const health = await window.TicketHealth.load();
        window.TicketHealth.render(health);
      }
    } catch (e) {
      console.warn(e);
      if (window.TicketHealth) window.TicketHealth.render({ ok: false });
    }

    try {
      if (!adminDataLoaded && window.TicketDictionary) {
        await window.TicketDictionary.init();
        adminDataLoaded = true;
      } else if (window.TicketDictionary) {
        await window.TicketDictionary.load();
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async function unlockAdmin({ silent = false } = {}) {
    const adminKey = typeof getAdminKey === "function" ? getAdminKey() : "";
    const editFallbackKey = typeof getEditKey === "function" ? getEditKey() : "";
    const key = adminKey || editFallbackKey;
    const usingAdminKey = !!adminKey;
    if (!key) {
      setAdminVisible(false);
      if (!silent) setGateMessage("请先输入管理员写入口令。", "error");
      return false;
    }

    const btn = document.getElementById("btnAdminUnlock");
    const oldText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "验证中…";
    }

    try {
      const ok = await validateAdminKey(key);
      if (!ok) {
        if (usingAdminKey) {
          if (typeof clearAdminKey === "function") clearAdminKey();
          if (typeof clearAdminKeySetAt === "function") clearAdminKeySetAt();
        } else {
          if (typeof clearEditKey === "function") clearEditKey();
          if (typeof clearEditKeySetAt === "function") clearEditKeySetAt();
        }
        if (typeof updateEditKeyStatus === "function") updateEditKeyStatus();
        setAdminVisible(false);
        setGateMessage("口令验证失败，请重新输入。", "error");
        return false;
      }

      setAdminVisible(true);
      setGateMessage("", "");
      if (typeof updateEditKeyStatus === "function") updateEditKeyStatus();
      if (!silent && typeof closeKeyModal === "function") closeKeyModal();
      await loadAdminData();
      if (!silent && typeof showToast === "function") showToast("管理员页面已解锁。", "success");
      return true;
    } catch (e) {
      console.warn(e);
      setAdminVisible(false);
      setGateMessage("无法验证口令，请稍后重试。", "error");
      return false;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.setAttribute("aria-busy", "false");
        btn.textContent = oldText || "输入 / 验证口令";
      }
    }
  }

  async function requestUnlock() {
    if (typeof ensureAdminKey === "function") {
      const key = await ensureAdminKey();
      if (!key) {
        setGateMessage("Admin key is not set.", "error");
        return;
      }
    } else if (typeof ensureEditKey === "function") {
      const key = await ensureEditKey();
      if (!key) {
        setGateMessage("未设置口令。", "error");
        return;
      }
    } else if (typeof openKeyModal === "function") {
      openKeyModal("admin");
      return;
    }
    await unlockAdmin({ silent: false });
  }

  function lockAdmin() {
    if (typeof clearAdminKey === "function") clearAdminKey();
    if (typeof clearAdminKeySetAt === "function") clearAdminKeySetAt();
    if (typeof clearEditKey === "function") clearEditKey();
    if (typeof clearEditKeySetAt === "function") clearEditKeySetAt();
    if (typeof updateEditKeyStatus === "function") updateEditKeyStatus();
    setAdminVisible(false);
    setGateMessage("已退出管理员页面。", "success");
  }

  async function init() {
    try { if (window.TicketFoldState) window.TicketFoldState.init(); } catch (e) {}
    try { if (typeof updateEditKeyStatus === "function") updateEditKeyStatus(); } catch (e) {}

    const unlockBtn = document.getElementById("btnAdminUnlock");
    if (unlockBtn) unlockBtn.addEventListener("click", requestUnlock);

    const lockBtn = document.getElementById("btnAdminLock");
    if (lockBtn) lockBtn.addEventListener("click", lockAdmin);

    setAdminVisible(false);
    await unlockAdmin({ silent: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
