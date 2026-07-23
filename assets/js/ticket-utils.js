/**
 * 工单前端通用工具（浏览器运行时源）
 *
 * 说明：
 *   - `normalizeRecord` / `normalizeRecords` / `formatISOToLocal` 是纯函数，无副作用；
 *     以顶层 function 声明挂到全局，供其他 defer classic 脚本按符号名直接调用。
 *   - `loadScript` / `loadScripts` 是浏览器专用的按需加载器。
 *
 * 时序约束：
 *   该文件走 `<script defer>` 加载，早于任何 `<script type="module">` 执行；
 *   因此消费者可以在 defer 立即执行体内部（例如 initMain 的 await 之前）安全调用这些函数。
 *   若将其迁移到 ES module，会破坏 `ticket-main-bootstrap.js` 首屏同步路径的可用性。
 *
 * 单测策略：见 `tests/ticket-utils.test.mjs`（用 node:vm 加载本文件后测试）。
 */

function formatISOToLocal(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 从多个可能字段名里挑第一个非 undefined 的值
function pickField(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (obj[keys[i]] !== undefined) return obj[keys[i]];
  }
  return undefined;
}

// 统一数据结构：内部一律使用标准工单字段
function normalizeRecord(r, fallbackId) {
  const obj = (r && typeof r === "object") ? r : {};
  const idRaw = Number(pickField(obj, ["id", "ID", "Id"]) ?? fallbackId);
  const id = Number.isFinite(idRaw) ? idRaw : fallbackId;
  return {
    id,
    date:          pickField(obj, ["date", "日期", "time", "createdAt"]) ?? "",
    issue:         pickField(obj, ["issue", "问题", "question", "title", "subject"]) ?? "",
    department:    pickField(obj, ["department", "dept", "部门", "departmentName"]) ?? "",
    name:          pickField(obj, ["name", "owner", "person", "姓名", "handler"]) ?? "",
    solution:      pickField(obj, ["solution", "method", "处理方法", "fix"]) ?? "",
    remarks:       pickField(obj, ["remarks", "remark", "备注", "note"]) ?? "",
    type:          pickField(obj, ["type", "类型", "category"]) ?? "",
    status:        pickField(obj, ["status", "ticketStatus", "状态"]) ?? "待处理",
    priority:      pickField(obj, ["priority", "优先级"]) ?? "普通",
    assignee:      pickField(obj, ["assignee", "负责人"]) ?? "",
    due_date:      pickField(obj, ["due_date", "dueDate", "截止日期"]) ?? "",
    closed_at:     pickField(obj, ["closed_at", "closedAt", "关闭时间"]) ?? "",
    updated_at:    pickField(obj, ["updated_at", "updatedAt"]) ?? "",
    updated_at_ts: pickField(obj, ["updated_at_ts", "updatedAtTs", "updatedAtTS"]) ?? 0,
    is_deleted:    Number(pickField(obj, ["is_deleted", "isDeleted"]) ?? 0) ? 1 : 0,
    deleted_at:    pickField(obj, ["deleted_at", "deletedAt"]) ?? ""
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