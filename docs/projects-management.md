# 项目管理 (Project Identity & Path Management)

> fork v12.6.5-plus.2+ 引入。源需求:`claude-mem-改造需求.md`。

## 解决什么问题

旧版用 `basename(cwd)` 推导项目名:

```
/home/me/A/c   →  project = "c"
/home/me/B/c   →  project = "c"   ← 同名,数据混在一起
```

新版引入**稳定 ID + 多路径绑定**:每个项目有 8 位数字 ID,可挂载多个路径,改名/合并/删除互不影响 observations 历史。

---

## 核心模型

### `projects` 表
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 8 位数字(10000000-99999999),`UNIQUE` |
| `name` | TEXT | 显示名,`UNIQUE`,可改 |
| `anchor_path` | TEXT | 主路径(可空) |
| `created_at` / `updated_at` | INTEGER | 时间戳 |

### `project_paths` 表
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 |
| `project_id` | INTEGER FK | → projects.id, `ON DELETE CASCADE` |
| `path` | TEXT | 已 `realpath` 规范化, **全局 `UNIQUE`** |
| `added_at` / `last_seen_at` | INTEGER | 命中即更新 last_seen_at |

> `path` 全局唯一意味着同一物理目录只能绑到**一个**项目;歧义由用户在 UI 解决。

### observations / session_summaries / sdk_sessions
新增 `project_id INTEGER` 列,`ON DELETE SET NULL`。**原 `project TEXT` 列保留**,作为冗余 + 上游 schema 兼容 + 迁移 fallback。

---

## 项目识别优先级 (`ProjectStore.resolveProject(cwd)`)

写每条 observation 前,worker 按以下顺序解析 cwd → project:

| # | 来源 | 触发条件 |
|---|---|---|
| 1 | `CLAUDE_MEM_PROJECT` env | 设了就用(`8 位数字 ID` 优先匹配,否则当 name lookup 或新建) |
| 2 | `.claude-mem` 锚点文件 | cwd 内有该文件,内容是 `{projectId: 8 位数字}` 或裸数字 |
| 3 | `project_paths` 精确匹配 | `path == realpath(cwd)` |
| 4 | `project_paths` 父目录最长前缀 | 子目录场景 (`/A/c/sub` 命中 `/A/c`) |
| 5 | 新建 | 都没命中 → 用 `basename(cwd)` 当 name 建项目 + 自动登记 cwd |

命中后会更新该路径的 `last_seen_at`。

---

## UI 入口

打开 viewer (`http://localhost:<worker-port>`) → **右下角 📁 浮动按钮** → 项目管理 Modal。

### 主 Modal 功能

- **左侧**:项目列表,每行显示 `name` + ID + chip(observation 数 / summary 数 / path 数)
- **右侧**:选中项目详情
  - **改名**(prompt) — 调 `PATCH /api/projects-v2/:id`
  - **+ 路径(输入)** — 直接输入绝对路径
  - **+ 路径(选择…)** — 弹出**目录浏览器** picker(见下)
  - **写锚点(输入)** / **写锚点(选择…)** — 在指定目录创建 `.claude-mem` 文件
  - **合并到…** — 把当前项目所有 obs/summary/paths 转给目标项目,删原项目
  - **删除项目** — 物理删,observations 的 `project_id` 级联 `SET NULL`(数据保留)
- **底部说明**:列出 5 层识别优先级(快速参考)

### 目录浏览器(file picker)

二级 Modal,支持:

- 路径输入框(回车直接跳转)
- `↑ 上一级` / `~ 回 $HOME` / 显示隐藏目录复选
- 点击子目录进入
- "选择此目录"按钮

走后端 `GET /api/projects-v2/_/browse?path=...` (localhost-only,只读,500 项上限)。

---

## CLI / API

### REST(localhost-only,worker 监听端口默认 37777)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/projects-v2` | 列表 + stats |
| GET | `/api/projects-v2/:id` | 详情 + paths |
| POST | `/api/projects-v2` | 新建 (body: `{name, anchor_path?}`) |
| PATCH | `/api/projects-v2/:id` | 改名 (body: `{name}`) |
| DELETE | `/api/projects-v2/:id` | 删除项目 |
| GET | `/api/projects-v2/:id/paths` | 路径列表 |
| POST | `/api/projects-v2/:id/paths` | 添加路径 (body: `{path}`) |
| DELETE | `/api/projects-v2/:id/paths/:pathId` | 移除路径 |
| POST | `/api/projects-v2/:id/merge` | 合并 (body: `{targetId}`) |
| POST | `/api/projects-v2/:id/anchor` | 写锚点文件 (body: `{cwd}`) |
| GET | `/api/projects-v2/_/browse?path=...` | 目录浏览器 |

兼容旧 `DELETE /api/projects/:name` + `POST /api/projects/:name/rename` 仍可用(基于 name 字符串,Header 删按钮在用)。

### 锁定项目身份的方法

**方法 A — env 变量**(per-shell):
```bash
export CLAUDE_MEM_PROJECT=63504262   # 用 8 位数字 ID
# 或
export CLAUDE_MEM_PROJECT=ssh-ops    # 用 name(找不到会新建)
```

**方法 B — 锚点文件**(per-directory):
```bash
# 在项目管理 UI 里点"写锚点(选择…)" → 选中你的项目根目录
# 或手动:
echo '{"projectId": 63504262}' > /path/to/your/project/.claude-mem
```

锚点优先级高于路径匹配,适合一个项目挂在多机不同绝对路径的场景。

> **建议**:`.claude-mem` 加进 `.gitignore`,因为 ID 是本机独立分配的。

---

## 数据迁移

升级到 v12.6.5-plus.2+ 后,**worker 启动时自动**:
1. 跑 schema migration v33(建 `projects` / `project_paths` 表 + `project_id` 列)
2. 跑 schema migration v34(给 v33 阶段已生成的 base62 ID 重新分配 8 位数字 ID,无损迁移)

之后**手动**回填历史 observations 的 `project_id`(一次性):

```bash
cd ~/Code/claude/claude-mem-plus

# dry-run(默认,只看不改)
bun scripts/migrate-projects.ts

# 真实写入
bun scripts/migrate-projects.ts --apply

# 指定其它数据库路径
bun scripts/migrate-projects.ts --db /path/to/claude-mem.db --apply
```

脚本逻辑:
- 扫 `observations` / `session_summaries` / `sdk_sessions` 里所有 distinct `project` (name)
- 每个 name 对应建一个 `projects` 记录(已存在则复用)
- 扫 `pending_messages.cwd` JOIN `sdk_sessions.project`,把历史 cwd 登记到对应 project
- 回填 `observations.project_id` / `session_summaries.project_id` / `sdk_sessions.project_id`
- **idempotent**:重跑只补少量增量

升级前**自动备份**到 `~/.claude-mem-plus/claude-mem.db.pre-int-id-<timestamp>.bak`。

---

## 双写过渡说明

为零回归,本版本采用**双写过渡**:写 observation 时同时设 `project` (name) 和 `project_id` (number)。

- 读端:旧 UI 仍用 `project name` 查,新 UI 走 `project_id`
- 任何 ProjectStore 解析失败都退化到 `project_id = NULL`,**不影响** name 写入
- 未来某个版本可发起一次性 cleanup 删除 `project` name 字段

---

## 故障与边界

| 现象 | 处理 |
|---|---|
| `project_paths.path` UNIQUE 冲突 | 同物理目录已绑别的项目 → 先在原项目移除路径 |
| `realpath` 失败(符号链接断了) | 保留原值,UI 上将来可标记不可达 |
| `.claude-mem` 锚点指向已删除项目 | resolveProject 跳过此层,降级到路径匹配 |
| Empty cwd / 异常 cwd | 走 `basename` 兜底 → `unknown-project` 项目 |
| Session 内 cwd 切换 | session 一旦初始化项目,**整个 session 不再重新推导**(沿用现有逻辑) |

---

## 相关代码位置

- `src/services/sqlite/ProjectStore.ts` — CRUD + resolveProject
- `src/services/sqlite/SessionStore.ts` 与 `migrations/runner.ts` — schema v33/v34
- `src/services/sqlite/observations/store.ts` — 写 observation 时双写 `project_id`
- `src/services/worker/http/routes/ProjectsRoutes.ts` — REST API
- `src/ui/viewer/components/ProjectsManagerModal.tsx` — UI
- `scripts/migrate-projects.ts` — 数据迁移
- `claude-mem-改造需求.md`(项目根) — 需求原文
