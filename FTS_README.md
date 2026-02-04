# LIKE → FTS 全文搜索升级说明

本项目已将后端搜索逻辑升级为 **优先使用 SQLite FTS5（tickets_fts）**，并在 FTS 不可用时自动回退到 LIKE，保证不会影响线上使用。

## 你需要做什么

### 1) 在 Cloudflare D1 Console 执行迁移 SQL

打开 `migrations/fts5_tickets.sql`，把内容复制到 D1 Console 执行。

> 说明：
> - 默认使用 `unicode61`（兼容更好）。
> - 如果你确认 D1 支持 `trigram` tokenizer，可以把文件里 Option 1 取消注释并注释 Option 2，获得更接近 LIKE 的“子串搜索”体验（中文更友好）。

### 2) 验证

- 打开页面，用 `q=xxx` 搜索。
- 在 DevTools Network 里看 `/api/tickets?q=...`、`/api/stats?q=...` 都应正常 200。
- 若 D1 里没有创建 tickets_fts，接口会自动回退 LIKE（不会报错）。

## 接口变化（兼容）

- 仍然使用 `q=keyword`
- 行为：**有 tickets_fts → FTS**；**没有 tickets_fts → LIKE**
