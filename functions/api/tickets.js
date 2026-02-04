/**
 * GET  /api/tickets
 *
 * Query:
 *   - trash=1            -> recycle bin
 *   - from=YYYY-MM-DD
 *   - to=YYYY-MM-DD
 *   - type=xxx
 *   - q=keyword          -> LIKE search across issue/department/name/solution/remarks/type
 *   - page=1
 *   - pageSize=100       -> capped to 100
 *   - cursor=<b64url>    -> keyset pagination cursor (optional)
 *   - direction=next|prev
 *
 * Response:
 *   { data: Ticket[], page, pageSize, total, next_cursor?, prev_cursor? }
 *
 * POST /api/tickets -> create ticket (requires X-EDIT-KEY)
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

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(input)));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function respondCachedJson(request, payload, { maxAge = 30, status = 200 } = {}) {
  const body = JSON.stringify(payload);
  const etag = `W/"${await sha256Hex(body)}"`;

  const headers = {
    "content-type": "application/json; charset=UTF-8",
    "cache-control": `public, max-age=${Math.max(0, Math.trunc(maxAge))}`,
    etag,
    vary: "accept-encoding",
  };

  const inm = request.headers.get("if-none-match") || request.headers.get("If-None-Match") || "";
  if (inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status, headers });
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

function clampInt(n, { min = 1, max = 1000000, fallback = 1 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function b64urlDecodeToString(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const base64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

function b64urlEncodeFromString(input) {
  const b64 = btoa(String(input));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(raw) {
  const txt = b64urlDecodeToString(raw);
  if (!txt) return null;
  try {
    const obj = JSON.parse(txt);
    if (!obj) return null;
    const v = String(obj.v ?? "");
    const id = Number(obj.id);
    if (!v || !Number.isFinite(id)) return null;
    return { v, id: Math.trunc(id) };
  } catch {
    return null;
  }
}

function encodeCursor({ v, id }) {
  return b64urlEncodeFromString(JSON.stringify({ v: String(v), id: Number(id) }));
}

function normalizeDateParam(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // strict YYYY-MM-DD to keep lexicographic comparisons correct
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

function normalizeTextParam(raw) {
  return String(raw ?? "").trim();
}


function buildFtsQuery(q) {
  // Build a conservative FTS MATCH query:
  // split by whitespace, quote each token, AND them together.
  const tokens = String(q || "")
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12); // limit terms
  if (!tokens.length) return "";
  const quoted = tokens.map((t) => `"${t.replace(/"/g, '""')}"`);
  return quoted.join(" AND ");
}


export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());

  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const directionRaw = String(url.searchParams.get("direction") || url.searchParams.get("dir") || "").toLowerCase();
  const direction = directionRaw === "prev" || directionRaw === "previous" ? "prev" : "next";

  const page = clampInt(url.searchParams.get("page"), { min: 1, fallback: 1 });
  const pageSize = clampInt(url.searchParams.get("pageSize"), { min: 1, max: 100, fallback: 100 });
  const offset = (page - 1) * pageSize;

  const from = normalizeDateParam(url.searchParams.get("from"));
  const to = normalizeDateParam(url.searchParams.get("to"));
  const type = normalizeTextParam(url.searchParams.get("type"));
  const qRaw = normalizeTextParam(url.searchParams.get("q"));

  // LIKE keyword: keep it short to reduce abuse.
  const q = qRaw.length > 120 ? qRaw.slice(0, 120) : qRaw;

  // Build WHERE + bind params (new schema)
  const where = [];
  const binds = [];

  where.push("is_deleted=?");
  binds.push(trash ? 1 : 0);

  if (from) {
    where.push("date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("date <= ?");
    binds.push(to);
  }
  if (type) {
    where.push("type = ?");
    binds.push(type);
  }

  // Keyword search: prefer FTS if available; fallback to LIKE if FTS table is missing.
  const ftsQuery = q ? buildFtsQuery(q) : "";
  const wantFts = Boolean(ftsQuery);

  let fromSql = "FROM tickets";
  let selectSql = "SELECT tickets.*";
  if (wantFts) {
    // Join FTS table (rowid maps to tickets.id).
    fromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
    // Fallback: LIKE (kept for compatibility and non-tokenized languages).
    const like = `%${q}%`;
    where.push(`(
      issue LIKE ? OR
      department LIKE ? OR
      name LIKE ? OR
      solution LIKE ? OR
      remarks LIKE ? OR
      type LIKE ?
    )`);
    binds.push(like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = trash ? "tickets.deleted_at" : "tickets.date";

  // Keyset pagination: if cursor exists, we add an extra WHERE clause and avoid OFFSET.
  const cursorWhere = [];
  const cursorBinds = [];
  let orderSql = trash
    ? "ORDER BY deleted_at ASC, id ASC"
    : "ORDER BY date ASC, id ASC";

  if (cursor) {
    if (direction === "next") {
      cursorWhere.push(`(${sortCol} > ? OR (${sortCol} = ? AND tickets.id > ?))`);
      cursorBinds.push(cursor.v, cursor.v, cursor.id);
      // keep ASC order
    } else {
      cursorWhere.push(`(${sortCol} < ? OR (${sortCol} = ? AND tickets.id < ?))`);
      cursorBinds.push(cursor.v, cursor.v, cursor.id);
      // fetch previous page in DESC order then reverse in memory
      orderSql = trash
        ? "ORDER BY deleted_at DESC, id DESC"
        : "ORDER BY date DESC, id DESC";
    }
  }

  const whereSqlWithCursor = cursorWhere.length
    ? (whereSql ? `${whereSql} AND ${cursorWhere.join(" AND ")}` : `WHERE ${cursorWhere.join(" AND ")}`)
    : whereSql;

  const listSql = cursor
    ? `${selectSql} ${fromSql} ${whereSqlWithCursor} ${orderSql} LIMIT ?`
    : `${selectSql} ${fromSql} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total ${fromSql} ${whereSql}`;
  try {
    const countRow = await env.DB.prepare(countSql).bind(...binds).first();
    const total = Number(countRow?.total ?? 0) || 0;

    const listStmt = env.DB.prepare(listSql);
    const bound = cursor
      ? listStmt.bind(...binds, ...cursorBinds, pageSize)
      : listStmt.bind(...binds, pageSize, offset);
    const { results } = await bound.all();

    // If direction=prev we fetched in DESC order; reverse back to ASC for consistent UI.
    const rows = Array.isArray(results) ? (direction === "prev" && cursor ? results.slice().reverse() : results) : [];

    const first = rows.length ? rows[0] : null;
    const last = rows.length ? rows[rows.length - 1] : null;
    const cursorKey = trash ? "deleted_at" : "date";
    const prev_cursor = first ? encodeCursor({ v: first[cursorKey], id: first.id }) : null;
    const next_cursor = last ? encodeCursor({ v: last[cursorKey], id: last.id }) : null;

    return await respondCachedJson(
      request,
      { data: rows, page, pageSize, total, next_cursor, prev_cursor },
      { maxAge: 30 }
    );
  } catch (e) {
    const msg = String(e?.message || e);
    // If FTS table is missing or MATCH fails, fallback to LIKE but keep the new schema.
    if (msg.includes('no such table: tickets_fts') || msg.includes('no such module: fts5') || msg.includes('unable to use function MATCH')) {
      // Re-run query with LIKE (no JOIN) under the new schema.
      const whereLike = [];
      const bindsLike = [];
      whereLike.push('is_deleted=?');
      bindsLike.push(trash ? 1 : 0);
      if (from) { whereLike.push('date >= ?'); bindsLike.push(from); }
      if (to) { whereLike.push('date <= ?'); bindsLike.push(to); }
      if (type) { whereLike.push('type = ?'); bindsLike.push(type); }
      if (q) {
        const like = `%${q}%`;
        whereLike.push(`(
          issue LIKE ? OR
          department LIKE ? OR
          name LIKE ? OR
          solution LIKE ? OR
          remarks LIKE ? OR
          type LIKE ?
        )`);
        bindsLike.push(like, like, like, like, like, like);
      }
      const whereLikeSql = whereLike.length ? `WHERE ${whereLike.join(' AND ')}` : '';
      const sortCol2 = trash ? 'deleted_at' : 'date';
      // Keyset cursor logic reused (no JOIN)
      const cursorWhere2 = [];
      const cursorBinds2 = [];
      let orderSql2 = trash ? 'ORDER BY deleted_at ASC, id ASC' : 'ORDER BY date ASC, id ASC';
      if (cursor) {
        if (direction === 'next') {
          cursorWhere2.push(`(${sortCol2} > ? OR (${sortCol2} = ? AND id > ?))`);
          cursorBinds2.push(cursor.v, cursor.v, cursor.id);
        } else {
          cursorWhere2.push(`(${sortCol2} < ? OR (${sortCol2} = ? AND id < ?))`);
          cursorBinds2.push(cursor.v, cursor.v, cursor.id);
          orderSql2 = trash ? 'ORDER BY deleted_at DESC, id DESC' : 'ORDER BY date DESC, id DESC';
        }
      }
      const whereLikeSqlWithCursor = cursorWhere2.length
        ? (whereLikeSql ? `${whereLikeSql} AND ${cursorWhere2.join(' AND ')}` : `WHERE ${cursorWhere2.join(' AND ')}`)
        : whereLikeSql;
      const listLikeSql = cursor
        ? `SELECT * FROM tickets ${whereLikeSqlWithCursor} ${orderSql2} LIMIT ?`
        : `SELECT * FROM tickets ${whereLikeSql} ${orderSql2} LIMIT ? OFFSET ?`;
      const countLikeSql = `SELECT COUNT(*) as total FROM tickets ${whereLikeSql}`;
      const countRowLike = await env.DB.prepare(countLikeSql).bind(...bindsLike).first();
      const totalLike = Number(countRowLike?.total ?? 0) || 0;
      const stmtLike = env.DB.prepare(listLikeSql);
      const boundLike = cursor
        ? stmtLike.bind(...bindsLike, ...cursorBinds2, pageSize)
        : stmtLike.bind(...bindsLike, pageSize, offset);
      const { results: resLike } = await boundLike.all();
      const rowsLike = Array.isArray(resLike) ? (direction === 'prev' && cursor ? resLike.slice().reverse() : resLike) : [];
      const firstLike = rowsLike.length ? rowsLike[0] : null;
      const lastLike = rowsLike.length ? rowsLike[rowsLike.length - 1] : null;
      const prev_cursorLike = firstLike ? encodeCursor({ v: firstLike[sortCol2], id: firstLike.id }) : null;
      const next_cursorLike = lastLike ? encodeCursor({ v: lastLike[sortCol2], id: lastLike.id }) : null;
      return await respondCachedJson(
        request,
        { data: rowsLike, page, pageSize, total: totalLike, next_cursor: next_cursorLike, prev_cursor: prev_cursorLike },
        { maxAge: 30 }
      );
    }

    // Backward compatible fallback (old schema without is_deleted/deleted_at)
    const where2 = [];
    const binds2 = [];

    if (from) {
      where2.push("date >= ?");
      binds2.push(from);
    }
    if (to) {
      where2.push("date <= ?");
      binds2.push(to);
    }
    if (type) {
      where2.push("type = ?");
      binds2.push(type);
    }
  // Keyword search: prefer FTS if available; fallback to LIKE if FTS table is missing.
  const ftsQuery = q ? buildFtsQuery(q) : "";
  const wantFts = Boolean(ftsQuery);

  let fromSql = "FROM tickets";
  let selectSql = "SELECT tickets.*";
  if (wantFts) {
    // Join FTS table (rowid maps to tickets.id).
    fromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
    // Fallback: LIKE (kept for compatibility and non-tokenized languages).
    const like = `%${q}%`;
    where.push(`(
      issue LIKE ? OR
      department LIKE ? OR
      name LIKE ? OR
      solution LIKE ? OR
      remarks LIKE ? OR
      type LIKE ?
    )`);
    binds.push(like, like, like, like, like, like);
  }

    const whereSql2 = where2.length ? `WHERE ${where2.join(" AND ")}` : "";
    // Old schema fallback: no trash/cursor. We keep OFFSET mode; keyset not guaranteed.
    const listSql2 = `SELECT * FROM tickets ${whereSql2} ORDER BY date ASC, id ASC LIMIT ? OFFSET ?`;
    const countSql2 = `SELECT COUNT(*) as total FROM tickets ${whereSql2}`;

    const countRow2 = await env.DB.prepare(countSql2).bind(...binds2).first();
    const total2 = Number(countRow2?.total ?? 0) || 0;

    const { results } = await env.DB.prepare(listSql2).bind(...binds2, pageSize, offset).all();
    return await respondCachedJson(
      request,
      { data: results ?? [], page, pageSize, total: total2 },
      { maxAge: 30 }
    );
  }
}

export async function onRequestPost({ request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const date = String(body?.date ?? "").trim();
  const issue = String(body?.issue ?? "").trim();
  if (!date || !issue) {
    return jsonResponse({ ok: false, error: "date & issue required" }, { status: 400 });
  }

  const department = String(body?.department ?? "");
  const name = String(body?.name ?? "");
  const solution = String(body?.solution ?? "");
  const remarks = String(body?.remarks ?? "");
  const type = String(body?.type ?? "");

  const nowTs = Date.now();

  // Ensure the column exists (safe no-op if it already exists)
  try {
    await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN updated_at_ts INTEGER`).run();
  } catch (_) {}

  // Insert with explicit updated_at_ts (direction A). If this fails, return the real error instead of silently falling back.
  let r;
  try {
    r = await env.DB
      .prepare(
        `INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, nowTs)
      .run();
  } catch (e) {
    return jsonResponse(
      { ok: false, error: "insert_failed", detail: String(e?.message || e) },
      { status: 500 }
    );
  }

  const id = r?.meta?.last_row_id ?? null;

  // Hard guarantee: if for any reason the inserted row still has NULL/0, backfill just that row.
  if (id != null) {
    try {
      await env.DB
        .prepare(`UPDATE tickets SET updated_at_ts=? WHERE id=? AND (updated_at_ts IS NULL OR updated_at_ts=0)`)
        .bind(nowTs, id)
        .run();
    } catch (_) {}
  }

  return jsonResponse(
    { ok: true, id, updated_at_ts: nowTs, post_build: "directionA-ts-20260204" },
    { status: 201 }
  );
}