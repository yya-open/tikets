// 列表导航：月份筛选、分页控件和通用页码边界处理。
// 保持为 classic script，让 ticket-table-view.js 的 renderPagination 可以继续直接调用 clamp。

var PAGE_SIZE_MAX = 100;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
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
  const endPage = Math.min(totalPages, startPage + maxButtons - 1);
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
  if (!yearSelect) return;
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
  activeYear = select ? select.value : "";
  activeMonth = "";
  saveViewState();
  renderTable();
}

function setActiveMonth(m) {
  if (activeMonth === m) {
    activeMonth = "";
  } else {
    activeMonth = m;
  }
  saveViewState();
  renderTable();
}

window.TicketListNavigation = {
  clamp,
  bindMonthViewInteractions,
  bindPaginationInteractions,
  renderPagination,
  refreshYearOptions,
  refreshMonthButtons,
  onYearChange,
  setActiveMonth,
};