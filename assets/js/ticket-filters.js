(function () {
  function v(id) { return String(document.getElementById(id)?.value || '').trim(); }
  function read(extra = {}) {
    const viewMode = extra.viewMode || 'active';
    return { from: v('filterFrom'), to: v('filterTo'), type: v('filterType'), department: v('filterDepartment'), name: v('filterName'), q: v('filterKeyword'), status: v('filterStatus'), trash: viewMode === 'trash' ? 1 : 0 };
  }
  function applyToSearchParams(sp, filters) { Object.entries(filters || {}).forEach(([k, val]) => { if (val) sp.set(k, val); }); return sp; }
  window.TicketFilters = { read, applyToSearchParams };
})();
