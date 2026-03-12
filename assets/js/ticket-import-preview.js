(function () {
  function formatDiffList(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return '无';
    return changes.map((change) => `  - ${change.field}: ${change.from || '空'} → ${change.to || '空'}`).join('\n');
  }

  function lines(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) return emptyText;
    return items.map((item) => {
      const idPart = item.id === null || item.id === undefined ? '新记录' : `#${item.id}`;
      const header = `• ${idPart} ${item.date || ''} ${item.issue || ''} —— ${item.reason || ''}`.trim();
      if (Array.isArray(item.changes) && item.changes.length > 0) {
        return `${header}\n${formatDiffList(item.changes)}`;
      }
      return header;
    }).join('\n');
  }

  function format(preview) {
    const t = preview?.totals || {};
    const ex = preview?.examples || {};
    return [
      `输入：${t.incoming || 0} 条（active ${t.active || 0} / trash ${t.trash || 0}）`,
      `新增：${t.inserts || 0} 条`,
      `更新：${t.updates || 0} 条`,
      `跳过：${t.skips || 0} 条`,
      `无效：${t.invalid || 0} 条`,
      '',
      '新增示例：',
      lines(ex.inserts, '无'),
      '',
      '更新示例（旧值 → 新值）：',
      lines(ex.updates, '无'),
      '',
      '跳过示例：',
      lines(ex.skips, '无'),
      '',
      '无效示例：',
      lines(ex.invalid, '无'),
    ].join('\n');
  }

  window.TicketImportPreview = { format };
})();
