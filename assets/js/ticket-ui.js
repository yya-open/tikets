(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('\"', '&quot;')
      .replaceAll("'", '&#039;');
  }
  function showRichConfirm({ title = '提示', html = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    const footerEl = document.getElementById('modalFooter');
    if (!overlay || !titleEl || !bodyEl || !footerEl) return Promise.resolve(false);
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('show');
    titleEl.textContent = title;
    bodyEl.innerHTML = html;
    footerEl.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'm-btn secondary';
    cancelBtn.textContent = cancelText;
    const okBtn = document.createElement('button');
    okBtn.className = `m-btn ${danger ? 'danger' : 'primary'}`;
    okBtn.textContent = confirmText;
    return new Promise((resolve) => {
      function close(v) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); overlay.onclick = null; resolve(v); }
      cancelBtn.onclick = () => close(false); okBtn.onclick = () => close(true); overlay.onclick = (e) => { if (e.target === overlay) close(false); };
      footerEl.appendChild(cancelBtn); footerEl.appendChild(okBtn);
    });
  }
  window.TicketUI = { escapeHtml, showRichConfirm };
})();
