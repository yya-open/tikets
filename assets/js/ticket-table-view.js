function tableText(value, fallback = "未填写") {
  const v = String(value ?? "").trim();
  return v || fallback;
}

function appendTextCell(row, className, value, fallback = "未填写", columnKey = "") {
  const cell = row.insertCell();
  cell.className = className;
  if (columnKey) cell.dataset.column = columnKey;
  const text = document.createElement("span");
  text.className = value ? "table-cell-text" : "table-cell-empty";
  text.textContent = tableText(value, fallback);
  cell.appendChild(text);
  return cell;
}

function appendIssueCell(row, record) {
  const cell = row.insertCell();
  cell.className = "ticket-issue-cell";
  cell.dataset.column = "issue";
  const title = document.createElement("div");
  title.className = "ticket-issue-title";
  title.textContent = tableText(record.issue, "未填写问题描述");
  cell.appendChild(title);
  return cell;
}

function appendTypeCell(row, type) {
  const cell = row.insertCell();
  cell.className = "ticket-type-cell";
  cell.dataset.column = "type";
  const pill = document.createElement("span");
  pill.className = "ticket-type-pill";
  pill.textContent = tableText(type, "未分类");
  cell.appendChild(pill);
  return cell;
}

function appendBadgeCell(row, key, value, fallback) {
  const cell = row.insertCell();
  cell.className = `ticket-${key}-cell`;
  cell.dataset.column = key;
  const badge = document.createElement("span");
  badge.className = `ticket-badge ticket-${key}-badge ticket-${key}-${String(value || fallback || "").replace(/\s+/g, "-")}`;
  badge.textContent = tableText(value, fallback);
  cell.appendChild(badge);
  return cell;
}

function appendDueCell(row, record) {
  const cell = row.insertCell();
  cell.className = "ticket-due-cell";
  cell.dataset.column = "due_date";
  const due = tableText(record.due_date, "未设置");
  const text = document.createElement("span");
  text.className = "table-cell-text";
  text.textContent = due;
  if (isTicketOverdue(record)) text.classList.add("is-overdue");
  cell.appendChild(text);
  return cell;
}

function isTicketOverdue(record) {
  const due = String(record?.due_date || "").trim();
  const status = String(record?.status || "待处理").trim();
  if (!due || status === "已解决" || status === "已关闭") return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return due < today;
}

function appendActionButton(container, text, className, action, id) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.className = className;
  btn.dataset.action = action;
  btn.dataset.id = String(id);
  container.appendChild(btn);
  return btn;
}

function bindTableDetailInteractions() {
  const table = document.getElementById('recordTable');
  if (!table || table.dataset.detailBound === '1') return;
  table.dataset.detailBound = '1';

  table.addEventListener('click', function (e) {
    if (handleRowSelectionClick(e)) return;
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = Number(btn.getAttribute('data-id'));
    if (!Number.isFinite(id)) return;
    if (action === 'view') return openTicketDetail(id);
    if (action === 'edit') return editRecord(id);
    if (action === 'delete') return deleteRecord(id);
    if (action === 'restore') return restoreRecord(id);
    if (action === 'hard-delete') return hardDeleteRecord(id);
  });

  table.addEventListener('dblclick', function (e) {
    const row = e.target && e.target.closest ? e.target.closest('tbody tr[data-ticket-id]') : null;
    if (!row) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    const id = Number(row.getAttribute('data-ticket-id'));
    if (!Number.isFinite(id)) return;
    openTicketDetail(id);
  });
}

var typePieChart = null;
var monthBarChart = null;


    // ⭐ 本地存储：保存 records 到 localStorage
    function saveToLocal() {
      try {
        localStorage.setItem("ticket_records", JSON.stringify(records));
      } catch (e) {
        console.error("保存到本地失败：", e);
      }
    }


    function saveViewState() {
      try {
        localStorage.setItem("ticket_view_year", window.TicketAppState.activeYear || "");
        localStorage.setItem("ticket_view_month", window.TicketAppState.activeMonth || "");
      } catch (e) {
        // ignore
      }
    }

    function loadViewState() {
      try {
        window.TicketAppState.activeYear = localStorage.getItem("ticket_view_year") || "";
        window.TicketAppState.activeMonth = localStorage.getItem("ticket_view_month") || "";
      } catch (e) {
        window.TicketAppState.activeYear = "";
        window.TicketAppState.activeMonth = "";
      }
    }


    // ⭐ 本地存储：从 localStorage 恢复 records
    function loadFromLocal() {
      try {
        const saved = localStorage.getItem("ticket_records");
        if (saved) {
          const data = JSON.parse(saved);
          if (Array.isArray(data)) {
            window.TicketPageState.setRecords(normalizeRecords(data));
            const maxId = records.reduce((max, r) => {
              const v = Number(r.id);
              return Number.isFinite(v) ? Math.max(max, v) : max;
            }, 0);
            nextId = maxId + 1;
          }
        }
      } catch (e) {
        console.error("从本地恢复数据失败：", e);
      }
    }

    // ===== 云端存储（Cloudflare Pages Functions + D1，服务端分页/筛选）=====
    // deleteRecord / restoreRecord / hardDeleteRecord 已迁至 ticket-record-actions.js

    function clearFilters() {
      ["filterFrom", "filterTo", "filterType", "filterDepartment", "filterName", "filterKeyword", "filterTicketStatus", "filterAssignee", "filterPriority"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const quickRoot = document.getElementById("quickFilterGroup");
      if (quickRoot) {
        quickRoot.dataset.activeFilter = "all";
        quickRoot.querySelectorAll("[data-quick-filter]").forEach((btn) => {
          btn.classList.toggle("active", btn.getAttribute("data-quick-filter") === "all");
        });
        try { localStorage.setItem("ticket_quick_filter_v1", "all"); } catch {}
      }
      // 保留年份/月视图状态，仅清空高级筛选
      window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
      renderTable({ resetPage: true });
}

async function renderTable({ resetPage = true } = {}) {
  const tbody = document.getElementById("recordTable").querySelector("tbody");
  bindTableDetailInteractions();
  bindMonthViewInteractions();
  bindPaginationInteractions();
  bindBatchToolbarInteractions();
  bindWorkbenchControls();
  bindBatchWorkflowControls();
  tbody.innerHTML = "";

  // 若筛选条件/视图变化，则清空游标分页状态
  const newCursorKey = buildCursorKey();
  if (resetPage || newCursorKey !== cursorKey) {
    cursorKey = newCursorKey;
    pageCursorMap.clear();
    cursorNav = null;
  }

  try {
    if (resetPage) currentPage = 1;
    const loaded = await loadPageFromServer();
    if (loaded === false) return;
  } catch (e) {
    console.error(e);
    showToast("加载失败：请检查网络或后端是否正常。", "error");
    records = [];
    serverTotal = 0;
  }

  const totalItems = serverTotal;
  const pageRecords = records;

  if (pageRecords.length === 0) {
    const row = tbody.insertRow();
    const cell = row.insertCell(0);
    cell.colSpan = getVisibleTableColumnCount();
    cell.className = "table-empty-cell";
    const empty = document.createElement("div");
    empty.className = "table-empty-state";
    const title = document.createElement("div");
    title.className = "table-empty-title";
    title.textContent = viewMode === "trash" ? "回收站暂无记录" : "暂无工单记录";
    const desc = document.createElement("div");
    desc.className = "table-empty-desc";
    desc.textContent = viewMode === "trash"
      ? "被删除的工单会出现在这里，可在恢复前核对详情。"
      : "可以新建第一条工单，或调整筛选条件后重新查看。";
    empty.appendChild(title);
    empty.appendChild(desc);
    cell.appendChild(empty);
  } else {
    pageRecords.forEach(r => {
      const row = tbody.insertRow();
      row.dataset.ticketId = String(r.id);
      row.title = '双击查看详情';
      row.style.cursor = 'pointer';
      const selectCell = row.insertCell(0);
      selectCell.className = 'sel-cell';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'row-select';
      checkbox.dataset.id = String(r.id);
      checkbox.checked = selectedTicketIds.has(Number(r.id));
      selectCell.appendChild(checkbox);
      row.classList.toggle('row-selected', checkbox.checked);
      appendTextCell(row, "ticket-date-cell", r.date, "未设置", "date");
      appendIssueCell(row, r);
      appendBadgeCell(row, "status", r.status, "待处理");
      appendBadgeCell(row, "priority", r.priority, "普通");
      appendTextCell(row, "ticket-assignee-cell", r.assignee, "未指派", "assignee");
      appendDueCell(row, r);
      appendTextCell(row, "ticket-org-cell", r.department, "未填写", "department");
      appendTextCell(row, "ticket-person-cell", r.name, "未填写", "name");
      appendTextCell(row, "ticket-long-cell", r.solution, "未填写", "solution");
      appendTextCell(row, "ticket-long-cell", r.remarks, "未填写", "remarks");
      appendTypeCell(row, r.type);
      const actionCell = row.insertCell();
      actionCell.className = "ticket-action-cell";
      actionCell.dataset.column = "actions";
      const actionStack = document.createElement("div");
      actionStack.className = "action-stack table-action-stack";
      actionCell.appendChild(actionStack);

      if (viewMode === "trash") {
        appendActionButton(actionStack, "查看", "small secondary", "view", r.id);
        appendActionButton(actionStack, "恢复", "small", "restore", r.id);
        appendActionButton(actionStack, "彻底删除", "small danger", "hard-delete", r.id);
      } else {
        appendActionButton(actionStack, "查看", "small secondary", "view", r.id);
        appendActionButton(actionStack, "编辑", "small", "edit", r.id);
        appendActionButton(actionStack, "删除", "small danger", "delete", r.id);
      }
    });
  }

  // 统计/图表：基于服务端“当前视图（全部筛选结果）”
  try {
    const stats = await loadStatsFromServer();
    updateStatsAndChartsFromStats(stats);
  } catch (e) {
    console.warn(e);
  }

  refreshMonthButtons();
  renderPagination(totalItems);
  syncBatchToolbar();
  applyColumnVisibility(document);
}

