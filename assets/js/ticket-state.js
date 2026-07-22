var editingId = null;
var editingUpdatedAt = ""; // legacy concurrency token from server
var editingUpdatedAtTs = 0; // preferred concurrency token (ms timestamp)

window.__TicketPageStateDraft = window.__TicketPageStateDraft || {
  records: [],
  nextId: 1,
  activeYear: "",
  activeMonth: "",
  serverTotal: 0,
  metaMonthCounts: {},
  metaTotalAll: 0,
  pageSize: (window.TicketConfig && window.TicketConfig.defaults && window.TicketConfig.defaults.pageSize) || 100,
  currentPage: 1,
};

function getPageStateValue(key) {
  if (window.TicketPageState && typeof window.TicketPageState.get === "function") return window.TicketPageState.get(key);
  return window.__TicketPageStateDraft[key];
}

function setPageStateValue(key, value) {
  if (window.TicketPageState && typeof window.TicketPageState.set === "function") {
    window.TicketPageState.set(key, value);
    return;
  }
  window.__TicketPageStateDraft[key] = value;
}

window.TicketAppState = window.TicketAppState || {};
Object.defineProperties(window.TicketAppState, {
  records: { get: () => getPageStateValue("records"), set: (v) => { setPageStateValue("records", Array.isArray(v) ? v : []); } },
  editingId: { get: () => editingId, set: (v) => { editingId = v; } },
  editingUpdatedAt: { get: () => editingUpdatedAt, set: (v) => { editingUpdatedAt = v || ""; } },
  editingUpdatedAtTs: { get: () => editingUpdatedAtTs, set: (v) => { editingUpdatedAtTs = Number(v || 0) || 0; } },
  nextId: { get: () => getPageStateValue("nextId"), set: (v) => { setPageStateValue("nextId", Number(v || 1) || 1); } },
  viewMode: { get: () => viewMode, set: (v) => { viewMode = (v === "trash") ? "trash" : "active"; } },
  activeYear: { get: () => getPageStateValue("activeYear"), set: (v) => { setPageStateValue("activeYear", String(v || "").trim()); } },
  activeMonth: { get: () => getPageStateValue("activeMonth"), set: (v) => { setPageStateValue("activeMonth", String(v || "").trim()); } },
  serverTotal: { get: () => getPageStateValue("serverTotal"), set: (v) => { setPageStateValue("serverTotal", Number(v || 0) || 0); } },
  metaMonthCounts: { get: () => getPageStateValue("metaMonthCounts"), set: (v) => { setPageStateValue("metaMonthCounts", v && typeof v === "object" ? v : {}); } },
  metaTotalAll: { get: () => getPageStateValue("metaTotalAll"), set: (v) => { setPageStateValue("metaTotalAll", Number(v || 0) || 0); } },
  pageSize: {
    get: () => getPageStateValue("pageSize"),
    set: (v) => {
      const fallback = (window.TicketConfig && window.TicketConfig.defaults && window.TicketConfig.defaults.pageSize) || 100;
      setPageStateValue("pageSize", Number(v || fallback) || fallback);
    }
  },
  currentPage: { get: () => getPageStateValue("currentPage"), set: (v) => { setPageStateValue("currentPage", Number(v || 1) || 1); } }
});

window.TicketQueryState = window.TicketQueryState || {
  readFilters(extra = {}) {
    const viewMode = extra.viewMode || window.TicketAppState.viewMode || 'active';
    const form = window.TicketFilters && typeof window.TicketFilters.read === 'function'
      ? window.TicketFilters.read({ viewMode })
      : {};

    const year = String(window.TicketAppState.activeYear || '').trim();
    const month = String(window.TicketAppState.activeMonth || '').trim();
    let rangeFrom = '';
    let rangeTo = '';

    if (extra.includeYearMonth !== false && year) {
      if (month) {
        const y = Number(year);
        const m = Number(month);
        const lastDay = Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12
          ? new Date(y, m, 0).getDate()
          : 31;
        rangeFrom = `${year}-${month}-01`;
        rangeTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      } else {
        rangeFrom = `${year}-01-01`;
        rangeTo = `${year}-12-31`;
      }
    }

    const maxDate = (a, b) => {
      if (!a) return b || '';
      if (!b) return a || '';
      return a >= b ? a : b;
    };
    const minDate = (a, b) => {
      if (!a) return b || '';
      if (!b) return a || '';
      return a <= b ? a : b;
    };

    const from = maxDate(rangeFrom, form.from || '');
    const to = minDate(rangeTo, form.to || '');

    return {
      ...form,
      from,
      to,
      year,
      month,
    };
  },

  buildSearchParams(extra = {}) {
    const filters = this.readFilters(extra);
    const { year, month, ...queryFilters } = filters;
    const sp = new URLSearchParams();
    if (window.TicketFilters && typeof window.TicketFilters.applyToSearchParams === 'function') {
      window.TicketFilters.applyToSearchParams(sp, queryFilters);
    } else {
      Object.entries(queryFilters || {}).forEach(([k, val]) => { if (val) sp.set(k, val); });
    }
    return sp;
  },

  getFilterSummary() {
    const filters = this.readFilters({ includeYearMonth: true });
    return {
      year: filters.year || '',
      month: filters.month || '',
      from: filters.from || '',
      to: filters.to || '',
      type: filters.type || '',
      department: filters.department || '',
      name: filters.name || '',
      keyword: filters.q || '',
      ticketStatus: filters.ticketStatus || '',
      assignee: filters.assignee || '',
      priority: filters.priority || '',
      quick: filters.quick || '',
      trash: Number(filters.trash || 0) || 0,
    };
  }
};
