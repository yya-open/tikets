(function () {
  const runtime = {
    statsCache: new Map(),
  };

  function toSearchParams(input) {
    if (input instanceof URLSearchParams) return new URLSearchParams(input);
    const sp = new URLSearchParams();
    Object.entries(input || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
    });
    return sp;
  }

  function buildSnapshot(extra = {}) {
    const viewMode = extra.viewMode || window.TicketAppState?.viewMode || 'active';
    const includeYearMonth = extra.includeYearMonth !== false;
    const pageSize = Number(extra.pageSize || window.TicketAppState?.pageSize || 100) || 100;
    const page = Number(extra.page || window.TicketAppState?.currentPage || 1) || 1;
    const baseParams = window.TicketQueryState && typeof window.TicketQueryState.buildSearchParams === 'function'
      ? window.TicketQueryState.buildSearchParams({ includeYearMonth, viewMode })
      : new URLSearchParams();

    const filters = window.TicketQueryState && typeof window.TicketQueryState.readFilters === 'function'
      ? window.TicketQueryState.readFilters({ includeYearMonth, viewMode })
      : {};

    const statsParams = new URLSearchParams(baseParams);
    const pageParams = new URLSearchParams(baseParams);
    pageParams.set('page', String(page));
    pageParams.set('pageSize', String(pageSize));

    return {
      viewMode,
      includeYearMonth,
      page,
      pageSize,
      filters,
      statsParams,
      pageParams,
      statsKey: statsParams.toString(),
      pageKey: pageParams.toString(),
    };
  }

  async function fetchStats(snapshotInput) {
    const snapshot = snapshotInput && snapshotInput.statsParams ? snapshotInput : buildSnapshot(snapshotInput || {});
    const cacheKey = snapshot.statsKey;
    if (cacheKey && runtime.statsCache.has(cacheKey)) return runtime.statsCache.get(cacheKey);
    const promise = window.TicketService.loadStats(snapshot.statsParams).catch((err) => {
      runtime.statsCache.delete(cacheKey);
      throw err;
    });
    if (cacheKey) runtime.statsCache.set(cacheKey, promise);
    return promise;
  }

  function invalidateStatsCache() {
    runtime.statsCache.clear();
  }

  async function fetchPage(snapshotInput, options = {}) {
    const snapshot = snapshotInput && snapshotInput.pageParams ? snapshotInput : buildSnapshot(snapshotInput || {});
    const pageParams = new URLSearchParams(snapshot.pageParams);
    if (options.cursor) pageParams.set('cursor', options.cursor);
    if (options.direction) pageParams.set('direction', options.direction);
    return await window.TicketService.loadTickets(pageParams);
  }

  async function fetchAll(snapshotInput, options = {}) {
    const snapshot = snapshotInput && snapshotInput.statsParams ? snapshotInput : buildSnapshot(snapshotInput || {});
    const stats = options.stats || await fetchStats(snapshot);
    const total = Number(stats?.total_filtered ?? stats?.total_all ?? 0) || 0;
    if (total <= 0) return [];

    const pageSize = Math.min(Number(options.pageSize || snapshot.pageSize || 100) || 100, 100);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const all = [];
    for (let page = 1; page <= pages; page++) {
      const pageSnapshot = buildSnapshot({
        viewMode: snapshot.viewMode,
        includeYearMonth: snapshot.includeYearMonth,
        page,
        pageSize,
      });
      const data = await fetchPage(pageSnapshot);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      all.push(...(window.normalizeRecords ? window.normalizeRecords(arr) : arr));
    }
    return all;
  }

  function getCurrentQuerySummary() {
    return window.TicketQueryState && typeof window.TicketQueryState.getFilterSummary === 'function'
      ? window.TicketQueryState.getFilterSummary()
      : {};
  }

  window.TicketQueryRuntime = {
    buildSnapshot,
    fetchStats,
    fetchPage,
    fetchAll,
    getCurrentQuerySummary,
    invalidateStatsCache,
    toSearchParams,
  };
})();
