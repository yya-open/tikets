// 工作台控件：快捷筛选、表格密度、列显示设置
// 这些控件共享一份内部状态（列可见集合、密度偏好、快捷筛选偏好），
// 都通过 localStorage 持久化，并在改变后触发 renderTable。
// 保持为 classic script 顶级函数声明，供 ticket-table-view.js
// 里 renderTable/renderPagination 等按名字直接调用。

const TABLE_COLUMNS = [
  { key: "date", label: "日期", required: true },
  { key: "issue", label: "问题", required: true },
  { key: "status", label: "状态", defaultHidden: true },
  { key: "priority", label: "优先级", defaultHidden: true },
  { key: "assignee", label: "负责人", defaultHidden: true },
  { key: "due_date", label: "截止日期", defaultHidden: true },
  { key: "department", label: "部门" },
  { key: "name", label: "姓名" },
  { key: "solution", label: "处理方法" },
  { key: "remarks", label: "备注" },
  { key: "type", label: "类型" },
  { key: "actions", label: "操作", required: true },
];
const COLUMN_VISIBILITY_STORAGE_KEY = "ticket_visible_columns_v2";
const TABLE_DENSITY_STORAGE_KEY = "ticket_table_density_v1";
const QUICK_FILTER_STORAGE_KEY = "ticket_quick_filter_v1";

function readJsonSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonSetting(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function getDefaultVisibleColumns() {
  return TABLE_COLUMNS
    .filter((col) => col.required || !col.defaultHidden)
    .map((col) => col.key);
}

function getVisibleColumns() {
  const validColumns = new Set(TABLE_COLUMNS.map((col) => col.key));
  const saved = readJsonSetting(COLUMN_VISIBILITY_STORAGE_KEY, null);
  const savedColumns = Array.isArray(saved) ? saved.filter((key) => validColumns.has(key)) : null;
  const visible = new Set(savedColumns || getDefaultVisibleColumns());
  TABLE_COLUMNS.forEach((col) => { if (col.required) visible.add(col.key); });
  return visible;
}

function setColumnVisibility(key, visible) {
  const cols = getVisibleColumns();
  if (visible) cols.add(key);
  else cols.delete(key);
  TABLE_COLUMNS.forEach((col) => { if (col.required) cols.add(col.key); });
  writeJsonSetting(COLUMN_VISIBILITY_STORAGE_KEY, Array.from(cols));
}

function resetColumnVisibilityDefaults() {
  writeJsonSetting(COLUMN_VISIBILITY_STORAGE_KEY, getDefaultVisibleColumns());
}

function areDefaultColumnsSelected(visible) {
  const defaults = getDefaultVisibleColumns();
  return TABLE_COLUMNS.every((col) => visible.has(col.key) === defaults.includes(col.key));
}

function applyColumnVisibility(root = document) {
  const visible = getVisibleColumns();
  root.querySelectorAll("[data-column]").forEach((el) => {
    const key = el.getAttribute("data-column");
    el.hidden = key && !visible.has(key);
  });
}

function getVisibleTableColumnCount() {
  return 1 + TABLE_COLUMNS.filter((col) => getVisibleColumns().has(col.key)).length;
}

function updateColumnSettingsMeta(panel) {
  const visible = getVisibleColumns();
  const count = panel.querySelector("[data-column-visible-count]");
  const resetBtn = panel.querySelector("[data-column-reset]");
  if (count) count.textContent = `已显示 ${visible.size}/${TABLE_COLUMNS.length} 列`;
  if (resetBtn) resetBtn.disabled = areDefaultColumnsSelected(visible);
}

function applyTableDensity(value) {
  const table = document.getElementById("recordTable");
  if (!table) return;
  table.classList.toggle("table-compact", value === "compact");
}

function bindWorkbenchControls() {
  const quickRoot = document.getElementById("quickFilterGroup");
  if (quickRoot && quickRoot.dataset.bound !== "1") {
    quickRoot.dataset.bound = "1";
    const savedQuick = (() => { try { return localStorage.getItem(QUICK_FILTER_STORAGE_KEY) || "all"; } catch { return "all"; } })();
    quickRoot.dataset.activeFilter = savedQuick;
    quickRoot.querySelectorAll("[data-quick-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-quick-filter") === savedQuick);
    });
    quickRoot.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-quick-filter]") : null;
      if (!btn) return;
      const key = btn.getAttribute("data-quick-filter") || "all";
      quickRoot.dataset.activeFilter = key;
      try { localStorage.setItem(QUICK_FILTER_STORAGE_KEY, key); } catch {}
      quickRoot.querySelectorAll("[data-quick-filter]").forEach((item) => item.classList.toggle("active", item === btn));
      window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
      if (typeof renderTable === "function") renderTable({ resetPage: true });
    });
  }

  const density = document.getElementById("tableDensitySelect");
  if (density && density.dataset.bound !== "1") {
    density.dataset.bound = "1";
    try { density.value = localStorage.getItem(TABLE_DENSITY_STORAGE_KEY) || "comfortable"; } catch {}
    applyTableDensity(density.value);
    density.addEventListener("change", () => {
      applyTableDensity(density.value);
      try { localStorage.setItem(TABLE_DENSITY_STORAGE_KEY, density.value); } catch {}
    });
  }

  renderColumnSettings();
}

function renderColumnSettings() {
  const panel = document.getElementById("columnSettingsPanel");
  if (!panel || panel.dataset.rendered === "1") {
    applyColumnVisibility(document);
    if (panel) updateColumnSettingsMeta(panel);
    return;
  }
  panel.dataset.rendered = "1";
  panel.innerHTML = "";
  const visible = getVisibleColumns();
  const meta = document.createElement("div");
  meta.className = "column-settings-meta";
  const count = document.createElement("span");
  count.className = "column-settings-count";
  count.dataset.columnVisibleCount = "1";
  const hint = document.createElement("span");
  hint.className = "column-settings-hint";
  hint.textContent = "日期、问题、操作为固定列";
  meta.appendChild(count);
  meta.appendChild(hint);
  panel.appendChild(meta);
  TABLE_COLUMNS.forEach((col) => {
    const label = document.createElement("label");
    label.className = "column-toggle";
    if (col.required) label.classList.add("is-required");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = visible.has(col.key);
    input.disabled = !!col.required;
    input.dataset.columnToggle = col.key;
    input.addEventListener("change", () => {
      setColumnVisibility(col.key, input.checked);
      applyColumnVisibility(document);
      updateColumnSettingsMeta(panel);
    });
    label.appendChild(input);
    const text = document.createElement("span");
    text.className = "column-toggle-label";
    text.textContent = col.label;
    label.appendChild(text);
    if (col.required) {
      const required = document.createElement("span");
      required.className = "column-required";
      required.textContent = "固定";
      label.appendChild(required);
    }
    panel.appendChild(label);
  });
  const actions = document.createElement("div");
  actions.className = "column-settings-actions";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "small secondary";
  resetBtn.textContent = "恢复默认";
  resetBtn.dataset.columnReset = "1";
  resetBtn.addEventListener("click", () => {
    resetColumnVisibilityDefaults();
    const defaults = getVisibleColumns();
    panel.querySelectorAll("input[data-column-toggle]").forEach((input) => {
      input.checked = defaults.has(input.dataset.columnToggle);
    });
    applyColumnVisibility(document);
    updateColumnSettingsMeta(panel);
  });
  actions.appendChild(resetBtn);
  panel.appendChild(actions);
  applyColumnVisibility(document);
  updateColumnSettingsMeta(panel);
}

window.TicketWorkbench = {
  TABLE_COLUMNS,
  getVisibleColumns,
  applyColumnVisibility,
  getVisibleTableColumnCount,
  getDefaultVisibleColumns,
  resetColumnVisibilityDefaults,
  updateColumnSettingsMeta,
  setColumnVisibility,
  applyTableDensity,
  renderColumnSettings,
  bindWorkbenchControls,
};