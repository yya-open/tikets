import { requireEditKey } from '../_lib/auth.js';
import { errorResponse, isPublicGetRequest, jsonResponse, readJson, respondCachedJson } from '../_lib/http.js';

const FTS_FIELDS = ['issue', 'department', 'name', 'solution', 'remarks', 'type'];

function clampInt(v, { min = 1, max = 100, fallback = 1 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

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
  const trash = ['1', 'true', 'yes'].includes(String(url.searchParams.get('trash') || '').toLowerCase());
  const from = normalizeDate(url.searchParams.get('from'));
  const to = normalizeDate(url.searchParams.get('to'));
  const type = normalizeText(url.searchParams.get('type'), 80);
  const q = normalizeText(url.searchParams.get('q'), 120);
  return { trash, from, to, type, q };
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
      tickets.issue LIKE ? OR
      tickets.department LIKE ? OR
      tickets.name LIKE ? OR
      tickets.solution LIKE ? OR
      tickets.remarks LIKE ? OR
      tickets.type LIKE ?
    )`);
    binds.push(like, like, like, like, like, like);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, binds };
}

async function queryList(env, filters, { page, pageSize, preferFts = true } = {}) {
  const offset = (page - 1) * pageSize;
  const orderSql = filters.trash ? 'ORDER BY tickets.deleted_at DESC, tickets.id DESC' : 'ORDER BY tickets.date DESC, tickets.id DESC';

  let fromSql = 'FROM tickets';
  let selectSql = 'SELECT tickets.*';
  let countSql = 'SELECT COUNT(*) AS total';
  let whereInfo;
  if (preferFts && filters.q) {
    fromSql = 'FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id';
    whereInfo = buildWhere(filters, { useFts: true });
    if (buildFtsQuery(filters.q)) {
      selectSql = 'SELECT tickets.*';
    }
  }
  if (!whereInfo) {
    whereInfo = buildWhere(filters, { useLike: !!filters.q });
  }

  const listSql = `${selectSql} ${fromSql} ${whereInfo.whereSql} ${orderSql} LIMIT ? OFFSET ?`;
  const totalRow = await env.DB.prepare(`${countSql} ${fromSql} ${whereInfo.whereSql}`).bind(...whereInfo.binds).first();
  const listRes = await env.DB.prepare(listSql).bind(...whereInfo.binds, pageSize, offset).all();
  return { total: Number(totalRow?.total ?? 0) || 0, data: listRes?.results || [] };
}

async function handleGet({ request, env }) {
  const url = new URL(request.url);
  const filters = buildFilters(url);
  const page = clampInt(url.searchParams.get('page'), { min: 1, max: 1000000, fallback: 1 });
  const pageSize = clampInt(url.searchParams.get('pageSize'), { min: 1, max: 100, fallback: 100 });

  try {
    let result;
    try {
      result = await queryList(env, filters, { page, pageSize, preferFts: true });
    } catch (e) {
      const msg = String(e || '');
      if (!/tickets_fts|fts5|MATCH/i.test(msg)) throw e;
      result = await queryList(env, filters, { page, pageSize, preferFts: false });
    }
    return respondCachedJson(request, { data: result.data, page, pageSize, total: result.total }, { maxAge: 30 });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'tickets_list_failed' });
  }
}

async function handlePost({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const payload = body.value && typeof body.value === 'object' ? body.value : {};
  const date = normalizeDate(payload.date);
  const issue = normalizeText(payload.issue, 500);
  if (!date || !issue) {
    return errorResponse('date & issue required', { status: 400, code: 'invalid_record' });
  }
  const nowTs = Date.now();
  try {
    const result = await env.DB.prepare(
      `INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts, is_deleted, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0, NULL)`
    ).bind(
      date,
      issue,
      String(payload.department ?? ''),
      String(payload.name ?? ''),
      String(payload.solution ?? ''),
      String(payload.remarks ?? ''),
      String(payload.type ?? ''),
      nowTs,
    ).run();
    const id = Number(result?.meta?.last_row_id ?? 0) || 0;
    return jsonResponse({ ok: true, id, updated_at_ts: nowTs });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'ticket_create_failed' });
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

export const onRequestPost = handlePost;
