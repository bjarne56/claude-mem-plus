# claude-mem-plus v12.6.1

[Claude Code](https://docs.claude.com/en/docs/claude-code) 的持久化记忆系统 + 远程备份 + 自动同步 + 多用户/团队共享 + 安装时多语言适配。

**基于 [thedotmack/claude-mem-plus v12.6.0](https://github.com/bjarne56/claude-mem-plus-plus/releases/tag/v12.6.0) 二次开发。**

**npm**:`npm install -g claude-mem-plus`(bin 沿用 `claude-mem-plus`,跟上游 npm 包不能并存)

> 本仓库是 [thedotmack/claude-mem-plus](https://github.com/bjarne56/claude-mem-plus-plus) v12.6.0 的 fork,新增:
> - 🔄 **cmem-sync 远程备份 + 自动同步** — push/pull 到自托管 cmem-server，定时自动同步，跨机器无缝切换
> - 👥 **多用户共享 + 团队共享** — 三种共享模式 (read-only / fork-allowed / auto-copy)，支持批量给多个用户授权
> - 🌐 **31 种语言 viewer UI** — browser 自动检测，LanguageSelect 下拉，RTL 支持
> - 🌐 **31 种语言 SKILL.md description** — `install-client.sh` 检测系统 locale，重写每个 SKILL.md frontmatter 的 `description:` 行，让 Claude Code 的 `/` 菜单按系统语言显示命令说明；缺翻译的 locale 保留英文
> - 🗑️ **软删除 + 回收站** — 项目/会话/observation 三级软删 + 4-tab 恢复 UI
> - 🚪 **公开 /register 注册页** — 配套 server 提供，admin 可热切 open / invite_only / closed
>
> ⚠️ **必须配套 [bjarne56/cmem-server](https://github.com/bjarne56/cmem-server)** — Rust 单二进制 + SQLite + JWT + admin web。没有它,sync / share / fork 全部是 no-op。

## 5 分钟上手

### 一、装 claude-mem-plus 客户端(本机)

```bash
# 一行装(macOS / Ubuntu / Debian / Rocky / Fedora / Arch / Alpine)
curl -sSL https://raw.githubusercontent.com/<your>/claude-mem-plus/zh-fork/install-client.sh | bash

# 或装完自动连 cmem-server
curl -sSL .../install-client.sh | bash -s install --server https://cmem.example.com

# 装完验证健康度
bash install-client.sh check

# 卸载
bash install-client.sh uninstall      # 交互问要不要清数据
```

脚本会:
1. 装 Node 22+(用包管理器 / nvm fallback)
2. 装 Bun(claude-mem-plus worker 运行时)
3. npm install claude-mem-plus
4. 注册 claude-code hooks
5. 启动 worker daemon
6. 检测系统语言写入 `~/.claude-mem-plus/settings.json` 的 `CLAUDE_MEM_MODE`
7. 可选 `claude-mem-plus sync login --server <URL>`

完整安装路径(各 OS / tarball / git / Docker)见 [docs/INSTALL.md](docs/INSTALL.md)。

### 二、(服务器侧)装 cmem-server

参见 [cmem-server/scripts/install-server.sh](../cmem-server/scripts/install-server.sh)。一句话:

```bash
ssh root@your-vps
curl -sSL .../install-server.sh | bash    # 装好 + systemd + Caddy + admin/admin@123
```

详细见 [cmem-server/docs/DEPLOYMENT.md](../cmem-server/docs/DEPLOYMENT.md)。

### 三、登录 + 推送

```bash
# 在你 dev 机器
claude-mem-plus sync login --server https://cmem.example.com
# username: 你建的账号 / password: 你的密码 / machine_name: my-mac

claude-mem-plus sync status            # 看连接 + pending 数
claude-mem-plus sync push              # 推本地 observation 到 server
claude-mem-plus sync pull              # 拉自己其他机器的 / 别人共享给你的
```

或者打开 `http://127.0.0.1:37701` viewer,**右下角 Sync 浮动按钮** → 表单登录(machine_name 自动从 navigator.platform 推 my-mac/my-windows/my-linux)。

## 核心概念

### 项目识别 + 跨机器自动合并

不同机器上同名项目自动合并。`(user_id, project_name)` 在 server 唯一。

```
Mac:   /Users/alice/work/nginx-rce  →  push 时 project_name="nginx-rce"
Linux: /home/alice/projects/nginx-rce → push 时 project_name="nginx-rce"

Server:同 user + 规范化后同名 → 视为同一 project,合并
```

要锁定 project_id 跨机器一致(避免规范化冲突),在项目根创建 `.cmem-project.toml`:

```bash
cd /path/to/your/project
claude-mem-plus sync project init    # 生成 .cmem-project.toml(应该 .gitignore)
```

### 三种共享 mode

| mode | 共享给的人能干什么 | 适合场景 |
|---|---|---|
| **read-only** | 只读,不能 fork | 给客户演示 / 只读知识库 |
| **fork-allowed** | 主动 fork 后归 ta 所有 | 团队协作 |
| **auto-copy** | pull 时自动生成副本到 ta 名下 | 跨账号同步自己的笔记 |

```bash
# 共享整个项目
claude-mem-plus sync share-project nginx-rce --with bob --mode fork-allowed
claude-mem-plus sync share-project nginx-rce --public --mode read-only        # 任何登录用户可见
claude-mem-plus sync share-project nginx-rce --link --mode read-only --expire 7d   # 匿名链接

# 撤销
claude-mem-plus sync unshare-project nginx-rce

# 接收方 fork 整个项目(只在 fork-allowed 模式有效)
claude-mem-plus sync fork-project alice/nginx-rce

# fork 单条 observation
claude-mem-plus sync fork 019xxx-abc --to-project my-research
```

详细共享语义见 [cmem-server 仓库的 PROJECT_SHARING.md](../cmem-server/docs/PROJECT_SHARING.md)。

## 31 种语言

viewer 右上角语言下拉(31 种),搜索 + 切换 + 自动 RTL 布局(阿拉伯 / 希伯来 / 乌尔都)。同步更新 `~/.claude-mem-plus/settings.json` 的 `CLAUDE_MEM_MODE`,worker 下次生成 observation 用对应语言。

```
en (默认 fallback)
zh / zh-tw / ja / ko / es / pt-br / fr / de            (Tier 1)
ru / ar / he / pl / cs / nl / tr / uk                   (Tier 2)
vi / id / th / hi / bn / ro / sv / ur                   (Tier 3)
it / el / hu / fi / da / no                              (Tier 4)
```

install.sh 跑的时候自动从 `defaults read NSGlobalDomain AppleLanguages`(macOS)/ `LANG`(Linux)检测,首次写入 settings.json。

## 软删除 + 回收站

viewer 顶部按钮:**📦 回收站** 和 **🗑️ 删除当前项目**(选了项目时才出现)。

- 单条 observation:卡片右上角小垃圾桶
- 整个会话:SummaryCard 顶部垃圾桶(级联删该 session 的 obs/sum)
- 整个项目:Header 项目下拉旁的垃圾桶(级联删项目所有 session/obs/sum)

删除后进 trash 表(SQLite 影子表),回收站 UI 可:
- 按项目维度看(每行显示 obs/会话/摘要 计数)
- 按类型 tab 看(observations / sessions / summaries)
- 单行恢复 / 永久删除 / 整批清空
- 会话级恢复带子项(observation/summary 一起回主表)

## CLI 命令清单

```
# claude-mem-plus 自身(upstream)
claude-mem-plus start / stop / restart / status
claude-mem-plus install --ide claude-code
claude-mem-plus update
claude-mem-plus --help

# cmem-sync 集成(本 fork 加的)
claude-mem-plus sync login --server URL    # 登录 + 注册本机器
claude-mem-plus sync logout
claude-mem-plus sync register --server URL  # 新用户注册
claude-mem-plus sync status
claude-mem-plus sync push                   # 手动 push 本地新 obs
claude-mem-plus sync pull                   # 拉 server / 别人共享
claude-mem-plus sync me                     # 当前 user / machine
claude-mem-plus sync projects               # 列项目 + 共享状态
claude-mem-plus sync share-project NAME --with USER [--mode MODE]
claude-mem-plus sync share-project NAME --public [--mode MODE]
claude-mem-plus sync share-project NAME --link [--mode MODE] [--expire 7d]
claude-mem-plus sync unshare-project NAME
claude-mem-plus sync fork-project USER/NAME [--name NEW]
claude-mem-plus sync fork OBS_ID --to-project NAME
claude-mem-plus sync project init           # 生成 .cmem-project.toml
```

## 数据隔离

claude-mem-plus 主库 `~/.claude-mem-plus/claude-mem.db` 是**唯一数据源**。cmem-sync 集成只在这个 db 上加列(`uuid_v7` / `server_seq` / `derived_from` / `derivation_chain` / `deleted_at`)+ 加新表(`sync_state` / `shared_view` / `projects_sync`)。

不引入第二个数据库文件。删除/恢复/回收站跟 sync 完全独立。

## viewer

打开 `http://127.0.0.1:37701`(端口由 `CLAUDE_MEM_WORKER_PORT` 控制,默认 37700+uid%100):

Header 右上从左到右:
1. 文档 / X / Discord 链接
2. GitHub stars
3. 项目下拉(选具体项目时出现 🗑️ 删除当前项目按钮)
4. 📦 回收站
5. 中/EN 语言下拉(31 种)
6. ☀️/🌙 主题切换
7. ⚙️ 设置(ContextSettingsModal)

右下角浮动按钮:
- 🔄 Sync 设置(SyncSettingsModal — 配 server URL / login / push/pull / 项目共享列表)
- 📋 Console(LogsDrawer — 实时看 worker log,带级别 / 组件 过滤)

## 故障排查

最快诊断:

```bash
bash install-client.sh check     # 一键检查 node / bun / claude-mem-plus / worker / hooks
```

常见症状:

| 症状 | 修 |
|---|---|
| `claude-mem-plus sync` 提示 `Unknown command: sync` | 全局装的是 upstream,运行 `cd /path/to/fork && npm link`(开发) 或 `npm install -g <fork-tarball>`(生产) |
| viewer 切语言不生效 | 浏览器硬刷新(Cmd-Shift-R) |
| sync push 401 | `claude-mem-plus sync logout && login` 拿新 token |
| sync push HTTP 415 | 客户端旧版本 用了 NDJSON,升 fork 最新 commit |
| viewer Sync 表单登录 400 ValidationError | 必填 4 个字段 全填上(server_url / username / password / machine_name) |
| worker 启动失败 "Database not initialized" | 升 fork(SyncRoutes 注册时序问题修过了) |
| viewer 空白 / blank | 浏览器 console 看 JS error,可能 React 加载失败,硬刷新 |
| viewer 注册页"注册已关闭" | server admin 在 `/admin/settings` 切回 open / invite_only |

完整故障速查表见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 文档目录

| 文档 | 用途 |
|---|---|
| [README.md](README.md) | upstream claude-mem-plus 原文 |
| **CMEM_SYNC_README.md**(本文件) | fork 改动 + sync 集成总览 |
| [docs/INSTALL.md](docs/INSTALL.md) | ✅ 详细安装(各 OS / npm / tarball / git / docker) |
| [docs/USAGE.md](docs/USAGE.md) | ✅ 完整使用教程(sync / 共享 / 回收站 / CLI) |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | ✅ 故障排查(按症状) |
| [PUBLISHING.md](PUBLISHING.md) | ✅ 发布流程(npm / 内部分发) |
| 📘 [docs/skills-i18n/](docs/skills-i18n/) | ✅ 10 个 `/claude-mem-plus:*` 命令的多语言操作手册 PDF（31 语言 + 英文，共 32 份） |
| docs/SHARING.md | ⏳ 三种 mode 行为 + 8 个不变量(参见 [cmem-server/docs/PROJECT_SHARING.md](../cmem-server/docs/PROJECT_SHARING.md))|
| docs/I18N.md | ⏳ 31 语言扩展(参见 src/ui/viewer/i18n/ 源码 + scripts/translate-i18n.ts) |
| docs/CONTRIBUTING.md | ⏳ 待补 — 现阶段:fork → PR 到 zh-fork 分支 |

## License

upstream claude-mem-plus: AGPL-3.0(thedotmack)
本 fork 的增量改动:沿用 AGPL-3.0
cmem-server 独立项目:MIT(单独仓库,见 cmem-server/LICENSE)

## 贡献

按 [CONTRIBUTING.md](docs/CONTRIBUTING.md) 提 PR。修改 i18n 字符串后跑 `bun scripts/translate-i18n.ts --force` 重翻译所有 30 种语言(成本 ~$3,Claude Haiku)。

---

> 想要 cmem-server **服务端**安装? 见 [cmem-server/docs/DEPLOYMENT.md](../cmem-server/docs/DEPLOYMENT.md)
