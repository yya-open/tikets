const FTS_FIELDS = ["issue", "department", "name", "solution", "remarks", "type"];

export function normalizeDateParam(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

export function normalizeTextParam(raw) {
  return String(raw ?? "").trim();
}

export function normalizeFilterTextParam(raw, maxLen = 80) {
  return normalizeTextParam(raw).slice(0, maxLen);
}

export function normalizeStatusDeletedParam(raw) {
  const s = normalizeTextParam(raw).toLowerCase();
  if (!s) return null;
  if (["active", "normal", "open", "0", "false"].includes(s)) return 0;
  if (["trash", "deleted", "recycle", "1", "true"].includes(s)) return 1;
  return null;
}

export function buildDeletedFilter(trash, statusDeleted = null) {
  return statusDeleted === null ? (trash ? 1 : 0) : statusDeleted;
}

export function pushTicketFilters(where, binds, { deleted, from, to, type, department, name }) {
  where.push("tickets.is_deleted=?");
  binds.push(deleted);

  if (from) {
    where.push("tickets.date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("tickets.date <= ?");
    binds.push(to);
  }
  if (type) {
    where.push("tickets.type = ?");
    binds.push(type);
  }
  if (department) {
    where.push("tickets.department LIKE ?");
    binds.push(`%${department}%`);
  }
  if (name) {
    where.push("tickets.name LIKE ?");
    binds.push(`%${name}%`);
  }
}

export function pushKeywordLikeFilter(where, binds, q, tablePrefix = "tickets.") {
  if (!q) return;
  const like = `%${q}%`;
  const p = tablePrefix;
  where.push(`(
    ${p}issue LIKE ? OR
    ${p}department LIKE ? OR
    ${p}name LIKE ? OR
    ${p}solution LIKE ? OR
    ${p}remarks LIKE ? OR
    ${p}type LIKE ?
  )`);
  binds.push(like, like, like, like, like, like);
}

export function buildFtsQuery(q) {
  const tokens = String(q || "")
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!tokens.length) return "";

  const perToken = tokens.map((tok) => {
    const phrase = `"${String(tok).replace(/"/g, '""')}"`;
    const ors = FTS_FIELDS.map((f) => `${f}:${phrase}`).join(" OR ");
    return `(${ors})`;
  });

  return perToken.join(" AND ");
}
