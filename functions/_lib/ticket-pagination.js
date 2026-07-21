export function parsePageNumber(value, { min = 1, max = 1000000, fallback = 1 } = {}) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function decodeBase64Url(input) {
  const value = String(input || "").trim();
  if (!value) return "";

  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

function encodeBase64Url(input) {
  return btoa(String(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeCursor(raw) {
  const decoded = decodeBase64Url(raw);
  if (!decoded) return null;

  try {
    const value = JSON.parse(decoded);
    const id = Number(value?.id);
    const sortValue = String(value?.v ?? "");
    return sortValue && Number.isFinite(id) ? { v: sortValue, id: Math.trunc(id) } : null;
  } catch {
    return null;
  }
}

export function encodeCursor({ v, id }) {
  return encodeBase64Url(JSON.stringify({ v: String(v), id: Number(id) }));
}

export function buildCursorClause({ cursor, direction, sortColumn, idColumn = "id" }) {
  if (!cursor) return { sql: "", binds: [], reverseResults: false };

  const isPrevious = direction === "prev";
  const operator = isPrevious ? "<" : ">";
  return {
    sql: `(${sortColumn} ${operator} ? OR (${sortColumn} = ? AND ${idColumn} ${operator} ?))`,
    binds: [cursor.v, cursor.v, cursor.id],
    reverseResults: isPrevious,
  };
}

export function buildPageWindow({ cursor, direction, page, pageSize, sortColumn, idColumn = "id" }) {
  const cursorClause = buildCursorClause({ cursor, direction, sortColumn, idColumn });
  if (cursorClause.sql) {
    return {
      ...cursorClause,
      limitSql: "LIMIT ?",
      limitBinds: [pageSize],
    };
  }

  return {
    ...cursorClause,
    limitSql: "LIMIT ? OFFSET ?",
    limitBinds: [pageSize, (page - 1) * pageSize],
  };
}