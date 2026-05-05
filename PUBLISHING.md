# claude-mem-plus fork (zh-fork) Publishing Guide

如何把 fork 发到 npm 让其他用户 `npm install -g <package>` 可用。

## 先决定 publish 策略

### Option A:**保留 `claude-mem-plus` 名(覆盖 upstream)**

```json
{ "name": "claude-mem-plus", "version": "12.4.9-zh-fork.1" }
```

⚠️ **不推荐** — 你不是 upstream 维护者,npm publish 会被拒(需要 publish 权限)。除非 fork 自己用 (`npm pack` + 本地 `npm install -g <tgz>`)。

### Option B:**改名 `claude-mem-plus-zh-fork`(独立包)**← 推荐

```json
{
  "name": "claude-mem-plus-zh-fork",
  "version": "1.0.0",
  "description": "claude-mem-plus fork: 31 langs i18n + soft delete trash + cmem-sync integration",
  "repository": { "url": "https://github.com/<your>/claude-mem-plus.git" },
  "homepage": "https://github.com/<your>/claude-mem-plus#readme",
  "bugs": { "url": "https://github.com/<your>/claude-mem-plus/issues" }
}
```

用户:`npm install -g claude-mem-plus-zh-fork`,命令仍是 `claude-mem-plus`(`bin` 字段控制)。

### Option C:**只 GitHub Release tarball,不 publish 到 npm**

用户:
```bash
npm install -g https://github.com/<your>/claude-mem-plus/releases/download/v1.0.0/claude-mem-plus-1.0.0.tgz
```
或 `install-client.sh --tarball <URL>`。

## 推荐流程(Option B)

### 1. 改 package.json

```bash
cd /Users/bjarne/Code/claude/claude-mem-plus

# 备份原文件
cp package.json package.json.upstream-backup

# 编辑(用 sed 或手动)
python3 - <<'PY'
import json
d = json.load(open('package.json'))
d['name'] = 'claude-mem-plus-zh-fork'
d['version'] = '1.0.0'
d['description'] = 'claude-mem-plus fork: 31-language viewer i18n + soft delete trash + cmem-sync integration'
d['repository'] = {'type': 'git', 'url': 'https://github.com/<your-username>/claude-mem-plus.git'}
d['homepage'] = 'https://github.com/<your-username>/claude-mem-plus#readme'
d['bugs'] = {'url': 'https://github.com/<your-username>/claude-mem-plus/issues'}
# bin 不变(用户装完跑 `claude-mem-plus` 命令)
json.dump(d, open('package.json', 'w'), indent=2)
print("OK")
PY
```

注意 ⚠️ 改名后**全局命令冲突**:
- 用户已经装了 upstream `claude-mem-plus` → fork 装失败(命令名冲突)
- 解决:让用户先 `npm uninstall -g claude-mem-plus`,再装 fork

或者 fork 也改 bin:
```json
{ "bin": { "claude-mem-plus": "./dist/npx-cli/index.js", "cmem": "./dist/npx-cli/index.js" } }
```

### 2. 准备 .npmignore

确保 publish 时不发不需要的文件:

```
# .npmignore
src/
scripts/
tests/
docs/
plans/
node_modules/
.git/
.github/
.scratch/
*.test.ts
*.spec.ts
.translation-cache.json
PLAN-*.md
PATHFINDER-*
ANTI-PATTERN-TODO.md
ISSUE-BLOWOUT-TODO.md
```

只发:
- `dist/` (compiled)
- `plugin/` (plugin assets)
- `package.json`
- `README.md`
- `LICENSE`
- `CMEM_SYNC_README.md`
- `install-client.sh`

### 3. Build + npm pack 验证

```bash
npm run build
npm pack --dry-run | head -50    # 看会发哪些文件
npm pack                          # 真生成 tgz
ls -lh claude-mem-plus-zh-fork-1.0.0.tgz
```

### 4. 本地装一遍确认 work

```bash
npm uninstall -g claude-mem-plus        # 卸 upstream(如果有)
npm install -g ./claude-mem-plus-zh-fork-1.0.0.tgz
which claude-mem-plus
claude-mem-plus sync --help              # 应该看到 sync 子命令
```

### 5. npm publish

```bash
npm login                           # 第一次需要(用户名 / 密码 / OTP)
npm publish --access public         # 发布到 https://www.npmjs.com/package/claude-mem-plus-zh-fork
```

公开后,其他用户:
```bash
npm install -g claude-mem-plus-zh-fork
```

或者用 `install-client.sh`:
```bash
curl -sSL https://raw.githubusercontent.com/<your>/claude-mem-plus/zh-fork/install-client.sh | \
    bash -s -- --package claude-mem-plus-zh-fork
```

## GitHub Release(配合 npm publish)

### 1. tag + push

```bash
git tag -a v1.0.0 -m "zh-fork 1.0.0 — i18n 31 langs + trash + sync"
git push origin v1.0.0
```

### 2. 用 gh CLI 创 release

```bash
gh release create v1.0.0 \
    --title "v1.0.0 zh-fork" \
    --notes-file CHANGELOG.md \
    claude-mem-plus-zh-fork-1.0.0.tgz
```

或用 GitHub Actions 自动化(下面)。

## GitHub Actions(自动 publish)

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: [ 'v*' ]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org/
      - run: npm install
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            *.tgz
```

`secrets.NPM_TOKEN`:在 npm 网站生成 access token,GitHub repo Settings → Secrets → 加 NPM_TOKEN。

## 跟 upstream 同步

定期 rebase upstream 避免 fork 落后:

```bash
git fetch upstream
git rebase upstream/main

# 解 conflict 时 [zh-fork] 前缀的 commit 是我们的改动
# 大部分 conflict 在 messages-zh.ts / messages-en.ts(upstream 加新 key)和 worker-service.ts 注册路由

npm install
npm run build
npm test

git push origin zh-fork --force-with-lease
```

如果 upstream 改了 schema,可能要更新 migration v31 兼容(看 migration runner 现有逻辑)。

## 升级用户的 fork 装的版本

用户:
```bash
npm update -g claude-mem-plus-zh-fork    # 拉最新
claude-mem-plus stop && claude-mem-plus start
```

或者重跑 install-client.sh(会自动 npm install 最新):
```bash
curl -sSL .../install-client.sh | bash -s -- --package claude-mem-plus-zh-fork
```

## 常见问题

### npm publish 被拒(403 / 409)

- 包名已存在 → 改 `name`
- 不是 owner → npm 公网限定 unique 包名
- 需要 OTP → npm 账号开了 2FA,publish 时输入

### bin 命令冲突(claude-mem-plus 已装 upstream)

```bash
npm uninstall -g claude-mem-plus
npm install -g claude-mem-plus-zh-fork
```

或者 fork 改 bin name(`{ "bin": { "cmem-mem": "..." } }`),让两者共存。

### Bun 依赖

claude-mem-plus worker 跑在 Bun 上(`worker-service.cjs`)。npm install 不会装 Bun。`install-client.sh` 会自动装,手动安装看:
```bash
curl -fsSL https://bun.sh/install | bash
```

### 翻译失效

publish 后用户看到 viewer 但有的语言显示 fallback en — 因为 `messages-{lang}.ts` 没翻译 / 是 stub。维护流程:
```bash
bun scripts/translate-i18n.ts --force      # 重翻所有 30 种(~$3,Claude Haiku)
git add src/ui/viewer/i18n/messages-*.ts
git commit -m "i18n: refresh translations"
npm version patch && git push --tags
```

GitHub Actions 自动 publish 新版本。

## License 注意

upstream 是 **AGPL-3.0**,fork 沿用。Publish 到 npm:
- ✅ 允许商业 / 闭源使用
- ⚠️ 但任何 modification 公开服务时必须开源(AGPL 网络条款)
- 这不影响 user `npm install -g` 本地用

## CHANGELOG 格式

```markdown
# Changelog

## [1.0.0] — 2026-XX-XX

### Added
- 31 种语言 viewer i18n(zh/en/ja/ko/...)+ navigator.language 自动检测 + RTL CSS
- 软删除 + 回收站(项目/会话/observation 三级 + 整批恢复)
- cmem-sync 客户端集成(login / push / pull / share / fork)
- viewer Sync Settings 浮动面板
- HumanFormatter 多语言(zh/en + 其他 fallback en)
- install-client.sh 通用一键安装
- CMEM_SYNC_README.md 总览文档

### Changed
- viewer 默认 CONTEXT_FULL_COUNT 0 → 5(更多细节给 Claude)
- ContextSettingsModal 全部 i18n 化

### Fixed
- 多个 trash 路由匹配顺序 bug
- 叶子节点(observation/summary)单独恢复 FK 失败 → 引导走会话/项目级恢复
- SyncRoutes 启动崩(dbManager 未 init 时早注册)
- worker DatabaseManager 没跑 MigrationRunner

### Based on
- upstream bjarne56/claude-mem-plus v12.4.9
```
