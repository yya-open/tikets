export function pickFirstNonEmptyArray(...arrs) {
  for (const a of arrs) if (Array.isArray(a) && a.length > 0) return a;
  for (const a of arrs) if (Array.isArray(a)) return a;
  return [];
}

export function parseUpdatedAtToTs(updatedAt) {
  const s = String(updatedAt || '').trim();
  if (!s) return 0;
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return parsed;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  return 0;
}

export function parseImportPayload(payload) {
  if (Array.isArray(payload)) return { active: payload, trash: [] };
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.active) || Array.isArray(payload.trash)) {
      return {
        active: Array.isArray(payload.active) ? payload.active : [],
        trash: Array.isArray(payload.trash) ? payload.trash : [],
      };
    }
    return {
      active: pickFirstNonEmptyArray(payload.records, payload.data, payload.tickets, payload.items),
      trash: pickFirstNonEmptyArray(payload.trash, payload.deleted, payload.recycle_bin),
    };
  }
  return null;
}

export function normalizeImportRecord(record, forcedDeleted = null) {
  const obj = record && typeof record === 'object' ? record : {};
  const idNum = Number(obj.id ?? obj.ID ?? obj.Id);
  const id = Number.isFinite(idNum) ? Math.trunc(idNum) : null;
  const updated_at = String(obj.updated_at ?? obj.updatedAt ?? '').trim();
  const tsRaw = obj.updated_at_ts ?? obj.updatedAtTs ?? obj.updatedAtTS ?? obj.updated_atTs;
  const tsNum = Number(tsRaw);
  const updated_at_ts = Number.isFinite(tsNum) && tsNum > 0 ? Math.trunc(tsNum) : parseUpdatedAtToTs(updated_at);
  const rawDeleted = Number(obj.is_deleted ?? obj.isDeleted ?? obj.__is_deleted ?? 0) ? 1 : 0;
  const is_deleted = forcedDeleted === null ? rawDeleted : (forcedDeleted ? 1 : 0);
  const deleted_at = is_deleted ? String(obj.deleted_at ?? obj.deletedAt ?? '').trim() : '';
  return {
    id,
    date: String(obj.date ?? obj.日期 ?? obj.time ?? obj.createdAt ?? '').trim(),
    issue: String(obj.issue ?? obj.问题 ?? obj.question ?? obj.title ?? obj.subject ?? '').trim(),
    department: String(obj.department ?? obj.dept ?? obj.部门 ?? obj.departmentName ?? ''),
    name: String(obj.name ?? obj.owner ?? obj.person ?? obj.姓名 ?? obj.handler ?? ''),
    solution: String(obj.solution ?? obj.method ?? obj.处理方法 ?? obj.fix ?? ''),
    remarks: String(obj.remarks ?? obj.remark ?? obj.备注 ?? obj.note ?? ''),
    type: String(obj.type ?? obj.类型 ?? obj.category ?? ''),
    updated_at,
    updated_at_ts,
    has_version: updated_at_ts > 0 || !!updated_at,
    is_deleted,
    deleted_at,
  };
}

export function normalizeImportPayload(parsed) {
  const active = Array.isArray(parsed?.active) ? parsed.active.map((r) => normalizeImportRecord(r, 0)) : [];
  const trash = Array.isArray(parsed?.trash) ? parsed.trash.map((r) => normalizeImportRecord(r, 1)) : [];
  return { active, trash, all: [...active, ...trash] };
}

export function validateImportRecords(records) {
  const bad = records.find((r) => !r.date || !r.issue);
  return bad ? 'date & issue required for all records' : '';
}

export async function getTicketColumns(db) {
  const { results } = await db.prepare('PRAGMA table_info(tickets)').all();
  return new Set((results || []).map((row) => String(row.name)));
}

export async function assertImportSchemaReady(db) {
  const cols = await getTicketColumns(db);
  const required = ['id', 'date', 'issue', 'department', 'name', 'solution', 'remarks', 'type', 'updated_at', 'updated_at_ts', 'is_deleted', 'deleted_at'];
  const missing = required.filter((name) => !cols.has(name));
  return { ok: missing.length === 0, missing };
}

export async function fetchExistingVersionMap(db, ids) {
  const uniq = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
  const map = new Map();
  const CHUNK = 100;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const part = uniq.slice(i, i + CHUNK);
    if (!part.length) continue;
    const placeholders = part.map(() => '?').join(',');
    const { results } = await db.prepare(`SELECT id, updated_at, updated_at_ts FROM tickets WHERE id IN (${placeholders})`).bind(...part).all();
    for (const row of results || []) {
      map.set(Number(row.id), {
        updated_at: String(row.updated_at ?? '').trim(),
        updated_at_ts: Number(row.updated_at_ts ?? 0) || 0,
      });
    }
  }
  return map;
}

export async function tryRebuildFts(db) {
  try {
    await db.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
    return { ok: true };
  } catch (e) {
    const msg = String(e || '');
    if (/no such table: tickets_fts/i.test(msg) || /no such module: fts5/i.test(msg)) {
      return { ok: false, skipped: true };
    }
    return { ok: false, error: msg };
  }
}

export function assignSequentialIds(records) {
  let nextId = records.reduce((max, row) => (Number.isFinite(row.id) ? Math.max(max, row.id) : max), 0) + 1;
  return records.map((row) => {
    if (Number.isFinite(row.id)) return row;
    const out = { ...row, id: nextId };
    nextId += 1;
    return out;
  });
}

export function shouldOverwrite(existing, incoming) {
  if (!existing) return true;
  const incomingTs = Number(incoming.updated_at_ts ?? 0) || 0;
  const existingTs = Number(existing.updated_at_ts ?? 0) || 0;
  if (incomingTs > 0) return incomingTs > existingTs;
  if (incoming.updated_at) return String(incoming.updated_at) > String(existing.updated_at || '');
  return false;
}
