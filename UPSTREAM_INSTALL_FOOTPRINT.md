# 上游 claude-mem-plus 安装改动清单(实测 + 源码)

> 目标:在不污染主机的前提下,搞清楚 `npm i -g claude-mem-plus` + `claude-mem-plus install`
> 到底碰了哪些路径,作为 `claude-mem-un.sh` 的输入。
>
> 测试方法:
> - Docker 镜像 `node:20-bookworm` + bun + jq
> - 容器内 snapshot before/after,做精确 diff
> - 运行命令:`CLAUDE_MEM_PROVIDER=claude claude-mem-plus install --ide claude-code --no-auto-start`
>   (非交互,默认 IDE = claude-code,不启 worker)
> - 测得版本:`claude-mem-plus@12.6.0`(2026-05-04)
>
> 容器构建/运行:
> ```
> docker build -t claude-mem-plus-upstream-probe:latest docker/upstream-probe/
> docker run --rm -v $PWD/docker/upstream-probe/out:/probe/out claude-mem-plus-upstream-probe:latest
> ```
>
> 原始 diff:`docker/upstream-probe/out/diff.txt`(9052 行,绝大部分是 npm 包内部文件 + bun cache)
> 原始日志:`docker/upstream-probe/out/install.log`

## 一、Docker 实测命中的路径(default install 流程)

按改动来源分类,所有路径在容器内的实际表现:

### A. npm 全局包(npm 自带)
| 路径 | 类型 | 说明 |
|---|---|---|
| `/usr/local/lib/node_modules/claude-mem-plus/` | 目录 | npm 全局 install 解包位置 |
| `/usr/local/bin/claude-mem-plus` | symlink | 指向 `../lib/node_modules/claude-mem-plus/dist/npx-cli/index.js` |

`npm uninstall -g claude-mem-plus` 自动处理这两条。

### B. Claude Code 插件系统(~/.claude/)
| 路径 | 类型 | 写入位置(install.ts 行号) |
|---|---|---|
| `~/.claude/plugins/marketplaces/thedotmack/` | 目录 | `copyPluginToMarketplace` (`src/npx-cli/commands/install.ts:495`) |
| `~/.claude/plugins/cache/thedotmack/claude-mem-plus/<version>/` | 目录 | `copyPluginToCache` (`install.ts:527`) |
| `~/.claude/plugins/installed_plugins.json` | JSON 修改 | `registerPlugin` 写入 `plugins['claude-mem-plus@thedotmack']` (`install.ts:106`) |
| `~/.claude/plugins/known_marketplaces.json` | JSON 修改 | `registerMarketplace` 写入 `thedotmack` key (`install.ts:89`) |
| `~/.claude/settings.json` | JSON 修改 | `enablePluginInClaudeSettings` 写入 `enabledPlugins['claude-mem-plus@thedotmack'] = true` (`install.ts:128`) |

### C. claude-mem-plus 数据目录(~/.claude-mem-plus/)
| 路径 | 类型 | 说明 |
|---|---|---|
| `~/.claude-mem-plus/` | 目录 | `ensureAllDataDirs` 创建(包含 archives/logs/trash/backups/modes 子目录) |
| `~/.claude-mem-plus/settings.json` | 文件 | `mergeSettings` 写 64 个 `CLAUDE_MEM_*` 配置项(`install.ts:550`) |

> 数据目录解析逻辑(`src/shared/paths.ts:resolveDataDir`):
> 优先 `$CLAUDE_MEM_DATA_DIR` → `~/.claude-mem-plus`(fork 默认)→ `~/.claude-mem-plus`(legacy)。
> 上游 npm 包不知道 fork 路径,所以走 legacy `~/.claude-mem-plus`。

### D. bun 运行时(install 时按需装)
| 路径 | 类型 | 说明 |
|---|---|---|
| `~/.bun/install/cache/...` | 大量目录 | bun 装 marketplace 依赖时的 cache(共享给系统其它 bun 用户,**卸载脚本不动**) |

> 容器里的 bun 是镜像预装的;主机上若已有 bun,这部分 install 时也会动 cache。
> 这是 bun 全局缓存,不是 claude-mem-plus 私有,不应该删。

## 二、源码静态分析:可能命中但默认 install 没碰的路径

容器实测只跑了 `--ide claude-code`,所以下面这些只在用户显式选其它 IDE 时才出现。
源码位置:`src/services/integrations/*.ts`,以及 install.ts 里 `setupIDEs` 派发逻辑。

### E. Gemini CLI(`GeminiCliHooksInstaller.ts`)
- `~/.gemini/settings.json` — 写 `hooks.<event>` 项,command 含 `worker-service.cjs hook gemini-cli`
- `~/.gemini/GEMINI.md` — 追加上下文段落

### F. Cursor(`CursorHooksInstaller.ts`)
- `~/.cursor/hooks.json` — 写 hook 项(user 级)
- `~/.cursor/mcp.json` — 写 `mcpServers.claude-mem-plus`
- 项目级:`<project>/.cursor/rules/claude-mem-plus-context.md`(只在显式 install 项目级时)
- `~/.claude-mem-plus/cursor-projects.json` — 注册表(数据目录内,跟着数据目录走)

### G. Windsurf(`WindsurfHooksInstaller.ts`)
- `~/.codeium/windsurf/hooks.json` — hook 项,command 含 `worker-service.cjs hook windsurf`
- 项目级:`<project>/.windsurf/rules/claude-mem-plus-context.md`
- `~/.claude-mem-plus/windsurf-projects.json` — 注册表

### H. OpenCode(`OpenCodeInstaller.ts`)
- `~/.config/opencode/plugins/claude-mem-plus.js` — 复制 dist plugin
- `~/.config/opencode/AGENTS.md` — 追加段落

### I. OpenClaw(`OpenClawInstaller.ts`)
- `~/.openclaw/openclaw.json` — extensions 注册
- `~/.openclaw/extensions/claude-mem-plus/` — extension 目录

### J. Codex CLI(`CodexCliInstaller.ts`)
- `~/.codex/AGENTS.md` — 追加段落
- `~/.claude-mem-plus/transcript-watch.json` — 添加 codex watch(数据目录内,跟着走)

### K. 其它 MCP(`McpIntegrations.ts`,只在选 antigravity/copilot-cli/warp 时)
- `~/.github/copilot/mcp.json`
- `~/.gemini/antigravity/mcp_config.json`
- `~/.warp/mcp.json`
- `~/.config/goose/config.yaml`(yaml,不是 json)

## 三、卸载副作用(uninstall.ts 逆向时会动的额外位置)

源码 `src/npx-cli/commands/uninstall.ts:removeStrayClaudeMemPaths` 显示,
完整卸载还应清:

| 路径 | 说明 |
|---|---|
| `~/.npm/_npx/<hash>/node_modules/claude-mem-plus/` | npx 临时缓存(若曾经 `npx claude-mem-plus` 跑过) |
| `~/.cache/claude-cli-nodejs/*/mcp-logs-plugin-claude-mem-plus-*` | claude-code 内的 MCP 日志 |
| `~/.claude/plugins/data/claude-mem-plus-thedotmack/` | claude-code 插件 data 目录 |
| `~/.bashrc` / `~/.zshrc` / Windows PowerShell profile | `alias claude-mem-plus=` 行(legacy 入口) |

## 四、卸载脚本 `claude-mem-un.sh` 的覆盖矩阵

`claude-mem-un.sh`(共 33 个清理点)对应处理上面 A–K 全部 + 第三节副作用:

- A → 步骤 2(npm uninstall + 兜底删 bin/lib 残留)
- B → 步骤 3 + 4(目录 + JSON 安全编辑)
- C → 步骤 7(交互式问 / `--purge` / `--keep-data`,软链不跟过去)
- D → **不动**(bun cache 共享)
- E–K → 步骤 6(各 IDE 集成清理,jq 编辑而非 grep,带备份)
- 第三节 → 步骤 5(npx / mcp-logs / shell alias)

### 已知遗漏 / 不确定的点
1. **goose `config.yaml`** — yaml 格式 jq 不能直接编辑,脚本只 warn,需要用户手动清。
2. **Codex / Gemini / OpenCode 的 AGENTS.md 段落** — 只在 install.ts 写的固定标记
   `<!-- claude-mem-plus:start --> ... <!-- claude-mem-plus:end -->` 之间清;若上游版本没有这种标记,脚本只 warn,
   避免误删用户自定义内容。
3. **bun 全局 cache(`~/.bun/install/cache/`)** — 共享缓存,故意不动。用户若想彻底清,自行 `bun pm cache rm`。
4. **某些 IDE 集成路径只来自源码静态分析** — 如 `~/.warp/mcp.json` 在容器实测里没出现,
   因为 default install 不选这些 IDE。脚本对这些路径的处理已经做了 `[[ -f ]]` 守卫,不存在就跳过。

## 五、关键观察

1. **default install(--ide claude-code)足迹很小** — 只 5 个 host 路径(B 全部 + ~/.claude-mem-plus),
   加 npm 包本身和 bun cache。
2. **多 IDE 集成是按需加载的** — install.ts 里 `makeIDETask` 用 `await import(...)` 动态加载对应 installer,
   只有用户在 multiselect 选了某 IDE 才会跑那个 installer。
3. **fork 兼容性** — 上游用 `~/.claude-mem-plus`(legacy),fork 用 `~/.claude-mem-plus`。
   主机上若 fork 已装,**绝不能** `npm i -g claude-mem-plus` 到主机:
   - `/usr/local/bin/claude-mem-plus` 不冲突(名字不同),但 fork 也注册过 `claude-mem-plus` 命令名时会覆盖
   - 两者共用 `~/.claude/plugins/marketplaces/thedotmack/`(因为 fork 没改 marketplace key)→ 互相覆盖
   - 两者共用 `~/.claude/settings.json` 的 `enabledPlugins['claude-mem-plus@thedotmack']`
4. **JSON 修改用 atomic write**(`writeJsonFileAtomic`),所以可以放心 jq 编辑后 mv。
