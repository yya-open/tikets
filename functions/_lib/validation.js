const MAX_SHORT = 80;
const MAX_MEDIUM = 200;
const MAX_LONG = 4000;

function cleanText(value, maxLen) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLen);
}

export function validateTicketPayload(input, { requireVersion = false } = {}) {
  const data = input && typeof input === "object" ? input : {};
  const normalized = {
    date: cleanText(data.date, 20),
    issue: cleanText(data.issue, MAX_MEDIUM),
    department: cleanText(data.department, MAX_SHORT),
    name: cleanText(data.name, MAX_SHORT),
    solution: cleanText(data.solution, MAX_LONG),
    remarks: cleanText(data.remarks, MAX_LONG),
    type: cleanText(data.type, MAX_SHORT) || "日常故障",
    updated_at: cleanText(data.updated_at ?? data.updatedAt, 40),
    updated_at_ts: Number(data.updated_at_ts ?? data.updatedAtTs ?? data.updatedAtTS ?? data.updated_atTs) || 0,
    force: Boolean(data.force),
  };

  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)) {
    errors.push({ field: "date", message: "日期必须是 YYYY-MM-DD" });
  }
  if (!normalized.issue) {
    errors.push({ field: "issue", message: "问题不能为空" });
  }
  if (normalized.issue.length > MAX_MEDIUM) {
    errors.push({ field: "issue", message: `问题不能超过 ${MAX_MEDIUM} 个字符` });
  }
  if (normalized.department.length > MAX_SHORT) {
    errors.push({ field: "department", message: `部门不能超过 ${MAX_SHORT} 个字符` });
  }
  if (normalized.name.length > MAX_SHORT) {
    errors.push({ field: "name", message: `姓名不能超过 ${MAX_SHORT} 个字符` });
  }
  if (normalized.solution.length > MAX_LONG) {
    errors.push({ field: "solution", message: `处理方法不能超过 ${MAX_LONG} 个字符` });
  }
  if (normalized.remarks.length > MAX_LONG) {
    errors.push({ field: "remarks", message: `备注不能超过 ${MAX_LONG} 个字符` });
  }
  if (requireVersion && !normalized.force && !(normalized.updated_at_ts > 0) && !normalized.updated_at) {
    errors.push({ field: "updated_at_ts", message: "缺少并发版本号，请刷新后重试" });
  }

  return {
    ok: errors.length === 0,
    errors,
    data: normalized,
  };
}
