#!/usr/bin/env bash
# pack-release.sh — 给 claude-mem fork 打 release 包(开源 / 内部分发用)
#
# 输出:
#   dist/
#     claude-mem-<version>.tgz             npm pack 产物
#     claude-mem-<version>.tgz.sha256      SHA256 校验
#     install-client.sh                    安装脚本(便于和 tarball 一起分发)
#     RELEASE_MANIFEST.txt                 内容清单 + 校验 + 提交 hash + 时间
#
# 用法:
#   bash scripts/pack-release.sh                    # 默认 = build + pack + manifest
#   bash scripts/pack-release.sh --skip-build       # 跳过 npm run build(已 build 过)
#   bash scripts/pack-release.sh --tag v12.4.9-zh   # 自定义 release tag(默认 = package.json version)
#   bash scripts/pack-release.sh --dry-run          # 只打印步骤,不执行

set -euo pipefail

# ── 颜色 ───────────────────────────────────────
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
OK="${GREEN}✓${RESET}"; FAIL="${RED}✗${RESET}"; INFO="${BLUE}ℹ${RESET}"
log()  { echo -e "$@"; }
ok()   { log "  ${OK} $*"; }
fail() { log "  ${FAIL} ${RED}$*${RESET}"; exit 1; }
info() { log "  ${INFO} $*"; }
step() { echo; log "${BOLD}${BLUE}▶ $*${RESET}"; }

# ── 参数 ───────────────────────────────────────
SKIP_BUILD=0
DRY_RUN=0
RELEASE_TAG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1; shift ;;
        --dry-run)    DRY_RUN=1; shift ;;
        --tag)        RELEASE_TAG="$2"; shift 2 ;;
        -h|--help)
            command sed -n '1,/^set -euo/p' "$0" | command sed '$d'
            exit 0 ;;
        *) fail "未知参数 $1" ;;
    esac
done

# ── 基本检查 ───────────────────────────────────
ROOT="$(command cd "$(command dirname "$0")/.." && command pwd)"
cd "$ROOT" || fail "找不到项目根目录"

[[ -f package.json ]] || fail "package.json 不存在,$ROOT 不是 claude-mem 仓库?"

PKG_VERSION=$(command node -p "require('./package.json').version")
PKG_NAME=$(command node -p "require('./package.json').name")
[[ -z "$RELEASE_TAG" ]] && RELEASE_TAG="$PKG_VERSION"

DIST="$ROOT/dist"
TARBALL_NAME="${PKG_NAME}-${PKG_VERSION}.tgz"

run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        info "[dry-run] $*"
    else
        eval "$@" || fail "命令失败:$*"
    fi
}

# ── pipeline ───────────────────────────────────
log "${BOLD}claude-mem release packer${RESET}"
info "包名:       $PKG_NAME"
info "版本:       $PKG_VERSION"
info "release tag:$RELEASE_TAG"
info "输出:       $DIST/"

step "1/6 准备 dist/"
run "command rm -rf '$DIST'"
run "command mkdir -p '$DIST'"

step "2/6 验证依赖装好"
[[ -d node_modules ]] || fail "node_modules 不在 — 先 npm install"
ok "node_modules 存在"

step "3/6 build(可跳过)"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
    info "跳过 build(--skip-build)"
else
    run "npm run build"
    # viewer 单独
    [[ -f scripts/build-viewer.js ]] && run "node scripts/build-viewer.js"
    ok "build 完"
fi

step "4/6 npm pack"
run "npm pack --pack-destination '$DIST' >/dev/null"
[[ "$DRY_RUN" -eq 0 && -f "$DIST/$TARBALL_NAME" ]] || {
    [[ "$DRY_RUN" -eq 0 ]] && fail "tarball 没生成:$DIST/$TARBALL_NAME"
}
[[ "$DRY_RUN" -eq 0 ]] && ok "$(command du -h "$DIST/$TARBALL_NAME" | command awk '{print $1, $NF}')"

step "5/6 SHA256 + 拷 install 脚本"
if [[ "$DRY_RUN" -eq 0 ]]; then
    (cd "$DIST" && command shasum -a 256 "$TARBALL_NAME" > "$TARBALL_NAME.sha256")
    ok "$(command cat "$DIST/$TARBALL_NAME.sha256")"
fi
run "command cp '$ROOT/install-client.sh' '$DIST/install-client.sh'"
run "command chmod +x '$DIST/install-client.sh'"

step "6/6 RELEASE_MANIFEST.txt"
if [[ "$DRY_RUN" -eq 0 ]]; then
    local_git_hash=$(command git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "?")
    local_git_branch=$(command git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
    local_git_dirty=""
    if [[ -n "$(command git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
        local_git_dirty=" (DIRTY — 有未提交改动)"
    fi
    cat > "$DIST/RELEASE_MANIFEST.txt" <<EOF
claude-mem release manifest
═══════════════════════════════════════════════════════════════
package:       $PKG_NAME
version:       $PKG_VERSION
release tag:   $RELEASE_TAG
build host:    $(command uname -srm)
build time:    $(command date -u +"%Y-%m-%dT%H:%M:%SZ")
git commit:    $local_git_hash on $local_git_branch$local_git_dirty
node version:  $(command node --version)
npm version:   $(command npm --version)
═══════════════════════════════════════════════════════════════

文件:
  $TARBALL_NAME           $(command du -h "$DIST/$TARBALL_NAME" | command awk '{print $1}')
  $TARBALL_NAME.sha256    $(command cat "$DIST/$TARBALL_NAME.sha256" | command awk '{print $1}')
  install-client.sh       $(command du -h "$DIST/install-client.sh" | command awk '{print $1}')

安装方式(给客户/用户的命令):
  # 直接从 tarball 装(推荐)
  bash install-client.sh install --tarball file://\$(pwd)/$TARBALL_NAME

  # 或托管到自己 server 后,一行 curl 安装
  curl -sSL https://your-host/install-client.sh \\
    | bash -s install --tarball https://your-host/$TARBALL_NAME

校验 tarball:
  shasum -a 256 -c $TARBALL_NAME.sha256
EOF
    ok "RELEASE_MANIFEST.txt 已生成"
fi

# ── 总结 ───────────────────────────────────────
echo
log "${BOLD}${GREEN}━━━ 打包完成 ━━━${RESET}"
log "  ${BOLD}dist/${RESET}"
if [[ "$DRY_RUN" -eq 0 ]]; then
    command ls -lh "$DIST" | command tail -n +2 | command awk '{printf "    %s  %s\n", $5, $NF}'
    echo
    log "  下一步:"
    log "    cat $DIST/RELEASE_MANIFEST.txt"
    log "    上传 $TARBALL_NAME 到 GitHub releases / npm registry / 自己的 server"
fi
