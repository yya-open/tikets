import { requireAdminKey } from "../../_lib/auth.js";
import { jsonResponse, withErrorHandler } from "../../_lib/http.js";
import {
  applyPendingMigrations,
  getCurrentSchemaVersion,
  latestSchemaVersion,
  listPendingMigrations,
} from "../../_lib/schema_migrate.js";

const handleGet = withErrorHandler(async ({ request, env }) => {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;
  const current = await getCurrentSchemaVersion(env.DB);
  const latest = latestSchemaVersion();
  const pending = (await listPendingMigrations(env.DB)).map((m) => ({ version: m.version, name: m.name }));
  return jsonResponse({ ok: true, current, latest, pending });
});

const handlePost = withErrorHandler(async ({ request, env }) => {
  const auth = await requireAdminKey(request, env);
  if (auth) return auth;
  const before = await getCurrentSchemaVersion(env.DB);
  const result = await applyPendingMigrations(env.DB);
  const after = await getCurrentSchemaVersion(env.DB);
  return jsonResponse({ ok: true, before, after, latest: latestSchemaVersion(), applied: result.applied || [] });
});

export const onRequestGet = handleGet;
export const onRequestPost = handlePost;
