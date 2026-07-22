(function () {
  const draft = window.__TicketPageStateDraft || {};
  const defaultPageSize = (window.TicketConfig && window.TicketConfig.defaults && window.TicketConfig.defaults.pageSize) || 100;
  const state = {
    records: Array.isArray(draft.records) ? draft.records : [],
    nextId: Number(draft.nextId || 1) || 1,
    activeYear: String(draft.activeYear || "").trim(),
    activeMonth: String(draft.activeMonth || "").trim(),
    serverTotal: Number(draft.serverTotal || 0) || 0,
    metaMonthCounts: draft.metaMonthCounts && typeof draft.metaMonthCounts === "object" ? draft.metaMonthCounts : {},
    metaTotalAll: Number(draft.metaTotalAll || 0) || 0,
    pageSize: Number(draft.pageSize || defaultPageSize) || defaultPageSize,
    currentPage: Number(draft.currentPage || 1) || 1,
    cursorNav: null,
    cursorKey: "",
    pageCursorMap: new Map(),
    selectedTicketIds: new Set(),
  };

  function normalizeValue(key, value) {
    if (key === "records") return Array.isArray(value) ? value : [];
    if (["nextId", "pageSize", "currentPage", "serverTotal", "metaTotalAll"].includes(key)) {
      const fallback = key === "pageSize" ? defaultPageSize : (key === "currentPage" || key === "nextId" ? 1 : 0);
      return Number(value || fallback) || fallback;
    }
    if (key === "activeYear" || key === "activeMonth") return String(value || "").trim();
    if (key === "metaMonthCounts") return value && typeof value === "object" ? value : {};
    if (key === "pageCursorMap") return value instanceof Map ? value : new Map();
    if (key === "selectedTicketIds") return value instanceof Set ? value : new Set();
    if (key === "cursorNav") return value && typeof value === "object" ? value : null;
    if (key === "cursorKey") return String(value || "");
    return value;
  }

  function get(key) {
    return state[key];
  }

  function set(key, value) {
    if (!(key in state)) return;
    state[key] = normalizeValue(key, value);
  }

  function getState() {
    return { ...state };
  }

  function patchState(patch) {
    Object.entries(patch || {}).forEach(([key, value]) => set(key, value));
    return getState();
  }

  function setRecords(records) {
    set("records", records);
    return state.records;
  }

  function getSelectedRecords() {
    return state.records.filter((record) => state.selectedTicketIds.has(Number(record.id)));
  }

  function toggleSelectAllOnPage(checked) {
    state.records.forEach((record) => {
      const id = Number(record.id);
      if (!Number.isFinite(id)) return;
      if (checked) state.selectedTicketIds.add(id);
      else state.selectedTicketIds.delete(id);
    });
  }

  function pruneSelectionToRecords() {
    const currentIds = new Set(state.records.map((record) => Number(record.id)).filter(Number.isFinite));
    state.selectedTicketIds = new Set(Array.from(state.selectedTicketIds).filter((id) => currentIds.has(id)));
  }

  function resetCursorState({ cursorKey = state.cursorKey } = {}) {
    state.cursorKey = String(cursorKey || "");
    state.pageCursorMap.clear();
    state.cursorNav = null;
  }

  function defineGlobalAlias(key) {
    if (Object.prototype.hasOwnProperty.call(window, key)) return;
    Object.defineProperty(window, key, {
      configurable: true,
      get() { return state[key]; },
      set(value) { set(key, value); },
    });
  }

  [
    "records",
    "nextId",
    "activeYear",
    "activeMonth",
    "serverTotal",
    "metaMonthCounts",
    "metaTotalAll",
    "pageSize",
    "currentPage",
    "cursorNav",
    "cursorKey",
    "pageCursorMap",
    "selectedTicketIds",
  ].forEach(defineGlobalAlias);

  window.TicketPageState = {
    get,
    set,
    getState,
    patchState,
    setRecords,
    getSelectedRecords,
    toggleSelectAllOnPage,
    pruneSelectionToRecords,
    resetCursorState,
  };
})();
