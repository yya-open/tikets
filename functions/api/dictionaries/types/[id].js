import { requireEditKey } from "../../../_lib/auth.js";
import { jsonResponse } from "../../../_lib/http.js";
import { normalizeTypeName } from "../../../_lib/ticket_types.js";

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? Math.trunc(id) : null;
}

function parseSortOrder(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function tableMissing(error) {
  return /no such table: ticket_type_dict/i.test(String(error?.message || error));
}

export async function onRequestPut({ params, request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad_id", code: "bad_id" }, { status: 400, headers: { "cache-control": "no-store" } });

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
    const current = await env.DB.prepare("SELECT id, name FROM ticket_type_dict WHERE id=?").bind(id).first();
    if (!current) {
      return jsonResponse({ ok: false, error: "not_found", code: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    const oldName = String(current.name || "");
    const r = await env.DB
      .prepare("UPDATE ticket_type_dict SET name=?, sort_order=?, is_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(name, sortOrder, enabled, id)
      .run();
    if (Number(r?.meta?.changes || 0) === 0) {
      return jsonResponse({ ok: false, error: "not_found", code: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    let ticketAffected = 0;
    if (oldName && oldName !== name) {
      const tr = await env.DB
        .prepare("UPDATE tickets SET type=?, updated_at=CURRENT_TIMESTAMP, updated_at_ts=? WHERE type=?")
        .bind(name, Date.now(), oldName)
        .run();
      ticketAffected = Number(tr?.meta?.changes || 0);
    }
    return jsonResponse({ ok: true, ticket_affected: ticketAffected }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (tableMissing(e)) {
      return jsonResponse({ ok: false, error: "schema_not_ready", code: "schema_not_ready" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    const msg = String(e?.message || e);
    const status = /UNIQUE constraint failed/i.test(msg) ? 409 : 500;
    return jsonResponse({ ok: false, error: "update_failed", code: "update_failed", detail: msg }, { status, headers: { "cache-control": "no-store" } });
  }
}

export async function onRequestDelete({ params, request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad_id", code: "bad_id" }, { status: 400, headers: { "cache-control": "no-store" } });

  try {
    const r = await env.DB
      .prepare("UPDATE ticket_type_dict SET is_enabled=0, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(id)
      .run();
    if (Number(r?.meta?.changes || 0) === 0) {
      return jsonResponse({ ok: false, error: "not_found", code: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return jsonResponse({ ok: true, disabled: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (tableMissing(e)) {
      return jsonResponse({ ok: false, error: "schema_not_ready", code: "schema_not_ready" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return jsonResponse({ ok: false, error: "delete_failed", code: "delete_failed", detail: String(e?.message || e) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
