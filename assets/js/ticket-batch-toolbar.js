function getSelectedRecords() {
  return window.TicketPageState.getSelectedRecords();
}

function handleRowSelectionClick(e) {
  const checkbox = e.target && e.target.closest ? e.target.closest('input.row-select[type="checkbox"]') : null;
  if (!checkbox) return false;

  const id = Number(checkbox.getAttribute('data-id'));
  if (Number.isFinite(id)) {
    if (checkbox.checked) selectedTicketIds.add(id);
    else selectedTicketIds.delete(id);
    const row = checkbox.closest('tr');
    if (row) row.classList.toggle('row-selected', checkbox.checked);
    syncBatchToolbar();
  }
  return true;
}

function syncBatchToolbar() {
  const allHead = document.getElementById('selectAllRowsHead');
  const allTop = document.getElementById('selectAllRows');
  const currentIds = (window.TicketAppState.records || []).map((r) => Number(r.id)).filter(Number.isFinite);
  const selectable = currentIds.length;
  const selectedOnPage = currentIds.filter((id) => selectedTicketIds.has(id)).length;
  const summary = document.getElementById('batchSummary');
  if (summary) {
    const total = Number(window.TicketAppState.serverTotal || serverTotal || selectable) || selectable;
    summary.textContent = selectedOnPage
      ? `本页已选择 ${selectedOnPage} 条记录${total > selectable ? `；当前筛选共 ${total} 条，可直接导出当前筛选` : ''}`
      : (total > selectable ? `当前筛选共 ${total} 条，导出当前筛选可包含全部记录` : '未选择记录');
  }
  [allHead, allTop].forEach((el) => {
    if (!el) return;
    el.checked = selectable > 0 && selectedOnPage === selectable;
    el.indeterminate = selectedOnPage > 0 && selectedOnPage < selectable;
  });
  const mode = window.TicketAppState.viewMode || 'active';
  const btnDelete = document.getElementById('btnBatchDelete');
  const btnRestore = document.getElementById('btnBatchRestore');
  const btnHardDelete = document.getElementById('btnBatchHardDelete');
  if (btnDelete) btnDelete.classList.toggle('hidden', mode === 'trash');
  if (btnRestore) btnRestore.classList.toggle('hidden', mode !== 'trash');
  if (btnHardDelete) btnHardDelete.classList.toggle('hidden', mode !== 'trash');
  const batchEditPanel = document.getElementById('batchEditPanel');
  if (batchEditPanel) batchEditPanel.classList.toggle('hidden', selectedOnPage === 0);
}

function toggleSelectAllOnPage(checked) {
  window.TicketPageState.toggleSelectAllOnPage(checked);
  const tbody = document.querySelector('#recordTable tbody');
  if (tbody) {
    tbody.querySelectorAll('input.row-select[type="checkbox"]').forEach((input) => {
      input.checked = !!checked;
      const row = input.closest('tr');
      if (row) row.classList.toggle('row-selected', !!checked);
    });
  }
  syncBatchToolbar();
}

async function runBatchAction(action) {
  const selected = getSelectedRecords();
  if (!selected.length) return showToast('请先选择要批量处理的工单。', 'warning');
  if (action === 'export-json') return window.exportSelectedJson && window.exportSelectedJson(selected);
  if (action === 'export-excel') return window.exportSelectedExcel && window.exportSelectedExcel(selected);

  const count = selected.length;
  const configMap = {
    delete: { title: '批量删除', message: `确认将选中的 ${count} 条工单移入回收站吗？`, ok: '批量删除', handler: (id) => window.TicketService.deleteTicket(id) },
    restore: { title: '批量恢复', message: `确认恢复选中的 ${count} 条工单吗？`, ok: '批量恢复', handler: (id) => window.TicketService.restoreTicket(id) },
    'hard-delete': { title: '批量彻底删除', message: `确认彻底删除选中的 ${count} 条工单吗？

此操作不可恢复。`, ok: '批量彻底删除', handler: (id) => window.TicketService.hardDeleteTicket(id) },
  };
  const cfg = configMap[action];
  if (!cfg) return;
  const ok = await showConfirm({ title: cfg.title, message: cfg.message, confirmText: cfg.ok, cancelText: '取消', danger: true });
  if (!ok) return;

  let success = 0;
  for (const item of selected) {
    try {
      await cfg.handler(item.id);
      success += 1;
      selectedTicketIds.delete(Number(item.id));
    } catch (e) {
      if (isNoKeyError(e)) return;
      console.error(e);
    }
  }
  window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
  await reloadAndRender();
  showToast(`${cfg.title}完成：成功 ${success} / ${count} 条。`, success === count ? 'success' : 'warning');
}

function bindBatchToolbarInteractions() {
  const toolbar = document.getElementById('batchToolbar');
  if (!toolbar || toolbar.dataset.bound === '1') {
    syncBatchToolbar();
    return;
  }
  toolbar.dataset.bound = '1';
  toolbar.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[id]') : null;
    if (!btn) return;
    const id = btn.id;
    if (id === 'btnBatchExportFilteredJson') return window.exportCurrentJson && window.exportCurrentJson();
    if (id === 'btnBatchExportFilteredExcel') return window.exportExcelCurrent && window.exportExcelCurrent();
    if (id === 'btnBatchExportJson') return runBatchAction('export-json');
    if (id === 'btnBatchExportExcel') return runBatchAction('export-excel');
    if (id === 'btnBatchDelete') return runBatchAction('delete');
    if (id === 'btnBatchRestore') return runBatchAction('restore');
    if (id === 'btnBatchHardDelete') return runBatchAction('hard-delete');
  });
  const allHead = document.getElementById('selectAllRowsHead');
  const allTop = document.getElementById('selectAllRows');
  [allHead, allTop].forEach((el) => {
    if (!el) return;
    el.addEventListener('change', function () {
      toggleSelectAllOnPage(!!el.checked);
    });
  });
  syncBatchToolbar();
}

async function applyBatchWorkflowUpdate() {
  const selected = getSelectedRecords();
  if (!selected.length) return showToast("请先选择要批量更新的工单。", "warning");
  const status = String(document.getElementById("batchStatusSelect")?.value || "").trim();
  const assigneeRaw = document.getElementById("batchAssigneeInput")?.value;
  const assignee = String(assigneeRaw || "").trim();
  if (!status && assigneeRaw === "") return showToast("请选择状态或填写负责人。", "warning");

  const ok = await showConfirm({
    title: "批量更新",
    message: `确认更新选中的 ${selected.length} 条工单吗？\n${status ? "状态：" + status : ""}${assigneeRaw !== "" ? "; 负责人：" + assignee : ""}`,
    confirmText: "应用更新",
    cancelText: "取消",
    danger: false,
  });
  if (!ok) return;

  try {
    const ids = selected.map(function (r) { return Number(r.id); }).filter(function (n) { return Number.isFinite(n); });
    const updates = {};
    if (status) updates.status = status;
    if (assigneeRaw !== "" && assignee !== "") updates.assignee = assignee;

    const result = await window.TicketService.batchUpdate(ids, updates);
    selectedTicketIds.clear();
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("批量更新完成：成功 " + (result.updated || 0) + " / " + ids.length + " 条。", result.updated === ids.length ? "success" : "warning");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("批量更新失败：" + (e.message || "未知错误"), "error");
  }
}

function bindBatchWorkflowControls() {
  const btn = document.getElementById("btnBatchApplyWorkflow");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", applyBatchWorkflowUpdate);
}

window.TicketBatchToolbar = {
  getSelectedRecords,
  handleRowSelectionClick,
  syncBatchToolbar,
  toggleSelectAllOnPage,
  runBatchAction,
  bindBatchToolbarInteractions,
  applyBatchWorkflowUpdate,
  bindBatchWorkflowControls,
};

window.runBatchAction = runBatchAction;