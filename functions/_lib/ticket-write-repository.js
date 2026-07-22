export async function findTicket(db, id) {
  const { results } = await db.prepare("SELECT * FROM tickets WHERE id=? LIMIT 1").bind(id).all();
  return results?.[0] || null;
}

export function isDeletedTicket(ticket) {
  return Number(ticket?.is_deleted ?? 0) === 1;
}

function isMissingColumnError(error) {
  const message = String(error?.message || error);
  return /no such column/i.test(message) || /table tickets has no column/i.test(message);
}

export async function createTicket(db, ticket, nowTs) {
  const { date, issue, department, name, solution, remarks, type, status, priority, assignee, due_date, closed_at } = ticket;
  const closedAtValue = status === "已关闭" ? (closed_at || new Date(nowTs).toISOString()) : null;

  try {
    const result = await db
      .prepare(
        `INSERT INTO tickets (
           date, issue, department, name, solution, remarks, type,
           status, priority, assignee, due_date, closed_at,
           updated_at, updated_at_ts
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, status, priority, assignee, due_date || null, closedAtValue, nowTs)
      .run();
    return { id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs };
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;

    const result = await db
      .prepare(
        `INSERT INTO tickets (date, issue, department, name, solution, remarks, type, updated_at, updated_at_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
      )
      .bind(date, issue, department, name, solution, remarks, type, nowTs)
      .run();
    return { id: result?.meta?.last_row_id ?? null, updated_at_ts: nowTs, schema_warning: "workflow_fields_missing" };
  }
}

function parseVersion(body) {
  const updatedAtTs = Number(body?.updated_at_ts ?? body?.updatedAtTs ?? body?.updatedAtTS ?? body?.updated_atTs);
  return {
    hasTimestamp: Number.isFinite(updatedAtTs) && updatedAtTs > 0,
    updatedAtTs,
  };
}

function buildUpdateValues(ticket, nowTs) {
  const closedAtValue = ticket.status === "已关闭" ? (ticket.closed_at || new Date(nowTs).toISOString()) : null;
  return [
    ticket.date,
    ticket.issue,
    ticket.department,
    ticket.name,
    ticket.solution,
    ticket.remarks,
    ticket.type,
    ticket.status,
    ticket.priority,
    ticket.assignee,
    ticket.due_date || null,
    closedAtValue,
  ];
}

async function updateCurrentSchema(db, { id, ticket, version, nowTs }) {
  const values = buildUpdateValues(ticket, nowTs);
  const baseSql = `UPDATE tickets
    SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?,
        status=?, priority=?, assignee=?, due_date=?, closed_at=?,
        updated_at=CURRENT_TIMESTAMP,
        updated_at_ts=?`;

  return await db.prepare(`${baseSql} WHERE id=? AND is_deleted=0 AND updated_at_ts=?`).bind(...values, nowTs, id, version.updatedAtTs).run();
}

async function updateLegacySchema(db, { id, ticket, version, nowTs }) {
  const values = [ticket.date, ticket.issue, ticket.department, ticket.name, ticket.solution, ticket.remarks, ticket.type];
  const baseSql = "UPDATE tickets SET date=?, issue=?, department=?, name=?, solution=?, remarks=?, type=?, updated_at=CURRENT_TIMESTAMP";

  return await db.prepare(`${baseSql}, updated_at_ts=? WHERE id=? AND updated_at_ts=?`).bind(...values, nowTs, id, version.updatedAtTs).run();
}

export async function updateTicket(db, { id, ticket, body, nowTs }) {
  const current = await findTicket(db, id);
  if (!current) return { status: "not_found" };
  if (isDeletedTicket(current)) return { status: "deleted" };

  const version = parseVersion(body);
  if (!version.hasTimestamp) {
    return { status: "missing_version" };
  }

  const currentUpdatedAt = String(current.updated_at ?? "").trim();
  const currentUpdatedAtTs = Number(current.updated_at_ts ?? 0) || 0;
  let result;
  try {
    try {
      result = await updateCurrentSchema(db, { id, ticket, version, nowTs });
    } catch {
      result = await updateLegacySchema(db, { id, ticket, version, nowTs });
    }
  } catch (error) {
    if (isMissingColumnError(error)) return { status: "version_unavailable" };
    throw error;
  }

  if (Number(result?.meta?.changes ?? 0) === 0) {
    const latest = await findTicket(db, id);
    return {
      status: "conflict",
      current: latest ?? current,
      client_updated_at_ts: version.updatedAtTs,
      server_updated_at: String((latest ?? current).updated_at ?? currentUpdatedAt),
      server_updated_at_ts: Number((latest ?? current).updated_at_ts ?? currentUpdatedAtTs) || 0,
    };
  }

  const latest = await findTicket(db, id);
  return {
    status: "updated",
    updated_at: String(latest?.updated_at ?? ""),
    updated_at_ts: Number(latest?.updated_at_ts ?? nowTs) || nowTs,
  };
}

export async function softDeleteTicket(db, id, nowTs) {
  let result;
  try {
    result = await db
      .prepare("UPDATE tickets SET is_deleted=1, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_at_ts=? WHERE id=? AND is_deleted=0")
      .bind(nowTs, id)
      .run();
  } catch {
    result = await db
      .prepare("UPDATE tickets SET is_deleted=1, deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_deleted=0")
      .bind(id)
      .run();
  }

  if (Number(result?.meta?.changes ?? 0) > 0) return { status: "deleted" };

  const latest = await findTicket(db, id);
  if (!latest) return { status: "not_found" };
  if (isDeletedTicket(latest)) return { status: "already_deleted" };
  return { status: "failed" };
}

export async function batchUpdateTickets(db, { ids, updates, nowTs }) {
  const clauses = [];
  const values = [];
  if (updates.status) {
    clauses.push("status=?");
    values.push(updates.status);
  }
  if (updates.assignee !== undefined) {
    clauses.push("assignee=?");
    values.push(updates.assignee);
  }

  clauses.push("updated_at=CURRENT_TIMESTAMP", "updated_at_ts=?");
  const placeholders = ids.map(() => "?").join(",");
  const result = await db
    .prepare(`UPDATE tickets SET ${clauses.join(", ")} WHERE id IN (${placeholders}) AND is_deleted=0`)
    .bind(...values, nowTs, ...ids)
    .run();
  return Number(result?.meta?.changes ?? 0);
}