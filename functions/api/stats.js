import { errorResponse, isPublicGetRequest, respondCachedJson } from '../_lib/http.js';

const FTS_FIELDS = ['issue', 'department', 'name', 'solution', 'remarks', 'type'];

function normalizeDate(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function normalizeText(v, max = 120) {
  return String(v ?? '').trim().slice(0, max);
}

function escapeFtsPhrase(s) {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

function buildFtsQuery(q) {
  const tokens = String(q || '').trim().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  if (!tokens.length) return '';
  return tokens.map((tok) => `(${FTS_FIELDS.map((f) => `${f}:${escapeFtsPhrase(tok)}`).join(' OR ')})`).join(' AND ');
}

function buildFilters(url) {
  return {
    trash: ['1', 'true', 'yes'].includes(String(url.searchParams.get('trash') || '').toLowerCase()),
    from: normalizeDate(url.searchParams.get('from')),
    to: normalizeDate(url.searchParams.get('to')),
    type: normalizeText(url.searchParams.get('type'), 80),
    q: normalizeText(url.searchParams.get('q'), 120),
  };
}

function buildWhere(filters, { useFts = false, useLike = false } = {}) {
  const where = ['tickets.is_deleted=?'];
  const binds = [filters.trash ? 1 : 0];
  if (filters.from) {
    where.push('tickets.date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('tickets.date <= ?');
    binds.push(filters.to);
  }
  if (filters.type) {
    where.push('tickets.type = ?');
    binds.push(filters.type);
  }
  if (useFts && filters.q) {
    where.push('tickets_fts MATCH ?');
    binds.push(buildFtsQuery(filters.q));
  } else if (useLike && filters.q) {
    const like = `%${filters.q}%`;
    where.push(`(
      tickets.issue LIKE ? OR tickets.department LIKE ? OR tickets.name LIKE ? OR
      tickets.solution LIKE ? OR tickets.remarks LIKE ? OR tickets.type LIKE ?
    )`);
    binds.push(like, like, like, like, like, like);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, binds };
}

async function queryStats(env, filters, { preferFts = true } = {}) {
  const baseWhere = 'WHERE is_deleted=?';
  const baseBinds = [filters.trash ? 1 : 0];

  let fromSql = 'FROM tickets';
  let whereInfo;
  if (preferFts && filters.q && buildFtsQuery(filters.q)) {
    fromSql = 'FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id';
    whereInfo = buildWhere(filters, { useFts: true });
  }
  if (!whereInfo) whereInfo = buildWhere(filters, { useLike: !!filters.q });

  const totalAllRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM tickets ${baseWhere}`).bind(...baseBinds).first();
  const totalFilteredRow = await env.DB.prepare(`SELECT COUNT(*) AS total ${fromSql} ${whereInfo.whereSql}`).bind(...whereInfo.binds).first();
  const typeRows = await env.DB.prepare(`
    SELECT COALESCE(NULLIF(TRIM(tickets.type),''),'未分类') AS k, COUNT(*) AS c
    ${fromSql}
    ${whereInfo.whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `).bind(...whereInfo.binds).all();
  const monthRows = await env.DB.prepare(`
    SELECT substr(tickets.date,1,7) AS k, COUNT(*) AS c
    ${fromSql}
    ${whereInfo.whereSql}
    GROUP BY k
    ORDER BY k ASC
  `).bind(...whereInfo.binds).all();

  const type_counts = {};
  for (const row of typeRows?.results || []) type_counts[String(row.k)] = Number(row.c) || 0;
  const month_counts = {};
  for (const row of monthRows?.results || []) if (row.k) month_counts[String(row.k)] = Number(row.c) || 0;

  return {
    trash: filters.trash ? 1 : 0,
    total_all: Number(totalAllRow?.total ?? 0) || 0,
    total_filtered: Number(totalFilteredRow?.total ?? 0) || 0,
    type_counts,
    month_counts,
  };
}

async function handleGet({ request, env }) {
  const filters = buildFilters(new URL(request.url));
  try {
    let payload;
    try {
      payload = await queryStats(env, filters, { preferFts: true });
    } catch (e) {
      const msg = String(e || '');
      if (!/tickets_fts|fts5|MATCH/i.test(msg)) throw e;
      payload = await queryStats(env, filters, { preferFts: false });
    }
    return respondCachedJson(request, payload, { maxAge: 60 });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'stats_failed' });
  }
}

export async function onRequestGet(ctx) {
  const { request } = ctx;
  if (!isPublicGetRequest(request)) {
    return handleGet(ctx);
  }
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('x-edge-cache', 'HIT');
    return new Response(hit.body, { status: hit.status, headers });
  }
  const response = await handleGet(ctx);
  if (response.status === 200) await cache.put(cacheKey, response.clone());
  return response;
}
