import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeletedFilter,
  buildFtsQuery,
  normalizeDateParam,
  normalizeFilterTextParam,
  normalizeStatusDeletedParam,
  pushKeywordLikeFilter,
  pushTicketFilters,
} from "../functions/_lib/ticket_query.js";
import { diffImport, normalizeImportPayload, parseImportPayload } from "../functions/_lib/import_common.js";
import { splitSqlStatements } from "../functions/_lib/schema_migrate.js";
import { validateTicketPayload } from "../functions/_lib/validation.js";

test("ticket query helpers normalize filters and build ticket predicates", () => {
  assert.equal(normalizeDateParam("2026-05-10"), "2026-05-10");
  assert.equal(normalizeDateParam("2026-5-10"), "");
  assert.equal(normalizeStatusDeletedParam("deleted"), 1);
  assert.equal(normalizeStatusDeletedParam("active"), 0);
  assert.equal(normalizeStatusDeletedParam("unknown"), null);
  assert.equal(buildDeletedFilter(false, null), 0);
  assert.equal(buildDeletedFilter(false, 1), 1);
  assert.equal(normalizeFilterTextParam("abcdefghijkl", 4), "abcd");

  const where = [];
  const binds = [];
  pushTicketFilters(where, binds, {
    deleted: 0,
    from: "2026-01-01",
    to: "2026-12-31",
    type: "VPN",
    department: "IT",
    name: "Alice",
  });

  assert.deepEqual(where, [
    "tickets.is_deleted=?",
    "tickets.date >= ?",
    "tickets.date <= ?",
    "tickets.type = ?",
    "tickets.department LIKE ?",
    "tickets.name LIKE ?",
  ]);
  assert.deepEqual(binds, [0, "2026-01-01", "2026-12-31", "VPN", "%IT%", "%Alice%"]);
});

test("keyword helpers build safe LIKE and FTS queries", () => {
  const where = [];
  const binds = [];
  pushKeywordLikeFilter(where, binds, "vpn", "");
  assert.equal(where.length, 1);
  assert.match(where[0], /issue LIKE \?/);
  assert.match(where[0], /type LIKE \?/);
  assert.deepEqual(binds, ["%vpn%", "%vpn%", "%vpn%", "%vpn%", "%vpn%", "%vpn%"]);

  const fts = buildFtsQuery('vpn "login"');
  assert.match(fts, /issue:"vpn"/);
  assert.match(fts, /type:"vpn"/);
  assert.match(fts, /issue:"""login"""/);
  assert.match(fts, / AND /);

  const capped = buildFtsQuery("1 2 3 4 5 6 7 8 9 10 11 12 13");
  assert.equal((capped.match(/\(issue:/g) || []).length, 12);
});

test("ticket validation normalizes valid payloads and reports invalid records", () => {
  const valid = validateTicketPayload({
    date: "2026-05-10",
    issue: "  Cannot login  ",
    department: "IT",
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.data.issue, "Cannot login");
  assert.equal(valid.data.type, "日常故障");

  const invalid = validateTicketPayload({ date: "2026/05/10", issue: "" }, { requireVersion: true });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors.map((e) => e.field), ["date", "issue", "updated_at_ts"]);
});

test("import diff protects newer server records", () => {
  const parsed = parseImportPayload({
    active: [
      { id: 1, date: "2026-01-01", issue: "older backup", updated_at_ts: 100 },
      { id: 2, date: "2026-01-02", issue: "newer backup", updated_at_ts: 300 },
      { id: 3, date: "2026-01-03", issue: "new cloud row", updated_at_ts: 50 },
      { id: 4, date: "", issue: "bad" },
    ],
  });
  const normalized = normalizeImportPayload(parsed);
  const existing = new Map([
    [1, { id: 1, updated_at: "", updated_at_ts: 200 }],
    [2, { id: 2, updated_at: "", updated_at_ts: 200 }],
  ]);

  const diff = diffImport(existing, normalized.all);
  assert.deepEqual(diff.skips.map((r) => r.id), [1]);
  assert.deepEqual(diff.updates.map((r) => r.id), [2]);
  assert.deepEqual(diff.inserts.map((r) => r.id), [3]);
  assert.deepEqual(diff.invalid.map((r) => r.id), [4]);
});

test("SQL splitter keeps trigger bodies intact", () => {
  const sql = `
    CREATE TABLE tickets(id INTEGER);
    CREATE TRIGGER trg AFTER INSERT ON tickets BEGIN
      INSERT INTO tickets(id) VALUES (new.id);
      UPDATE tickets SET id = id;
    END;
    CREATE INDEX idx_tickets_id ON tickets(id);
  `;

  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /CREATE TRIGGER/);
  assert.match(statements[1], /UPDATE tickets SET id = id;/);
  assert.match(statements[2], /CREATE INDEX/);
});
