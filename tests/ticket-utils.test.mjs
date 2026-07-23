/**
 * `assets/js/ticket-utils.js` 纯函数单测
 *
 * 为什么用 node:vm 而不是直接 import：
 *   该文件是浏览器 defer classic 脚本，通过顶层 function 声明挂到全局；
 *   把它抽成 ES module 会破坏 defer 时序（详见文件顶注释）。
 *   这里在假的沙箱里执行它，直接取沙箱上的函数句柄做断言。
 *
 * 覆盖点：
 *   1. formatISOToLocal 空值 / 非法值 / 正常 ISO
 *   2. normalizeRecord 中文别名 / 驼峰别名 / fallbackId / is_deleted 归一
 *   3. normalizeRecords 非数组 / 空数组 / 缺 id 兜底
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// 在假沙箱里执行 utils.js，捞出顶层 function 声明
const source = readFileSync(new URL("../assets/js/ticket-utils.js", import.meta.url), "utf8");
const sandbox = {
  document: { createElement: () => ({}), head: { appendChild: () => {} } },
  Promise,
};
runInNewContext(source, sandbox, { filename: "ticket-utils.js" });

const { normalizeRecord, normalizeRecords, formatISOToLocal } = sandbox;

test("formatISOToLocal handles empty, invalid and valid inputs", () => {
  assert.equal(formatISOToLocal(""), "-");
  assert.equal(formatISOToLocal(null), "-");
  assert.equal(formatISOToLocal(undefined), "-");

  // 不可 parse 的字符串原样返回，避免误显示 1970-01-01
  assert.equal(formatISOToLocal("not-a-date"), "not-a-date");

  // 正常 ISO：格式化为 YYYY-MM-DD HH:mm:ss，跟本地时区相关，验证结构和补零
  const out = formatISOToLocal("2026-05-10T03:04:05");
  assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("normalizeRecord accepts chinese aliases and camelCase fallbacks", () => {
  const r = normalizeRecord({
    ID: "42",
    日期: "2026-05-10",
    问题: "无法登录",
    部门: "IT",
    姓名: "张三",
    处理方法: "重启",
    备注: "复现率高",
    类型: "日常故障",
    状态: "处理中",
    优先级: "高",
    负责人: "李四",
    截止日期: "2026-05-20",
    updatedAt: "2026-05-10T09:00:00Z",
    updatedAtTs: 1715330400,
    isDeleted: "0",
  }, 999);

  assert.equal(r.id, 42, "数字 id 应从字符串解析");
  assert.equal(r.date, "2026-05-10");
  assert.equal(r.issue, "无法登录");
  assert.equal(r.department, "IT");
  assert.equal(r.name, "张三");
  assert.equal(r.solution, "重启");
  assert.equal(r.remarks, "复现率高");
  assert.equal(r.type, "日常故障");
  assert.equal(r.status, "处理中");
  assert.equal(r.priority, "高");
  assert.equal(r.assignee, "李四");
  assert.equal(r.due_date, "2026-05-20");
  assert.equal(r.updated_at, "2026-05-10T09:00:00Z");
  assert.equal(r.updated_at_ts, 1715330400);
  assert.equal(r.is_deleted, 0, "字符串 '0' 应视为未删除");
});

test("normalizeRecord fills defaults for missing fields and uses fallbackId", () => {
  const r = normalizeRecord({}, 7);
  assert.equal(r.id, 7);
  assert.equal(r.date, "");
  assert.equal(r.issue, "");
  assert.equal(r.status, "待处理", "空状态应默认为待处理");
  assert.equal(r.priority, "普通", "空优先级应默认为普通");
  assert.equal(r.is_deleted, 0);

  // 非对象输入也应该给出可用的默认结构
  const nullR = normalizeRecord(null, 3);
  assert.equal(nullR.id, 3);
  assert.equal(nullR.status, "待处理");

  // NaN id 时用 fallbackId 兜底
  const badId = normalizeRecord({ id: "abc" }, 12);
  assert.equal(badId.id, 12);

  // is_deleted 从任意 truthy 数字归一为 1
  const del = normalizeRecord({ is_deleted: 2 }, 1);
  assert.equal(del.is_deleted, 1);
});

test("normalizeRecords handles non-array, empty and missing-id inputs", () => {
  // 注意：vm 沙箱返回的数组来自另一个 realm，跨 realm 的 deepStrictEqual 会因 prototype 不同而失败，
  // 因此这里改成用 length + Array.isArray 语义等价断言。
  for (const bad of [null, undefined, "not array", 42, {}]) {
    const out = normalizeRecords(bad);
    assert.ok(Array.isArray(out), "非数组输入应返回数组");
    assert.equal(out.length, 0);
  }
  const empty = normalizeRecords([]);
  assert.ok(Array.isArray(empty));
  assert.equal(empty.length, 0);

  const out = normalizeRecords([
    { issue: "a" },
    { id: 10, issue: "b" },
    { issue: "c" },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 1, "缺 id 按 index+1 兜底");
  assert.equal(out[1].id, 10, "已有 id 保留");
  assert.equal(out[2].id, 3);
  assert.equal(out[0].issue, "a");
  assert.equal(out[2].issue, "c");
});