/**
 * PUT    /api/tickets/:id  -> update ticket (optimistic concurrency via updated_at)
 * DELETE /api/tickets/:id  -> soft delete (move to recycle bin)
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

function getEditKeyFromRequest(request) {
  const url = new URL(request.url);
  return (
    request.headers.get("X-EDIT-KEY") ||
    request.headers.get("x-edit-key") ||
    url.searchParams.get("key") ||
    ""
  );
}

function requireEditKey(request, env) {
  const expected = String(env.EDIT_KEY || "");
  if (!expected) {
    return new Response("Server misconfigured: EDIT_KEY is not set", { status: 500 });
  }
  const provided = getEditKeyFromRequest(request);
  if (provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

async function getTicket(env, id) {
  const r = await env.DB.prepare("SELECT * FROM tickets WHERE id=? LIMIT 1").bind(id).all();
  return (r?.results && r.results[0]) ? r.results[0] : null;
}

function isDeletedRow(row) {
  // old schema: is_deleted may be undefined
  return Number(row?.is_deleted ?? 0) === 1;
}

export async function onRequestPut({ params, request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad id" }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const date = String(body?.date ?? "").trim();
  const issue = String(body?.issue ?? "").trim();
  if (!date || !issue) {
    return jsonResponse({ ok: false, error: "date & issue required" }, { status: 400 });
  }

  const department = String(body?.department ?? "");
  const name = String(body?.name ?? "");
  const solution = String(body?.solution ?? "");
  const remarks = String(body?.remarks ?? "");
  const type = String(body?.type ?? "");

  const force = !!body?.force;

  // Prefer updated_at_ts (integer timestamp) for optimistic concurrency.
  // Keep updated_at string for backward compatibility.
  const clientUpdatedAtTsRaw = body?.updated_at_ts ?? body?.updatedAtTs ?? body?.updatedAtTS ?? body?.updated_atTs;
  const clientUpdatedAtTs = Number(clientUpdatedAtTsRaw);
  const hasClientTs = Number.isFinite(clientUpdatedAtTs) && clientUpdatedAtTs > 0;

  const clientUpdatedAt = String(body?.updated_at ?? body?.updatedAt ?? "").trim();
  // Ensure exists (and not deleted)
  let current = null;
  try {
    current = await getTicket(env, id);
  } catch {
    // if table exists but schema old, still fine
    current = null;
  }

  if (!current) {
    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (isDeletedRow(current)) {
    return jsonResponse({ ok: false, error: "deleted" }, { status: 410 });
  }

  // Keep safe if updated_at is missing, but prefer updated_at_ts if available.
  const currentUpdatedAt = String(current?.updated_at ?? "").trim();
  const currentUpdatedAtTs = Number(current?.updated_at_ts ?? 0);
  const hasServerTs = Number.isFinite(currentUpdatedAtTs) && currentUpdatedAtTs > 0;

  if (!force && !hasClientTs && !clientUpdatedAt) {
    return jsonResponse(
      { ok: false, error: "missing_version", hint: "send updated_at_ts (preferred) or updated_at for concurrency control" },
      { status: 400 }
    );
  }

  const nowTs = Date.now();

  // Try new schema (with is_deleted + updated_at_ts concurrency)
  try {
    let stmt;
    if (force) {
      stmt = env.DB.prepare(
        `UPDATE tickets
         SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
             updated_at=CURRENT_TIMESTAMP,
             updated_at_ts=?
         WHERE id=? AND is_deleted=0`
      ).bind(date, issue, department, name, solution, remarks, type, nowTs, id);
    } else if (hasClientTs) {
      stmt = env.DB.prepare(
        `UPDATE tickets
         SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
             updated_at=CURRENT_TIMESTAMP,
             updated_at_ts=?
         WHERE id=? AND is_deleted=0 AND updated_at_ts=?`
      ).bind(date, issue, department, name, solution, remarks, type, nowTs, id, clientUpdatedAtTs);
    } else {
      stmt = env.DB.prepare(
        `UPDATE tickets
         SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
             updated_at=CURRENT_TIMESTAMP,
             updated_at_ts=?
         WHERE id=? AND is_deleted=0 AND updated_at=?`
      ).bind(date, issue, department, name, solution, remarks, type, nowTs, id, clientUpdatedAt);
    }

    const r = await stmt.run();
    const changes = Number(r?.meta?.changes ?? 0);

    if (changes === 0 && !force) {
      const latest = await getTicket(env, id);
      return jsonResponse(
        {
          ok: false,
          error: "conflict",
          current: latest ?? current,
          client_updated_at: clientUpdatedAt,
          client_updated_at_ts: hasClientTs ? clientUpdatedAtTs : null,
          server_updated_at: String((latest ?? current)?.updated_at ?? currentUpdatedAt),
          server_updated_at_ts: Number((latest ?? current)?.updated_at_ts ?? currentUpdatedAtTs) || 0,
        },
        { status: 409 }
      );
    }

    const latest = await getTicket(env, id);
    return jsonResponse({
      ok: true,
      updated_at: String(latest?.updated_at ?? ""),
      updated_at_ts: Number(latest?.updated_at_ts ?? nowTs) || nowTs,
    });
  } catch (e) {
    // Backward compatible fallback (old schema).
    // Concurrency prefers updated_at (string). If updated_at_ts exists, we still try to use it.
    let stmt;

    if (force) {
      try {
        stmt = env.DB.prepare(
          `UPDATE tickets
           SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
               updated_at=CURRENT_TIMESTAMP,
               updated_at_ts=?
           WHERE id=?`
        ).bind(date, issue, department, name, solution, remarks, type, nowTs, id);
      } catch {
        stmt = env.DB.prepare(
          `UPDATE tickets
           SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=?`
        ).bind(date, issue, department, name, solution, remarks, type, id);
      }
    } else if (hasClientTs) {
      try {
        stmt = env.DB.prepare(
          `UPDATE tickets
           SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
               updated_at=CURRENT_TIMESTAMP,
               updated_at_ts=?
           WHERE id=? AND updated_at_ts=?`
        ).bind(date, issue, department, name, solution, remarks, type, nowTs, id, clientUpdatedAtTs);
      } catch {
        // fall back to string token
        stmt = env.DB.prepare(
          `UPDATE tickets
           SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND updated_at=?`
        ).bind(date, issue, department, name, solution, remarks, type, id, clientUpdatedAt);
      }
    } else {
      stmt = env.DB.prepare(
        `UPDATE tickets
         SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND updated_at=?`
      ).bind(date, issue, department, name, solution, remarks, type, id, clientUpdatedAt);
    }

    const r = await stmt.run();
    const changes = Number(r?.meta?.changes ?? 0);

    if (changes === 0 && !force) {
      const latest = await getTicket(env, id);
      return jsonResponse(
        {
          ok: false,
          error: "conflict",
          current: latest ?? current,
          client_updated_at: clientUpdatedAt,
          client_updated_at_ts: hasClientTs ? clientUpdatedAtTs : null,
          server_updated_at: String((latest ?? current)?.updated_at ?? currentUpdatedAt),
          server_updated_at_ts: Number((latest ?? current)?.updated_at_ts ?? currentUpdatedAtTs) || 0,
        },
        { status: 409 }
      );
    }

    const latest = await getTicket(env, id);
    return jsonResponse({
      ok: true,
      updated_at: String(latest?.updated_at ?? ""),
      updated_at_ts: Number(latest?.updated_at_ts ?? nowTs) || nowTs,
    });
  }
}


export async function onRequestDelete({ params, request, env }) {
  const auth = requireEditKey(request, env);
  if (auth) return auth;

  const id = parseId(params.id);
  if (id === null) return jsonResponse({ ok: false, error: "bad id" }, { status: 400 });

  // Soft delete (new schema)
  try {
    const nowTs = Date.now();
    let r;

    // Prefer schema with updated_at_ts; fall back if column not present.
    try {
      r = await env.DB
        .prepare(
          `UPDATE tickets
           SET is_deleted=1,
               deleted_at=CURRENT_TIMESTAMP,
               updated_at=CURRENT_TIMESTAMP,
               updated_at_ts=?
           WHERE id=? AND is_deleted=0`
        )
        .bind(nowTs, id)
        .run();
    } catch {
      r = await env.DB
        .prepare(
          `UPDATE tickets
           SET is_deleted=1,
               deleted_at=CURRENT_TIMESTAMP,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND is_deleted=0`
        )
        .bind(id)
        .run();
    }

    const changes = Number(r?.meta?.changes ?? 0);
    if (changes === 0) {
      const latest = await getTicket(env, id);
      if (!latest) return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
      if (isDeletedRow(latest)) return jsonResponse({ ok: true, already: true, soft: true });
      return jsonResponse({ ok: false, error: "delete_failed" }, { status: 500 });
    }

    return jsonResponse({ ok: true, soft: true });
  } catch (e) {
    // Old schema fallback: hard delete
    await env.DB.prepare("DELETE FROM tickets WHERE id=?").bind(id).run();
    return jsonResponse({ ok: true, soft: false });
  }
}
