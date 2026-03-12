import { requireEditKey } from '../../../_lib/auth.js';
import { jsonResponse, errorResponse } from '../../../_lib/http.js';

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? Math.trunc(id) : null;
}

export async function onRequestPut({ params, request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;
  const id = parseId(params.id);
  if (id === null) return errorResponse('bad id', { status: 400, code: 'bad_id' });

  const result = await env.DB.prepare(
    `UPDATE tickets
     SET is_deleted=0,
         deleted_at=NULL,
         updated_at=CURRENT_TIMESTAMP,
         updated_at_ts=?
     WHERE id=? AND is_deleted=1`
  ).bind(Date.now(), id).run();
  const changes = Number(result?.meta?.changes ?? 0);
  if (!changes) return errorResponse('not_found', { status: 404, code: 'not_found' });
  return jsonResponse({ ok: true });
}
