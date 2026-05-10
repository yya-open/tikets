// Main ticket workspace bootstrap.
function loadRecordsFromLocalCache() {
  try {
    const saved = localStorage.getItem("ticket_records");
    if (!saved) return;
    const data = JSON.parse(saved);
    if (!Array.isArray(data)) return;
    records = normalizeRecords(data);
    const maxId = records.reduce((max, record) => {
      const value = Number(record.id);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    nextId = maxId + 1;
  } catch (e) {
    console.error("从本地恢复数据失败：", e);
  }
}

(async function initMain() {
  try { if (window.TicketValidation) window.TicketValidation.initFormValidationUI(); } catch (e) {}
  try { if (window.TicketFoldState) window.TicketFoldState.init(); } catch (e) {}
  try { if (typeof updateEditKeyStatus === "function") updateEditKeyStatus(); } catch (e) {}
  try { if (window.TicketDictionary) await window.TicketDictionary.init(); } catch (e) { console.warn(e); }

  try { if (typeof loadViewState === "function") loadViewState(); } catch (e) {}
  try { if (typeof loadViewMode === "function") loadViewMode(); } catch (e) {}
  try { if (typeof updateViewModeUI === "function") updateViewModeUI(); } catch (e) {}

  try {
    await reloadAndRender({ showLoadedToast: false });
  } catch (e) {
    console.error(e);
    try {
      loadRecordsFromLocalCache();
      refreshYearOptions();
      renderTable();
      showToast("云端加载失败，已使用本地缓存（仅本浏览器）。", "warning");
    } catch (fallbackError) {
      console.error(fallbackError);
    }
  }
})();
