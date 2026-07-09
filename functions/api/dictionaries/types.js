import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, errorJson, parseJsonBody, respondCachedJson, withErrorHandler } from "../../_lib/http.js";
import { defaultTypeRows, normalizeTypeName } from "../../_lib/ticket_types.js";

function tableMissing(error) {
  return /no such table: ticket_type_dict/i.test(String(error?.message || error));
}

function parseSortOrder(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function listTypes(env, { includeDisabled = false } = {}) {
  const where = includeDisabled ? "" : "WHERE d.is_enabled=1";
  const sql = `
    SELECT
      d.id,
      d.name,
      d.sort_order,
      d.is_enabled,
      d.created_at,
      d.updated_at,
      COUNT(t.id) AS ticket_count
    FROM ticket_type_dict d
    LEFT JOIN tickets t ON t.type = d.name
    ${where}
    GROUP BY d.id
    ORDER BY d.is_enabled DESC, d.sort_order ASC, d.name ASC
  `;
  const { results } = await env.DB.prepare(sql).all();
  return (results || []).map((row) => ({
    id: Number(row.id),
    name: String(row.name || ""),
    sort_order: Number(row.sort_order || 0),
    is_enabled: Number(row.is_enabled || 0) ? 1 : 0,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    ticket_count: Number(row.ticket_count || 0),
  }));
}

const handleGet = withErrorHandler(async ({ request, env }) => {
  const url = new URL(request.url);
  const includeDisabled = ["1", "true", "yes"].includes(String(url.searchParams.get("includeDisabled") || "").toLowerCase());
  try {
    const data = await listTypes(env, { includeDisabled });
    return await respondCachedJson(request, { ok: true, data, source: "db" }, { maxAge: 30 });
  } catch (e) {
    if (tableMissing(e)) {
      return await respondCachedJson(request, { ok: true, data: defaultTypeRows(), source: "defaults", schema_missing: true }, { maxAge: 30 });
    }
    throw e;
  }
});

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireEditKey(request, env);
  if (auth) return auth;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const name = normalizeTypeName(body?.name);
  if (!name) {
    return errorJson("validation_error", { code: "validation_error", detail: "类型名称不能为空", status: 400 });
  }

  const sortOrder = parseSortOrder(body?.sort_order ?? body?.sortOrder, 0);
  const enabled = Number(body?.is_enabled ?? body?.enabled ?? 1) ? 1 : 0;
  try {
    const inserted = await env.DB
      .prepare("INSERT INTO ticket_type_dict(name, sort_order, is_enabled, updated_at) VALUES(?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(name, sortOrder, enabled)
      .run();
    return jsonResponse({ ok: true, id: inserted?.meta?.last_row_id ?? null }, { status: 201 });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE constraint failed/i.test(msg)) {
      await env.DB
        .prepare("UPDATE ticket_type_dict SET is_enabled=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE name=?")
        .bind(enabled, sortOrder, name)
        .run();
      return jsonResponse({ ok: true, restored: true });
    }
    if (tableMissing(e)) {
      return errorJson("schema_not_ready", { code: "schema_not_ready", detail: "请先执行一键初始化或 /api/admin/migrate", status: 409 });
    }
    throw e;
  }
});

export const onRequestGet = handleGet;
export const onRequestPost = handlePost;
