// ===== Chart 插件：在饼图外显示标签（类型/数量/占比） =====
// 依赖 chartjs-plugin-datalabels（已在 <head> 引入）
if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
  try { Chart.register(ChartDataLabels); } catch (e) {}
}

// ===== 云端存储（Cloudflare Pages Functions + D1） =====
async function loadFromServer() {
  const res = await fetch("/api/tickets", { cache: "no-store" });
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  const data = await res.json();
  records = normalizeRecords(Array.isArray(data) ? data : []);
  const maxId = records.reduce((max, r) => {
    const v = Number(r.id);
    return Number.isFinite(v) ? Math.max(max, v) : max;
  }, 0);
  nextId = maxId + 1;
}

async function reloadAndRender({ showLoadedToast = false } = {}) {
  await loadFromServer();
  saveToLocal(); // 缓存一份到本地，作为兜底
  refreshYearOptions();
  renderTable();
  if (showLoadedToast) {
    showToast(`已从云端加载 ${records.length} 条${viewMode === "trash" ? "回收站记录" : "工单"}`, "success");
  }
}
