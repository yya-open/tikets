function escapeDetailValue(value) {
  const v = String(value ?? "").trim();
  return v ? escapeHtml(v) : '<span class="ticket-detail-empty">未填写</span>';
}

function closeTicketDetailModal() {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  if (!overlay || !titleEl || !bodyEl || !footerEl) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  overlay.onclick = null;
  bodyEl.innerHTML = "";
  footerEl.innerHTML = "";
}

function onTicketDetailMaskClick(e) {
  const overlay = document.getElementById("modalOverlay");
  if (overlay && e && e.target === overlay) closeTicketDetailModal();
}

function renderTicketDetailHtml(record) {
  return `
    <div class="ticket-detail-meta">
      <span class="ticket-chip">ID：${escapeHtml(String(record.id || '-'))}</span>
      <span class="ticket-chip">类型：${escapeHtml(record.type || '未分类')}</span>
      <span class="ticket-chip">日期：${escapeHtml(record.date || '-')}</span>
    </div>
    <div class="ticket-detail-grid">
      <div class="ticket-detail-item"><div class="ticket-detail-label">问题</div><div class="ticket-detail-value">${escapeDetailValue(record.issue)}</div></div>
      <div class="ticket-detail-item"><div class="ticket-detail-label">部门</div><div class="ticket-detail-value">${escapeDetailValue(record.department)}</div></div>
      <div class="ticket-detail-item"><div class="ticket-detail-label">姓名</div><div class="ticket-detail-value">${escapeDetailValue(record.name)}</div></div>
      <div class="ticket-detail-item"><div class="ticket-detail-label">最后更新时间</div><div class="ticket-detail-value">${escapeDetailValue(formatISOToLocal(record.updated_at || ''))}</div></div>
      <div class="ticket-detail-item full"><div class="ticket-detail-label">处理方法</div><div class="ticket-detail-value">${escapeDetailValue(record.solution)}</div></div>
      <div class="ticket-detail-item full"><div class="ticket-detail-label">备注</div><div class="ticket-detail-value">${escapeDetailValue(record.remarks)}</div></div>
    </div>`;
}

function openTicketDetail(id) {
  const record = (window.TicketAppState.records || []).find(r => r.id === id);
  if (!record) return showToast("未找到该工单详情。", "warning");

  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");

  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    try {
      alert(`日期：${record.date || '-'}
类型：${record.type || '未分类'}
问题：${record.issue || '未填写'}
部门：${record.department || '未填写'}
姓名：${record.name || '未填写'}
处理方法：${record.solution || '未填写'}
备注：${record.remarks || '未填写'}`);
    } catch (e) {}
    return;
  }

  titleEl.textContent = '工单详情';
  bodyEl.innerHTML = renderTicketDetailHtml(record);
  footerEl.innerHTML = '';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'm-btn secondary';
  closeBtn.textContent = '关闭';
  closeBtn.onclick = closeTicketDetailModal;

  if (viewMode === 'trash') {
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'm-btn primary';
    restoreBtn.textContent = '恢复';
    restoreBtn.onclick = async function () {
      closeTicketDetailModal();
      await restoreRecord(record.id);
    };
    footerEl.appendChild(restoreBtn);
  } else {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'm-btn primary';
    editBtn.textContent = '编辑';
    editBtn.onclick = function () {
      closeTicketDetailModal();
      editRecord(record.id);
    };
    footerEl.appendChild(editBtn);
  }

  footerEl.appendChild(closeBtn);
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('show');
  overlay.onclick = function (e) { if (e.target === overlay) closeTicketDetailModal(); };
}

window.openTicketDetail = openTicketDetail;
window.closeTicketDetailModal = closeTicketDetailModal;
window.onTicketDetailMaskClick = onTicketDetailMaskClick;

function bindTableDetailInteractions() {
  const table = document.getElementById('recordTable');
  if (!table || table.dataset.detailBound === '1') return;
  table.dataset.detailBound = '1';

  table.addEventListener('click', function (e) {
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
        localStorage.setItem("ticket_view_year", activeYear || "");
        localStorage.setItem("ticket_view_month", activeMonth || "");
      } catch (e) {
        // ignore
      }
    }

    function loadViewState() {
      try {
        activeYear = localStorage.getItem("ticket_view_year") || "";
        activeMonth = localStorage.getItem("ticket_view_month") || "";
      } catch (e) {
        activeYear = "";
        activeMonth = "";
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
      const sp = new URLSearchParams();
      if (viewMode === "trash") sp.set("trash", "1");

      // 年/月视图 -> 转成日期范围
      let rangeFrom = "";
      let rangeTo = "";
      if (includeYearMonth && activeYear) {
        if (activeMonth) {
          const last = String(monthLastDay(activeYear, Number(activeMonth))).padStart(2, "0");
          rangeFrom = `${activeYear}-${activeMonth}-01`;
          rangeTo = `${activeYear}-${activeMonth}-${last}`;
        } else {
          rangeFrom = `${activeYear}-01-01`;
          rangeTo = `${activeYear}-12-31`;
        }
      }

      const fromInput = (document.getElementById("filterFrom")?.value || "").trim();
      const toInput = (document.getElementById("filterTo")?.value || "").trim();
      const type = (document.getElementById("filterType")?.value || "").trim();
      const q = (document.getElementById("filterKeyword")?.value || "").trim();

      const from = maxDate(rangeFrom, fromInput);
      const to = minDate(rangeTo, toInput);

      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      if (type) sp.set("type", type);
      if (q) sp.set("q", q);
      return sp;
    }

    function buildCursorKey() {
      // 游标分页需要在“筛选条件不变”时才可复用 cursor
      const sp = buildFilters({ includeYearMonth: true });
      sp.set("pageSize", String(pageSize));
      return sp.toString();
    }

    function buildStatsKey() {
      // stats 不包含分页参数
      return buildFilters({ includeYearMonth: true }).toString();
    }

    async function loadMetaFromServer() {
      // 仅用于：年/月可用性与总量展示（不受筛选影响）
      const sp = new URLSearchParams();
      if (viewMode === "trash") sp.set("trash", "1");
      const j = await window.TicketService.loadMeta(viewMode);
      metaMonthCounts = (j && j.month_counts) ? j.month_counts : {};
      metaTotalAll = Number(j?.total_all ?? 0) || 0;
    }

    async function loadPageFromServer() {
      const sp = buildFilters({ includeYearMonth: true });
      sp.set("page", String(currentPage));
      sp.set("pageSize", String(pageSize));

      // 游标分页：仅用于“上一页/下一页”顺序翻页。
      if (cursorNav && cursorNav.cursor) {
        sp.set("cursor", cursorNav.cursor);
        sp.set("direction", cursorNav.direction || "next");
      }

      const j = await window.TicketService.loadTickets(sp);

      const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
      records = normalizeRecords(arr);
      serverTotal = Number(j?.total ?? records.length) || 0;

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
    await reloadAndRender();
    showToast("已彻底删除。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("彻底删除失败：请检查网络或后端是否正常。", "error");
  }
}

    function clearFilters() {
      document.getElementById("filterFrom").value = "";
      document.getElementById("filterTo").value = "";
      document.getElementById("filterType").value = "";
      document.getElementById("filterKeyword").value = "";
      // 保留月份视图状态，仅清空高级筛选
      renderTable({ resetPage: true });
}

async function renderTable({ resetPage = true } = {}) {
  const tbody = document.getElementById("recordTable").querySelector("tbody");
  bindTableDetailInteractions();
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
    cell.colSpan = 8;
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
      row.ondblclick = function (e) {
        if (e && e.target && e.target.closest && e.target.closest('button')) return;
        openTicketDetail(Number(r.id));
      };
      row.insertCell(0).innerText = r.date;
      row.insertCell(1).innerText = r.issue;
      row.insertCell(2).innerText = r.department;
      row.insertCell(3).innerText = r.name;
      row.insertCell(4).innerText = r.solution;
      row.insertCell(5).innerText = r.remarks;
      row.insertCell(6).innerText = r.type;
      const actionCell = row.insertCell(7);

      if (viewMode === "trash") {
        const viewBtn = document.createElement("button");
        viewBtn.type = 'button';
        viewBtn.innerText = "查看";
        viewBtn.className = "small secondary";
        viewBtn.dataset.action = 'view';
        viewBtn.dataset.id = String(r.id);
        viewBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openTicketDetail(Number(r.id)); return false; };

        const restoreBtn = document.createElement("button");
        restoreBtn.type = 'button';
        restoreBtn.innerText = "恢复";
        restoreBtn.className = "small";
        restoreBtn.dataset.action = 'restore';
        restoreBtn.dataset.id = String(r.id);
        restoreBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); restoreRecord(Number(r.id)); };

        const hardBtn = document.createElement("button");
        hardBtn.type = 'button';
        hardBtn.innerText = "彻底删除";
        hardBtn.className = "small danger";
        hardBtn.dataset.action = 'hard-delete';
        hardBtn.dataset.id = String(r.id);
        hardBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); hardDeleteRecord(Number(r.id)); };

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
        viewBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openTicketDetail(Number(r.id)); return false; };

        const editBtn = document.createElement("button");
        editBtn.type = 'button';
        editBtn.innerText = "编辑";
        editBtn.className = "small";
        editBtn.dataset.action = 'edit';
        editBtn.dataset.id = String(r.id);
        editBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); editRecord(Number(r.id)); };

        const delBtn = document.createElement("button");
        delBtn.type = 'button';
        delBtn.innerText = "删除";
        delBtn.className = "small danger";
        delBtn.dataset.action = 'delete';
        delBtn.dataset.id = String(r.id);
        delBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); deleteRecord(Number(r.id)); };

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
}

function renderPagination(totalItems) {
  const el = document.getElementById("pagination");
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = clamp(currentPage, 1, totalPages);

  el.innerHTML = "";

  const info = document.createElement("div");
  info.className = "page-info";
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);
  info.textContent = `显示 ${start}-${end} / ${totalItems} 条`;

  const controls = document.createElement("div");
  controls.className = "page-controls";

  // 每页条数（上限 100）
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
  sizeSelect.onchange = () => {
    pageSize = Math.min(Number(sizeSelect.value) || 100, PAGE_SIZE_MAX);
    renderTable({ resetPage: true });
  };

  function mkBtn(text, { disabled = false, active = false, onClick } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (active) b.classList.add("active");
    b.disabled = disabled;
    if (onClick) b.onclick = onClick;
    return b;
  }

  const firstBtn = mkBtn("首页", {
    disabled: currentPage <= 1 || totalItems === 0,
    onClick: () => { cursorNav = null; currentPage = 1; renderTable({ resetPage: true }); }
  });
  const prevBtn = mkBtn("上一页", {
    disabled: currentPage <= 1 || totalItems === 0,
    onClick: () => {
      const c = pageCursorMap.get(currentPage);
      if (c && c.prev_cursor) {
        cursorNav = { cursor: c.prev_cursor, direction: "prev" };
      } else {
        cursorNav = null;
      }
      currentPage -= 1;
      renderTable({ resetPage: false });
    }
  });
  const nextBtn = mkBtn("下一页", {
    disabled: currentPage >= totalPages || totalItems === 0,
    onClick: () => {
      const c = pageCursorMap.get(currentPage);
      if (c && c.next_cursor) {
        cursorNav = { cursor: c.next_cursor, direction: "next" };
      } else {
        cursorNav = null;
      }
      currentPage += 1;
      renderTable({ resetPage: false });
    }
  });
  const lastBtn = mkBtn("末页", {
    disabled: currentPage >= totalPages || totalItems === 0,
    onClick: () => { cursorNav = null; currentPage = totalPages; renderTable({ resetPage: false }); }
  });

  // 页码按钮（最多显示 7 个）
  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - 3);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  startPage = Math.max(1, endPage - maxButtons + 1);

  // 组合 UI
  controls.appendChild(sizeLabel);
  controls.appendChild(sizeSelect);
  controls.appendChild(firstBtn);
  controls.appendChild(prevBtn);

  for (let p = startPage; p <= endPage; p++) {
    controls.appendChild(mkBtn(String(p), {
      active: p === currentPage,
      disabled: totalItems === 0,
      onClick: () => { cursorNav = null; currentPage = p; renderTable({ resetPage: false }); }
    }));
  }

  controls.appendChild(nextBtn);
  controls.appendChild(lastBtn);

  // 跳转
  const jump = document.createElement("input");
  jump.type = "number";
  jump.min = "1";
  jump.max = String(totalPages);
  jump.placeholder = "页码";
  jump.value = "";
  jump.onkeydown = (e) => {
    if (e.key === "Enter") {
      const p = clamp(Number(jump.value) || 1, 1, totalPages);
      cursorNav = null;
      currentPage = p;
      renderTable({ resetPage: false });
      jump.value = "";
    }
  };

  const jumpBtn = mkBtn("跳转", {
    disabled: totalItems === 0,
    onClick: () => {
      const p = clamp(Number(jump.value) || 1, 1, totalPages);
      cursorNav = null;
      currentPage = p;
      renderTable({ resetPage: false });
      jump.value = "";
    }
  });

  controls.appendChild(jump);
  controls.appendChild(jumpBtn);

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
      container.innerHTML = "";

      const year = activeYear;
      const monthsHasData = {};
      Object.keys(metaMonthCounts || {}).forEach(key => {
        const y = String(key).slice(0, 4);
        const m = String(key).slice(5, 7);
        if (!m) return;
        if (!year || y === year) monthsHasData[m] = true;
      });

      // 若当前月份在该年份下无数据，则自动回到“全部月份”
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

        const hasData = monthsHasData[m];
        if (!hasData) {
          btn.classList.add("disabled");
          btn.onclick = null;
        } else {
          btn.onclick = () => setActiveMonth(m);
        }
        if (activeMonth === m) {
          btn.classList.add("active");
        }
        container.appendChild(btn);
      }

      // 增加一个“全部月份”按钮
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "month-btn";
      allBtn.textContent = "全部月份";
      if (!activeMonth) {
        allBtn.classList.add("active");
      }
      allBtn.onclick = () => {
        activeMonth = "";
        saveViewState();
        renderTable();
      };
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

