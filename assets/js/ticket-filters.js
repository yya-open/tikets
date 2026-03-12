(function () {
<<<<<<< HEAD
  function v(id) {
    return String(document.getElementById(id)?.value || '').trim();
  }

  function read() {
    return {
      from: v('filterFrom'),
      to: v('filterTo'),
      type: v('filterType'),
      department: v('filterDepartment'),
      name: v('filterName'),
      q: v('filterKeyword'),
    };
  }

  function applyToSearchParams(sp, filters) {
    Object.entries(filters || {}).forEach(([k, val]) => {
      if (val) sp.set(k, val);
    });
    return sp;
  }

=======
  function v(id) { return String(document.getElementById(id)?.value || '').trim(); }
  function read(extra = {}) {
    const viewMode = extra.viewMode || 'active';
    return { from: v('filterFrom'), to: v('filterTo'), type: v('filterType'), department: v('filterDepartment'), name: v('filterName'), q: v('filterKeyword'), status: v('filterStatus'), trash: viewMode === 'trash' ? 1 : 0 };
  }
  function applyToSearchParams(sp, filters) { Object.entries(filters || {}).forEach(([k, val]) => { if (val) sp.set(k, val); }); return sp; }
>>>>>>> fb6f94b1f0d1876ce6c9ccdeb82a8a1ab4fcedc7
  window.TicketFilters = { read, applyToSearchParams };
})();
