// 新增 / 编辑工单弹窗
function getTodayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDefaultTicketType() {
  return (window.TicketConfig && window.TicketConfig.defaults && window.TicketConfig.defaults.ticketType) || "日常故障";
}

function openTicketModal(reset = true) {
  const mask = document.getElementById("ticketModal");
  if (!mask) return;
  mask.classList.add("show");
  if (reset) resetForm(true);
  if (window.TicketValidation) window.TicketValidation.initFormValidationUI();
  setTimeout(() => {
    const el = document.getElementById("date");
    if (el) el.focus();
  }, 0);
}
function closeTicketModal() {
  const mask = document.getElementById("ticketModal");
  if (!mask) return;
  mask.classList.remove("show");
}
function onTicketModalMaskClick(e) {
  if (e && e.target && e.target.id === "ticketModal") closeTicketModal();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTicketModal(); });

function resetForm(resetEditing = true) {
  document.getElementById("ticketForm")?.reset();
  document.getElementById("date").value = getTodayLocalISO();
  document.getElementById("type").value = getDefaultTicketType();
  if (window.TicketValidation) window.TicketValidation.clearValidationErrors();
  if (resetEditing) {
    window.TicketAppState.editingId = null;
    window.TicketAppState.editingUpdatedAt = "";
    window.TicketAppState.editingUpdatedAtTs = 0;
    document.getElementById("submitBtn").innerText = "确定";
  }
}

function fillFormFromRecord(record) {
  if (!record) return;
  window.TicketAppState.editingId = record.id;
  window.TicketAppState.editingUpdatedAt = record.updated_at || "";
  window.TicketAppState.editingUpdatedAtTs = Number(record.updated_at_ts || 0) || 0;
  document.getElementById("date").value = record.date || "";
  document.getElementById("issue").value = record.issue || "";
  document.getElementById("department").value = record.department || "";
  document.getElementById("name").value = record.name || "";
  document.getElementById("solution").value = record.solution || "";
  document.getElementById("remarks").value = record.remarks || "";
  document.getElementById("type").value = record.type || getDefaultTicketType();
  if (window.TicketValidation) window.TicketValidation.clearValidationErrors();
  document.getElementById("submitBtn").innerText = "保存修改";
}

function editRecord(id) {
  const record = (window.TicketAppState.records || []).find(r => r.id === id);
  if (!record) return;
  fillFormFromRecord(record);
  openTicketModal(false);
}

async function addOrUpdateRecord() {
  const state = window.TicketAppState;
  const rawPayload = {
    date: document.getElementById("date").value,
    issue: document.getElementById("issue").value,
    department: document.getElementById("department").value,
    name: document.getElementById("name").value,
    solution: document.getElementById("solution").value,
    remarks: document.getElementById("remarks").value,
    type: document.getElementById("type").value
  };

  const checked = window.TicketValidation ? window.TicketValidation.validateTicketForm(rawPayload) : { ok: !!rawPayload.date && !!rawPayload.issue, errors: [], payload: rawPayload, fieldErrors: {} };
  if (!checked.ok) {
    if (window.TicketValidation) window.TicketValidation.applyValidationErrors(checked.fieldErrors);
    showToast(window.TicketValidation ? window.TicketValidation.render(checked.errors) : "请至少填写日期和问题！", "warning");
    return;
  }
  const payload = checked.payload || rawPayload;

  const btn = document.getElementById("submitBtn");
  const oldText = btn ? btn.innerText : "";
  if (btn) { btn.disabled = true; btn.innerText = "保存中..."; }

  try {
    if (state.editingId === null) {
      await window.TicketService.createTicket(payload);
    } else {
      let res = await window.TicketService.updateTicket(state.editingId, { ...payload, id: state.editingId, updated_at: state.editingUpdatedAt, updated_at_ts: state.editingUpdatedAtTs });

      if (res.status === 409) {
        let info = null;
        try { info = await res.json(); } catch {}
        const latest = info && info.current ? normalizeRecord(info.current, state.editingId) : null;
        const overwrite = await showConfirm({
          title: "编辑冲突",
          message: `建议使用【合并导入】（不清空云端）。

合并规则：仅当备份记录的 updated_at 更新更晚时才覆盖云端同 id 记录。

- 确认：合并到云端（安全）
- 取消：仅导入本地（只影响你当前浏览器）`,
          confirmText: "覆盖保存",
          cancelText: "加载最新",
          danger: true
        });
        if (!overwrite) {
          await reloadAndRender({ showLoadedToast: false });
          if (latest) fillFormFromRecord(latest);
          showToast("已加载最新版本，请确认后重新编辑保存。", "info");
          return;
        }
        res = await window.TicketService.updateTicket(state.editingId, { ...payload, id: state.editingId, force: true });
      }

      if (!res.ok) throw new Error(`update failed: ${res.status}`);
      state.editingId = null;
      state.editingUpdatedAt = "";
      state.editingUpdatedAtTs = 0;
      document.getElementById("submitBtn").innerText = "确定";
    }

    resetForm(false);
    await reloadAndRender();
    showToast("已保存到云端。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("保存失败：请检查网络或后端是否正常。", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = state.editingId === null ? "确定" : (oldText || "保存修改");
    }
  }
}
