var lastStatsKey = "";
var cachedStats = null;

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
  // 月份元数据用于导航，不受高级筛选条件影响。
  const j = await window.TicketService.loadMeta(viewMode);
  window.TicketAppState.metaMonthCounts = (j && j.month_counts) ? j.month_counts : {};
  window.TicketAppState.metaTotalAll = Number(j?.total_all ?? 0) || 0;
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
  window.TicketPageState.setRecords(normalizeRecords(arr));
  window.TicketAppState.serverTotal = Number(j?.total ?? records.length) || 0;
  window.TicketPageState.pruneSelectionToRecords();

  const p = Number(j?.page);
  const ps = Number(j?.pageSize);
  if (Number.isFinite(ps) && ps > 0) pageSize = Math.min(ps, PAGE_SIZE_MAX);
  if (Number.isFinite(p) && p > 0) currentPage = p;

  if (j && (j.next_cursor || j.prev_cursor)) {
    pageCursorMap.set(currentPage, {
      next_cursor: j.next_cursor || null,
      prev_cursor: j.prev_cursor || null,
    });
  }

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
  try {
    await loadMetaFromServer();
  } catch (e) {
    console.warn("loadMetaFromServer failed:", e);
    metaMonthCounts = {};
    window.TicketAppState.metaTotalAll = 0;
  }

  refreshYearOptions();
  await renderTable({ resetPage: true });

  if (showLoadedToast) {
    showToast(`已从云端加载（当前筛选）共 ${serverTotal} 条`, "success");
  }
}