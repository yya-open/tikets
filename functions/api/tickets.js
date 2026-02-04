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
 *
 * Response:
 *   { data: Ticket[], page, pageSize, total }
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());

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

  if (q) {
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
  const orderSql = trash
    ? "ORDER BY deleted_at ASC, id ASC"
    : "ORDER BY date ASC, id ASC";

  const listSql = `SELECT * FROM tickets ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total FROM tickets ${whereSql}`;

  try {
    const countRow = await env.DB.prepare(countSql).bind(...binds).first();
    const total = Number(countRow?.total ?? 0) || 0;

    const { results } = await env.DB.prepare(listSql).bind(...binds, pageSize, offset).all();
    return jsonResponse({ data: results ?? [], page, pageSize, total });
  } catch (e) {
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
    if (q) {
      const like = `%${q}%`;
      where2.push(`(
        issue LIKE ? OR
        department LIKE ? OR
        name LIKE ? OR
        solution LIKE ? OR
        remarks LIKE ? OR
        type LIKE ?
      )`);
      binds2.push(like, like, like, like, like, like);
    }

    const whereSql2 = where2.length ? `WHERE ${where2.join(" AND ")}` : "";
    const listSql2 = `SELECT * FROM tickets ${whereSql2} ORDER BY date ASC, id ASC LIMIT ? OFFSET ?`;
    const countSql2 = `SELECT COUNT(*) as total FROM tickets ${whereSql2}`;

    const countRow2 = await env.DB.prepare(countSql2).bind(...binds2).first();
    const total2 = Number(countRow2?.total ?? 0) || 0;

    const { results } = await env.DB.prepare(listSql2).bind(...binds2, pageSize, offset).all();
    return jsonResponse({ data: results ?? [], page, pageSize, total: total2 });
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

  const r = await env.DB
    .prepare(
      `INSERT INTO tickets (date, issue, department, name, solution, remarks, type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(date, issue, department, name, solution, remarks, type)
    .run();

  return jsonResponse({ ok: true, id: r?.meta?.last_row_id ?? null }, { status: 201 });
}
