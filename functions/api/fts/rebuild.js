import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse, errorResponse } from '../../_lib/http.js';
import { tryRebuildFts } from '../../_lib/ticket_import.js';

export async function onRequestPost({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  const result = await tryRebuildFts(env.DB);
  if (result.ok || result.skipped) return jsonResponse({ ok: true, ...result });
  return errorResponse(result.error || 'fts_rebuild_failed', { status: 500, code: 'fts_rebuild_failed' });
}

export async function onRequestGet({ request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets_fts').first();
    return jsonResponse({ ok: true, fts_rows: Number(row?.n || 0) });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'fts_status_failed' });
  }
}
