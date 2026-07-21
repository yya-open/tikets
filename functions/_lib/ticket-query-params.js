import {
  buildDeletedFilter,
  normalizeDateParam,
  normalizeFilterTextParam,
  normalizeStatusDeletedParam,
  normalizeTextParam,
} from "./ticket_query.js";
import { decodeCursor, parsePageNumber } from "./ticket-pagination.js";

function isTrashView(raw) {
  return ["1", "true", "yes"].includes(String(raw || "").toLowerCase());
}

function parseDirection(raw) {
  const value = String(raw || "").toLowerCase();
  return value === "prev" || value === "previous" ? "prev" : "next";
}

export function parseTicketListQuery(searchParams, { now = new Date() } = {}) {
  const trash = isTrashView(searchParams.get("trash"));
  const qRaw = normalizeTextParam(searchParams.get("q"));
  const quickRaw = normalizeFilterTextParam(searchParams.get("quick"), 24);

  return {
    cursor: decodeCursor(searchParams.get("cursor")),
    direction: parseDirection(searchParams.get("direction") || searchParams.get("dir")),
    page: parsePageNumber(searchParams.get("page")),
    pageSize: parsePageNumber(searchParams.get("pageSize"), { max: 100, fallback: 100 }),
    deleted: buildDeletedFilter(trash, normalizeStatusDeletedParam(searchParams.get("status"))),
    from: normalizeDateParam(searchParams.get("from")),
    to: normalizeDateParam(searchParams.get("to")),
    type: normalizeTextParam(searchParams.get("type")),
    department: normalizeFilterTextParam(searchParams.get("department")),
    name: normalizeFilterTextParam(searchParams.get("name")),
    ticketStatus: normalizeFilterTextParam(searchParams.get("ticketStatus") || searchParams.get("workStatus")),
    assignee: normalizeFilterTextParam(searchParams.get("assignee")),
    priority: normalizeFilterTextParam(searchParams.get("priority")),
    quick: ["open", "overdue", "today", "unassigned"].includes(quickRaw) ? quickRaw : "",
    quickDate: normalizeDateParam(searchParams.get("quickDate")) || now.toISOString().slice(0, 10),
    q: qRaw.slice(0, 120),
  };
}