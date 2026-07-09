import {
  buildDeletedFilter,
  buildFtsQuery,
  normalizeDateParam,
  normalizeFilterTextParam,
  normalizeStatusDeletedParam,
  normalizeTextParam,
  pushKeywordLikeFilter,
  pushTicketFilters,
} from "../_lib/ticket_query.js";
import { isPublicCacheableGet, jsonResponse, respondCachedJson, withErrorHandler } from "../_lib/http.js";

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

const handleGet = withErrorHandler(async ({ request, env }) => {
  const url = new URL(request.url);
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());

  const from = normalizeDateParam(url.searchParams.get("from"));
  const to = normalizeDateParam(url.searchParams.get("to"));
  const type = normalizeTextParam(url.searchParams.get("type"));
  const department = normalizeFilterTextParam(url.searchParams.get("department"));
  const name = normalizeFilterTextParam(url.searchParams.get("name"));
  const ticketStatus = normalizeFilterTextParam(url.searchParams.get("ticketStatus") || url.searchParams.get("workStatus"));
  const assignee = normalizeFilterTextParam(url.searchParams.get("assignee"));
  const priority = normalizeFilterTextParam(url.searchParams.get("priority"));
  const quickRaw = normalizeFilterTextParam(url.searchParams.get("quick"), 24);
  const quick = ["open", "overdue", "today", "unassigned"].includes(quickRaw) ? quickRaw : "";
  const quickDate = normalizeDateParam(url.searchParams.get("quickDate")) || new Date().toISOString().slice(0, 10);
  const statusDeleted = normalizeStatusDeletedParam(url.searchParams.get("status"));
  const qRaw = normalizeTextParam(url.searchParams.get("q"));
  const deleted = buildDeletedFilter(trash, statusDeleted);
  const q = qRaw.length > 120 ? qRaw.slice(0, 120) : qRaw;

  // base condition (new schema)
  const baseWhere = ["tickets.is_deleted=?"];
  const baseBinds = [deleted];

  // filtered condition
  const where = [];
  const binds = [];
  pushTicketFilters(where, binds, { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate });

  const ftsQuery = q ? buildFtsQuery(q) : "";
  const wantFts = Boolean(ftsQuery);
  let filteredFromSql = "FROM tickets";
  if (wantFts) {
    filteredFromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
    pushKeywordLikeFilter(where, binds, q);
  }

  const baseWhereSql = `WHERE ${baseWhere.join(" AND ")}`;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countAllSql = `SELECT COUNT(*) as total FROM tickets ${baseWhereSql}`;
  const countFilteredSql = `SELECT COUNT(*) as total ${filteredFromSql} ${whereSql}`;

  const typeSql = `
    SELECT COALESCE(NULLIF(TRIM(tickets.type),''),'未分类') as k, COUNT(*) as c
    ${filteredFromSql}
    ${whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `;

  const monthSql = `
    SELECT substr(tickets.date,1,7) as k, COUNT(*) as c
    ${filteredFromSql}
    ${whereSql}
    GROUP BY k
    ORDER BY k ASC
  `;

  const statusSql = `
    SELECT COALESCE(NULLIF(TRIM(tickets.status),''),'待处理') as k, COUNT(*) as c
    ${filteredFromSql}
    ${whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `;

  const assigneeSql = `
    SELECT COALESCE(NULLIF(TRIM(tickets.assignee),''),'未指派') as k, COUNT(*) as c
    ${filteredFromSql}
    ${whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `;

  try {
    const allRow = await env.DB.prepare(countAllSql).bind(...baseBinds).first();
    const filteredRow = await env.DB.prepare(countFilteredSql).bind(...binds).first();

    const total_all = Number(allRow?.total ?? 0) || 0;
    const total_filtered = Number(filteredRow?.total ?? 0) || 0;

    const typeRes = await env.DB.prepare(typeSql).bind(...binds).all();
    const monthRes = await env.DB.prepare(monthSql).bind(...binds).all();
    const statusRes = await env.DB.prepare(statusSql).bind(...binds).all();
    const assigneeRes = await env.DB.prepare(assigneeSql).bind(...binds).all();

    const type_counts = {};
    for (const r of (typeRes?.results ?? [])) {
      type_counts[String(r.k)] = Number(r.c) || 0;
    }

    const month_counts = {};
    for (const r of (monthRes?.results ?? [])) {
      if (!r.k) continue;
      month_counts[String(r.k)] = Number(r.c) || 0;
    }
    const status_counts = {};
    for (const r of (statusRes?.results ?? [])) {
      status_counts[String(r.k)] = Number(r.c) || 0;
    }
    const assignee_counts = {};
    for (const r of (assigneeRes?.results ?? [])) {
      assignee_counts[String(r.k)] = Number(r.c) || 0;
    }

    return await respondCachedJson(
      request,
      {
        trash: deleted ? 1 : 0,
        total_all,
        total_filtered,
        type_counts,
        month_counts,
        status_counts,
        assignee_counts,
      },
      { maxAge: 60 }
    );
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('no such table: tickets_fts') || msg.includes('no such module: fts5') || msg.includes('unable to use function MATCH')) {
      // FTS not available: rerun under new schema with LIKE.
      const whereLike = [];
      const bindsLike = [];
      pushTicketFilters(whereLike, bindsLike, { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate });
      pushKeywordLikeFilter(whereLike, bindsLike, q);
      const whereLikeSql = `WHERE ${whereLike.join(' AND ')}`;
      const countFilteredSqlLike = `SELECT COUNT(*) as total FROM tickets ${whereLikeSql}`;
      const typeSqlLike = `
        SELECT COALESCE(NULLIF(TRIM(tickets.type),''),'未分类') as k, COUNT(*) as c
        FROM tickets
        ${whereLikeSql}
        GROUP BY k
        ORDER BY c DESC, k ASC
      `;
      const monthSqlLike = `
        SELECT substr(tickets.date,1,7) as k, COUNT(*) as c
        FROM tickets
        ${whereLikeSql}
        GROUP BY k
        ORDER BY k ASC
      `;
      const allRow = await env.DB.prepare(countAllSql).bind(...baseBinds).first();
      const filteredRow = await env.DB.prepare(countFilteredSqlLike).bind(...bindsLike).first();
      const total_all = Number(allRow?.total ?? 0) || 0;
      const total_filtered = Number(filteredRow?.total ?? 0) || 0;
      const typeRes = await env.DB.prepare(typeSqlLike).bind(...bindsLike).all();
      const monthRes = await env.DB.prepare(monthSqlLike).bind(...bindsLike).all();
      const type_counts = {};
      for (const r of (typeRes?.results ?? [])) { type_counts[String(r.k)] = Number(r.c) || 0; }
      const month_counts = {};
      for (const r of (monthRes?.results ?? [])) { if (!r.k) continue; month_counts[String(r.k)] = Number(r.c) || 0; }
      return await respondCachedJson(request, { trash: deleted ? 1 : 0, total_all, total_filtered, type_counts, month_counts, status_counts: {}, assignee_counts: {} }, { maxAge: 60 });
    }

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
    if (department) {
      where2.push("department LIKE ?");
      binds2.push(`%${department}%`);
    }
    if (name) {
      where2.push("name LIKE ?");
      binds2.push(`%${name}%`);
    }
    pushKeywordLikeFilter(where2, binds2, q, "");

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

    return await respondCachedJson(
      request,
      {
        trash: deleted ? 1 : 0,
        total_all,
        total_filtered,
        type_counts,
        month_counts,
      },
      { maxAge: 60 }
    );
  }
}

export async function onRequestGet(ctx) {
  const request = ctx.request;
  const env = ctx.env;
  if (!isPublicCacheableGet(request)) {
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
      const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 60;
      headers.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`);
      const cloned = new Response(res.body, { status: res.status, headers });
      await cache.put(cacheKey, cloned.clone());
      return cloned;
    }
    await cache.put(cacheKey, res.clone());
  }
  return res;
}
