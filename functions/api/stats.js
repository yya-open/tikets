/**
 * GET /api/stats
 *
 * Query:
 *   - trash=1
 *   - from=YYYY-MM-DD
 *   - to=YYYY-MM-DD
 *   - type=xxx
 *   - q=keyword
 *
 * Response (all numbers):
 *   {
 *     trash: 0|1,
 *     total_all: number,
 *     total_filtered: number,
 *     type_counts: { [type: string]: number },
 *     month_counts: { [yyyy-MM: string]: number }
 *   }
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

function normalizeDateParam(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

function normalizeTextParam(raw) {
  return String(raw ?? "").trim();
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());

  const from = normalizeDateParam(url.searchParams.get("from"));
  const to = normalizeDateParam(url.searchParams.get("to"));
  const type = normalizeTextParam(url.searchParams.get("type"));
  const qRaw = normalizeTextParam(url.searchParams.get("q"));
  const q = qRaw.length > 120 ? qRaw.slice(0, 120) : qRaw;

  // base condition (new schema)
  const baseWhere = ["is_deleted=?"];
  const baseBinds = [trash ? 1 : 0];

  // filtered condition
  const where = ["is_deleted=?"];
  const binds = [trash ? 1 : 0];

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

  const baseWhereSql = `WHERE ${baseWhere.join(" AND ")}`;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countAllSql = `SELECT COUNT(*) as total FROM tickets ${baseWhereSql}`;
  const countFilteredSql = `SELECT COUNT(*) as total FROM tickets ${whereSql}`;

  const typeSql = `
    SELECT COALESCE(NULLIF(TRIM(type),''),'未分类') as k, COUNT(*) as c
    FROM tickets
    ${whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `;

  const monthSql = `
    SELECT substr(date,1,7) as k, COUNT(*) as c
    FROM tickets
    ${whereSql}
    GROUP BY k
    ORDER BY k ASC
  `;

  try {
    const allRow = await env.DB.prepare(countAllSql).bind(...baseBinds).first();
    const filteredRow = await env.DB.prepare(countFilteredSql).bind(...binds).first();

    const total_all = Number(allRow?.total ?? 0) || 0;
    const total_filtered = Number(filteredRow?.total ?? 0) || 0;

    const typeRes = await env.DB.prepare(typeSql).bind(...binds).all();
    const monthRes = await env.DB.prepare(monthSql).bind(...binds).all();

    const type_counts = {};
    for (const r of (typeRes?.results ?? [])) {
      type_counts[String(r.k)] = Number(r.c) || 0;
    }

    const month_counts = {};
    for (const r of (monthRes?.results ?? [])) {
      if (!r.k) continue;
      month_counts[String(r.k)] = Number(r.c) || 0;
    }

    return jsonResponse({
      trash: trash ? 1 : 0,
      total_all,
      total_filtered,
      type_counts,
      month_counts,
    });
  } catch (e) {
    // old schema fallback (no is_deleted)
    const baseWhere2 = [];
    const baseBinds2 = [];

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

    const baseWhereSql2 = baseWhere2.length ? `WHERE ${baseWhere2.join(" AND ")}` : "";
    const whereSql2 = where2.length ? `WHERE ${where2.join(" AND ")}` : "";

    const countAllSql2 = `SELECT COUNT(*) as total FROM tickets ${baseWhereSql2}`;
    const countFilteredSql2 = `SELECT COUNT(*) as total FROM tickets ${whereSql2}`;

    const typeSql2 = `
      SELECT COALESCE(NULLIF(TRIM(type),''),'未分类') as k, COUNT(*) as c
      FROM tickets
      ${whereSql2}
      GROUP BY k
      ORDER BY c DESC, k ASC
    `;

    const monthSql2 = `
      SELECT substr(date,1,7) as k, COUNT(*) as c
      FROM tickets
      ${whereSql2}
      GROUP BY k
      ORDER BY k ASC
    `;

    const allRow = await env.DB.prepare(countAllSql2).bind(...baseBinds2).first();
    const filteredRow = await env.DB.prepare(countFilteredSql2).bind(...binds2).first();

    const total_all = Number(allRow?.total ?? 0) || 0;
    const total_filtered = Number(filteredRow?.total ?? 0) || 0;

    const typeRes = await env.DB.prepare(typeSql2).bind(...binds2).all();
    const monthRes = await env.DB.prepare(monthSql2).bind(...binds2).all();

    const type_counts = {};
    for (const r of (typeRes?.results ?? [])) {
      type_counts[String(r.k)] = Number(r.c) || 0;
    }

    const month_counts = {};
    for (const r of (monthRes?.results ?? [])) {
      if (!r.k) continue;
      month_counts[String(r.k)] = Number(r.c) || 0;
    }

    return jsonResponse({
      trash: trash ? 1 : 0,
      total_all,
      total_filtered,
      type_counts,
      month_counts,
    });
  }
}
