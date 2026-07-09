function formatISOToLocal(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 统一数据结构：内部一律使用标准工单字段
function normalizeRecord(r, fallbackId) {
  const obj = (r && typeof r === "object") ? r : {};
  return {
    id: (() => { const v = Number(obj.id ?? obj.ID ?? obj.Id ?? fallbackId); return Number.isFinite(v) ? v : fallbackId; })(),
    date: obj.date ?? obj.日期 ?? obj.time ?? obj.createdAt ?? "",
    issue: obj.issue ?? obj.问题 ?? obj.question ?? obj.title ?? obj.subject ?? "",
    department: obj.department ?? obj.dept ?? obj.部门 ?? obj.departmentName ?? "",
    name: obj.name ?? obj.owner ?? obj.person ?? obj.姓名 ?? obj.handler ?? "",
    solution: obj.solution ?? obj.method ?? obj.处理方法 ?? obj.fix ?? "",
    remarks: obj.remarks ?? obj.remark ?? obj.备注 ?? obj.note ?? "",
    type: obj.type ?? obj.类型 ?? obj.category ?? "",
    status: obj.status ?? obj.ticketStatus ?? obj.状态 ?? "待处理",
    priority: obj.priority ?? obj.优先级 ?? "普通",
    assignee: obj.assignee ?? obj.负责人 ?? "",
    due_date: obj.due_date ?? obj.dueDate ?? obj.截止日期 ?? "",
    closed_at: obj.closed_at ?? obj.closedAt ?? obj.关闭时间 ?? "",
    updated_at: obj.updated_at ?? obj.updatedAt ?? "",
    updated_at_ts: obj.updated_at_ts ?? obj.updatedAtTs ?? obj.updatedAtTS ?? 0,
    is_deleted: Number(obj.is_deleted ?? obj.isDeleted ?? 0) ? 1 : 0,
    deleted_at: obj.deleted_at ?? obj.deletedAt ?? ""
  };
}

function normalizeRecords(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((r, idx) => normalizeRecord(r, idx + 1));
}

// 动态加载脚本 — 用于按需加载 vendor 库（Chart.js、XLSX、JSZip）
function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = function () { reject(new Error("Failed to load script: " + src)); };
    document.head.appendChild(script);
  });
}

// 动态加载多个脚本（串行，保证执行顺序）
function loadScripts(sources) {
  return sources.reduce(function (chain, src) {
    return chain.then(function () { return loadScript(src); });
  }, Promise.resolve());
}
