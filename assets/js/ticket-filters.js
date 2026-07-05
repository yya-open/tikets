(function () {
  function v(id) {
    return String(document.getElementById(id)?.value || '').trim();
  }

  function read(extra = {}) {
    const viewMode = extra.viewMode || 'active';
    const quickRoot = document.getElementById('quickFilterGroup');
    const quick = String(quickRoot?.dataset.activeFilter || '').trim();
    return {
      from: v('filterFrom'),
      to: v('filterTo'),
      type: v('filterType'),
      department: v('filterDepartment'),
      name: v('filterName'),
      q: v('filterKeyword'),
      ticketStatus: v('filterTicketStatus'),
      assignee: v('filterAssignee'),
      priority: v('filterPriority'),
      quick: quick && quick !== 'all' ? quick : '',
      quickDate: quick && quick !== 'all' ? todayISO() : '',
      trash: viewMode === 'trash' ? 1 : 0,
    };
  }

  function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function applyToSearchParams(sp, filters) {
    Object.entries(filters || {}).forEach(([k, val]) => {
      if (val) sp.set(k, val);
    });
    return sp;
  }

  window.TicketFilters = { read, applyToSearchParams };
})();
