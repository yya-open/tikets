// 键盘快捷键 — 全局热键绑定
// 遵守 CSP: 无内联事件处理器
(function () {
  "use strict";

  function isModalOpen(modalId) {
    var el = document.getElementById(modalId);
    return el && el.classList.contains("show");
  }

  function closeAllModals() {
    // 工单表单
    if (window.closeTicketModal) window.closeTicketModal();
    // 工单详情
    if (window.closeTicketDetailModal) window.closeTicketDetailModal();
    // 口令设置
    if (window.closeKeyModal) window.closeKeyModal();
    // 通用弹窗 (modalOverlay 由 showModal/showConfirm 控制)
    var overlay = document.getElementById("modalOverlay");
    if (overlay && overlay.classList.contains("show")) {
      // 触发 Escape 已在 showModal/showConfirm 中绑定，但这里主动关闭
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
    }
  }

  document.addEventListener("keydown", function (e) {
    // 不拦截输入框内的快捷键
    var tag = (e.target && e.target.tagName) || "";
    var isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    // ---- Escape: 关闭当前模态框 ----
    if (e.key === "Escape") {
      // 让各模态框自行处理；如果没有任何模态框处理，我们兜底关闭所有
      // 但 showModal/showConfirm 已绑定 Escape，所以不做重复关闭
      return;
    }

    // ---- Ctrl+N: 新建工单 ----
    if (e.key === "n" && (e.ctrlKey || e.metaKey) && !isInput) {
      e.preventDefault();
      if (window.openTicketModal) window.openTicketModal(true);
      return;
    }

    // ---- Ctrl+F: 聚焦关键词搜索 ----
    if (e.key === "f" && (e.ctrlKey || e.metaKey) && !isInput) {
      e.preventDefault();
      var keywordInput = document.getElementById("filterKeyword");
      if (keywordInput) {
        keywordInput.focus();
        keywordInput.select();
      }
      return;
    }

    // ---- Ctrl+E: 导出当前视图 Excel ----
    if (e.key === "e" && (e.ctrlKey || e.metaKey) && !isInput) {
      e.preventDefault();
      if (window.exportExcelCurrent) window.exportExcelCurrent();
      return;
    }

    // ---- Ctrl+S: 保存工单表单（模态框打开时） ----
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      var ticketModal = document.getElementById("ticketModal");
      if (ticketModal && ticketModal.classList.contains("show")) {
        e.preventDefault();
        var form = document.getElementById("ticketForm");
        if (form) {
          form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      }
      return;
    }
  });
})();