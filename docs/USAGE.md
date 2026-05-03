# 使用指南

适用于 **claude-mem-plus**(claude-mem 的 fork,带 cmem-sync / 31 语言 / 回收站 / 公开注册)。

> 安装见 [INSTALL.md](INSTALL.md)。故障见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
> **必须配对** [bjarne56/cmem-server](https://github.com/bjarne56/cmem-server) 使用 sync 功能。

---

## 1. 第一次启动

装完后 worker 应该已自动跑(默认端口 37700+uid%100,常见 37701)。

```bash
# 看 worker 状态
claude-mem status

# 打开 viewer
open http://127.0.0.1:37701       # macOS
xdg-open http://127.0.0.1:37701   # Linux
```

viewer 加载完会:
- 自动检测浏览器语言(31 种语言下拉,带搜索)
- 把 `~/.claude-mem/settings.json` 的 `CLAUDE_MEM_MODE` 同步到选择的语言
- 显示 Header 项目下拉、Feed 列表、Console 抽屉、Sync 浮动按钮

---

## 2. 让 claude-code 开始记忆

claude-mem 的核心价值是 **每次 Claude Code 会话结束后自动总结成 observation**,下次开新会话时按相关性注入。

只需:

```bash
claude-mem install --ide claude-code
```

(install-client.sh 已经自动跑过)

之后:
- 任何 `claude` 会话开始 → SessionStart hook 注入历史 context
- 会话过程中 → PostToolUse hook 累积工具调用
- 会话结束 → Summary hook 把整个会话压成 1 个 observation
- 几小时内 → worker 异步用 Claude Haiku / Gemini Flash / OpenRouter 提取 facts/concepts/narrative,落进 SQLite + Chroma 向量库

打开 viewer 就能看 timeline / 详情 / 搜索。

---

## 3. cmem-sync — 跨机器同步

> 这是本 fork 加的核心功能。upstream 没有 sync。

### 一次性配置

```bash
# 注册新账号(如果还没有)
claude-mem sync register --server https://cmem.example.com --invite-code <CODE>

# 或登录已有账号
claude-mem sync login --server https://cmem.example.com
# 交互式 prompt:
#   username: alice
#   password: ********
#   machine_name: my-mac          # 用于跨机器识别本机
```

或者**纯 GUI**:viewer 右下角 🔄 Sync → 表单填四项 → submit。

### 日常用

```bash
# 看当前同步状态
claude-mem sync status
#   server: https://cmem.example.com
#   user: alice  machine: my-mac
#   pending push: 12  pending downgrades: 0
#   last push: 2026-05-02 12:34   last pull: 2026-05-02 12:34

# 手动 push 本地新 obs
claude-mem sync push

# 拉服务器有的(自己其他机器 + 别人共享)
claude-mem sync pull
```

或者**自动同步**(viewer SyncSettingsModal 顶部开关):
- ⏱ 自动同步 ☑
- 间隔:5 min ~ 24 h
- 方向:双向 / 仅 push / 仅 pull
- 倒计时显示下次执行

设完即时生效,worker 后台 setInterval 跑。

---

## 4. 项目共享

每个项目可以**共享给多人 / 公开 / 匿名链接**,接收方可只读看 / fork 改 / 自动副本。

### 三档 mode

| mode | 接收方能干啥 | 适合场景 |
|---|---|---|
| **read-only** | 只看,不能 fork | 给客户演示 / 公开知识库 |
| **fork-allowed** | 主动 fork 后归 ta 所有 | 团队协作:你写笔记,队友 fork 后基于此再编辑 |
| **auto-copy** | pull 时自动生成副本到 ta 名下 | 跨账号同步自己的笔记 |

### 三档 target

| target | 接收方 | 注意 |
|---|---|---|
| **user** | 指定用户名(可多个) | 最常用,逗号 / 空格 / 换行分隔多个 username |
| **public** | 所有 server 上登录用户 | 公开知识库 |
| **link** | 任何人(匿名,带 token) | 强制 read-only,可设过期天数 |

### CLI 共享

```bash
# 给 bob 一个人(fork-allowed,默认 mode)
claude-mem sync share-project nginx-rce --with bob --mode fork-allowed

# 一次给多人(逗号分隔)
claude-mem sync share-project nginx-rce --with alice,bob,carol --mode read-only

# 公开
claude-mem sync share-project nginx-rce --public --mode read-only

# 匿名链接(7 天过期)
claude-mem sync share-project nginx-rce --link --mode read-only --expire 7d

# 撤销所有共享
claude-mem sync unshare-project nginx-rce
```

### viewer 共享(推荐)

打开 SyncSettingsModal → 项目区点项目右侧 [共享] → 内联表单:
- 选 target type (user / public / link)
- target=user:textarea 输入多个 username,**逗号 / 空格 / 换行任意混合**,实时显示已识别数量
- 选 mode
- 点确认 → 批量调用,聚合"成功 N 失败 M",失败的 username 单独列出

### fork 别人共享给你的

```bash
# fork 整个项目(只在 fork-allowed 模式有效)
claude-mem sync fork-project alice/nginx-rce
claude-mem sync fork-project alice/nginx-rce --name my-fork-name

# fork 单条 observation 到你的某个项目
claude-mem sync fork 019xxx-abc --to-project my-research
```

---

## 5. 跨机器项目识别

不同机器上 **同名项目自动合并**。`(user_id, project_name)` 在 server 唯一。

```
Mac:   /Users/alice/work/nginx-rce  →  push 时 project_name="nginx-rce"
Linux: /home/alice/projects/nginx-rce → push 时 project_name="nginx-rce"

Server:同 user + 规范化后同名 → 视为同一 project,合并
```

要锁定 project_id 跨机器一致(避免规范化算法升级时冲突),在项目根创建 `.cmem-project.toml`:

```bash
cd /path/to/your/project
claude-mem sync project init    # 生成 .cmem-project.toml(应该 .gitignore)
```

文件长这样:

```toml
[project]
id = "01234567-89ab-cdef-0123-456789abcdef"   # UUID v4,跟 server 上 ID 锁定
name = "nginx-rce"                              # 显示名,可改
```

---

## 6. 软删除 + 回收站

viewer Header 顶部按钮:**📦 回收站** 和 **🗑️ 删除当前项目**(选了项目时才出现)。

- 单条 observation:卡片右上角小垃圾桶
- 整个会话:SummaryCard 顶部垃圾桶(级联删该 session 的 obs / sum)
- 整个项目:Header 项目下拉旁的垃圾桶(级联删项目所有 session / obs / sum)

删除后进 trash 表(SQLite 影子表),回收站 UI 可:
- 按项目维度看(每行显示 obs / 会话 / 摘要 计数)
- 按类型 tab 看(observations / sessions / summaries)
- 单行恢复 / 永久删除 / 整批清空
- 会话级恢复带子项(observation/summary 一起回主表)

**叶子节点不能单独恢复**(observation 的父 session 已删了恢复会破坏 FK);只能从 项目 / 会话 tab 整批恢复。

---

## 7. CLI 命令清单

```
# claude-mem 自身(upstream)
claude-mem start / stop / restart / status
claude-mem install --ide claude-code
claude-mem update
claude-mem --help

# cmem-sync 集成(本 fork)
claude-mem sync register --server URL [--invite-code CODE] [--email X]
claude-mem sync login --server URL
claude-mem sync logout
claude-mem sync status
claude-mem sync push                                 # 手动 push 本地新 obs
claude-mem sync pull                                 # 拉自己其他机器 + 别人共享
claude-mem sync me                                   # 当前 user / machine
claude-mem sync projects                             # 列项目 + 共享状态
claude-mem sync share-project NAME --with USER[,USER2...] [--mode MODE]
claude-mem sync share-project NAME --public [--mode MODE]
claude-mem sync share-project NAME --link [--mode MODE] [--expire 7d]
claude-mem sync unshare-project NAME
claude-mem sync fork-project USER/NAME [--name NEW]
claude-mem sync fork OBS_ID --to-project NAME
claude-mem sync project init                         # 生成 .cmem-project.toml
```

每个命令 `--help` 看完整参数。

---

## 8. viewer 操作快捷

```
Cmd-K (Mac) / Ctrl-K (Linux)    全局搜索
Esc                              关 modal
Cmd-Shift-R                      硬刷新(切语言后视觉不更新时用)
```

Header 右上从左到右:
1. 文档 / X / Discord 链接
2. GitHub stars
3. 项目下拉(选了项目时出现 🗑️ 删除按钮)
4. 📦 回收站
5. 🌐 语言下拉(31 种)
6. ☀️/🌙 主题切换
7. ⚙️ 设置(ContextSettingsModal)

右下角浮动按钮:
- 🔄 Sync 设置(SyncSettingsModal — server URL / login / push/pull / 自动同步 / 项目共享)
- 📋 Console(LogsDrawer — 实时 worker log,带级别 / 组件 过滤)

---

## 9. 数据存哪

| 数据 | 路径 | 说明 |
|---|---|---|
| 主库 | `~/.claude-mem/claude-mem.db` | SQLite WAL,所有 obs / session / sync_state |
| 向量索引 | `~/.claude-mem/chroma/` | Chroma persistent client |
| 配置 | `~/.claude-mem/settings.json` | CLAUDE_MEM_MODE / 端口 / AI provider |
| 日志 | `~/.claude-mem/logs/worker-YYYY-MM-DD.log` | 按日切割,默认保留 7 天 |
| Worker PID | `~/.claude-mem/worker.pid` | 单进程锁 |
| Worker 端口 | `~/.claude-mem/worker.port` | 启动时写,kit 用来连 |
| transcripts | `~/.claude/projects/<encoded>/<uuid>.jsonl` | claude-code 自己写的对话原文(claude-mem 只读) |

`CLAUDE_MEM_DATA_DIR` 可改父目录,所有上述路径都自动跟随。

---

## 10. 隐私

- `<private>...</private>` 标签包起来的内容 **永远不会** 写进 db / chroma / 不会 sync 到 server。在 hook 层(edge)就剥离。
- API token、cookie、ssh key 这类敏感字符串建议自己包 `<private>`,不依赖自动检测。
- viewer 没有"导出全部"按钮 — 显式动作,要导出走 `claude-mem export` CLI。

---

## 11. 升级 / 卸载

见 [INSTALL.md § 7-8](INSTALL.md#7-升级)。
