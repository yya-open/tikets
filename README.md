# 工单记录系统（Cloudflare Pages + D1 共享版）

这个版本将数据从浏览器 localStorage 改为 **Cloudflare D1（云端共享）**，并通过 **Pages Functions** 提供 API：
- GET  `/api/tickets`（工单列表）
- GET  `/api/tickets?trash=1`（回收站列表）
- POST `/api/tickets`
- PUT  `/api/tickets/:id`（支持并发冲突检测：需要传 updated_at；冲突返回 409）
- DELETE `/api/tickets/:id`（软删除：移入回收站）
- PUT `/api/tickets/:id/restore`（从回收站恢复）
- DELETE `/api/tickets/:id/hard`（彻底删除）
- POST `/api/import/preview`（安全合并导入预演：仅备份更新更晚才覆盖）
- POST `/api/import/apply`（安全合并导入应用）
- PUT `/api/import`（危险：覆盖云端数据，仅用于灾难恢复）

## 1. 部署到 Cloudflare Pages

1) 把本目录推到 GitHub 仓库  
2) Cloudflare Dashboard → Pages → Create a project → 连接 GitHub 仓库  
3) Build settings（静态站）：
- Framework preset: **None**
- Build command: **(留空)**
- Build output directory: **/**（根目录）

## 2. 创建 D1 数据库并绑定

在 Cloudflare Dashboard → **D1** 创建一个数据库（例如 `ticket_db`）。

然后到 Pages 项目 → Settings → Functions → D1 database bindings：
- Variable name: **DB**
- Database: 选择你刚创建的 D1

## 3. 初始化表结构

在 D1 控制台（或用 wrangler）执行建表 SQL：

```sql
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  issue TEXT NOT NULL,
  department TEXT,
  name TEXT,
  solution TEXT,
  remarks TEXT,
  type TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT
);
```

### 3.1 旧库升级（如果你之前已经创建过 tickets 表）

在 D1 控制台执行：

```sql
ALTER TABLE tickets ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE tickets ADD COLUMN deleted_at TEXT;
```

## 4. 说明

- 不需要登录：任何能访问网站的人都能增删改数据（**请自行确保链接不外泄**）。
- “载入备份”：会提示你选择“覆盖云端”或“仅导入本地”。

生成时间：2025-12-26


## 0. 写入口令（保护写操作）

为了避免链接外泄被人乱写，本版本对写接口加了共享口令校验：

- GET `/api/tickets`：公开
- POST/PUT/DELETE `/api/*`：必须携带 `X-EDIT-KEY`（或 `?key=`）

### 0.1 在 Cloudflare Pages 配置 EDIT_KEY（必须）

Pages 项目 → Settings → Variables and Secrets（或 Environment Variables）中新增：
- `EDIT_KEY`：你设置的共享口令

本地开发可在 `wrangler.toml` 加：

```toml
[vars]
EDIT_KEY = "你自己的口令"
```

### 0.2 前端如何提供口令

页面右上角有「设置写入口令」按钮，会把口令保存到浏览器 localStorage；
之后新增/编辑/删除/导入都会自动带上 `X-EDIT-KEY`。



## 性能优化（推荐）

### 1) 边缘缓存（stats / tickets）
- `GET /api/stats` 与未携带 `x-edit-key` 的 `GET /api/tickets` 已支持 **ETag + Edge Cache**。
- 默认 TTL：stats 60s、tickets 30s（并带 `stale-while-revalidate=300`）。

验证方法：
- 浏览器 DevTools → Network → 观察 Response Headers：
  - `cache-control` 包含 `s-maxage=...`
  - `etag` 存在
  - Cloudflare 侧会逐步出现 `cf-cache-status: HIT`（第二次请求常见）

### 2) D1 索引（必须手动执行一次）
请在 D1 Console 执行以下文件的 SQL（可重复执行，不会报错）：
- `migrations/perf_indexes.sql`

执行后：
- 列表 / 分页 / 回收站 / stats 的查询会更稳定、更快（数据量越大越明显）。


## Schema migrations（避免漏跑SQL）

- 查看当前版本：GET `/api/admin/migrate`
- 应用迁移（需要 `x-edit-key`）：POST `/api/admin/migrate`

建议每次部署后先执行一次 POST，确保 D1 schema/索引/FTS 同步。
