function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getTodayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function getDateTimeStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '')
    .slice(0, 40);
}

function getExportContextLabel() {
  const runtime = window.TicketQueryRuntime;
  const summary = runtime && typeof runtime.getCurrentQuerySummary === 'function'
    ? runtime.getCurrentQuerySummary()
    : (window.TicketQueryState && typeof window.TicketQueryState.getFilterSummary === 'function' ? window.TicketQueryState.getFilterSummary() : {});
  const parts = [];
  parts.push(window.TicketAppState.viewMode === 'trash' ? '回收站' : '工单');
  if (summary.year) parts.push(`${summary.year}年`);
  if (summary.month) parts.push(`${summary.month}月`);
  if (summary.type) parts.push(`类型-${sanitizeFilenamePart(summary.type)}`);
  if (summary.department) parts.push(`部门-${sanitizeFilenamePart(summary.department)}`);
  if (summary.name) parts.push(`姓名-${sanitizeFilenamePart(summary.name)}`);
  if (summary.keyword) parts.push(`关键词-${sanitizeFilenamePart(summary.keyword)}`);
  if (summary.status) parts.push(`状态-${sanitizeFilenamePart(summary.status)}`);
  return parts.filter(Boolean).join('_') || '工单';
}

function buildExportFilename(base, ext) {
  return `${base}_${getExportContextLabel()}_${getDateTimeStamp()}.${ext}`;
}

async function fetchAllFilteredRecords() {
  const runtime = window.TicketQueryRuntime;
  if (!runtime) throw new Error('TicketQueryRuntime is not available');
  const snapshot = runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode });
  return await runtime.fetchAll(snapshot, { pageSize: 100 });
}

function buildSummaryRows(records) {
  const byType = {};
  const byMonth = {};
  records.forEach((r) => {
    byType[r.type || "未分类"] = (byType[r.type || "未分类"] || 0) + 1;
    const mk = String(r.date || "").slice(0, 7) || "未知月份";
    byMonth[mk] = (byMonth[mk] || 0) + 1;
  });
  return { byType, byMonth };
}


function makeExcelRows(records) {
  return (records || []).map((r) => ({
    ID: r.id,
    日期: r.date || "",
    问题: r.issue || "",
    部门: r.department || "",
    姓名: r.name || "",
    处理方法: r.solution || "",
    备注: r.remarks || "",
    类型: r.type || "",
    更新时间: r.updated_at || "",
    已删除: Number(r.is_deleted || 0) ? "是" : "否",
    删除时间: r.deleted_at || ""
  }));
}

function autoFitWorksheetColumns(ws, rows) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const keys = dataRows.length ? Object.keys(dataRows[0]) : [];
  ws['!cols'] = keys.map((key) => {
    let width = String(key || '').length;
    dataRows.forEach((row) => {
      const value = row && row[key] != null ? String(row[key]) : '';
      width = Math.max(width, value.length);
    });
    return { wch: Math.min(Math.max(width + 2, 10), 40) };
  });
}

async function fetchRecordsByViewMode(targetViewMode, extraSearchParams) {
  const runtime = window.TicketQueryRuntime;
  if (!runtime) throw new Error('TicketQueryRuntime is not available');
  const snapshot = runtime.buildSnapshot({ includeYearMonth: true, viewMode: targetViewMode });
  if (extraSearchParams instanceof URLSearchParams) {
    snapshot.statsParams = new URLSearchParams(extraSearchParams);
    snapshot.pageParams = new URLSearchParams(extraSearchParams);
    if (targetViewMode === 'trash') {
      snapshot.statsParams.set('trash', '1');
      snapshot.pageParams.set('trash', '1');
    }
    snapshot.statsKey = snapshot.statsParams.toString();
    snapshot.pageParams.set('page', '1');
    snapshot.pageParams.set('pageSize', String(snapshot.pageSize || 100));
    snapshot.pageKey = snapshot.pageParams.toString();
  }
  return await runtime.fetchAll(snapshot, { pageSize: 100 });
}

async function exportExcelCurrent() {
  try {
    const records = await fetchAllFilteredRecords();
    if (!records.length) return showToast('当前视图没有可导出的记录。', 'warning');

    const rows = makeExcelRows(records);
    const { byType } = buildSummaryRows(records);
    const totalCount = records.length || 1;
    const typeRows = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([类型, 数量]) => ({ 类型, 数量, 占比: `${((数量 / totalCount) * 100).toFixed(1)}%` }));
    const totalRows = [
      { 类型: '合计', 数量: records.length, 占比: '100.0%' },
      ...typeRows,
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    autoFitWorksheetColumns(ws, rows);
    XLSX.utils.book_append_sheet(wb, ws, '当前筛选');

    const totalWs = XLSX.utils.json_to_sheet(totalRows);
    autoFitWorksheetColumns(totalWs, totalRows);
    XLSX.utils.book_append_sheet(wb, totalWs, '类型汇总');

    XLSX.writeFile(wb, buildExportFilename('当前筛选导出', 'xlsx'));
    showToast(`已导出当前筛选 Excel（${records.length} 条，含类型汇总）。`, 'success');
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast('导出当前筛选 Excel 失败。', 'error');
  }
}

async function exportExcelByMonth() {
  try {
    const records = await fetchAllFilteredRecords();
    if (!records.length) return showToast('当前视图没有可导出的记录。', 'warning');

    const groups = {};
    records.forEach((r) => {
      const key = String(r.date || '').slice(0, 7) || '未知月份';
      (groups[key] ||= []).push(r);
    });

    const { byType } = buildSummaryRows(records);
    const totalCount = records.length || 1;
    const typeRows = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([类型, 数量]) => ({ 类型, 数量, 占比: `${((数量 / totalCount) * 100).toFixed(1)}%` }));
    const totalRows = [
      { 类型: '合计', 数量: records.length, 占比: '100.0%' },
      ...typeRows,
    ];

    const wb = XLSX.utils.book_new();
    const totalWs = XLSX.utils.json_to_sheet(totalRows);
    autoFitWorksheetColumns(totalWs, totalRows);
    XLSX.utils.book_append_sheet(wb, totalWs, '类型汇总');

    Object.keys(groups).sort().forEach((monthKey) => {
      const rows = makeExcelRows(groups[monthKey]);
      const ws = XLSX.utils.json_to_sheet(rows);
      autoFitWorksheetColumns(ws, rows);
      const safeSheetName = monthKey.replace(/[\/*?:\[\]]/g, '_').slice(0, 31) || 'Sheet';
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });

    XLSX.writeFile(wb, buildExportFilename('按月分Sheet导出', 'xlsx'));
    showToast(`已按月份分 Sheet 导出 Excel（${records.length} 条，含类型汇总）。`, 'success');
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast('按月份分 Sheet 导出 Excel 失败。', 'error');
  }
}

async function backupData() {
  try {
    const active = await fetchRecordsByViewMode('active');
    const trash = await fetchRecordsByViewMode('trash');
    if (!active.length && !trash.length) return showToast('当前没有可备份的数据。', 'warning');

    const payload = {
      exported_at: new Date().toISOString(),
      source: 'ticket-system',
      active,
      trash,
      totals: {
        active: active.length,
        trash: trash.length,
        all: active.length + trash.length,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, buildExportFilename('完整备份', 'json'));
    showToast(`已导出完整备份（工单 ${active.length} 条，回收站 ${trash.length} 条）。`, 'success');
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast('导出 JSON 备份失败。', 'error');
  }
}

function exportCurrentJson() {
  fetchAllFilteredRecords().then((records) => {
    if (!records.length) return showToast("当前视图没有可导出的记录。", "warning");
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    downloadBlob(blob, buildExportFilename('当前视图导出', 'json'));
    showToast(`已导出当前视图 JSON（${records.length} 条）。`, "success");
  }).catch((e) => {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("导出当前视图 JSON 失败。", "error");
  });
}

async function exportSummaryExcel() {
  try {
    const records = await fetchAllFilteredRecords();
    if (!records.length) return showToast("当前视图没有可导出的记录。", "warning");

    const wb = XLSX.utils.book_new();
    const { byType, byMonth } = buildSummaryRows(records);
    const runtime = window.TicketQueryRuntime;
    const snapshot = runtime ? runtime.buildSnapshot({ includeYearMonth: true, viewMode: window.TicketAppState.viewMode }) : null;
    const stats = runtime ? await runtime.fetchStats(snapshot) : await loadStatsFromServer();
    const filterSummary = runtime ? runtime.getCurrentQuerySummary() : (window.TicketQueryState && typeof window.TicketQueryState.getFilterSummary === 'function'
      ? window.TicketQueryState.getFilterSummary()
      : {});
    const summary = [
      { 项目: "导出时间", 值: new Date().toLocaleString() },
      { 项目: "当前模式", 值: window.TicketAppState.viewMode === "trash" ? "回收站" : "工单" },
      { 项目: "当前视图记录数", 值: records.length },
      { 项目: "全部记录数", 值: Number(stats?.total_all ?? records.length) || records.length },
      { 项目: "年份筛选", 值: filterSummary.year || "全部" },
      { 项目: "月份筛选", 值: filterSummary.month || "全部" },
      { 项目: "日期范围", 值: `${filterSummary.from || "-"} ~ ${filterSummary.to || "-"}` },
      { 项目: "类型筛选", 值: filterSummary.type || "全部" },
      { 项目: "关键字", 值: filterSummary.keyword || "-" }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "汇总");

    const detailRows = records.map((r) => ({
      日期: r.date, 问题: r.issue, 部门: r.department, 姓名: r.name, 处理方法: r.solution, 备注: r.remarks, 类型: r.type
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "当前视图明细");

    const totalCount = records.length || 1;
    const typeRows = Object.entries(byType).sort((a,b) => b[1]-a[1]).map(([类型, 数量]) => ({ 类型, 数量, 占比: `${((数量 / totalCount) * 100).toFixed(1)}%` }));
    const monthRows = Object.entries(byMonth).sort((a,b) => a[0].localeCompare(b[0])).map(([月份, 数量]) => ({ 月份, 数量 }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(typeRows), "类型统计");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthRows), "月份统计");

    XLSX.writeFile(wb, buildExportFilename('统计汇总', 'xlsx'));
    showToast(`已导出统计汇总 Excel（${records.length} 条）。`, "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("导出统计汇总 Excel 失败。", "error");
  }
}


function exportSelectedJson(records) {
  const selected = Array.isArray(records) ? records : [];
  if (!selected.length) return showToast('请先选择要导出的工单。', 'warning');
  const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
  downloadBlob(blob, buildExportFilename(`选中${selected.length}条`, 'json'));
  showToast(`已导出选中 JSON（${selected.length} 条）。`, 'success');
}

function exportSelectedExcel(records) {
  const selected = Array.isArray(records) ? records : [];
  if (!selected.length) return showToast('请先选择要导出的工单。', 'warning');
  const rows = makeExcelRows(selected);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  autoFitWorksheetColumns(ws, rows);
  XLSX.utils.book_append_sheet(wb, ws, '选中工单');
  XLSX.writeFile(wb, buildExportFilename(`选中${selected.length}条`, 'xlsx'));
  showToast(`已导出选中 Excel（${selected.length} 条）。`, 'success');
}

function loadBackup(event) {
  const input = event.target;
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      let importedPayload = null;
      if (parsed && typeof parsed === "object" && (Array.isArray(parsed.active) || Array.isArray(parsed.trash))) {
        importedPayload = {
          active: Array.isArray(parsed.active) ? parsed.active : [],
          trash: Array.isArray(parsed.trash) ? parsed.trash : [],
        };
      }

      let imported = null;
      if (importedPayload) imported = window.TicketAppState.viewMode === "trash" ? importedPayload.trash : importedPayload.active;
      if (!importedPayload && Array.isArray(parsed)) {
        imported = parsed;
      } else if (!importedPayload && parsed && typeof parsed === "object") {
        const candidate = (Array.isArray(parsed.records) && parsed.records) || (Array.isArray(parsed.data) && parsed.data) || (Array.isArray(parsed.tickets) && parsed.tickets) || (Array.isArray(parsed.items) && parsed.items);
        if (candidate) {
          imported = candidate;
        } else {
          const keys = Object.keys(parsed);
          const monthLike = keys.some(k => /^\d{4}-\d{2}$/.test(k) && Array.isArray(parsed[k]));
          if (monthLike) {
            imported = [];
            keys.sort().forEach(k => { if (Array.isArray(parsed[k])) imported = imported.concat(parsed[k]); });
          }
        }
      }

      if (!Array.isArray(imported)) {
        showToast("备份格式不正确：请导入通过本系统导出的 JSON 备份文件。", "error");
        return;
      }

      const normImported = normalizeRecords(imported);
      const normPayload = importedPayload ? {
        active: normalizeRecords(importedPayload.active),
        trash: normalizeRecords(importedPayload.trash),
      } : null;

      const toCloud = await showConfirm({
        title: "导入备份",
        message: `建议使用【合并导入】（不清空云端）。

合并规则：仅当备份记录的 updated_at 更新更晚时才覆盖云端同 id 记录。

- 确认：合并到云端（安全）
- 取消：仅导入本地（只影响你当前浏览器）`,
        confirmText: "合并到云端",
        cancelText: "仅本地导入",
        danger: false
      });

      if (toCloud) {
        const previewRes = await window.TicketApi.authedFetch("/api/import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normPayload || normImported)
        });
        if (!previewRes.ok) throw new Error(`import preview failed: ${previewRes.status}`);
        const preview = await previewRes.json();
        const t = preview && preview.totals ? preview.totals : null;
        const msg = window.TicketImportPreview ? window.TicketImportPreview.format(preview) : `预演结果：新增 ${t?.inserts || 0} 条，更新 ${t?.updates || 0} 条，跳过 ${t?.skips || 0} 条。`;

        const apply = await showConfirm({
          title: "导入预演（安全合并）",
          message: msg,
          confirmText: "应用导入",
          cancelText: "取消",
          danger: false
        });
        if (!apply) {
          showToast("已取消导入。", "info");
          return;
        }

        const applyRes = await window.TicketApi.authedFetch("/api/import/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normPayload || normImported)
        });
        if (!applyRes.ok) throw new Error(`import apply failed: ${applyRes.status}`);

        let applyJson = null;
        try { applyJson = await applyRes.json(); } catch {}
        await reloadAndRender();

        const t2 = applyJson && applyJson.totals ? applyJson.totals : null;
        if (t2) {
          const inserts = Number(t2.inserts || 0);
          const updates = Number(t2.updates || 0);
          const skips = Number(t2.skips || 0);
          const newerEq = Number(t2.skipped_newer_or_equal || 0);
          let msg2 = `导入完成：新增 ${inserts} 条，更新 ${updates} 条，跳过 ${skips} 条（active ${t2.active} / trash ${t2.trash}）`;
          if (newerEq > 0) msg2 += `；其中 ${newerEq} 条因云端版本更新/相同已跳过（保护线上数据）`;
          showToast(msg2, inserts + updates === 0 && skips > 0 ? "info" : "success");
        } else {
          showToast("已合并导入到云端（未清空）。", "success");
        }

        if (window.TicketAppState.viewMode !== "trash" && (window.TicketAppState.records || []).length === 0 && t2 && Number(t2.trash || 0) > 0) {
          const goTrash = await showConfirm({
            title: "导入完成，但当前列表为空",
            message: `备份中包含回收站记录 ${t2.trash} 条。\n\n是否切换到【回收站】查看/恢复？\n（提示：年份/月筛选也可能导致列表为空）`,
            confirmText: "切换到回收站",
            cancelText: "保持当前视图",
            danger: false
          });
          if (goTrash) {
            window.TicketAppState.viewMode = "trash";
            saveViewState();
            await reloadAndRender();
          }
        }
      } else {
        window.TicketAppState.records = normImported;
        const allForMax = normPayload ? normPayload.active.concat(normPayload.trash) : window.TicketAppState.records;
        const maxId = allForMax.reduce((max, r) => {
          const v = Number(r.id);
          return Number.isFinite(v) ? Math.max(max, v) : max;
        }, 0);
        window.TicketAppState.nextId = maxId + 1;
        window.TicketAppState.currentPage = 1;
        refreshYearOptions();
        renderTable();
        saveToLocal();
        showToast(`已导入到本地（共 ${(window.TicketAppState.records || []).length} 条，仅本浏览器）！`, "success");
      }
    } catch (err) {
      if (isNoKeyError(err)) return;
      console.error(err);
      showToast(err instanceof SyntaxError ? "解析备份失败：文件不是有效的 JSON。" : "导入失败：请检查备份文件或后端是否正常。", "error");
    } finally {
      if (input) input.value = "";
    }
  };

  reader.onerror = function() {
    showToast("读取文件失败，请重试。", "error");
    if (input) input.value = "";
  };

  reader.readAsText(file);
}

async function archiveByMonthJSON() {
  try {
    const records = await fetchAllFilteredRecords();
    if (records.length === 0) return showToast("没有可归档的数据！", "warning");
    const groups = {};
    records.forEach(r => { const monthKey = String(r.date || '').slice(0, 7) || '未知月份'; (groups[monthKey] ||= []).push(r); });
    Object.keys(groups).sort().forEach(monthKey => {
      const blob = new Blob([JSON.stringify(groups[monthKey], null, 2)], { type: "application/json" });
      downloadBlob(blob, buildExportFilename(`月份归档_${monthKey}`, 'json'));
    });
    showToast(`所有月份已分别导出为独立 JSON 文件（${records.length} 条）。`, "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("按月份导出 JSON 失败。", "error");
  }
}

async function exportYearZip() {
  try {
    const records = await fetchAllFilteredRecords();
    if (records.length === 0) return showToast("没有可打包的数据！", "warning");
    const zip = new JSZip();
    const groups = {};
    records.forEach(r => { const monthKey = String(r.date || '').slice(0, 7) || '未知月份'; (groups[monthKey] ||= []).push(r); });
    Object.keys(groups).sort().forEach(monthKey => zip.file(`工单_${monthKey}.json`, JSON.stringify(groups[monthKey], null, 2)));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, buildExportFilename('年度归档', 'zip'));
    showToast(`已打包年度 ZIP（${records.length} 条）。`, "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("打包年度 ZIP 失败。", "error");
  }
}

async function manualBackup() {
  if (!window.showDirectoryPicker) return showToast("当前浏览器不支持目录访问 API，建议使用最新版的 Edge/Chrome。", "warning");
  try {
    const records = await fetchAllFilteredRecords();
    if (records.length === 0) return showToast("当前没有可备份的数据！", "warning");
    const dir = await window.showDirectoryPicker();
    const today = new Date().toISOString().slice(0, 10);
    const fileHandle = await dir.getFileHandle(buildExportFilename('本地目录备份', 'json'), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(records, null, 2));
    await writable.close();
    showToast(`备份成功（${records.length} 条）！`, "success");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("备份失败！", "error");
  }
}


window.exportExcelCurrent = exportExcelCurrent;
window.exportCurrentJson = exportCurrentJson;
window.exportSummaryExcel = exportSummaryExcel;
window.exportExcelByMonth = exportExcelByMonth;
window.backupData = backupData;
window.loadBackup = loadBackup;
window.archiveByMonthJSON = archiveByMonthJSON;
window.exportYearZip = exportYearZip;
window.manualBackup = manualBackup;

window.exportSelectedJson = exportSelectedJson;
window.exportSelectedExcel = exportSelectedExcel;
