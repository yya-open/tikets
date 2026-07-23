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

test("main page loads filters, query runtime, and query controller in order", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const filtersIndex = html.indexOf("/assets/js/ticket-filters.js");
  const pageStateIndex = html.indexOf("/assets/js/ticket-page-state.js");
  const runtimeIndex = html.indexOf("/assets/js/ticket-query-runtime.js");
  const controllerIndex = html.indexOf("/assets/js/ticket-query-controller.js");
  const workbenchIndex = html.indexOf("/assets/js/ticket-workbench-controls.js");
  const detailModalIndex = html.indexOf("/assets/js/ticket-detail-modal.js");
  const batchToolbarIndex = html.indexOf("/assets/js/ticket-batch-toolbar.js");
  const listNavigationIndex = html.indexOf("/assets/js/ticket-list-navigation.js");
  const recordActionsIndex = html.indexOf("/assets/js/ticket-record-actions.js");
  const tableViewIndex = html.indexOf("/assets/js/ticket-table-view.js");
  assert.ok(filtersIndex > -1, "ticket-filters.js should be loaded by index.html");
  assert.ok(pageStateIndex > -1, "ticket-page-state.js should be loaded by index.html");
  assert.ok(runtimeIndex > -1, "ticket-query-runtime.js should be loaded by index.html");
  assert.ok(controllerIndex > -1, "ticket-query-controller.js should be loaded by index.html");
  assert.ok(workbenchIndex > -1, "ticket-workbench-controls.js should be loaded by index.html");
  assert.ok(detailModalIndex > -1, "ticket-detail-modal.js should be loaded by index.html");
  assert.ok(batchToolbarIndex > -1, "ticket-batch-toolbar.js should be loaded by index.html");
  assert.ok(listNavigationIndex > -1, "ticket-list-navigation.js should be loaded by index.html");
  assert.ok(recordActionsIndex > -1, "ticket-record-actions.js should be loaded by index.html");
  assert.ok(tableViewIndex > -1, "ticket-table-view.js should be loaded by index.html");
  assert.ok(pageStateIndex < runtimeIndex, "page state should be available before query runtime snapshots");
  assert.ok(filtersIndex < runtimeIndex, "filters should be available before query runtime is used");
  assert.ok(runtimeIndex < controllerIndex, "query runtime should be available before query controller");
  assert.ok(controllerIndex < tableViewIndex, "query controller should be available before table view");
  assert.ok(workbenchIndex < tableViewIndex, "workbench controls should be available before table view");
  assert.ok(detailModalIndex < tableViewIndex, "ticket detail modal should be available before table view");
  assert.ok(batchToolbarIndex < tableViewIndex, "batch toolbar should be available before table view");
  assert.ok(listNavigationIndex < tableViewIndex, "list navigation should be available before table view");
  assert.ok(recordActionsIndex < tableViewIndex, "record actions should be available before table view");
  assert.ok(recordActionsIndex < detailModalIndex, "record actions should be available before detail modal");
  assert.ok(recordActionsIndex < batchToolbarIndex, "record actions should be available before batch toolbar");
  assert.ok(pageStateIndex < tableViewIndex, "page state should be available before table view state access");
  assert.match(html, /id="quickFilterGroup"/);
  assert.match(html, /id="tableDensitySelect"/);
  assert.match(html, /id="columnSettingsPanel"/);
  assert.match(html, /id="btnBatchApplyWorkflow"/);
  assert.match(html, /id="btnBatchExportFilteredExcel"/);
  assert.match(html, /id="btnBatchExportFilteredJson"/);
  assert.doesNotMatch(html, /class="product-overview"/);
  assert.doesNotMatch(html, /工单协同台/);
  assert.match(html, /<th data-column="status">状态<\/th>/);
  assert.match(html, /<th data-column="priority">优先级<\/th>/);
  assert.match(html, /data-column="assignee"/);
  assert.match(html, /data-column="due_date"/);
});

test("ticket table columns can be hidden with sensible defaults", () => {
  const tableView = readFileSync(new URL("../assets/js/ticket-table-view.js", import.meta.url), "utf8");
  const workbench = readFileSync(new URL("../assets/js/ticket-workbench-controls.js", import.meta.url), "utf8");
  const batchToolbar = readFileSync(new URL("../assets/js/ticket-batch-toolbar.js", import.meta.url), "utf8");
  const listNavigation = readFileSync(new URL("../assets/js/ticket-list-navigation.js", import.meta.url), "utf8");
  const recordActions = readFileSync(new URL("../assets/js/ticket-record-actions.js", import.meta.url), "utf8");
  const queryController = readFileSync(new URL("../assets/js/ticket-query-controller.js", import.meta.url), "utf8");

  assert.match(workbench, /ticket_visible_columns_v2/);
  assert.match(workbench, /\{ key: "status", label: "状态", defaultHidden: true \}/);
  assert.match(workbench, /\{ key: "priority", label: "优先级", defaultHidden: true \}/);
  assert.match(workbench, /\{ key: "assignee", label: "负责人", defaultHidden: true \}/);
  assert.match(workbench, /\{ key: "due_date", label: "截止日期", defaultHidden: true \}/);
  assert.match(workbench, /function getDefaultVisibleColumns\(\)/);
  assert.match(workbench, /function resetColumnVisibilityDefaults\(\)/);
  assert.match(workbench, /function updateColumnSettingsMeta\(panel\)/);
  assert.match(workbench, /data-column-visible-count/);
  assert.match(workbench, /data-column-reset/);
  assert.match(workbench, /column-required/);
  assert.match(workbench, /input\.disabled = !!col\.required/);
  assert.match(tableView, /window\.TicketPageState\.setRecords/);
  assert.doesNotMatch(tableView, /function buildFilters\(/);
  assert.doesNotMatch(tableView, /function loadPageFromServer\(/);
  assert.doesNotMatch(tableView, /const TABLE_COLUMNS = \[/);
  assert.doesNotMatch(tableView, /function renderColumnSettings\(\)/);
  assert.doesNotMatch(tableView, /function bindWorkbenchControls\(\)/);
  assert.doesNotMatch(tableView, /function renderTicketDetailHtml\(record\)/);
  assert.doesNotMatch(tableView, /function openTicketDetail\(id\)/);
  assert.match(batchToolbar, /function syncBatchToolbar\(\)/);
  assert.match(batchToolbar, /function bindBatchToolbarInteractions\(\)/);
  assert.match(batchToolbar, /function applyBatchWorkflowUpdate\(\)/);
  assert.doesNotMatch(tableView, /function syncBatchToolbar\(\)/);
  assert.doesNotMatch(tableView, /function runBatchAction\(action\)/);
  assert.doesNotMatch(tableView, /function applyBatchWorkflowUpdate\(\)/);
  assert.match(listNavigation, /function bindMonthViewInteractions\(\)/);
  assert.match(listNavigation, /function bindPaginationInteractions\(\)/);
  assert.match(listNavigation, /function renderPagination\(totalItems\)/);
  assert.match(listNavigation, /function refreshYearOptions\(\)/);
  assert.match(listNavigation, /function refreshMonthButtons\(\)/);
  assert.match(listNavigation, /function onYearChange\(\)/);
  assert.match(listNavigation, /function setActiveMonth\(m\)/);
  assert.match(listNavigation, /function clamp\(num, min, max\)/);
  assert.doesNotMatch(tableView, /function bindMonthViewInteractions\(\)/);
  assert.doesNotMatch(tableView, /function bindPaginationInteractions\(\)/);
  assert.doesNotMatch(tableView, /function renderPagination\(totalItems\)/);
  assert.doesNotMatch(tableView, /function refreshYearOptions\(\)/);
  assert.doesNotMatch(tableView, /function refreshMonthButtons\(\)/);
  assert.doesNotMatch(tableView, /function onYearChange\(\)/);
  assert.doesNotMatch(tableView, /function setActiveMonth\(m\)/);
  assert.doesNotMatch(tableView, /function clamp\(num, min, max\)/);
  assert.match(recordActions, /async function deleteRecord\(id\)/);
  assert.match(recordActions, /async function restoreRecord\(id\)/);
  assert.match(recordActions, /async function hardDeleteRecord\(id\)/);
  assert.doesNotMatch(tableView, /async function deleteRecord\(id\)/);
  assert.doesNotMatch(tableView, /async function restoreRecord\(id\)/);
  assert.doesNotMatch(tableView, /async function hardDeleteRecord\(id\)/);
  assert.match(queryController, /function buildFilters\(/);
  assert.match(queryController, /function loadPageFromServer\(/);
  assert.match(queryController, /function reloadAndRender\(/);
  assert.doesNotMatch(tableView, /var\s+pageCursorMap\s*=\s*new Map\(\)/);
  assert.doesNotMatch(tableView, /var\s+selectedTicketIds\s*=\s*new Set\(\)/);
});

test("ticket table column widths target semantic columns", () => {
  const css = readFileSync(new URL("../assets/app.css", import.meta.url), "utf8");

  assert.match(css, /#recordTable \[data-column="date"\]/);
  assert.match(css, /#recordTable \[data-column="issue"\]/);
  assert.match(css, /#recordTable \[data-column="solution"\]/);
  assert.match(css, /#recordTable \[data-column="remarks"\]/);
  assert.doesNotMatch(css, /#recordTable th:nth-child\(8\)/);
  assert.doesNotMatch(css, /#recordTable th:nth-child\(9\)/);
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
    assert.ok(mainPage.includes(vendorPath) === false, `${vendorPath} should be lazy-loaded (not in HTML)`);
    assert.equal(existsSync(new URL(`..${vendorPath}`, import.meta.url)), true, `${vendorPath} should exist on disk`);
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
