import { buildFtsQuery, pushKeywordLikeFilter, pushTicketFilters } from "./ticket_query.js";
import { buildPageWindow, encodeCursor } from "./ticket-pagination.js";

function buildWhereSql(where) {
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

function appendCursorClause(whereSql, cursorSql) {
  if (!cursorSql) return whereSql;
  return whereSql ? `${whereSql} AND ${cursorSql}` : `WHERE ${cursorSql}`;
}

function isFtsUnavailable(error) {
  const message = String(error?.message || error);
  return (
    message.includes("no such table: tickets_fts") ||
    message.includes("no such module: fts5") ||
    message.includes("unable to use function MATCH")
  );
}

function buildCurrentSchemaPlan(options, { useFts }) {
  const { cursor, direction, page, pageSize, deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate, q } = options;
  const where = [];
  const binds = [];
  pushTicketFilters(where, binds, { deleted, from, to, type, department, name, ticketStatus, assignee, priority, quick, quickDate });

  const ftsQuery = useFts ? buildFtsQuery(q) : "";
  const joinsFts = Boolean(ftsQuery);
  if (joinsFts) {
    where.push("tickets_fts MATCH ?");
    binds.push(ftsQuery);
  } else if (q) {
    pushKeywordLikeFilter(where, binds, q);
  }

  const useCursor = Boolean(cursor) && !q;
  const sortColumn = deleted ? "tickets.deleted_at" : "tickets.date";
  const pageWindow = buildPageWindow({
    cursor: useCursor ? cursor : null,
    direction,
    page,
    pageSize,
    sortColumn,
    idColumn: "tickets.id",
  });
  const orderSql = joinsFts
    ? "ORDER BY bm25(tickets_fts) ASC, COALESCE(tickets.updated_at_ts,0) DESC, tickets.id DESC"
    : pageWindow.reverseResults
      ? (deleted ? "ORDER BY deleted_at DESC, id DESC" : "ORDER BY date DESC, id DESC")
      : (deleted ? "ORDER BY deleted_at ASC, id ASC" : "ORDER BY date ASC, id ASC");
  const whereSql = buildWhereSql(where);
  const fromSql = joinsFts
    ? "FROM tickets JOIN tickets_fts ON tickets_fts.rowid = tickets.id"
    : "FROM tickets";

  return {
    binds,
    countSql: `SELECT COUNT(*) as total ${fromSql} ${whereSql}`,
    cursorKey: deleted ? "deleted_at" : "date",
    listSql: `SELECT tickets.* ${fromSql} ${appendCursorClause(whereSql, pageWindow.sql)} ${orderSql} ${pageWindow.limitSql}`,
    listBinds: [...binds, ...pageWindow.binds, ...pageWindow.limitBinds],
    reverseResults: pageWindow.reverseResults,
    supportsCursor: true,
    useCursor,
  };
}

function buildLegacySchemaPlan(options) {
  const { page, pageSize, from, to, type, department, name, q } = options;
  const where = [];
  const binds = [];

  if (from) {
    where.push("date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("date <= ?");
    binds.push(to);
  }
  if (type) {
    where.push("type = ?");
    binds.push(type);
  }
  if (department) {
    where.push("department LIKE ?");
    binds.push(`%${department}%`);
  }
  if (name) {
    where.push("name LIKE ?");
    binds.push(`%${name}%`);
  }
  pushKeywordLikeFilter(where, binds, q, "");

  const whereSql = buildWhereSql(where);
  return {
    binds,
    countSql: `SELECT COUNT(*) as total FROM tickets ${whereSql}`,
    cursorKey: null,
    listSql: `SELECT * FROM tickets ${whereSql} ORDER BY date ASC, id ASC LIMIT ? OFFSET ?`,
    listBinds: [...binds, pageSize, (page - 1) * pageSize],
    reverseResults: false,
    supportsCursor: false,
    useCursor: false,
  };
}

async function executePlan(db, plan) {
  const countRow = await db.prepare(plan.countSql).bind(...plan.binds).first();
  const { results } = await db.prepare(plan.listSql).bind(...plan.listBinds).all();
  const rows = Array.isArray(results) ? (plan.reverseResults ? results.slice().reverse() : results) : [];
  const first = rows[0] || null;
  const last = rows[rows.length - 1] || null;

  return {
    data: rows,
    total: Number(countRow?.total ?? 0) || 0,
    supportsCursor: plan.supportsCursor,
    next_cursor: plan.useCursor && last ? encodeCursor({ v: last[plan.cursorKey], id: last.id }) : null,
    prev_cursor: plan.useCursor && first ? encodeCursor({ v: first[plan.cursorKey], id: first.id }) : null,
  };
}

export async function listTickets(db, options) {
  try {
    return await executePlan(db, buildCurrentSchemaPlan(options, { useFts: true }));
  } catch (error) {
    if (isFtsUnavailable(error)) {
      return await executePlan(db, buildCurrentSchemaPlan(options, { useFts: false }));
    }
    return await executePlan(db, buildLegacySchemaPlan(options));
  }
}