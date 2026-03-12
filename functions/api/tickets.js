import { requireEditKey } from "../_lib/auth.js";
import { jsonResponse, respondCachedJson } from "../_lib/http.js";
import { validateTicketPayload } from "../_lib/validation.js";

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


const FTS_FIELDS = ["issue", "department", "name", "solution", "remarks", "type"];

function escapeFtsPhrase(s) {
  // Wrap as a phrase and escape quotes for FTS5.
  return `"${String(s ?? "").replace(/"/g, '""')}"`;
}

function buildFtsQuery(q) {
  // Conservative multi-field FTS query:
  // - Split by whitespace into terms
  // - For each term: (issue:"term" OR department:"term" OR ...)
  // - AND terms together
  const tokens = String(q || "")
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!tokens.length) return "";

  const perToken = tokens.map((tok) => {
    const phrase = escapeFtsPhrase(tok);
    const ors = FTS_FIELDS.map((f) => `${f}:${phrase}`).join(" OR ");
    return `(${ors})`;
  });

  return perToken.join(" AND ");
}



async function handleGet({ request, env }) {
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

  const hasKeyword = Boolean(q);
  const useCursor = Boolean(cursor) && !hasKeyword;

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
  const useRelevanceOrder = wantFts && hasKeyword;

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


  if (useRelevanceOrder) {
    // Relevance first, then newest updated.
    orderSql = "ORDER BY bm25(tickets_fts) ASC, COALESCE(tickets.updated_at_ts,0) DESC, tickets.id DESC";
  }

  if (useCursor) {
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
    const rows = Array.isArray(results) ? (direction === "prev" && useCursor ? results.slice().reverse() : results) : [];

    const first = rows.length ? rows[0] : null;
    const last = rows.length ? rows[rows.length - 1] : null;
    const cursorKey = trash ? "deleted_at" : "date";
    const prev_cursor = useCursor && first ? encodeCursor({ v: first[cursorKey], id: first.id }) : null;
    const next_cursor = useCursor && last ? encodeCursor({ v: last[cursorKey], id: last.id }) : null;

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
      if (useCursor) {
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
      const rowsLike = Array.isArray(resLike) ? (direction === 'prev' && useCursor ? resLike.slice().reverse() : resLike) : [];
      const firstLike = rowsLike.length ? rowsLike[0] : null;
      const lastLike = rowsLike.length ? rowsLike[rowsLike.length - 1] : null;
      const prev_cursorLike = useCursor && firstLike ? encodeCursor({ v: firstLike[sortCol2], id: firstLike.id }) : null;
      const next_cursorLike = useCursor && lastLike ? encodeCursor({ v: lastLike[sortCol2], id: lastLike.id }) : null;
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
    return jsonResponse({ ok: false, error: "invalid_json", code: "invalid_json" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const checked = validateTicketPayload(body);
  if (!checked.ok) {
    return jsonResponse({ ok: false, error: "validation_error", code: "validation_error", fields: checked.errors }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const { date, issue, department, name, solution, remarks, type } = checked.data;
  const nowTs = Date.now();

  let result;
  try {
    result = await env.DB
      .prepare(
        `INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, nowTs)
      .run();
  } catch (e) {
    return jsonResponse({ ok: false, error: "insert_failed", code: "insert_failed", detail: String(e?.message || e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }

  return jsonResponse({ ok: true, id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs }, { status: 201, headers: { "cache-control": "no-store" } });
}

function isCacheableGet(request) {
  // Only cache public read requests (no edit key)
  if ((request.method || "GET").toUpperCase() !== "GET") return false;
  const k = request.headers.get("x-edit-key") || request.headers.get("X-EDIT-KEY");
  if (k && String(k).trim()) return false;
  return true;
}

export async function onRequestGet(ctx) {
  const request = ctx.request;
  const env = ctx.env;
  if (!isCacheableGet(request)) {
    return await handleGet({ request, env });
  }

  const url = new URL(request.url);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set("x-edge-cache", "HIT");
    return new Response(hit.body, { status: hit.status, headers: h });
  }


  const res = await handleGet({ request, env });
  // Cache only successful JSON responses (avoid caching 304/errors)
  if (res && res.status === 200) {
    // Ensure edge can cache: add s-maxage if not present
    const cc = res.headers.get("cache-control") || "";
    if (!/s-maxage=\d+/i.test(cc)) {
      const headers = new Headers(res.headers);
      const maxAgeMatch = /max-age=(\d+)/i.exec(cc);
      const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 30;
      headers.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`);
      const cloned = new Response(res.body, { status: res.status, headers });
      await cache.put(cacheKey, cloned.clone());
      return cloned;
    }
    await cache.put(cacheKey, res.clone());
  }
  return res;
}
