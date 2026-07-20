import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/**
 * 创建 D1 兼容的 mock 数据库实例。
 * 封装 node:sqlite 的 DatabaseSync，使其 API 与 Cloudflare D1 一致。
 */
export function createMockD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode=WAL");

  function prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      bind(...args) {
        return {
          async run() {
            try {
              const info = stmt.run(...args);
              return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
            } catch (e) {
              throw new Error(e.message);
            }
          },
          async all() {
            const rows = stmt.all(...args);
            return { results: rows };
          },
          async first() {
            const row = stmt.get(...args);
            return row ?? null;
          },
        };
      },
    };
  }

  return {
    prepare,
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        const stmt = db.prepare(s.sql);
        const info = stmt.run(...s.args);
        results.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
      }
      return results;
    },
    exec(sql) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

/**
 * 使用 schema.sql 初始化测试数据库。
 * 返回 mockD1 实例。
 */
export function initTestDb() {
  const d1 = createMockD1();
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf-8");
  d1.exec(schema);
  return d1;
}

/**
 * 插入一条工单测试数据，返回完整记录。
 */
export function insertTicket(d1, overrides = {}) {
  const defaults = {
    date: "2026-06-15",
    issue: "测试工单",
    department: "IT部",
    name: "张三",
    solution: "已处理",
    remarks: "无",
    type: "日常故障",
    status: "待处理",
    priority: "普通",
    assignee: "李四",
    due_date: null,
    closed_at: null,
    updated_at: null,
    updated_at_ts: Date.now(),
    is_deleted: 0,
    deleted_at: null,
  };
  const row = { ...defaults, ...overrides };
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(",");
  const vals = cols.map((k) => row[k]);
  const sql = `INSERT INTO tickets (${cols.join(",")}) VALUES (${placeholders})`;
  d1.prepare(sql).bind(...vals).run();
  const inserted = d1.prepare("SELECT * FROM tickets ORDER BY id DESC LIMIT 1").bind().first();
  return inserted;
}

/**
 * 创建一个模拟的 Request 对象。
 */
export function createRequest(method, url, { body, headers = {} } = {}) {
  const opts = { method, headers: new Headers({ "content-type": "application/json", ...headers }) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return new Request(url.startsWith("http") ? url : `http://test.local${url}`, opts);
}

/**
 * 创建一个模拟的 Pages Functions context 对象。
 */
export function createCtx({ method = "GET", url = "/api/tickets", params = {}, body, headers = {}, env = {} } = {}) {
  return {
    request: createRequest(method, url, { body, headers }),
    env,
    params,
  };
}