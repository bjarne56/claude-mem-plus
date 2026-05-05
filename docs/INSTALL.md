# 安装指南

适用于 **claude-mem-plus**(claude-mem-plus 的 fork,带 cmem-sync / 31 语言 / 回收站 / 删除 / 公开注册页)。

> 想找 **cmem-server 服务端**?见独立仓库 [bjarne56/cmem-server](https://github.com/bjarne56/cmem-server)。
> client + server 是两个仓库,**必须配对使用**才能跨机器同步与共享。

---

## 选哪条路

| 你的情况 | 推荐 |
|---|---|
| 第一次装,普通用户 | [一键脚本](#1-一键脚本最快) |
| fork / 内部分发 / 开源版本 | [tarball 安装](#2-tarball-安装) |
| 开发者本地改代码 | [git 源码安装](#3-git-源码安装) |
| **本 fork**(claude-mem-plus,有 sync / i18n / trash) | `npm install -g claude-mem-plus` |
| 上游 npm 包(无 sync,普通 claude-mem-plus) | `npm install -g claude-mem-plus`(注意:跟本 fork bin 同名 `claude-mem-plus`,**不能并存**) |

所有路线最终结果等价 — 都装到 npm 全局 bin,数据目录在 `~/.claude-mem-plus/`。

---

## 前置依赖

| 项目 | 要求 | 怎么装 |
|---|---|---|
| **OS** | macOS 12+ / Ubuntu 20+ / Debian 11+ / Rocky 8+ / Fedora 38+ / Arch / Alpine | - |
| **Node.js** | ≥ 18 (推荐 22 LTS) | install 脚本会自动装 |
| **Bun** | ≥ 1.1 (worker 运行时) | install 脚本会自动装 |
| **claude-code** | 已装(plugin 注册需要) | https://docs.claude.com/en/docs/claude-code |

不需要手动准备:Python / Chroma / Docker — 都按需自动拉起。

---

## 1. 一键脚本(最快)

```bash
# 默认装上游 npm 包
curl -sSL https://raw.githubusercontent.com/<your-org>/claude-mem-plus/zh-fork/install-client.sh | bash

# 装完立即连一台 cmem-server(可选)
curl -sSL .../install-client.sh | bash -s install --server https://cmem.example.com
```

脚本会:

1. 检测 OS → 装 Node 22 (brew / apt / dnf / pacman / apk / nvm fallback)
2. 装 Bun (brew / 官方 install.sh)
3. `npm install -g claude-mem-plus`(或 `--package <other-name>` 切换到其他 fork)
4. `claude-mem-plus install --ide claude-code` 注册 SessionStart / PostToolUse 等 hook
5. `claude-mem-plus start` 启动 worker daemon (port 37700+uid%100)
6. 检测系统语言 → 写入 `~/.claude-mem-plus/settings.json` 的 `CLAUDE_MEM_MODE`
7. 可选:`claude-mem-plus sync login --server <URL>` 连服务器

---

## 2. tarball 安装

适合 fork 用户 / 内部分发 / 没法访问 npmjs 的环境。

**先打包**(在你的 fork 仓库根目录):

```bash
npm run pack:release
# 产出 dist/claude-mem-plus-<version>.tgz + .sha256 + install-client.sh + RELEASE_MANIFEST.txt
```

**用户安装**(任何机器):

```bash
# 单文件本地装
bash install-client.sh install --tarball file:///path/to/claude-mem-plus-12.4.9.tgz

# 或托管到 server 后远程装(适合给客户/团队)
curl -sSL https://your-host/install-client.sh \
  | bash -s install --tarball https://your-host/claude-mem-plus-12.4.9.tgz \
                    --server https://cmem.example.com
```

校验完整性:

```bash
shasum -a 256 -c claude-mem-plus-12.4.9.tgz.sha256
```

---

## 3. git 源码安装

适合开发者(改代码 + 立即试)。

```bash
git clone https://github.com/<your-org>/claude-mem-plus.git
cd claude-mem-plus
git checkout zh-fork
npm install
npm run build
npm link              # 把本地代码 symlink 到全局,'claude-mem-plus' 命令立即指向当前仓库

# 验证
which claude-mem-plus      # 应该指向 ~/.nvm/.../bin/claude-mem-plus -> $(pwd)/dist/npx-cli/index.js
claude-mem-plus --version
claude-mem-plus sync --help    # 本 fork 才有这个子命令
```

改完源码:

```bash
npm run build-and-sync   # build → 同步到 marketplace 缓存 → 重启 worker
```

或者**只重启 worker**(没动 hook 代码):

```bash
npm run worker:restart
```

---

## 4. 验证安装

```bash
# 一键健康检查
bash install-client.sh check
```

期望输出:

```
✓ node v22.22.0 (≥ 18)
✓ bun 1.3.13
✓ claude-mem-plus 12.4.9
✓ 支持 sync 子命令(本 fork)
✓ 数据目录存在: ~/.claude-mem-plus
✓ settings.json 存在
✓ claude-mem.db (13M)
✓ worker 运行中 (PID 12345)
✓ /api/sync/state 响应 ok (端口 37701)
✓ claude-code 配置里看到 claude-mem-plus hook 引用
━━━ 全部通过 ━━━
```

任何一项 ⚠/✗ 都到 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 查对应症状。

---

## 5. 卸载

```bash
bash install-client.sh uninstall
# 交互式问要不要清 ~/.claude-mem-plus 和 marketplace 插件

# 或一刀切清干净
bash install-client.sh uninstall --purge

# 或保数据
bash install-client.sh uninstall --keep-data
```

手动等价命令:

```bash
claude-mem-plus stop
npm uninstall -g claude-mem-plus
rm -rf ~/.claude/plugins/marketplaces/thedotmack
rm -rf ~/.claude-mem-plus                    # 谨慎:丢所有 observation + 同步状态
```

---

## 6. 多账号 / 多 profile

支持同一台机器跑多个隔离 profile(work / personal / dev)。**没有 CLI 子命令** — 用环境变量切:

```bash
# work profile
export CLAUDE_MEM_DATA_DIR="$HOME/.claude-mem-plus-work"
export CLAUDE_MEM_WORKER_PORT=37800
claude-mem-plus start

# personal profile(另一个 shell)
export CLAUDE_MEM_DATA_DIR="$HOME/.claude-mem-plus-personal"
export CLAUDE_MEM_WORKER_PORT=37801
claude-mem-plus start
```

每个 profile 完全隔离:db / chroma / logs / sync_state / settings 都在自己的目录。

---

## 7. Docker / 容器

claude-mem-plus 客户端**没有官方 Docker 镜像**(它是常驻在用户 dev 机器上的)。如果你想 contain 化:

```dockerfile
FROM node:22-bookworm
RUN npm install -g claude-mem-plus  # 或 --tarball <内部 url>
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"
VOLUME /root/.claude-mem-plus
EXPOSE 37777
CMD ["claude-mem-plus", "start", "--foreground"]
```

但更常见做法是 **客户端裸装在 dev 机器,只把 cmem-server 容器化**。

---

## 8. 升级

```bash
# 跟随 npm
npm update -g claude-mem-plus

# 或重跑 install 脚本(幂等)
bash install-client.sh install
```

升级 fork 跟上游同步:

```bash
cd /path/to/your/claude-mem-plus-fork
git fetch origin
git checkout zh-fork
git merge origin/main      # 处理冲突
npm install
npm run build
npm link                    # 重新链接全局 CLI
```

每次升级后跑 `install-client.sh check` 确认所有功能正常。
