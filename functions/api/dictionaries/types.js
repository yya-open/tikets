import { requireEditKey } from "../../_lib/auth.js";
import { jsonResponse, respondCachedJson } from "../../_lib/http.js";
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const includeDisabled = ["1", "true", "yes"].includes(String(url.searchParams.get("includeDisabled") || "").toLowerCase());
  try {
    const data = await listTypes(env, { includeDisabled });
    return await respondCachedJson(request, { ok: true, data, source: "db" }, { maxAge: 30 });
  } catch (e) {
    if (tableMissing(e)) {
      return await respondCachedJson(request, { ok: true, data: defaultTypeRows(), source: "defaults", schema_missing: true }, { maxAge: 30 });
    }
    return jsonResponse({ ok: false, error: String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
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

  const name = normalizeTypeName(body?.name);
  if (!name) {
    return jsonResponse({ ok: false, error: "validation_error", code: "validation_error", fields: [{ field: "name", message: "类型名称不能为空" }] }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const sortOrder = parseSortOrder(body?.sort_order ?? body?.sortOrder, 0);
  const enabled = Number(body?.is_enabled ?? body?.enabled ?? 1) ? 1 : 0;
  try {
    const inserted = await env.DB
      .prepare("INSERT INTO ticket_type_dict(name, sort_order, is_enabled, updated_at) VALUES(?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(name, sortOrder, enabled)
      .run();
    return jsonResponse({ ok: true, id: inserted?.meta?.last_row_id ?? null }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE constraint failed/i.test(msg)) {
      await env.DB
        .prepare("UPDATE ticket_type_dict SET is_enabled=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE name=?")
        .bind(enabled, sortOrder, name)
        .run();
      return jsonResponse({ ok: true, restored: true }, { headers: { "cache-control": "no-store" } });
    }
    if (tableMissing(e)) {
      return jsonResponse({ ok: false, error: "schema_not_ready", code: "schema_not_ready", message: "请先执行一键初始化或 /api/admin/migrate" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return jsonResponse({ ok: false, error: "insert_failed", code: "insert_failed", detail: msg }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
