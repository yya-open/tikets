import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { requireAdminKey, requireEditKey } from "../functions/_lib/auth.js";
import { isPublicCacheableGet } from "../functions/_lib/http.js";
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
import { onRequestGet as authTest } from "../functions/api/auth-test.js";
import { onRequestPut as replaceImport } from "../functions/api/import.js";

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
    ticketStatus: "处理中",
    assignee: "Bob",
    priority: "高",
    quick: "open",
    quickDate: "2026-05-10",
  });

  assert.deepEqual(where, [
    "tickets.is_deleted=?",
    "tickets.date >= ?",
    "tickets.date <= ?",
    "tickets.type = ?",
    "tickets.department LIKE ?",
    "tickets.name LIKE ?",
    "tickets.status = ?",
    "tickets.assignee LIKE ?",
    "tickets.priority = ?",
    "COALESCE(NULLIF(TRIM(tickets.status),''),'待处理') IN ('待处理','处理中')",
  ]);
  assert.deepEqual(binds, [0, "2026-01-01", "2026-12-31", "VPN", "%IT%", "%Alice%", "处理中", "%Bob%", "高"]);
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
  assert.equal(valid.data.status, "待处理");
  assert.equal(valid.data.priority, "普通");

  const invalid = validateTicketPayload({ date: "2026/05/10", issue: "" }, { requireVersion: true });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors.map((e) => e.field), ["date", "issue", "updated_at_ts"]);

  const invalidDueDate = validateTicketPayload({ date: "2026-05-10", issue: "x", due_date: "2026/05/11" });
  assert.equal(invalidDueDate.ok, false);
  assert.deepEqual(invalidDueDate.errors.map((e) => e.field), ["due_date"]);
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

test("main page loads ticket filters before query runtime", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const filtersIndex = html.indexOf("/assets/js/ticket-filters.js");
  const runtimeIndex = html.indexOf("/assets/js/ticket-query-runtime.js");
  assert.ok(filtersIndex > -1, "ticket-filters.js should be loaded by index.html");
  assert.ok(runtimeIndex > -1, "ticket-query-runtime.js should be loaded by index.html");
  assert.ok(filtersIndex < runtimeIndex, "filters should be available before query runtime is used");
  assert.match(html, /id="quickFilterGroup"/);
  assert.match(html, /id="tableDensitySelect"/);
  assert.match(html, /id="columnSettingsPanel"/);
  assert.match(html, /id="btnBatchApplyWorkflow"/);
  assert.doesNotMatch(html, /<th data-column="status">/);
  assert.doesNotMatch(html, /<th data-column="priority">/);
  assert.match(html, /data-column="assignee"/);
});

test("pages load auth and api through the ES module core entry", () => {
  const pages = ["../index.html", "../admin.html"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

  for (const html of pages) {
    const coreIndex = html.indexOf("/assets/js/ticket-core.entry.js");
    const sessionIndex = html.indexOf("/assets/js/ticket-session.js");
    assert.ok(coreIndex > -1, "core module entry should be loaded");
    assert.match(html, /<script\s+type="module"\s+src="\/assets\/js\/ticket-core\.entry\.js"><\/script>/);
    assert.ok(sessionIndex > -1, "ticket-session.js should still be loaded");
    assert.ok(coreIndex < sessionIndex, "core module should be declared before session-dependent scripts");
    assert.equal(html.includes("/assets/js/ticket-auth.js"), false);
    assert.equal(html.includes("/assets/js/ticket-api.js"), false);
  }
});

test("pages keep scripts and styles externalized for CSP", () => {
  const pages = ["../index.html", "../admin.html"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const headers = readFileSync(new URL("../_headers", import.meta.url), "utf8");
  const mainPage = pages[0];

  for (const html of pages) {
    assert.equal(/<style\b/i.test(html), false);
    assert.equal(/\sstyle=/i.test(html), false);
    assert.equal(/\son(?:click|change|submit|keydown)=/i.test(html), false);
    assert.equal(/javascript:/i.test(html), false);
    assert.equal(html.includes("cdn.jsdelivr.net"), false);

    for (const match of html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)/g)) {
      const assetPath = match[1].split("?")[0];
      assert.equal(existsSync(new URL(`..${assetPath}`, import.meta.url)), true, `${match[1]} should exist`);
    }
  }

  for (const vendorPath of [
    "/assets/vendor/xlsx.full.min.js",
    "/assets/vendor/jszip.min.js",
    "/assets/vendor/chart.umd.min.js",
    "/assets/vendor/chartjs-plugin-datalabels.min.js",
  ]) {
    assert.ok(mainPage.includes(vendorPath), `${vendorPath} should be loaded locally`);
    assert.equal(existsSync(new URL(`..${vendorPath}`, import.meta.url)), true, `${vendorPath} should exist`);
  }

  assert.match(headers, /script-src 'self'(?:;|$)/);
  assert.match(headers, /style-src 'self'(?:;|$)/);
  assert.equal(headers.includes("'unsafe-inline'"), false);
  assert.equal(headers.includes("cdn.jsdelivr.net"), false);
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=3600/s);
  assert.match(headers, /\/assets\/vendor\/\*\s+Cache-Control: public, max-age=31536000, immutable/s);
});

test("public API cache helper honors fresh requests and auth headers", () => {
  assert.equal(isPublicCacheableGet(new Request("https://example.test/api/tickets")), true);
  assert.equal(isPublicCacheableGet(new Request("https://example.test/api/tickets?fresh=1")), false);
  assert.equal(
    isPublicCacheableGet(new Request("https://example.test/api/tickets", { headers: { "Cache-Control": "no-cache" } })),
    false
  );
  assert.equal(
    isPublicCacheableGet(new Request("https://example.test/api/tickets", { headers: { Pragma: "no-cache" } })),
    false
  );
  assert.equal(
    isPublicCacheableGet(new Request("https://example.test/api/tickets", { headers: { "X-EDIT-KEY": "secret" } })),
    false
  );
  assert.equal(
    isPublicCacheableGet(new Request("https://example.test/api/tickets", { method: "POST" })),
    false
  );
});

test("edit and admin keys are validated with admin as write superset", async () => {
  const env = { EDIT_KEY: "edit-secret", ADMIN_KEY: "admin-secret" };

  assert.equal(
    await requireEditKey(new Request("https://example.test/api/tickets", { headers: { "X-EDIT-KEY": "edit-secret" } }), env),
    null
  );
  assert.equal(
    await requireEditKey(new Request("https://example.test/api/tickets", { headers: { "X-EDIT-KEY": "admin-secret" } }), env),
    null
  );
  assert.equal(
    await requireAdminKey(new Request("https://example.test/api/admin/migrate", { headers: { "X-ADMIN-KEY": "admin-secret" } }), env),
    null
  );

  const deniedAdmin = await requireAdminKey(
    new Request("https://example.test/api/admin/migrate", { headers: { "X-EDIT-KEY": "edit-secret" } }),
    env
  );
  assert.equal(deniedAdmin.status, 403);

  assert.equal(
    await requireAdminKey(
      new Request("https://example.test/api/admin/migrate", { headers: { "X-EDIT-KEY": "edit-secret" } }),
      { EDIT_KEY: "edit-secret" }
    ),
    null
  );
});

test("auth-test admin scope requires admin credentials when configured", async () => {
  const env = { EDIT_KEY: "edit-secret", ADMIN_KEY: "admin-secret" };

  const editRes = await authTest({
    request: new Request("https://example.test/api/auth-test", { headers: { "X-EDIT-KEY": "edit-secret" } }),
    env,
  });
  assert.equal(editRes.status, 200);
  assert.equal((await editRes.json()).scope, "edit");

  const deniedAdmin = await authTest({
    request: new Request("https://example.test/api/auth-test?scope=admin", { headers: { "X-EDIT-KEY": "edit-secret" } }),
    env,
  });
  assert.equal(deniedAdmin.status, 403);

  const adminRes = await authTest({
    request: new Request("https://example.test/api/auth-test?scope=admin", { headers: { "X-ADMIN-KEY": "admin-secret" } }),
    env,
  });
  assert.equal(adminRes.status, 200);
  assert.equal((await adminRes.json()).scope, "admin");
});

test("replace-all import requires explicit confirmation", async () => {
  const request = new Request("https://example.test/api/import", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-ADMIN-KEY": "admin-secret" },
    body: JSON.stringify({ active: [] }),
  });
  const res = await replaceImport({ request, env: { ADMIN_KEY: "admin-secret" } });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.code, "confirmation_required");
});

test("frontend keeps admin credentials separate from edit credentials", () => {
  const authModule = readFileSync(new URL("../assets/js/modules/ticket-auth.module.js", import.meta.url), "utf8");
  const session = readFileSync(new URL("../assets/js/ticket-session.js", import.meta.url), "utf8");

  assert.match(authModule, /ticket_admin_key/);
  assert.match(authModule, /export function getAdmin\(\)/);
  assert.match(authModule, /export function setAdmin\(value\)/);
  assert.match(authModule, /clearAdminSetAt/);

  assert.match(session, /function ensureAdminKey\(\)/);
  assert.match(session, /window\.ensureAdminKey = ensureAdminKey/);
  assert.match(session, /X-ADMIN-KEY/);
});

test("frontend admin-only endpoints request admin-scoped credentials", () => {
  const apiModule = readFileSync(new URL("../assets/js/modules/ticket-api.module.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../assets/js/ticket-service.js", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../assets/js/ticket-settings-tools.js", import.meta.url), "utf8");
  const health = readFileSync(new URL("../assets/js/ticket-health.js", import.meta.url), "utf8");
  const adminBootstrap = readFileSync(new URL("../assets/js/ticket-admin-bootstrap.js", import.meta.url), "utf8");
  const dictionary = readFileSync(new URL("../assets/js/ticket-dictionary.js", import.meta.url), "utf8");

  assert.match(apiModule, /authScope === "admin"/);
  assert.match(apiModule, /headers\.set\(isAdminScope \? "X-ADMIN-KEY" : "X-EDIT-KEY"/);
  assert.match(service, /\/api\/admin\/migrate', \{ method: 'POST', authScope: 'admin' \}/);
  assert.match(settings, /\/api\/admin\/oneclick/);
  assert.match(settings, /authScope: "admin"/);
  assert.match(health, /\/api\/health', \{ authScope: 'admin'/);
  assert.match(adminBootstrap, /ensureAdminKey/);
  assert.match(dictionary, /openKeyModal\("admin"\)/);
});
