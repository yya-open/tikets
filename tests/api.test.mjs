import test from "node:test";
import assert from "node:assert/strict";
import { initTestDb, insertTicket, createCtx } from "./helper.mjs";

// Mock Cloudflare Workers caches API for Node.js test environment
if (!globalThis.caches) {
  const cache = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        const entry = cache.get(key.url);
        if (!entry) return undefined;
        if (entry.expires && entry.expires < Date.now()) {
          cache.delete(key.url);
          return undefined;
        }
        return entry.response.clone();
      },
      async put(key, response) {
        cache.set(key.url, { response, expires: Date.now() + 30000 });
      },
      async delete(key) {
        cache.delete(key.url);
      },
    },
  };
}

// 模拟环境变量
const EDIT_KEY = "test-edit-key";
const ADMIN_KEY = "test-admin-key";
function env(d1) {
  return { DB: d1, EDIT_KEY, ADMIN_KEY };
}

// ===== tickets CRUD =====

test("GET /api/tickets returns empty list when no tickets exist", async () => {
  const d1 = initTestDb();
  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?fresh=1&page=1&pageSize=10", env: env(d1) });
  const res = await onRequestGet(ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.length, 0);
  assert.equal(data.total, 0);
  d1.close();
});

test("GET /api/tickets returns paginated tickets", async () => {
  const d1 = initTestDb();
  for (let i = 0; i < 15; i++) {
    await insertTicket(d1, { issue: `工单${i + 1}`, date: `2026-06-${String(i + 1).padStart(2, "0")}` });
  }
  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?fresh=1&page=1&pageSize=10", env: env(d1) });
  const res = await onRequestGet(ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.length, 10);
  assert.equal(data.total, 15);
  d1.close();
});

test("GET /api/tickets supports cursor pagination", async () => {
  const d1 = initTestDb();
  for (let i = 0; i < 5; i++) {
    await insertTicket(d1, { issue: `工单${i + 1}`, date: `2026-06-${String(i + 1).padStart(2, "0")}` });
  }
  const { onRequestGet } = await import("../functions/api/tickets.js");

  // Get the second record to use as cursor target
  const all = await d1.prepare("SELECT id, date FROM tickets ORDER BY date ASC, id ASC LIMIT 2").bind().all();
  const pivot = all.results[1];
  const raw = JSON.stringify({ v: pivot.date, id: pivot.id });
  const cursor = Buffer.from(raw).toString("base64url");

  const res = await onRequestGet(createCtx({ url: `/api/tickets?fresh=1&pageSize=2&cursor=${cursor}&direction=next`, env: env(d1) }));
  const data = await res.json();
  assert.equal(data.data.length, 2);
  assert.equal(data.total, 5);
  d1.close();
});

test("GET /api/tickets filters by keyword", async () => {
  const d1 = initTestDb();
  await insertTicket(d1, { issue: "打印机故障" });
  await insertTicket(d1, { issue: "网络连接问题" });
  await insertTicket(d1, { issue: "打印机卡纸" });
  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?fresh=1&q=打印机", env: env(d1) });
  const res = await onRequestGet(ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.length, 2);
  d1.close();
});

test("GET /api/tickets filters by type", async () => {
  const d1 = initTestDb();
  await insertTicket(d1, { issue: "A", type: "日常故障" });
  await insertTicket(d1, { issue: "B", type: "网络问题" });
  await insertTicket(d1, { issue: "C", type: "日常故障" });
  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?fresh=1&type=日常故障", env: env(d1) });
  const res = await onRequestGet(ctx);
  const data = await res.json();
  assert.equal(data.data.length, 2);
  d1.close();
});

test("POST /api/tickets creates a ticket", async () => {
  const d1 = initTestDb();
  const { onRequestPost } = await import("../functions/api/tickets.js");
  const ctx = createCtx({
    method: "POST",
    url: "/api/tickets",
    body: { date: "2026-06-15", issue: "新工单", type: "日常故障" },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.id > 0);

  // Verify it was actually inserted
  const count = await d1.prepare("SELECT COUNT(*) AS c FROM tickets").bind().first();
  assert.equal(count.c, 1);
  d1.close();
});

test("POST /api/tickets rejects missing required fields", async () => {
  const d1 = initTestDb();
  const { onRequestPost } = await import("../functions/api/tickets.js");
  const ctx = createCtx({
    method: "POST",
    url: "/api/tickets",
    body: { date: "2026-06-15" },  // missing issue
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 400);
  d1.close();
});

test("POST /api/tickets rejects missing auth key", async () => {
  const d1 = initTestDb();
  const { onRequestPost } = await import("../functions/api/tickets.js");
  const ctx = createCtx({
    method: "POST",
    url: "/api/tickets",
    body: { date: "2026-06-15", issue: "test" },
    env: env(d1),  // no x-edit-key header
  });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 403);
  d1.close();
});

test("POST /api/tickets rejects invalid JSON", async () => {
  const d1 = initTestDb();
  const { onRequestPost } = await import("../functions/api/tickets.js");
  const ctx = createCtx({
    method: "POST",
    url: "/api/tickets",
    body: undefined,
    headers: { "x-edit-key": EDIT_KEY, "content-type": "application/json" },
    env: env(d1),
  });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 400);
  d1.close();
});

// ===== PUT /api/tickets/:id =====

test("PUT /api/tickets/:id updates an existing ticket", async () => {
  const d1 = initTestDb();
  const ticket = await insertTicket(d1);
  const { onRequestPut } = await import("../functions/api/tickets/[id].js");
  const ctx = createCtx({
    method: "PUT",
    url: `/api/tickets/${ticket.id}`,
    params: { id: String(ticket.id) },
    body: {
      date: ticket.date,
      issue: "更新后的工单",
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      updated_at: ticket.updated_at || "",
      updated_at_ts: ticket.updated_at_ts,
    },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestPut(ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);

  // Verify update
  const updated = await d1.prepare("SELECT issue FROM tickets WHERE id=?").bind(ticket.id).first();
  assert.equal(updated.issue, "更新后的工单");
  d1.close();
});

test("PUT /api/tickets/:id returns 404 for non-existent ticket", async () => {
  const d1 = initTestDb();
  const { onRequestPut } = await import("../functions/api/tickets/[id].js");
  const ctx = createCtx({
    method: "PUT",
    url: "/api/tickets/99999",
    params: { id: "99999" },
    body: { date: "2026-06-15", issue: "test", type: "日常故障", status: "待处理", priority: "普通", updated_at: "", updated_at_ts: 1234567890 },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestPut(ctx);
  assert.equal(res.status, 404);
  d1.close();
});

test("PUT /api/tickets/:id returns 409 for a stale version", async () => {
  const d1 = initTestDb();
  const ticket = await insertTicket(d1);
  const { onRequestPut } = await import("../functions/api/tickets/[id].js");
  const res = await onRequestPut(createCtx({
    method: "PUT",
    url: `/api/tickets/${ticket.id}`,
    params: { id: String(ticket.id) },
    body: {
      date: ticket.date,
      issue: "过期版本更新",
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      updated_at_ts: ticket.updated_at_ts - 1,
    },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  }));

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, "conflict");
  assert.equal(data.current.id, ticket.id);
  d1.close();
});

test("PUT /api/tickets/batch updates status and assignee", async () => {
  const d1 = initTestDb();
  const first = await insertTicket(d1, { assignee: "" });
  const second = await insertTicket(d1, { assignee: "" });
  const { onRequestPut } = await import("../functions/api/tickets/batch.js");
  const res = await onRequestPut(createCtx({
    method: "PUT",
    url: "/api/tickets/batch",
    body: { ids: [first.id, second.id], updates: { status: "处理中", assignee: "王五" } },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  }));

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.updated, 2);
  const updated = await d1.prepare("SELECT status, assignee FROM tickets WHERE id IN (?, ?) ORDER BY id").bind(first.id, second.id).all();
  assert.deepEqual(updated.results.map((row) => ({ ...row })), [
    { status: "处理中", assignee: "王五" },
    { status: "处理中", assignee: "王五" },
  ]);
  d1.close();
});

test("PUT /api/tickets/batch rejects invalid status", async () => {
  const d1 = initTestDb();
  const ticket = await insertTicket(d1);
  const { onRequestPut } = await import("../functions/api/tickets/batch.js");
  const res = await onRequestPut(createCtx({
    method: "PUT",
    url: "/api/tickets/batch",
    body: { ids: [ticket.id], updates: { status: "未知状态" } },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  }));

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, "invalid_status");
  d1.close();
});

// ===== DELETE /api/tickets/:id =====

test("DELETE /api/tickets/:id soft-deletes a ticket", async () => {
  const d1 = initTestDb();
  const ticket = await insertTicket(d1);
  const { onRequestDelete } = await import("../functions/api/tickets/[id].js");
  const ctx = createCtx({
    method: "DELETE",
    url: `/api/tickets/${ticket.id}`,
    params: { id: String(ticket.id) },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestDelete(ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.soft, true);

  // Verify soft deleted
  const deleted = await d1.prepare("SELECT is_deleted FROM tickets WHERE id=?").bind(ticket.id).first();
  assert.equal(deleted.is_deleted, 1);
  d1.close();
});

test("DELETE /api/tickets/:id returns 404 for non-existent ticket", async () => {
  const d1 = initTestDb();
  const { onRequestDelete } = await import("../functions/api/tickets/[id].js");
  const ctx = createCtx({
    method: "DELETE",
    url: "/api/tickets/99999",
    params: { id: "99999" },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  });
  const res = await onRequestDelete(ctx);
  assert.equal(res.status, 404);
  d1.close();
});

test("soft-deleted tickets do not appear in normal listing", async () => {
  const d1 = initTestDb();
  await insertTicket(d1, { issue: "可见工单" });
  const ticket2 = await insertTicket(d1, { issue: "已删除工单" });

  // Soft delete the second ticket
  const { onRequestDelete } = await import("../functions/api/tickets/[id].js");
  await onRequestDelete(createCtx({
    method: "DELETE",
    url: `/api/tickets/${ticket2.id}`,
    params: { id: String(ticket2.id) },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  }));

  // Normal listing should only show active tickets
  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?fresh=1", env: env(d1) });
  const res = await onRequestGet(ctx);
  const data = await res.json();
  assert.equal(data.data.length, 1);
  assert.equal(data.data[0].issue, "可见工单");
  d1.close();
});

test("trash view shows soft-deleted tickets", async () => {
  const d1 = initTestDb();
  await insertTicket(d1, { issue: "正常工单" });
  const delTicket = await insertTicket(d1, { issue: "回收站工单" });

  const { onRequestDelete } = await import("../functions/api/tickets/[id].js");
  await onRequestDelete(createCtx({
    method: "DELETE",
    url: `/api/tickets/${delTicket.id}`,
    params: { id: String(delTicket.id) },
    headers: { "x-edit-key": EDIT_KEY },
    env: env(d1),
  }));

  const { onRequestGet } = await import("../functions/api/tickets.js");
  const ctx = createCtx({ url: "/api/tickets?trash=1&fresh=1", env: env(d1) });
  const res = await onRequestGet(ctx);
  const data = await res.json();
  assert.equal(data.data.length, 1);
  assert.equal(data.data[0].issue, "回收站工单");
  d1.close();
});