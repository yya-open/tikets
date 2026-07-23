function escapeDetailValue(value) {
  const v = String(value ?? "").trim();
  return v ? escapeHtml(v) : '<span class="ticket-detail-empty">未填写</span>';
}

function closeTicketDetailModal() {
  const overlay = document.getElementById('ticketDetailModal');
  const bodyEl = document.getElementById('ticketDetailBody');
  const footerEl = document.getElementById('ticketDetailActions');
  if (!overlay || !bodyEl || !footerEl) return;
  overlay.classList.remove('show');
  bodyEl.innerHTML = '';
  footerEl.innerHTML = '';
}

function onTicketDetailMaskClick(e) {
  const overlay = document.getElementById('ticketDetailModal');
  if (overlay && e && e.target === overlay) closeTicketDetailModal();
}

function renderTicketDetailHtml(record) {
  const isTrash = window.TicketAppState.viewMode === 'trash' || Number(record.is_deleted || 0) === 1;
  return `
    <div class="ticket-detail-meta">
      <span class="ticket-chip">ID：${escapeHtml(String(record.id || '-'))}</span>
      <span class="ticket-chip ${isTrash ? 'ticket-detail-status-trash' : 'ticket-detail-status-active'}">${isTrash ? '回收站' : '正常工单'}</span>
      <span class="ticket-chip">类型：${escapeHtml(record.type || '未分类')}</span>
      <span class="ticket-chip">状态：${escapeHtml(record.status || '待处理')}</span>
      <span class="ticket-chip">优先级：${escapeHtml(record.priority || '普通')}</span>
      <span class="ticket-chip">日期：${escapeHtml(record.date || '-')}</span>
    </div>
    <div class="ticket-detail-highlight">
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">部门</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.department)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">姓名</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.name)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">负责人</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.assignee)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">截止日期</div><div class="ticket-detail-stat-value">${escapeDetailValue(record.due_date)}</div></div>
      <div class="ticket-detail-stat"><div class="ticket-detail-stat-label">最后更新时间</div><div class="ticket-detail-stat-value">${escapeDetailValue(formatISOToLocal(record.updated_at || ''))}</div></div>
    </div>
    <div class="ticket-detail-sections">
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">问题描述</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.issue)}</div></div>
      </section>
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">处理记录</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.solution)}</div></div>
      </section>
      <section class="ticket-detail-section">
        <div class="ticket-detail-section-header">补充备注</div>
        <div class="ticket-detail-section-body"><div class="ticket-detail-value">${escapeDetailValue(record.remarks)}</div></div>
      </section>
    </div>`;
}

function openTicketDetail(id) {
  const record = (window.TicketAppState.records || []).find(r => r.id === id);
  if (!record) return showToast('未找到该工单详情。', 'warning');

  const overlay = document.getElementById('ticketDetailModal');
  const bodyEl = document.getElementById('ticketDetailBody');
  const footerEl = document.getElementById('ticketDetailActions');
  if (!overlay || !bodyEl || !footerEl) {
    try { alert(`日期：${record.date || '-'}
类型：${record.type || '未分类'}
问题：${record.issue || '未填写'}`); } catch (e) {}
    return;
  }

  bodyEl.innerHTML = renderTicketDetailHtml(record);
  footerEl.innerHTML = '';

  function makeFooterButton(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  if (window.TicketAppState.viewMode === 'trash') {
    footerEl.appendChild(makeFooterButton('恢复', 'primary', async function () {
      closeTicketDetailModal();
      await restoreRecord(record.id);
    }));
    footerEl.appendChild(makeFooterButton('彻底删除', 'danger', async function () {
      closeTicketDetailModal();
      await hardDeleteRecord(record.id);
    }));
  } else {
    footerEl.appendChild(makeFooterButton('编辑', 'primary', function () {
      closeTicketDetailModal();
      editRecord(record.id);
    }));
    footerEl.appendChild(makeFooterButton('删除', 'danger', async function () {
      closeTicketDetailModal();
      await deleteRecord(record.id);
    }));
  }
  footerEl.appendChild(makeFooterButton('关闭', 'secondary', closeTicketDetailModal));
  overlay.classList.add('show');
}

window.TicketDetailModal = {
  close: closeTicketDetailModal,
  onMaskClick: onTicketDetailMaskClick,
  renderHtml: renderTicketDetailHtml,
  open: openTicketDetail,
};

window.openTicketDetail = openTicketDetail;
window.closeTicketDetailModal = closeTicketDetailModal;
window.onTicketDetailMaskClick = onTicketDetailMaskClick;