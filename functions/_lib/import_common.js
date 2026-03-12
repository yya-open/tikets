function pickFirstNonEmptyArray(...arrs) {
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) return a;
  }
  for (const a of arrs) {
    if (Array.isArray(a)) return a;
  }
  return [];
}

export function parseImportPayload(payload) {
  if (Array.isArray(payload)) {
    return { active: payload, trash: [] };
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.active) || Array.isArray(payload.trash)) {
      return {
        active: Array.isArray(payload.active) ? payload.active : [],
        trash: Array.isArray(payload.trash) ? payload.trash : [],
      };
    }
    return {
      active: pickFirstNonEmptyArray(payload.records, payload.data, payload.tickets, payload.items),
      trash: pickFirstNonEmptyArray(payload.deleted, payload.recycle_bin),
    };
  }
  return null;
}

export function parseUpdatedAtToTs(updatedAt) {
  const s = String(updatedAt || "").trim();
  if (!s) return 0;
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return parsed;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export function normalizeImportRecord(record, forcedDeleted = null) {
  const obj = record && typeof record === "object" ? record : {};
  const idNum = Number(obj.id ?? obj.ID ?? obj.Id);
  const id = Number.isFinite(idNum) ? Math.trunc(idNum) : null;
  const updated_at = String(obj.updated_at ?? obj.updatedAt ?? "").trim();
  const updated_at_ts = (() => {
    const raw = Number(obj.updated_at_ts ?? obj.updatedAtTs ?? obj.updatedAtTS ?? obj.updated_atTs);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : parseUpdatedAtToTs(updated_at);
  })();
  const is_deleted = forcedDeleted === null ? (Number(obj.is_deleted ?? obj.isDeleted ?? obj.__is_deleted ?? 0) ? 1 : 0) : forcedDeleted;
  const deleted_at = is_deleted ? String(obj.deleted_at ?? obj.deletedAt ?? "").trim() : "";
  return {
    id,
    date: String(obj.date ?? "").trim(),
    issue: String(obj.issue ?? "").trim(),
    department: String(obj.department ?? "").trim(),
    name: String(obj.name ?? "").trim(),
    solution: String(obj.solution ?? "").trim(),
    remarks: String(obj.remarks ?? "").trim(),
    type: String(obj.type ?? "").trim(),
    updated_at,
    updated_at_ts,
    is_deleted,
    deleted_at,
  };
}

export function normalizeImportPayload(parsed) {
  const active = (parsed?.active || []).map((r) => normalizeImportRecord(r, 0));
  const trash = (parsed?.trash || []).map((r) => normalizeImportRecord(r, 1));
  return { active, trash, all: [...active, ...trash] };
}

export async function fetchExistingMap(env, ids) {
  const map = new Map();
  const uniq = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
  const CHUNK = 100;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `SELECT id, date, issue, updated_at, updated_at_ts, is_deleted FROM tickets WHERE id IN (${placeholders})`;
    const { results } = await env.DB.prepare(sql).bind(...chunk).all();
    for (const row of results || []) {
      map.set(Number(row.id), {
        id: Number(row.id),
        date: String(row.date || ""),
        issue: String(row.issue || ""),
        updated_at: String(row.updated_at || "").trim(),
        updated_at_ts: Number(row.updated_at_ts ?? 0) || 0,
        is_deleted: Number(row.is_deleted ?? 0) ? 1 : 0,
      });
    }
  }
  return map;
}

export function summarizeImport(incoming) {
  return incoming.reduce((acc, row) => {
    if (row.is_deleted) acc.trash += 1;
    else acc.active += 1;
    return acc;
  }, { active: 0, trash: 0 });
}

export function diffImport(existingMap, incoming) {
  const details = { inserts: [], updates: [], skips: [], invalid: [] };
  for (const row of incoming) {
    if (!row.date || !row.issue) {
      details.invalid.push({ id: row.id, date: row.date, issue: row.issue, reason: "缺少 date 或 issue" });
      continue;
    }
    if (!Number.isFinite(row.id)) {
      details.inserts.push({ id: null, date: row.date, issue: row.issue, reason: "无 id，按新增处理" });
      continue;
    }
    const existing = existingMap.get(row.id);
    if (!existing) {
      details.inserts.push({ id: row.id, date: row.date, issue: row.issue, reason: "云端不存在该 id" });
      continue;
    }
    const incomingTs = Number(row.updated_at_ts || 0);
    const existingTs = Number(existing.updated_at_ts || 0);
    const newerByTs = incomingTs > 0 && existingTs >= 0 && incomingTs > existingTs;
    const newerByText = incomingTs === 0 && row.updated_at && row.updated_at > (existing.updated_at || "");
    if (newerByTs || newerByText) {
      details.updates.push({
        id: row.id,
        date: row.date,
        issue: row.issue,
        reason: "备份版本更新更晚，将覆盖云端记录",
        server_updated_at: existing.updated_at,
        incoming_updated_at: row.updated_at,
      });
    } else {
      details.skips.push({
        id: row.id,
        date: row.date,
        issue: row.issue,
        reason: "云端版本更新更晚或相同，已保护跳过",
        server_updated_at: existing.updated_at,
        incoming_updated_at: row.updated_at,
      });
    }
  }
  return details;
}

export function summarizeDiff(details, incomingSummary) {
  return {
    incoming: incomingSummary.active + incomingSummary.trash,
    active: incomingSummary.active,
    trash: incomingSummary.trash,
    inserts: details.inserts.length,
    updates: details.updates.length,
    skips: details.skips.length,
    skipped_newer_or_equal: details.skips.length,
    invalid: details.invalid.length,
  };
}

export function pickExamples(details, limit = 8) {
  const slim = (row) => ({
    id: row.id,
    date: row.date,
    issue: row.issue,
    reason: row.reason,
    server_updated_at: row.server_updated_at,
    incoming_updated_at: row.incoming_updated_at,
  });
  return {
    inserts: details.inserts.slice(0, limit).map(slim),
    updates: details.updates.slice(0, limit).map(slim),
    skips: details.skips.slice(0, limit).map(slim),
    invalid: details.invalid.slice(0, limit).map(slim),
  };
}
