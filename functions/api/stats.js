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

async function respondCachedJson(request, payload, { maxAge = 60, status = 200 } = {}) {
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

function normalizeDateParam(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
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
  const ftsQuery = q ? buildFtsQuery(q) : "";
  const wantFts = Boolean(ftsQuery);
  let filteredFromSql = "FROM tickets";
  if (wantFts) {
    filteredFromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
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
  const countFilteredSql = `SELECT COUNT(*) as total ${filteredFromSql} ${whereSql}`;

  const typeSql = `
    SELECT COALESCE(NULLIF(TRIM(type),''),'未分类') as k, COUNT(*) as c
    ${filteredFromSql}
    ${whereSql}
    GROUP BY k
    ORDER BY c DESC, k ASC
  `;

  const monthSql = `
    SELECT substr(date,1,7) as k, COUNT(*) as c
    ${filteredFromSql}
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

    return await respondCachedJson(
      request,
      {
        trash: trash ? 1 : 0,
        total_all,
        total_filtered,
        type_counts,
        month_counts,
      },
      { maxAge: 60 }
    );
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('no such table: tickets_fts') || msg.includes('no such module: fts5') || msg.includes('unable to use function MATCH')) {
      // FTS not available: rerun under new schema with LIKE.
      const whereLike = ['is_deleted=?'];
      const bindsLike = [trash ? 1 : 0];
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
      const whereLikeSql = `WHERE ${whereLike.join(' AND ')}`;
      const countFilteredSqlLike = `SELECT COUNT(*) as total FROM tickets ${whereLikeSql}`;
      const typeSqlLike = `
        SELECT COALESCE(NULLIF(TRIM(type),''),'未分类') as k, COUNT(*) as c
        FROM tickets
        ${whereLikeSql}
        GROUP BY k
        ORDER BY c DESC, k ASC
      `;
      const monthSqlLike = `
        SELECT substr(date,1,7) as k, COUNT(*) as c
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
      return await respondCachedJson(request, { trash: trash ? 1 : 0, total_all, total_filtered, type_counts, month_counts }, { maxAge: 60 });
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
  const ftsQuery = q ? buildFtsQuery(q) : "";
  const wantFts = Boolean(ftsQuery);
  let filteredFromSql = "FROM tickets";
  if (wantFts) {
    filteredFromSql = "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id";
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
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
        trash: trash ? 1 : 0,
        total_all,
        total_filtered,
        type_counts,
        month_counts,
      },
      { maxAge: 60 }
    );
  }
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
