import { requireEditKey } from "../_lib/auth.js";
import { jsonResponse, respondCachedJson } from "../_lib/http.js";
import { validateTicketPayload } from "../_lib/validation.js";

function clampInt(n, { min = 1, max = 1000000, fallback = 1 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function normalizeDateParam(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeTextParam(raw, max = 120) {
  return String(raw ?? "").trim().slice(0, max);
}

const FTS_FIELDS = ["issue", "department", "name", "solution", "remarks", "type"];
function escapeFtsPhrase(s) {
  return `"${String(s ?? "").replace(/"/g, '""')}"`;
}
function buildFtsQuery(q) {
  const tokens = String(q || "").trim().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  if (!tokens.length) return "";
  return tokens.map((tok) => `(${FTS_FIELDS.map((f) => `${f}:${escapeFtsPhrase(tok)}`).join(" OR ")})`).join(" AND ");
}

function buildBaseQuery(url) {
  const trash = ["1", "true", "yes"].includes(String(url.searchParams.get("trash") || "").toLowerCase());
  const page = clampInt(url.searchParams.get("page"), { min: 1, fallback: 1 });
  const pageSize = clampInt(url.searchParams.get("pageSize"), { min: 1, max: 100, fallback: 50 });
  const offset = (page - 1) * pageSize;
  const from = normalizeDateParam(url.searchParams.get("from"));
  const to = normalizeDateParam(url.searchParams.get("to"));
  const type = normalizeTextParam(url.searchParams.get("type"), 80);
  const department = normalizeTextParam(url.searchParams.get("department"), 80);
  const name = normalizeTextParam(url.searchParams.get("name"), 80);
  const q = normalizeTextParam(url.searchParams.get("q"), 120);
  return { trash, page, pageSize, offset, from, to, type, department, name, q };
}

async function queryTickets(db, params, { preferFts = true } = {}) {
  const where = ["tickets.is_deleted=?"];
  const binds = [params.trash ? 1 : 0];
  if (params.from) { where.push("tickets.date >= ?"); binds.push(params.from); }
  if (params.to) { where.push("tickets.date <= ?"); binds.push(params.to); }
  if (params.type) { where.push("tickets.type = ?"); binds.push(params.type); }
  if (params.department) { where.push("tickets.department LIKE ?"); binds.push(`%${params.department}%`); }
  if (params.name) { where.push("tickets.name LIKE ?"); binds.push(`%${params.name}%`); }

  const ftsQuery = params.q ? buildFtsQuery(params.q) : "";
  const useFts = preferFts && Boolean(ftsQuery);
  let fromSql = "FROM tickets";
  let selectSql = "SELECT tickets.*";
  let orderSql = params.q ? "ORDER BY COALESCE(tickets.updated_at_ts,0) DESC, tickets.id DESC" : (params.trash ? "ORDER BY tickets.deleted_at DESC, tickets.id DESC" : "ORDER BY tickets.date DESC, tickets.id DESC");

  if (useFts) {
    fromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
    orderSql = "ORDER BY bm25(tickets_fts) ASC, COALESCE(tickets.updated_at_ts,0) DESC, tickets.id DESC";
  } else if (params.q) {
    const like = `%${params.q}%`;
    where.push(`(tickets.issue LIKE ? OR tickets.department LIKE ? OR tickets.name LIKE ? OR tickets.solution LIKE ? OR tickets.remarks LIKE ? OR tickets.type LIKE ?)`);
    binds.push(like, like, like, like, like, like);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const countSql = `SELECT COUNT(*) as total ${fromSql} ${whereSql}`;
  const listSql = `${selectSql} ${fromSql} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;

  const countRow = await db.prepare(countSql).bind(...binds).first();
  const total = Number(countRow?.total ?? 0) || 0;
  const { results } = await db.prepare(listSql).bind(...binds, params.pageSize, params.offset).all();
  return { data: Array.isArray(results) ? results : [], total };
}

async function handleGet({ request, env }) {
  const url = new URL(request.url);
  const params = buildBaseQuery(url);
  try {
    const queried = await queryTickets(env.DB, params, { preferFts: true });
    return respondCachedJson(request, { data: queried.data, page: params.page, pageSize: params.pageSize, total: queried.total, filters: { from: params.from, to: params.to, type: params.type, department: params.department, name: params.name, q: params.q, trash: params.trash ? 1 : 0 } }, { maxAge: 30 });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("no such table: tickets_fts") || msg.includes("no such module: fts5") || msg.includes("unable to use function MATCH")) {
      const queried = await queryTickets(env.DB, params, { preferFts: false });
      return respondCachedJson(request, { data: queried.data, page: params.page, pageSize: params.pageSize, total: queried.total, filters: { from: params.from, to: params.to, type: params.type, department: params.department, name: params.name, q: params.q, trash: params.trash ? 1 : 0 } }, { maxAge: 30 });
    }
    throw e;
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
  try {
    const result = await env.DB.prepare(`INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`).bind(date, issue, department, name, solution, remarks, type, nowTs).run();
    return jsonResponse({ ok: true, id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonResponse({ ok: false, error: "insert_failed", code: "insert_failed", detail: String(e?.message || e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

function isCacheableGet(request) {
  if ((request.method || "GET").toUpperCase() !== "GET") return false;
  const k = request.headers.get("x-edit-key") || request.headers.get("X-EDIT-KEY");
  return !(k && String(k).trim());
}

export async function onRequestGet(ctx) {
  const request = ctx.request;
  const env = ctx.env;
  if (!isCacheableGet(request)) return handleGet({ request, env });
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
    const headers = new Headers(res.headers);
    const cc = headers.get("cache-control") || "public, max-age=30";
    if (!/s-maxage=/i.test(cc)) {
      const maxAge = Number(/max-age=(\d+)/i.exec(cc)?.[1] || 30);
      headers.set("cache-control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`);
    }
    const cached = new Response(res.body, { status: res.status, headers });
    await cache.put(cacheKey, cached.clone());
    return cached;
  }
  return res;
}
