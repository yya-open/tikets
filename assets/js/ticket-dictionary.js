(function () {
  const state = {
    items: [],
    source: "",
    schemaMissing: false,
    editingId: null,
  };

  function defaultRows() {
    const list = window.TicketConfig?.defaults?.ticketTypes || [window.TicketConfig?.defaults?.ticketType || "日常故障"];
    return list.map((name, index) => ({
      id: null,
      name,
      sort_order: (index + 1) * 10,
      is_enabled: 1,
      ticket_count: 0,
      builtin: true,
    }));
  }

  function enabledRows() {
    return state.items.filter((item) => Number(item.is_enabled ?? 1) === 1);
  }

  function getDefaultType() {
    const first = enabledRows()[0] || state.items[0];
    return first?.name || window.TicketConfig?.defaults?.ticketType || "日常故障";
  }

  function setPill(id, on, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("on", "off");
    el.classList.add(on ? "on" : "off");
    el.textContent = text;
  }

  function fillSelect(select, { includeAll = false, includeDisabled = true, keepValue = "" } = {}) {
    if (!select) return;
    const prev = keepValue || select.value;
    select.innerHTML = "";
    if (includeAll) {
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "全部类型";
      select.appendChild(all);
    }

    const allRows = state.items.length ? state.items : defaultRows();
    const rows = includeDisabled
      ? allRows
      : allRows.filter((item) => Number(item.is_enabled ?? 1) === 1 || String(item.name || "") === prev);
    rows.forEach((item) => {
      const name = String(item.name || "").trim();
      if (!name) return;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = Number(item.is_enabled ?? 1) ? name : `${name}（停用）`;
      select.appendChild(opt);
    });

    if (prev && !Array.from(select.options).some((opt) => opt.value === prev)) {
      const opt = document.createElement("option");
      opt.value = prev;
      opt.textContent = prev;
      select.appendChild(opt);
    }
    select.value = prev || (includeAll ? "" : getDefaultType());
  }

  function refreshSelects(options = {}) {
    fillSelect(document.getElementById("type"), { includeAll: false, includeDisabled: false, keepValue: options.currentType || "" });
    fillSelect(document.getElementById("filterType"), { includeAll: true, includeDisabled: true });
  }

  async function load({ render = true } = {}) {
    try {
      const data = await window.TicketService.loadTicketTypes({ includeDisabled: true });
      state.items = Array.isArray(data?.data) ? data.data : defaultRows();
      state.source = data?.source || "db";
      state.schemaMissing = !!data?.schema_missing;
    } catch (e) {
      console.warn(e);
      state.items = defaultRows();
      state.source = "fallback";
      state.schemaMissing = true;
    }
    refreshSelects();
    if (render) renderManager();
    return state.items;
  }

  function resetForm() {
    state.editingId = null;
    const name = document.getElementById("typeDictName");
    const sort = document.getElementById("typeDictSort");
    const enabled = document.getElementById("typeDictEnabled");
    const btn = document.getElementById("btnSaveTypeDict");
    if (name) name.value = "";
    if (sort) {
      const maxSort = state.items.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0);
      sort.value = String(maxSort + 10);
    }
    if (enabled) enabled.checked = true;
    if (btn) btn.textContent = "保存";
  }

  function editRow(item) {
    if (!item || !Number.isFinite(Number(item.id))) return;
    state.editingId = Number(item.id);
    const name = document.getElementById("typeDictName");
    const sort = document.getElementById("typeDictSort");
    const enabled = document.getElementById("typeDictEnabled");
    const btn = document.getElementById("btnSaveTypeDict");
    if (name) name.value = item.name || "";
    if (sort) sort.value = String(Number(item.sort_order || 0));
    if (enabled) enabled.checked = Number(item.is_enabled || 0) === 1;
    if (btn) btn.textContent = "保存修改";
    if (name) name.focus();
  }

  function renderManager() {
    const body = document.getElementById("typeDictBody");
    if (!body) return;
    body.innerHTML = "";

    const rows = state.items.length ? state.items : defaultRows();
    setPill("typeDictStatusPill", !state.schemaMissing, state.schemaMissing ? "需初始化" : `${enabledRows().length}/${rows.length} 启用`);

    const hint = document.getElementById("typeDictHint");
    if (hint) {
      hint.textContent = state.schemaMissing
        ? "当前使用内置默认类型；如需编辑字典，请先执行“一键初始化 / 自检”或 /api/admin/migrate。"
        : "停用类型不会修改历史工单；筛选仍可查看停用类型，改名会同步更新已有工单的类型字段。";
    }

    rows.forEach((item) => {
      const tr = document.createElement("tr");
      const enabled = Number(item.is_enabled ?? 1) === 1;

      const cells = [
        String(item.sort_order ?? ""),
        String(item.name || ""),
        String(item.ticket_count ?? 0),
        enabled ? "启用" : "停用",
      ];
      cells.forEach((text, index) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (index === 3) td.className = enabled ? "dict-status-on" : "dict-status-off";
        tr.appendChild(td);
      });

      const action = document.createElement("td");
      if (Number.isFinite(Number(item.id))) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "small";
        edit.textContent = "编辑";
        edit.dataset.action = "edit";
        edit.dataset.id = String(item.id);
        action.appendChild(edit);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "small secondary";
        toggle.textContent = enabled ? "停用" : "启用";
        toggle.dataset.action = "toggle";
        toggle.dataset.id = String(item.id);
        action.appendChild(toggle);
      } else {
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = "初始化后可管理";
        action.appendChild(span);
      }
      tr.appendChild(action);
      body.appendChild(tr);
    });
    resetForm();
  }

  function readForm() {
    return {
      name: String(document.getElementById("typeDictName")?.value || "").trim(),
      sort_order: Number(document.getElementById("typeDictSort")?.value || 0) || 0,
      is_enabled: document.getElementById("typeDictEnabled")?.checked ? 1 : 0,
    };
  }

  function isSchemaNotReady(err) {
    const code = String(err?.code || err?.data?.code || err?.data?.error || "");
    return Number(err?.status) === 409 && (code === "schema_not_ready" || code === "schema_missing");
  }

  async function refreshHealthQuietly() {
    try {
      if (!window.TicketHealth) return;
      const health = await window.TicketHealth.load();
      window.TicketHealth.render(health);
    } catch (e) {
      console.warn(e);
    }
  }

  async function ensureDictionaryReady() {
    if (!state.schemaMissing) return true;
    const ok = await showConfirm({
      title: "初始化故障类型字典",
      message: "故障类型字典表尚未初始化。是否现在执行数据库迁移并写入默认故障类型？",
      confirmText: "立即初始化",
      cancelText: "取消",
      danger: false,
    });
    if (!ok) return false;

    try {
      await window.TicketService.runAdminMigrate();
      await load();
      await refreshHealthQuietly();
      if (!state.schemaMissing) {
        if (typeof showToast === "function") showToast("故障类型字典已初始化。", "success");
        return true;
      }
      if (typeof showToast === "function") showToast("迁移已执行，但字典表仍不可用，请查看一键初始化详情。", "error");
      return false;
    } catch (e) {
      if (window.isNoKeyError && window.isNoKeyError(e)) {
        window.openKeyModal && window.openKeyModal("admin");
        if (typeof showToast === "function") showToast("请先设置有效写入口令。", "error");
        return false;
      }
      console.error(e);
      if (typeof showToast === "function") showToast("初始化故障类型字典失败。", "error");
      return false;
    }
  }

  async function saveFromForm() {
    const payload = readForm();
    if (!payload.name) {
      if (typeof showToast === "function") showToast("类型名称不能为空。", "warning");
      return;
    }

    if (state.schemaMissing) {
      const ready = await ensureDictionaryReady();
      if (!ready) return;
    }

    try {
      if (state.editingId === null) {
        await window.TicketService.createTicketType(payload);
      } else {
        await window.TicketService.updateTicketType(state.editingId, payload);
      }
      await load();
      if (typeof showToast === "function") showToast("故障类型已保存。", "success");
    } catch (e) {
      if (window.isNoKeyError && window.isNoKeyError(e)) {
        window.openKeyModal && window.openKeyModal();
        if (typeof showToast === "function") showToast("请先设置有效写入口令。", "error");
        return;
      }
      console.error(e);
      if (isSchemaNotReady(e)) {
        state.schemaMissing = true;
        const ready = await ensureDictionaryReady();
        if (ready) return saveFromForm();
        return;
      }
      if (typeof showToast === "function") showToast(e?.status === 409 ? "保存失败：名称已存在或字典尚未初始化。" : "保存故障类型失败。", "error");
    }
  }

  async function toggleRow(id) {
    const item = state.items.find((row) => Number(row.id) === Number(id));
    if (!item) return;
    const nextEnabled = Number(item.is_enabled || 0) ? 0 : 1;
    const message = nextEnabled
      ? `确认启用“${item.name}”吗？`
      : `确认停用“${item.name}”吗？\n\n停用后不会修改历史工单，只会影响新建工单的推荐选择。`;
    const ok = await showConfirm({ title: "故障类型状态", message, confirmText: nextEnabled ? "启用" : "停用", cancelText: "取消", danger: !nextEnabled });
    if (!ok) return;
    try {
      await window.TicketService.updateTicketType(item.id, { ...item, is_enabled: nextEnabled });
      await load();
      if (typeof showToast === "function") showToast(nextEnabled ? "已启用故障类型。" : "已停用故障类型。", "success");
    } catch (e) {
      if (window.isNoKeyError && window.isNoKeyError(e)) return;
      console.error(e);
      if (typeof showToast === "function") showToast("更新故障类型状态失败。", "error");
    }
  }

  function bind() {
    const save = document.getElementById("btnSaveTypeDict");
    if (save && save.dataset.bound !== "1") {
      save.dataset.bound = "1";
      save.addEventListener("click", saveFromForm);
    }

    const clear = document.getElementById("btnClearTypeDict");
    if (clear && clear.dataset.bound !== "1") {
      clear.dataset.bound = "1";
      clear.addEventListener("click", resetForm);
    }

    const reload = document.getElementById("btnReloadTypeDict");
    if (reload && reload.dataset.bound !== "1") {
      reload.dataset.bound = "1";
      reload.addEventListener("click", () => load().then(() => {
        if (typeof showToast === "function") showToast("字典已刷新。", "success");
      }));
    }

    const body = document.getElementById("typeDictBody");
    if (body && body.dataset.bound !== "1") {
      body.dataset.bound = "1";
      body.addEventListener("click", (event) => {
        const btn = event.target && event.target.closest ? event.target.closest("button[data-action]") : null;
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const item = state.items.find((row) => Number(row.id) === id);
        if (btn.dataset.action === "edit") editRow(item);
        if (btn.dataset.action === "toggle") toggleRow(id);
      });
    }
  }

  async function init() {
    bind();
    await load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { bind(); });
  } else {
    bind();
  }

  window.TicketDictionary = {
    init,
    load,
    refreshSelects,
    getDefaultType,
    getTypes: () => state.items.slice(),
  };
})();
