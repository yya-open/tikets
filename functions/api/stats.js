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
import { isPublicCacheableGet, respondCachedJson, withErrorHandler } from "../_lib/http.js";

function isFtsUnavailable(error) {
  const message = String(error?.message || error);
  return (
    message.includes("no such table: tickets_fts") ||
    message.includes("no such module: fts5") ||
    message.includes("unable to use function MATCH")
  );
}

function isLegacySchema(error) {
  const message = String(error?.message || error);
  return (
    message.includes("no such column") ||
    message.includes("no such table: tickets")
  );
}

function buildStatsPlan(options, { useFts }) {
  const { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate, q } = options;

  const baseBinds = [deleted];
  const where = [];
  const binds = [];
  pushTicketFilters(where, binds, { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate });

  let filteredFromSql = "FROM tickets";
  const ftsQuery = useFts ? buildFtsQuery(q) : "";
  if (ftsQuery) {
    filteredFromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
    pushKeywordLikeFilter(where, binds, q);
  }

  const baseWhereSql = "WHERE tickets.is_deleted=?";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return {
    baseBinds,
    binds,
    countAllSql: `SELECT COUNT(*) as total FROM tickets ${baseWhereSql}`,
    countFilteredSql: `SELECT COUNT(*) as total ${filteredFromSql} ${whereSql}`,
    typeSql: `SELECT COALESCE(NULLIF(TRIM(tickets.type),''),'未分类') as k, COUNT(*) as c ${filteredFromSql} ${whereSql} GROUP BY k ORDER BY c DESC, k ASC`,
    monthSql: `SELECT substr(tickets.date,1,7) as k, COUNT(*) as c ${filteredFromSql} ${whereSql} GROUP BY k ORDER BY k ASC`,
    statusSql: `SELECT COALESCE(NULLIF(TRIM(tickets.status),''),'待处理') as k, COUNT(*) as c ${filteredFromSql} ${whereSql} GROUP BY k ORDER BY c DESC, k ASC`,
    assigneeSql: `SELECT COALESCE(NULLIF(TRIM(tickets.assignee),''),'未指派') as k, COUNT(*) as c ${filteredFromSql} ${whereSql} GROUP BY k ORDER BY c DESC, k ASC`,
  };
}

function buildLegacyStatsPlan(options) {
  const { from, to, type, department, name, q } = options;
  const where = [];
  const binds = [];

  if (from) { where.push("date >= ?"); binds.push(from); }
  if (to) { where.push("date <= ?"); binds.push(to); }
  if (type) { where.push("type = ?"); binds.push(type); }
  if (department) { where.push("department LIKE ?"); binds.push(`%${department}%`); }
  if (name) { where.push("name LIKE ?"); binds.push(`%${name}%`); }
  pushKeywordLikeFilter(where, binds, q, "");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return {
    baseBinds: [],
    binds,
    countAllSql: `SELECT COUNT(*) as total FROM tickets`,
    countFilteredSql: `SELECT COUNT(*) as total FROM tickets ${whereSql}`,
    typeSql: `SELECT COALESCE(NULLIF(TRIM(type),''),'未分类') as k, COUNT(*) as c FROM tickets ${whereSql} GROUP BY k ORDER BY c DESC, k ASC`,
    monthSql: `SELECT substr(date,1,7) as k, COUNT(*) as c FROM tickets ${whereSql} GROUP BY k ORDER BY k ASC`,
    statusSql: null,
    assigneeSql: null,
  };
}

function toCounts(res) {
  const counts = {};
  for (const r of (res?.results ?? [])) {
    if (!r.k) continue;
    counts[String(r.k)] = Number(r.c) || 0;
  }
  return counts;
}

async function executeStatsPlan(db, plan, { trash }) {
  const allRow = await db.prepare(plan.countAllSql).bind(...plan.baseBinds).first();
  const filteredRow = await db.prepare(plan.countFilteredSql).bind(...plan.binds).first();

  const typeRes = await db.prepare(plan.typeSql).bind(...plan.binds).all();
  const monthRes = await db.prepare(plan.monthSql).bind(...plan.binds).all();
  const statusRes = plan.statusSql ? await db.prepare(plan.statusSql).bind(...plan.binds).all() : { results: [] };
  const assigneeRes = plan.assigneeSql ? await db.prepare(plan.assigneeSql).bind(...plan.binds).all() : { results: [] };

  return {
    trash: trash ? 1 : 0,
    total_all: Number(allRow?.total ?? 0) || 0,
    total_filtered: Number(filteredRow?.total ?? 0) || 0,
    type_counts: toCounts(typeRes),
    month_counts: toCounts(monthRes),
    status_counts: toCounts(statusRes),
    assignee_counts: toCounts(assigneeRes),
  };
}

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

  const options = { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate, q };

  try {
    const result = await executeStatsPlan(env.DB, buildStatsPlan(options, { useFts: true }), { trash });
    return await respondCachedJson(request, result, { maxAge: 60 });
  } catch (e) {
    if (isFtsUnavailable(e)) {
      const result = await executeStatsPlan(env.DB, buildStatsPlan(options, { useFts: false }), { trash });
      return await respondCachedJson(request, result, { maxAge: 60 });
    }
    if (isLegacySchema(e)) {
      const result = await executeStatsPlan(env.DB, buildLegacyStatsPlan(options), { trash });
      return await respondCachedJson(request, result, { maxAge: 60 });
    }
    throw e;
  }
});

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
  if (res && res.status === 200) {
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