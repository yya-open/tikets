/**
 * POST /api/admin/oneclick
 * Requires x-edit-key.
 * Runs:
 *  1) apply pending schema migrations
 *  2) rebuild FTS index (if tickets_fts exists)
 *  3) basic self-check (indexes existence, fts existence, schema version)
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

async function tableExists(db, name) {
  try {
    const r = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .bind(String(name))
      .first();
    return !!(r && r.name);
  } catch {
    return false;
  }
}

async function getIndexes(db, tableName) {
  try {
    const rows = await db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?")
      .bind(String(tableName))
      .all();
    return (rows && rows.results) ? rows.results : [];
  } catch {
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  if (!isEditAllowed(request, env)) {
    return jsonResponse(
      { ok: false, error: "forbidden: missing or invalid x-edit-key" },
      { status: 403 }
    );
  }

  const out = {
    ok: true,
    steps: {},
    now: new Date().toISOString(),
  };

  // 1) Migrations
  try {
    const before = await getCurrentSchemaVersion(env.DB);
    const latest = latestSchemaVersion();
    const pending = await listPendingMigrations(env.DB);

    const applied = await applyPendingMigrations(env.DB);
    const after = await getCurrentSchemaVersion(env.DB);

    out.steps.migrate = {
      ok: true,
      before,
      after,
      latest,
      pending_before: pending.map((m) => ({ version: m.version, name: m.name })),
      applied: applied.applied || [],
    };
  } catch (e) {
    out.steps.migrate = { ok: false, error: String(e) };
  }

  // 2) FTS rebuild
  try {
    const exists = await tableExists(env.DB, "tickets_fts");
    if (!exists) {
      out.steps.fts_rebuild = { ok: true, skipped: true, reason: "tickets_fts not found" };
    } else {
      await env.DB.prepare("INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild')").run();
      out.steps.fts_rebuild = { ok: true };
    }
  } catch (e) {
    out.steps.fts_rebuild = { ok: false, error: String(e) };
  }

  // 3) Self-check summary
  try {
    const schema = {
      current: await getCurrentSchemaVersion(env.DB),
      latest: latestSchemaVersion(),
    };

    const fts = {
      exists: await tableExists(env.DB, "tickets_fts"),
      count: null,
    };
    if (fts.exists) {
      try {
        const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM tickets_fts").first();
        fts.count = r ? (r.c ?? null) : null;
      } catch {}
    }

    const expectedIndexes = [
      "idx_tickets_active_date_id",
      "idx_tickets_active_updated",
      "idx_tickets_deleted",
    ];
    const idx = await getIndexes(env.DB, "tickets");
    const existingNames = new Set(idx.map((x) => x.name).filter(Boolean));
    const missing = expectedIndexes.filter((n) => !existingNames.has(n));

    out.steps.selfcheck = {
      ok: true,
      schema,
      fts,
      indexes: {
        expected: expectedIndexes,
        missing,
      },
    };
  } catch (e) {
    out.steps.selfcheck = { ok: false, error: String(e) };
  }

  // overall ok: all steps ok (except acceptable skips)
  const stepOk = (s) => s && s.ok === true;
  out.ok =
    stepOk(out.steps.migrate) &&
    (stepOk(out.steps.fts_rebuild) || (out.steps.fts_rebuild && out.steps.fts_rebuild.skipped)) &&
    stepOk(out.steps.selfcheck);

  return jsonResponse(out, { status: out.ok ? 200 : 500 });
}
