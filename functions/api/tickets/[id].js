import { requireEditKey } from '../../_lib/auth.js';
import { jsonResponse, errorResponse, readJson } from '../../_lib/http.js';

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? Math.trunc(id) : null;
}

function normalizeDate(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function text(v) {
  return String(v ?? '').trim();
}

async function getTicket(db, id) {
  return db.prepare('SELECT * FROM tickets WHERE id=? LIMIT 1').bind(id).first();
}

export async function onRequestPut({ params, request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;

  const id = parseId(params.id);
  if (id === null) return errorResponse('bad id', { status: 400, code: 'bad_id' });

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const payload = body.value && typeof body.value === 'object' ? body.value : {};

  const date = normalizeDate(payload.date);
  const issue = text(payload.issue);
  if (!date || !issue) {
    return errorResponse('date & issue required', { status: 400, code: 'invalid_record' });
  }

  const current = await getTicket(env.DB, id);
  if (!current) return errorResponse('not_found', { status: 404, code: 'not_found' });
  if (Number(current.is_deleted || 0) === 1) return errorResponse('deleted_record', { status: 409, code: 'deleted_record' });

  const force = !!payload.force;
  const clientTs = Number(payload.updated_at_ts ?? 0) || 0;
  const clientUpdatedAt = text(payload.updated_at);
  if (!force && !clientTs && !clientUpdatedAt) {
    return errorResponse('missing_version', { status: 400, code: 'missing_version', extra: { hint: 'send updated_at_ts (preferred) or updated_at' } });
  }

  const currentTs = Number(current.updated_at_ts ?? 0) || 0;
  const currentUpdatedAt = text(current.updated_at);
  const hasConflict = !force && ((clientTs && clientTs !== currentTs) || (!clientTs && clientUpdatedAt !== currentUpdatedAt));
  if (hasConflict) {
    return jsonResponse({
      ok: false,
      error: 'conflict',
      current,
      client_updated_at: clientUpdatedAt,
      client_updated_at_ts: clientTs || null,
      server_updated_at: currentUpdatedAt,
      server_updated_at_ts: currentTs,
    }, { status: 409 });
  }

  const nowTs = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE tickets
       SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
           updated_at=CURRENT_TIMESTAMP,
           updated_at_ts=?
       WHERE id=? AND is_deleted=0`
    ).bind(
      date,
      issue,
      text(payload.department),
      text(payload.name),
      text(payload.solution),
      text(payload.remarks),
      text(payload.type),
      nowTs,
      id,
    ).run();
    const latest = await getTicket(env.DB, id);
    return jsonResponse({ ok: true, updated_at: String(latest?.updated_at ?? ''), updated_at_ts: Number(latest?.updated_at_ts ?? nowTs) || nowTs });
  } catch (e) {
    return errorResponse(String(e), { status: 500, code: 'ticket_update_failed' });
  }
}

export async function onRequestDelete({ params, request, env }) {
  const denied = requireEditKey(request, env);
  if (denied) return denied;

  const id = parseId(params.id);
  if (id === null) return errorResponse('bad id', { status: 400, code: 'bad_id' });

  const result = await env.DB.prepare(
    `UPDATE tickets
     SET is_deleted=1,
         deleted_at=CURRENT_TIMESTAMP,
         updated_at=CURRENT_TIMESTAMP,
         updated_at_ts=?
     WHERE id=? AND is_deleted=0`
  ).bind(Date.now(), id).run();
  const changes = Number(result?.meta?.changes ?? 0);
  if (!changes) return errorResponse('not_found', { status: 404, code: 'not_found' });
  return jsonResponse({ ok: true, deleted: true });
}
