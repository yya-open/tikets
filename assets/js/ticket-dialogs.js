// 弹窗 / Toast 统一封装
function showToast(message, variant = "info", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    console.log(`[${variant}] ${title ? title + " - " : ""}${message}`);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  toast.innerHTML = `${title ? `<div class="title">${escapeHtml(title)}</div>` : ""}<div>${escapeHtml(message)}</div>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('\"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showModal({ title = "提示", message = "", okText = "确定", variant = "primary" } = {}) {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    alert(message);
    return Promise.resolve();
  }

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  bodyEl.innerHTML = escapeHtml(message).replace(/\n/g, "<br>");
  footerEl.innerHTML = "";

  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${variant === "danger" ? "danger" : "primary"}`;
  okBtn.textContent = okText;

  return new Promise(resolve => {
    function close() {
      overlay.classList.remove("show");
      try {
        if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
        else if (document.body && typeof document.body.focus === "function") document.body.focus({ preventScroll: true });
      } catch (_) {}
      overlay.setAttribute("aria-hidden", "true");
      overlay.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
      resolve();
    }
    function onKeyDown(e) { if (e.key === "Escape") close(); }
    okBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    window.addEventListener("keydown", onKeyDown);
    footerEl.appendChild(okBtn);
    okBtn.focus({ preventScroll: true });
  });
}

function showConfirm({ title = "确认操作", message = "", confirmText = "确定", cancelText = "取消", danger = false } = {}) {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) return Promise.resolve(confirm(message));

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  bodyEl.innerHTML = escapeHtml(message).replace(/\n/g, "<br>");
  footerEl.innerHTML = "";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "m-btn secondary";
  cancelBtn.textContent = cancelText;
  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${danger ? "danger" : "primary"}`;
  okBtn.textContent = confirmText;

  return new Promise(resolve => {
    function close(result) {
      overlay.classList.remove("show");
      try {
        if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
        else if (document.body && typeof document.body.focus === "function") document.body.focus({ preventScroll: true });
      } catch (_) {}
      overlay.setAttribute("aria-hidden", "true");
      overlay.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }
    function onKeyDown(e) { if (e.key === "Escape") close(false); }
    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    window.addEventListener("keydown", onKeyDown);
    footerEl.appendChild(cancelBtn);
    footerEl.appendChild(okBtn);
    okBtn.focus({ preventScroll: true });
  });
}
