/**
 * GET  /api/admin/migrate  -> show current schema version + pending
 * POST /api/admin/migrate  -> apply pending migrations (requires x-edit-key)
 *
 * This prevents "forgot to run SQL in D1" issues when deploying new versions.
 */
import {
  applyPendingMigrations,
  getCurrentSchemaVersion,
  latestSchemaVersion,
  listPendingMigrations,
} from "../../_lib/schema_migrate.js";

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

function getEditKeyFromRequest(request) {
  return (
    request.headers.get("x-edit-key") ||
    request.headers.get("X-Edit-Key") ||
    request.headers.get("x-editkey") ||
    ""
  );
}

function isEditAllowed(request, env) {
  const k = getEditKeyFromRequest(request);
  const expected = (env && env.EDIT_KEY) ? String(env.EDIT_KEY) : "";
  return !!k && !!expected && k === expected;
}

export async function onRequestGet({ request, env }) {
  try {
    const current = await getCurrentSchemaVersion(env.DB);
    const latest = latestSchemaVersion();
    const pending = (await listPendingMigrations(env.DB)).map((m) => ({
      version: m.version,
      name: m.name,
    }));
    return jsonResponse({ ok: true, current, latest, pending });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!isEditAllowed(request, env)) {
    return jsonResponse(
      { ok: false, error: "forbidden: missing or invalid x-edit-key" },
      { status: 403 }
    );
  }

  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const result = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);

    return jsonResponse({
      ok: true,
      before,
      after,
      ...result,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, { status: 500 });
  }
}
