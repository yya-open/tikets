    // 初始化
    
(async function init() {
  try { if (window.TicketValidation) window.TicketValidation.initFormValidationUI(); } catch (e) {}
  try { if (window.TicketFoldState) window.TicketFoldState.init(); } catch (e) {}
  try { updateEditKeyStatus(); } catch (e) {}
  try { if (window.TicketHealth) { const health = await window.TicketHealth.load(); window.TicketHealth.render(health); } } catch (e) { console.warn(e); if (window.TicketHealth) window.TicketHealth.render({ ok:false }); }

  // 先恢复月份视图（只影响筛选/显示，不影响数据源）
  loadViewState();

  // 恢复视图模式（工单 / 回收站）
  loadViewMode();
  updateViewModeUI();

  // 先尝试从云端加载（多人共享数据）
  try {
    await reloadAndRender({ showLoadedToast: false });
  } catch (e) {
    console.error(e);
    // 云端失败时用本地缓存兜底
    loadFromLocal();
    refreshYearOptions();
    renderTable();
    showToast("云端加载失败，已使用本地缓存（仅本浏览器）。", "warning");
  }
})();
  

