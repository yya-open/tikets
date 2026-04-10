function escapeDetailValue(value) {
  const v = String(value ?? "").trim();
  return v ? escapeHtml(v) : '<span class="ticket-detail-empty">未填写</span>';
}

function closeTicketDetailModal() {
  const overlay = document.getElementById('ticketDetailModal');
  const bodyEl = document.getElementById('ticketDetailBody');
  const footerEl = document.getElementById('ticketDetailActions');
  if (!overlay || !bodyEl || !footerEl) return;
  overlay.classList.remove('show');
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';
}

function onTicketDetailMaskClick(e) {
  const overlay = document.getElementById('ticketDetailModal');
  if (overlay && e && e.target === overlay) closeTicketDetailModal();
}

function renderTicketDetailHtml(record) {
  const isTrash = window.TicketAppState.viewMode === 'trash' || Number(record.is_deleted || 0) === 1;
  return `
    <div class="ticket-detail-meta">
      <span class="ticket-chip">ID：${escapeHtml(String(record.id || '-'))}</span>
      <span class="ticket-chip ${isTrash ? 'ticket-detail-status-trash' : 'ticket-detail-status-active'}">${isTrash ? '回收站' : '正常工单'}</span>
      <span class="ticket-chip">类型：${escapeHtml(record.type || '未分类')}</span>
      <span class="ticket-chip">日期：${escapeHtml(record.date || '-')}</span>
    </div>
    <div class="ticket-detail-highlight">
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">部门</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.department)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">姓名</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.name)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">最后更新时间</div><div class="ticket-detail-stat-value">${escapeDetailValue(formatISOToLocal(record.updated_at || ''))}</div></div>
    </div>
    <div class="ticket-detail-sections">
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">问题描述</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.issue)}</div></div>
      </section>
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">处理记录</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.solution)}</div></div>
      </section>
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">补充备注</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.remarks)}</div></div>
      </section>
    </div>`;
}

function openTicketDetail(id) {
  const record = (window.TicketAppState.records || []).find(r => r.id === id);
  if (!record) return showToast('未找到该工单详情。', 'warning');

  const overlay = document.getElementById('ticketDetailModal');
  const bodyEl = document.getElementById('ticketDetailBody');
  const footerEl = document.getElementById('ticketDetailActions');
  if (!overlay || !bodyEl || !footerEl) {
    try { alert(`日期：${record.date || '-'}
类型：${record.type || '未分类'}
问题：${record.issue || '未填写'}`); } catch (e) {}
    return;
  }

  bodyEl.innerHTML = renderTicketDetailHtml(record);
  footerEl.innerHTML = '';

  function makeFooterButton(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  if (window.TicketAppState.viewMode === 'trash') {
    footerEl.appendChild(makeFooterButton('恢复', 'primary', async function () {
      closeTicketDetailModal();
      await restoreRecord(record.id);
    }));
    footerEl.appendChild(makeFooterButton('彻底删除', 'danger', async function () {
      closeTicketDetailModal();
      await hardDeleteRecord(record.id);
    }));
  } else {
    footerEl.appendChild(makeFooterButton('编辑', 'primary', function () {
      closeTicketDetailModal();
      editRecord(record.id);
    }));
    footerEl.appendChild(makeFooterButton('删除', 'danger', async function () {
      closeTicketDetailModal();
      await deleteRecord(record.id);
    }));
  }
  footerEl.appendChild(makeFooterButton('关闭', 'secondary', closeTicketDetailModal));
  overlay.classList.add('show');
}

window.openTicketDetail = openTicketDetail;
window.closeTicketDetailModal = closeTicketDetailModal;
window.onTicketDetailMaskClick = onTicketDetailMaskClick;

function bindTableDetailInteractions() {
  const table = document.getElementById('recordTable');
  if (!table || table.dataset.detailBound === '1') return;
  table.dataset.detailBound = '1';

  table.addEventListener('click', function (e) {
    const checkbox = e.target && e.target.closest ? e.target.closest('input.row-select[type="checkbox"]') : null;
    if (checkbox) {
      const id = Number(checkbox.getAttribute('data-id'));
      if (Number.isFinite(id)) {
        if (checkbox.checked) selectedTicketIds.add(id);
        else selectedTicketIds.delete(id);
        const row = checkbox.closest('tr');
        if (row) row.classList.toggle('row-selected', checkbox.checked);
        syncBatchToolbar();
      }
      return;
    }
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

function bindMonthViewInteractions() {
  const container = document.getElementById('monthButtons');
  if (!container || container.dataset.bound === '1') return;
  container.dataset.bound = '1';
  container.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-month-action]') : null;
    if (!btn || btn.disabled || btn.classList.contains('disabled')) return;
    const action = btn.getAttribute('data-month-action');
    if (action === 'all') {
      activeMonth = '';
      saveViewState();
      renderTable({ resetPage: true });
      return;
    }
    if (action === 'set') {
      const month = btn.getAttribute('data-month');
      if (!month) return;
      setActiveMonth(month);
    }
  });
}

function bindPaginationInteractions() {
  const root = document.getElementById('pagination');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  root.addEventListener('change', function (e) {
    const select = e.target && e.target.closest ? e.target.closest('select.page-size') : null;
    if (!select) return;
    pageSize = Math.min(Number(select.value) || 100, PAGE_SIZE_MAX);
    renderTable({ resetPage: true });
  });

  root.addEventListener('keydown', function (e) {
    const input = e.target && e.target.closest ? e.target.closest('input.page-jump') : null;
    if (!input || e.key !== 'Enter') return;
    const totalItems = Number(root.getAttribute('data-total-items') || 0) || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const p = clamp(Number(input.value) || 1, 1, totalPages);
    cursorNav = null;
    currentPage = p;
    renderTable({ resetPage: false });
    input.value = '';
  });

  root.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-page-action]') : null;
    if (!btn || btn.disabled) return;
    const action = btn.getAttribute('data-page-action');
    const totalItems = Number(root.getAttribute('data-total-items') || 0) || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (action === 'first') {
      cursorNav = null;
      currentPage = 1;
      return renderTable({ resetPage: true });
    }
    if (action === 'prev') {
      const c = pageCursorMap.get(currentPage);
      cursorNav = c && c.prev_cursor ? { cursor: c.prev_cursor, direction: 'prev' } : null;
      currentPage = Math.max(1, currentPage - 1);
      return renderTable({ resetPage: false });
    }
    if (action === 'next') {
      const c = pageCursorMap.get(currentPage);
      cursorNav = c && c.next_cursor ? { cursor: c.next_cursor, direction: 'next' } : null;
      currentPage = Math.min(totalPages, currentPage + 1);
      return renderTable({ resetPage: false });
    }
    if (action === 'last') {
      cursorNav = null;
      currentPage = totalPages;
      return renderTable({ resetPage: false });
    }
    if (action === 'goto') {
      const page = clamp(Number(btn.getAttribute('data-page') || 1), 1, totalPages);
      cursorNav = null;
      currentPage = page;
      return renderTable({ resetPage: false });
    }
    if (action === 'jump') {
      const input = root.querySelector('input.page-jump');
      const p = clamp(Number(input && input.value || 1), 1, totalPages);
      cursorNav = null;
      currentPage = p;
      renderTable({ resetPage: false });
      if (input) input.value = '';
    }
  });
}

var activeYear = ""; // 当前选择的年份（字符串，如 "2025"）
    let activeMonth = ""; // 当前选择的月份（字符串，"01" ~ "12"）

    var typePieChart = null;
    var monthBarChart = null;


// ===== 分页配置（每页最多 100 条）=====
var PAGE_SIZE_MAX = 100;
var pageSize = 100;     // 可选更小，但上限 100
var currentPage = 1;

// ===== Keyset 游标分页（用于“上一页/下一页”更快；页码跳转仍走 OFFSET） =====
var cursorNav = null; // { cursor: string, direction: 'next'|'prev' }
var cursorKey = "";   // 当前筛选 + viewMode + pageSize
var pageCursorMap = new Map(); // page -> { next_cursor, prev_cursor }
var selectedTicketIds = new Set();

// ===== 服务端分页（大数据量） =====
var serverTotal = 0;          // 当前筛选下的总条数（用于分页 UI）
var metaMonthCounts = {};     // 用于年份/月份按钮的“全量月份分布”（不受筛选影响，仅区分工单/回收站）
var metaTotalAll = 0;         // 当前模式（工单/回收站）的总条数（不受筛选影响）
var lastStatsKey = "";
var cachedStats = null;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

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
            records = normalizeRecords(data);
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
    function monthLastDay(year, month) {
      // month: 1-12
      const y = Number(year);
      const m = Number(month);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
      // JS: day 0 of next month = last day of current month
      return new Date(y, m, 0).getDate();
    }

    function maxDate(a, b) {
      if (!a) return b || "";
      if (!b) return a || "";
      return a >= b ? a : b; // YYYY-MM-DD lexicographic works
    }

    function minDate(a, b) {
      if (!a) return b || "";
      if (!b) return a || "";
      return a <= b ? a : b;
    }

    function buildFilters({ includeYearMonth = true } = {}) {
      if (window.TicketQueryRuntime && typeof window.TicketQueryRuntime.buildSnapshot === 'function') {
        return window.TicketQueryRuntime.buildSnapshot({
          includeYearMonth,
          viewMode: window.TicketAppState.viewMode,
          page: currentPage,
          pageSize,
        }).statsParams;
      }
      if (window.TicketQueryState && typeof window.TicketQueryState.buildSearchParams === 'function') {
        return window.TicketQueryState.buildSearchParams({ includeYearMonth, viewMode: window.TicketAppState.viewMode });
      }
      return new URLSearchParams();
    }

    function buildCursorKey() {
      const runtime = window.TicketQueryRuntime;
      if (runtime && typeof runtime.buildSnapshot === 'function') {
        const snapshot = runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode, page: currentPage, pageSize });
        return snapshot.statsKey + `&pageSize=${pageSize}`;
      }
      const sp = buildFilters({ includeYearMonth: true });
      sp.set("pageSize", String(pageSize));
      return sp.toString();
    }

    function buildStatsKey() {
      const runtime = window.TicketQueryRuntime;
      if (runtime && typeof runtime.buildSnapshot === 'function') {
        return runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode, page: currentPage, pageSize }).statsKey;
      }
      return buildFilters({ includeYearMonth: true }).toString();
    }

    async function loadMetaFromServer() {
      // 仅用于：年/月可用性与总量展示（不受筛选影响）
      const sp = new URLSearchParams();
      if (viewMode === "trash") sp.set("trash", "1");
      const j = await window.TicketService.loadMeta(viewMode);
      metaMonthCounts = (j && j.month_counts) ? j.month_counts : {};
      metaTotalAll = Number(j?.total_all ?? 0) || 0;
      window.TicketAppState.metaMonthCounts = metaMonthCounts;
      window.TicketAppState.metaTotalAll = metaTotalAll;
    }

    async function loadPageFromServer() {
      const runtime = window.TicketQueryRuntime;
      const snapshot = runtime && typeof runtime.buildSnapshot === 'function'
        ? runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode, page: currentPage, pageSize })
        : null;

      const j = snapshot
        ? await runtime.fetchPage(snapshot, cursorNav && cursorNav.cursor ? { cursor: cursorNav.cursor, direction: cursorNav.direction || 'next' } : {})
        : await window.TicketService.loadTickets(buildFilters({ includeYearMonth: true }));

      const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
      records = normalizeRecords(arr);
      serverTotal = Number(j?.total ?? records.length) || 0;
      window.TicketAppState.records = records;
      window.TicketAppState.serverTotal = serverTotal;
      const currentIds = new Set(records.map((r) => Number(r.id)).filter(Number.isFinite));
      selectedTicketIds = new Set(Array.from(selectedTicketIds).filter((id) => currentIds.has(id)));

      // 兼容后端回传 page/pageSize
      const p = Number(j?.page);
      const ps = Number(j?.pageSize);
      if (Number.isFinite(ps) && ps > 0) pageSize = Math.min(ps, PAGE_SIZE_MAX);
      if (Number.isFinite(p) && p > 0) currentPage = p;

      // 记录本页游标，用于更快的 prev/next
      if (j && (j.next_cursor || j.prev_cursor)) {
        pageCursorMap.set(currentPage, {
          next_cursor: j.next_cursor || null,
          prev_cursor: j.prev_cursor || null,
        });
      }

      // 本次游标导航只生效一次
      cursorNav = null;
    }

    async function loadStatsFromServer() {
      const runtime = window.TicketQueryRuntime;
      if (runtime && typeof runtime.buildSnapshot === 'function') {
        const snapshot = runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode, page: currentPage, pageSize });
        return await runtime.fetchStats(snapshot);
      }
      const key = buildStatsKey();
      if (key && key === lastStatsKey && cachedStats) return cachedStats;
      lastStatsKey = key;
      const sp = buildFilters({ includeYearMonth: true });
      cachedStats = await window.TicketService.loadStats(sp);
      return cachedStats;
    }

    async function reloadAndRender({ showLoadedToast = false } = {}) {
      // 1) meta（用于年份/月按钮）
      try {
        await loadMetaFromServer();
      } catch (e) {
        console.warn("loadMetaFromServer failed:", e);
        // meta 失败不阻断主流程
        metaMonthCounts = {};
        metaTotalAll = 0;
      }

      refreshYearOptions();
      await renderTable({ resetPage: true });

      if (showLoadedToast) {
        showToast(`已从云端加载（当前筛选）共 ${serverTotal} 条`, "success");
      }
    }

function getSelectedRecords() {
  return (window.TicketAppState.records || []).filter((r) => selectedTicketIds.has(Number(r.id)));
}

function syncBatchToolbar() {
  const allHead = document.getElementById('selectAllRowsHead');
  const allTop = document.getElementById('selectAllRows');
  const currentIds = (window.TicketAppState.records || []).map((r) => Number(r.id)).filter(Number.isFinite);
  const selectable = currentIds.length;
  const selectedOnPage = currentIds.filter((id) => selectedTicketIds.has(id)).length;
  const summary = document.getElementById('batchSummary');
  if (summary) summary.textContent = selectedOnPage ? `本页已选择 ${selectedOnPage} 条记录` : '未选择记录';
  [allHead, allTop].forEach((el) => {
    if (!el) return;
    el.checked = selectable > 0 && selectedOnPage === selectable;
    el.indeterminate = selectedOnPage > 0 && selectedOnPage < selectable;
  });
  const mode = window.TicketAppState.viewMode || 'active';
  const btnDelete = document.getElementById('btnBatchDelete');
  const btnRestore = document.getElementById('btnBatchRestore');
  const btnHardDelete = document.getElementById('btnBatchHardDelete');
  if (btnDelete) btnDelete.style.display = mode === 'trash' ? 'none' : '';
  if (btnRestore) btnRestore.style.display = mode === 'trash' ? '' : 'none';
  if (btnHardDelete) btnHardDelete.style.display = mode === 'trash' ? '' : 'none';
}

function toggleSelectAllOnPage(checked) {
  (window.TicketAppState.records || []).forEach((r) => {
    const id = Number(r.id);
    if (!Number.isFinite(id)) return;
    if (checked) selectedTicketIds.add(id);
    else selectedTicketIds.delete(id);
  });
  const tbody = document.querySelector('#recordTable tbody');
  if (tbody) {
    tbody.querySelectorAll('input.row-select[type="checkbox"]').forEach((input) => {
      input.checked = !!checked;
      const row = input.closest('tr');
      if (row) row.classList.toggle('row-selected', !!checked);
    });
  }
  syncBatchToolbar();
}

async function runBatchAction(action) {
  const selected = getSelectedRecords();
  if (!selected.length) return showToast('请先选择要批量处理的工单。', 'warning');
  if (action === 'export-json') return window.exportSelectedJson && window.exportSelectedJson(selected);
  if (action === 'export-excel') return window.exportSelectedExcel && window.exportSelectedExcel(selected);

  const count = selected.length;
  const configMap = {
    delete: { title: '批量删除', message: `确认将选中的 ${count} 条工单移入回收站吗？`, ok: '批量删除', handler: (id) => window.TicketService.deleteTicket(id) },
    restore: { title: '批量恢复', message: `确认恢复选中的 ${count} 条工单吗？`, ok: '批量恢复', handler: (id) => window.TicketService.restoreTicket(id) },
    'hard-delete': { title: '批量彻底删除', message: `确认彻底删除选中的 ${count} 条工单吗？

此操作不可恢复。`, ok: '批量彻底删除', handler: (id) => window.TicketService.hardDeleteTicket(id) },
  };
  const cfg = configMap[action];
  if (!cfg) return;
  const ok = await showConfirm({ title: cfg.title, message: cfg.message, confirmText: cfg.ok, cancelText: '取消', danger: true });
  if (!ok) return;

  let success = 0;
  for (const item of selected) {
    try {
      await cfg.handler(item.id);
      success += 1;
      selectedTicketIds.delete(Number(item.id));
    } catch (e) {
      if (isNoKeyError(e)) return;
      console.error(e);
    }
  }
  window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
  await reloadAndRender();
  showToast(`${cfg.title}完成：成功 ${success} / ${count} 条。`, success === count ? 'success' : 'warning');
}

function bindBatchToolbarInteractions() {
  const toolbar = document.getElementById('batchToolbar');
  if (!toolbar || toolbar.dataset.bound === '1') {
    syncBatchToolbar();
    return;
  }
  toolbar.dataset.bound = '1';
  toolbar.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[id]') : null;
    if (!btn) return;
    const id = btn.id;
    if (id === 'btnBatchExportJson') return runBatchAction('export-json');
    if (id === 'btnBatchExportExcel') return runBatchAction('export-excel');
    if (id === 'btnBatchDelete') return runBatchAction('delete');
    if (id === 'btnBatchRestore') return runBatchAction('restore');
    if (id === 'btnBatchHardDelete') return runBatchAction('hard-delete');
  });
  const allHead = document.getElementById('selectAllRowsHead');
  const allTop = document.getElementById('selectAllRows');
  [allHead, allTop].forEach((el) => {
    if (!el) return;
    el.addEventListener('change', function () {
      toggleSelectAllOnPage(!!el.checked);
    });
  });
  syncBatchToolbar();
}

async function deleteRecord(id) {
  const ok = await showConfirm({
    title: "确认删除",
    message: "确认将这条工单移入回收站吗？\n\n你可以在【回收站】中恢复。",
    confirmText: "移入回收站",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;

  try {
    await window.TicketService.deleteTicket(id);

    if (editingId === id) resetForm();
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已移入回收站。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("删除失败：请检查网络或后端是否正常。", "error");
  }
}

async function restoreRecord(id) {
  const ok = await showConfirm({
    title: "恢复工单",
    message: "确认从回收站恢复这条工单吗？",
    confirmText: "恢复",
    cancelText: "取消",
    danger: false
  });
  if (!ok) return;
  try {
    await window.TicketService.restoreTicket(id);
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已恢复该工单。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("恢复失败：请检查网络或后端是否正常。", "error");
  }
}

async function hardDeleteRecord(id) {
  const ok = await showConfirm({
    title: "彻底删除",
    message: "确认【彻底删除】这条记录吗？\n\n此操作不可恢复。",
    confirmText: "彻底删除",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;
  try {
    await window.TicketService.hardDeleteTicket(id);
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已彻底删除。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("彻底删除失败：请检查网络或后端是否正常。", "error");
  }
}

    function clearFilters() {
      ["filterFrom", "filterTo", "filterType", "filterDepartment", "filterName", "filterKeyword", "filterStatus"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
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
    await loadPageFromServer();
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
    cell.colSpan = 9;
    cell.style.textAlign = "center";
    cell.style.color = "#999";
    cell.style.padding = "14px 8px";
    cell.innerText = viewMode === "trash" ? "回收站暂无记录" : "暂无工单记录";
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
      row.insertCell(1).innerText = r.date;
      row.insertCell(2).innerText = r.issue;
      row.insertCell(3).innerText = r.department;
      row.insertCell(4).innerText = r.name;
      row.insertCell(5).innerText = r.solution;
      row.insertCell(6).innerText = r.remarks;
      row.insertCell(7).innerText = r.type;
      const actionCell = row.insertCell(8);

      if (viewMode === "trash") {
        const viewBtn = document.createElement("button");
        viewBtn.type = 'button';
        viewBtn.innerText = "查看";
        viewBtn.className = "small secondary";
        viewBtn.dataset.action = 'view';
        viewBtn.dataset.id = String(r.id);

        const restoreBtn = document.createElement("button");
        restoreBtn.type = 'button';
        restoreBtn.innerText = "恢复";
        restoreBtn.className = "small";
        restoreBtn.dataset.action = 'restore';
        restoreBtn.dataset.id = String(r.id);

        const hardBtn = document.createElement("button");
        hardBtn.type = 'button';
        hardBtn.innerText = "彻底删除";
        hardBtn.className = "small danger";
        hardBtn.dataset.action = 'hard-delete';
        hardBtn.dataset.id = String(r.id);

        actionCell.appendChild(viewBtn);
        actionCell.appendChild(restoreBtn);
        actionCell.appendChild(hardBtn);
      } else {
        const viewBtn = document.createElement("button");
        viewBtn.type = 'button';
        viewBtn.innerText = "查看";
        viewBtn.className = "small secondary";
        viewBtn.dataset.action = 'view';
        viewBtn.dataset.id = String(r.id);

        const editBtn = document.createElement("button");
        editBtn.type = 'button';
        editBtn.innerText = "编辑";
        editBtn.className = "small";
        editBtn.dataset.action = 'edit';
        editBtn.dataset.id = String(r.id);

        const delBtn = document.createElement("button");
        delBtn.type = 'button';
        delBtn.innerText = "删除";
        delBtn.className = "small danger";
        delBtn.dataset.action = 'delete';
        delBtn.dataset.id = String(r.id);

        actionCell.appendChild(viewBtn);
        actionCell.appendChild(editBtn);
        actionCell.appendChild(delBtn);
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
}

function renderPagination(totalItems) {
  const el = document.getElementById("pagination");
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = clamp(currentPage, 1, totalPages);
  el.setAttribute('data-total-items', String(totalItems || 0));

  el.innerHTML = "";

  const info = document.createElement("div");
  info.className = "page-info";
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);
  info.textContent = `显示 ${start}-${end} / ${totalItems} 条`;

  const controls = document.createElement("div");
  controls.className = "page-controls";

  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "每页：";
  const sizeSelect = document.createElement("select");
  sizeSelect.className = "page-size";
  [20, 50, 100].forEach(n => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} 条`;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.value = String(pageSize);

  function mkBtn(text, { disabled = false, active = false, pageAction = '', page = '' } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (active) b.classList.add("active");
    b.disabled = disabled;
    if (pageAction) b.setAttribute('data-page-action', pageAction);
    if (page !== '' && page !== undefined && page !== null) b.setAttribute('data-page', String(page));
    return b;
  }

  controls.appendChild(sizeLabel);
  controls.appendChild(sizeSelect);
  controls.appendChild(mkBtn("首页", { disabled: currentPage <= 1 || totalItems === 0, pageAction: 'first' }));
  controls.appendChild(mkBtn("上一页", { disabled: currentPage <= 1 || totalItems === 0, pageAction: 'prev' }));

  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - 3);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  startPage = Math.max(1, endPage - maxButtons + 1);

  for (let p = startPage; p <= endPage; p++) {
    controls.appendChild(mkBtn(String(p), {
      active: p === currentPage,
      disabled: totalItems === 0,
      pageAction: 'goto',
      page: p,
    }));
  }

  controls.appendChild(mkBtn("下一页", { disabled: currentPage >= totalPages || totalItems === 0, pageAction: 'next' }));
  controls.appendChild(mkBtn("末页", { disabled: currentPage >= totalPages || totalItems === 0, pageAction: 'last' }));

  const jump = document.createElement("input");
  jump.type = "number";
  jump.min = "1";
  jump.max = String(totalPages);
  jump.placeholder = "页码";
  jump.value = "";
  jump.className = 'page-jump';

  controls.appendChild(jump);
  controls.appendChild(mkBtn("跳转", { disabled: totalItems === 0, pageAction: 'jump' }));

  el.appendChild(info);
  el.appendChild(controls);
}

function refreshYearOptions() {
      const yearSelect = document.getElementById("yearSelect");
      const oldValue = activeYear;
      const years = Array.from(
        new Set(
          Object.keys(metaMonthCounts || {})
            .map(k => String(k).slice(0, 4))
            .filter(Boolean)
        )
      ).sort();
      yearSelect.innerHTML = '<option value="">全部年份</option>';
      years.forEach(y => {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
      });
      if (oldValue && years.includes(oldValue)) {
        activeYear = oldValue;
        yearSelect.value = oldValue;
      } else {
        activeYear = "";
        yearSelect.value = "";
        activeMonth = "";
      }
      refreshMonthButtons();
    }

    function refreshMonthButtons() {
      const container = document.getElementById("monthButtons");
      if (!container) return;
      container.innerHTML = "";

      const year = activeYear;
      const monthsHasData = {};
      Object.keys(metaMonthCounts || {}).forEach(key => {
        const y = String(key).slice(0, 4);
        const m = String(key).slice(5, 7);
        if (!m) return;
        if (!year || y === year) monthsHasData[m] = true;
      });

      if (activeMonth && !monthsHasData[activeMonth]) {
        activeMonth = "";
        saveViewState();
      }

      for (let i = 1; i <= 12; i++) {
        const m = String(i).padStart(2, "0");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "month-btn";
        btn.textContent = i + "月";
        btn.setAttribute('data-month-action', 'set');
        btn.setAttribute('data-month', m);

        const hasData = monthsHasData[m];
        if (!hasData) {
          btn.classList.add("disabled");
          btn.disabled = true;
        }
        if (activeMonth === m) {
          btn.classList.add("active");
        }
        container.appendChild(btn);
      }

      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "month-btn";
      allBtn.textContent = "全部月份";
      allBtn.setAttribute('data-month-action', 'all');
      if (!activeMonth) {
        allBtn.classList.add("active");
      }
      container.appendChild(allBtn);
    }

    function onYearChange() {
      const select = document.getElementById("yearSelect");
      activeYear = select.value;
      activeMonth = ""; // 切换年份时重置月份
      saveViewState();
      renderTable();
    }

    function setActiveMonth(m) {
      if (activeMonth === m) {
        activeMonth = ""; // 再次点击可取消
      } else {
        activeMonth = m;
      }
      saveViewState();
      renderTable();
    }


window.runBatchAction = runBatchAction;
