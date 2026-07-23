async function deleteRecord(id) {
  const ok = await showConfirm({
    title: "确认删除",
    message: "确认将这条工单移入回收站吗？\n\n你可以在【回收站】中恢复。",
    confirmText: "移入回收站",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;

  try {
    await window.TicketService.deleteTicket(id);

    if (editingId === id) resetForm();
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已移入回收站。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("删除失败：请检查网络或后端是否正常。", "error");
  }
}

async function restoreRecord(id) {
  const ok = await showConfirm({
    title: "恢复工单",
    message: "确认从回收站恢复这条工单吗？",
    confirmText: "恢复",
    cancelText: "取消",
    danger: false
  });
  if (!ok) return;
  try {
    await window.TicketService.restoreTicket(id);
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已恢复该工单。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("恢复失败：请检查网络或后端是否正常。", "error");
  }
}

async function hardDeleteRecord(id) {
  const ok = await showConfirm({
    title: "彻底删除",
    message: "确认【彻底删除】这条记录吗？\n\n此操作不可恢复。",
    confirmText: "彻底删除",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;
  try {
    await window.TicketService.hardDeleteTicket(id);
    window.TicketQueryRuntime && window.TicketQueryRuntime.invalidateStatsCache && window.TicketQueryRuntime.invalidateStatsCache();
    await reloadAndRender();
    showToast("已彻底删除。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("彻底删除失败：请检查网络或后端是否正常。", "error");
  }
}

window.TicketRecordActions = {
  deleteRecord,
  restoreRecord,
  hardDeleteRecord,
};