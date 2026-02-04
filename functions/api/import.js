/**
 * PUT /api/import
 * Replace ALL tickets with the provided payload (dangerous but useful for restore).
 *
 * Supported body formats:
 * 1) Array of records: [{id,date,issue,department,name,solution,remarks,type,...}, ...]
 * 2) Object with active/trash:
 *    {
 *      active: [...],
 *      trash: [...]
 *    }
 *
 * D1 binding name: DB
 */
function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function getEditKeyFromRequest(request) {
  const url = new URL(request.url);
  return (
    request.headers.get("X-EDIT-KEY") ||
    request.headers.get("x-edit-key") ||
    url.searchParams.get("key") ||
    ""
  );
}

function requireEditKey(request, env) {
  const expected = String(env.EDIT_KEY || "");
  if (!expected) {
    return new Response("Server misconfigured: EDIT_KEY is not set", { status: 500 });
  }
  const provided = getEditKeyFromRequest(request);
  if (provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function pickFirstNonEmptyArray(...arrs) {
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) return a;
  }
  for (const a of arrs) {
    if (Array.isArray(a)) return a;
  }
  return [];
}

export async function onRequestPut({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  let active = [];
  let trash = [];

  if (Array.isArray(payload)) {
    active = payload;
  } else if (payload && typeof payload === "object") {
    // try common keys
    active = pickFirstNonEmptyArray(payload.active, payload.records, payload.data, payload.tickets);
    trash = pickFirstNonEmptyArray(payload.trash, payload.deleted, payload.recycle_bin);
  } else {
    return jsonResponse({ ok: false, error: "Expected an array or {active,trash}" }, { status: 400 });
  }

  // Normalize
  const all = [];
  for (const r of active) all.push({ ...r, __is_deleted: 0 });
  for (const r of trash) all.push({ ...r, __is_deleted: 1 });

  // Clear
  await env.DB.prepare("DELETE FROM tickets").run();

  // Prefer new schema insert
  const insertNew = env.DB.prepare(
    `INSERT INTO tickets (
        id, date, issue, department, name, solution, remarks, type,
        is_deleted, deleted_at, updated_at, updated_at_ts
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertOld = env.DB.prepare(
    `INSERT INTO tickets (id, date, issue, department, name, solution, remarks, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const BATCH = 100;
  let inserted = 0;
  let usedNew = true;

  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);

    try {
      const stmts = chunk.map((r) => {
        const id = Number(r?.id);
        const safeId = Number.isFinite(id) ? id : null;
        const date = String(r?.date ?? "").trim();
        const issue = String(r?.issue ?? "").trim();

        const isDeleted = Number(r?.is_deleted ?? r?.isDeleted ?? r?.__is_deleted ?? 0) ? 1 : 0;
        const deletedAt = r?.deleted_at ?? r?.deletedAt ?? (isDeleted ? (r?.deleted_at || null) : null);
        const updatedAt = r?.updated_at ?? r?.updatedAt ?? null;
        const tsRaw = r?.updated_at_ts ?? r?.updatedAtTs ?? r?.updatedAtTS ?? r?.updated_atTs;
        let updatedAtTs = Number(tsRaw);
        if (!Number.isFinite(updatedAtTs) || updatedAtTs <= 0) {
          // Try to derive from updatedAt string (SQLite format or ISO). Fallback to now.
          const s = String(updatedAt ?? "").trim();
          const p = Date.parse(s);
          if (Number.isFinite(p)) updatedAtTs = p;
          else {
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
            if (m) updatedAtTs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
            else updatedAtTs = Date.now();
          }
        }

        return insertNew.bind(
          safeId,
          date,
          issue,
          String(r?.department ?? ""),
          String(r?.name ?? ""),
          String(r?.solution ?? ""),
          String(r?.remarks ?? ""),
          String(r?.type ?? ""),
          isDeleted,
          deletedAt,
          updatedAt,
          updatedAtTs
        );
      });

      await env.DB.batch(stmts);
      inserted += chunk.length;
    } catch (e) {
      // Schema doesn't have soft delete cols; fallback to old insert for this and remaining batches
      usedNew = false;
      const stmts = chunk.map((r) => {
        const id = Number(r?.id);
        const safeId = Number.isFinite(id) ? id : null;
        const date = String(r?.date ?? "").trim();
        const issue = String(r?.issue ?? "").trim();

        return insertOld.bind(
          safeId,
          date,
          issue,
          String(r?.department ?? ""),
          String(r?.name ?? ""),
          String(r?.solution ?? ""),
          String(r?.remarks ?? ""),
          String(r?.type ?? "")
        );
      });
      await env.DB.batch(stmts);
      inserted += chunk.length;
    }
  }

  return jsonResponse({ ok: true, inserted, mode: usedNew ? "new_schema" : "old_schema" });
}
