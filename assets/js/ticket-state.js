var records = [];
var editingId = null;
var editingUpdatedAt = ""; // legacy concurrency token from server
var editingUpdatedAtTs = 0; // preferred concurrency token (ms timestamp)
var nextId = 1;

window.TicketAppState = window.TicketAppState || {};
Object.defineProperties(window.TicketAppState, {
  records: { get: () => records, set: (v) => { records = Array.isArray(v) ? v : []; } },
  editingId: { get: () => editingId, set: (v) => { editingId = v; } },
  editingUpdatedAt: { get: () => editingUpdatedAt, set: (v) => { editingUpdatedAt = v || ""; } },
  editingUpdatedAtTs: { get: () => editingUpdatedAtTs, set: (v) => { editingUpdatedAtTs = Number(v || 0) || 0; } },
  nextId: { get: () => nextId, set: (v) => { nextId = Number(v || 1) || 1; } },
  viewMode: { get: () => viewMode, set: (v) => { viewMode = (v === "trash") ? "trash" : "active"; } },
  pageSize: {
    get: () => pageSize,
    set: (v) => {
      const fallback = (window.TicketConfig && window.TicketConfig.defaults && window.TicketConfig.defaults.pageSize) || 100;
      pageSize = Number(v || fallback) || fallback;
    }
  },
  currentPage: { get: () => currentPage, set: (v) => { currentPage = Number(v || 1) || 1; } }
});
