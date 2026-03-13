function formatISOToLocal(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 统一数据结构：内部一律使用 {id,date,issue,department,name,solution,remarks,type}
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
