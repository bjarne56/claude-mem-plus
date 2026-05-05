# 故障排查

按症状找对应修复。每条都给**根因解释 + 立即解决 + 预防**。

> 找不到匹配?跑 `bash install-client.sh check`,把 ⚠/✗ 行截图发 issue。

---

## 安装阶段

### `claude-mem-plus: command not found`

**根因**:npm 全局 bin 不在 PATH。

```bash
echo $PATH | tr ':' '\n' | grep -E 'npm|nvm|node'      # 看 PATH 有没有 npm bin
npm config get prefix                                     # 看 npm 装哪
```

**修**:把 `$(npm config get prefix)/bin` 加进 PATH(`~/.zshrc` 或 `~/.bashrc`):

```bash
export PATH="$(npm config get prefix)/bin:$PATH"
```

新开 shell 验证 `which claude-mem-plus` 有结果。

### `EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'`

**根因**:npm 全局装到系统目录,需要 sudo。

**修**(推荐):换 nvm 装 Node,这样 npm prefix 在 `~/.nvm/versions/...`,不需要 sudo。install-client.sh 会自动用 nvm fallback。

或临时 `sudo npm install -g claude-mem-plus`(有副作用,不推荐)。

### node 版本太旧

```
warn  node v16.x.x 太旧(需 ≥ 18)
```

**修**:`nvm install 22 && nvm use 22`,或包管理器升 node。

### `Unknown command: sync`

**根因**:全局装的是 upstream `claude-mem-plus`,本 fork(`claude-mem-plus`)才有 sync 子命令。

**修**:

```bash
# 选 1:npm 直接装本 fork
npm install -g claude-mem-plus

# 选 2:从 fork tarball 装
bash install-client.sh install --tarball file:///path/to/claude-mem-plus-12.4.9.tgz

# 选 3:从 git 装
bash install-client.sh install --git https://github.com/bjarne56/claude-mem-plus

# 选 4:开发模式 npm link(在 fork 仓库根)
cd /path/to/claude-mem-plus && npm link
which claude-mem-plus    # 应指向 fork 路径(注意 bin 名仍是 claude-mem-plus)
```

---

## Worker

### worker 启动失败,`Database not initialized`

**根因**:旧版本 SyncRoutes 注册时序 bug — 在 dbManager.initialize() 之前注册 → SyncManager 拿不到 db。

**修**:升 fork 到最新 commit。已修。

### worker 启动后 `EADDRINUSE`(端口占用)

```bash
# 看谁占着
lsof -nP -iTCP:37701 -sTCP:LISTEN

# 选 1:杀掉占用方(如果是孤儿 worker)
kill <PID>
claude-mem-plus start

# 选 2:换端口
export CLAUDE_MEM_WORKER_PORT=37810
claude-mem-plus start
```

### PID 文件存在但进程死了

```
⚠ PID 文件存在但进程死了(可清:rm ~/.claude-mem-plus/worker.pid 或 claude-mem-plus start)
```

**根因**:worker 之前 OOM/crash,PID 文件没清。

**修**:

```bash
rm ~/.claude-mem-plus/worker.pid
claude-mem-plus start
```

### viewer 空白 / blank

**根因**:`viewer-bundle.js` 加载失败(浏览器 console 看 error)。

常见原因:
- 浏览器缓存住了旧 bundle → **Cmd-Shift-R 硬刷新**
- worker port 不响应 → `bash install-client.sh check` 看
- 加载 React 失败 → 看 console,可能是 Tailwind CDN 阻塞(罕见)

---

## sync

### sync push 401 Unauthorized

**根因**:access_token 过期,refresh_token 无效或过期。

**修**:

```bash
claude-mem-plus sync logout
claude-mem-plus sync login --server <URL>
```

或在 viewer SyncSettingsModal 重登。

### sync push HTTP 415 Unsupported Media Type

**根因**:旧 fork 客户端用 NDJSON,新 server 要 JSON。

**修**:`git pull origin zh-fork && npm install && npm run build`,然后 `npm link` 重链全局 CLI。

### sync push 卡住

```bash
# 看 worker log
tail -f ~/.claude-mem-plus/logs/worker-$(date +%Y-%m-%d).log

# 常见原因:server 在 brute-force 限速里(60 req/min/IP),等 1 分钟再试
```

### sync login HTTP 400 ValidationError

**根因**:viewer 表单 4 个必填字段没全填(`server_url / username / password / machine_name`)。

**修**:确认 4 个都填了。`machine_name` 默认从 navigator.platform 推 `my-mac` / `my-windows` / `my-linux`,不用手动改。

### viewer SyncSettingsModal 排版乱(左右分栏)

**根因**:全局 CSS `.modal-body` 是给另一个 modal 设的 grid 布局。本 fork 已修。

**修**:升 fork 到最新 commit(`7de0d624` 或更新)。

### "登录页没看到邀请码框"

**根因**:`/admin/login` 是管理员登录,本来就不该有邀请码。

**修**:邀请码用在 `/register` 公开注册页(本 fork server 端已加),或用 `claude-mem-plus sync register --invite-code <CODE>`。

### "注册页显示注册已关闭"

**根因**:server admin 在 `/admin/settings` 把 registration_mode 设成了 `closed`。

**修**:让 admin 在 `/admin/settings` 切回 `open` 或 `invite_only`。

---

## i18n

### viewer 切语言不生效

**根因**:浏览器缓存 / settings.json 写入失败。

**修**:

```bash
# 1. 硬刷新
# Cmd-Shift-R (Mac) / Ctrl-F5 (Linux)

# 2. 看 settings.json 是不是真的更新
cat ~/.claude-mem-plus/settings.json | grep CLAUDE_MEM_MODE

# 3. 看 worker log 有没有 i18n 相关 error
tail -f ~/.claude-mem-plus/logs/worker-*.log | grep -i i18n
```

### 某语言显示 fallback 的 English

**根因**:该语言的 `messages-<lang>.ts` 缺了那个 key。

**修**:查 `src/ui/viewer/i18n/messages-en.ts` 拿到 key,手动给目标语言文件补上。或者 `bun scripts/translate-i18n.ts --lang <lang>` 用 Claude Haiku 自动补。

---

## 数据 / 性能

### `~/.claude-mem-plus/claude-mem.db` 占用过大(>100 MB)

**根因**:历史 observation 累积 + chroma 向量。

**修**:

```bash
# 看分布
du -sh ~/.claude-mem-plus/*

# 清旧的(>30 天的 observation 进 trash)
claude-mem-plus trim --older-than 30d --dry-run    # 先看会清啥
claude-mem-plus trim --older-than 30d              # 实清

# vacuum 释放磁盘
sqlite3 ~/.claude-mem-plus/claude-mem.db "VACUUM;"
```

### worker CPU 100%

**根因**:多半是 chroma re-embed 卡 / Claude API 重试循环。

**修**:

```bash
# 暂停 AI processing(只继续 hook 收集)
claude-mem-plus worker --pause-ai-processing

# 看 worker log 找 root cause
tail -100 ~/.claude-mem-plus/logs/worker-*.log | grep -iE 'error|fail|retry'
```

---

## claude-code 集成

### claude-code 启动后没注入历史 context

**根因**:hook 没注册 / 注册了但没生效。

**修**:

```bash
# 重注册
claude-mem-plus install --ide claude-code --force

# 看 claude-code 配置
cat ~/.claude/settings.json | grep claude-mem-plus
```

### Windows Terminal tab 不停增长

**根因**:hook 用 exit 1 / 2 让 Windows Terminal 不关 tab。

**修**:claude-mem-plus 用 exit 0 + 错误进 stderr → Windows Terminal 会正常关 tab。如果还有这问题,升级到最新 fork。

---

## 还是没解决?

```bash
# 1. 收集诊断信息
bash install-client.sh check > /tmp/cmem-check.txt 2>&1
cp ~/.claude-mem-plus/logs/worker-$(date +%Y-%m-%d).log /tmp/cmem-worker.log
cp ~/.claude-mem-plus/settings.json /tmp/cmem-settings.json

# 2. 提 issue 时附上这三个文件
# 注意:settings.json 可能有 sync token,check 里也有 server URL,公开前打码
```

---

## install-client.sh check 输出对照表

| 检查项 | ✓ | ⚠ / ✗ → 怎么办 |
|---|---|---|
| node | v18+ | 装 / 升 node |
| bun | 任意版本 | `curl -fsSL https://bun.sh/install \| bash` |
| claude-mem-plus CLI | 有 + 版本号 | `npm install -g <package>` |
| sync 子命令 | 支持 | 装 fork(见上方"Unknown command: sync") |
| 数据目录 | 存在 | `claude-mem-plus start` 会自建 |
| settings.json | 存在 | 同上 |
| claude-mem.db | 存在 | 同上 |
| worker daemon | PID 存活 | `claude-mem-plus start` |
| /api/sync/state | 响应 ok | 看 worker log |
| claude-code hook | 配置里有 | `claude-mem-plus install --ide claude-code` |
