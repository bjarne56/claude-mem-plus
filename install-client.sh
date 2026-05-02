#!/usr/bin/env bash
# claude-mem 客户端通用安装脚本(macOS / Ubuntu / Debian / Rocky / Fedora / Arch)
#
# 用法:
#   curl -sSL https://raw.githubusercontent.com/<your>/claude-mem/zh-fork/install-client.sh | bash
#   curl -sSL .../install-client.sh | bash -s -- --server https://cmem.example.com
#   ./install-client.sh                       # 本地跑
#   ./install-client.sh --server URL          # 装完自动 sync login
#   ./install-client.sh --no-hooks            # 跳过 claude-code hook 注册
#
# 标准路径(跨平台):
#   - 数据目录:~/.claude-mem/(默认,可改 CLAUDE_MEM_DATA_DIR)
#   - 全局 CLI:npm 全局 bin(由 nvm/npm 决定,通常 ~/.nvm/.../bin/claude-mem)

set -uo pipefail

# ── 颜色 ─────────────────────────────────────────────
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
OK="${GREEN}✓${RESET}"; FAIL="${RED}✗${RESET}"; INFO="${BLUE}ℹ${RESET}"; WARN="${YELLOW}⚠${RESET}"

log()  { echo -e "$@"; }
ok()   { log "  ${OK} $*"; }
fail() { log "  ${FAIL} ${RED}$*${RESET}"; exit 1; }
warn() { log "  ${WARN} ${YELLOW}$*${RESET}"; }
info() { log "  ${INFO} $*"; }
step() { echo; log "${BOLD}${BLUE}▶ $*${RESET}"; }

# ── 解析参数 ─────────────────────────────────────────
SERVER_URL=""
SKIP_HOOKS=0
SKIP_SYNC=0
PACKAGE_NAME="claude-mem"      # 默认装 upstream;如果你 fork 了改成 claude-mem-zh 等
PACKAGE_SOURCE="npm"            # npm | tarball | git
TARBALL_URL=""
GIT_REPO="https://github.com/thedotmack/claude-mem"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)        SERVER_URL="$2"; shift 2 ;;
        --no-hooks)      SKIP_HOOKS=1; shift ;;
        --no-sync)       SKIP_SYNC=1; shift ;;
        --package)       PACKAGE_NAME="$2"; shift 2 ;;
        --tarball)       PACKAGE_SOURCE="tarball"; TARBALL_URL="$2"; shift 2 ;;
        --git)           PACKAGE_SOURCE="git"; GIT_REPO="$2"; shift 2 ;;
        -h|--help)
            cat <<USAGE
claude-mem client installer

USAGE:
  install-client.sh [--server URL] [--no-hooks] [--no-sync] [--package NAME] [--tarball URL] [--git URL]

OPTIONS:
  --server URL    装完自动 \`claude-mem sync login\` 到该 cmem-server
  --no-hooks      跳过 \`claude-mem install --ide claude-code\` 注册 hook
  --no-sync       不做 sync 配置(只装 claude-mem 本体)
  --package NAME  npm 包名(默认 claude-mem,fork 改 claude-mem-zh)
  --tarball URL   从 tarball 装(替代 npm)
  --git URL       从 git 仓库 clone + npm pack + 装

什么会被改:
  - npm 全局装 claude-mem(node 必须先装好)
  - 创建 ~/.claude-mem/(数据目录,~10MB 起步)
  - ~/.claude/plugins/marketplaces/thedotmack/(claude-code 插件,~6MB)
  - ~/.claude-mem/settings.json(检测系统语言写 CLAUDE_MEM_MODE)

可以 uninstall:
  npm uninstall -g claude-mem
  rm -rf ~/.claude-mem ~/.claude/plugins/marketplaces/thedotmack
USAGE
            exit 0 ;;
        *) warn "未知参数:$1"; shift ;;
    esac
done

# ── 检测 OS ─────────────────────────────────────────
detect_os() {
    case "$OSTYPE" in
        darwin*)  echo "macos" ;;
        linux*)
            if   [[ -f /etc/os-release ]]; then
                . /etc/os-release
                case "$ID" in
                    ubuntu|debian|raspbian)         echo "debian" ;;
                    rocky|rhel|centos|almalinux|fedora) echo "rhel" ;;
                    arch|manjaro|endeavouros)       echo "arch" ;;
                    alpine)                         echo "alpine" ;;
                    *)                              echo "linux-other" ;;
                esac
            else
                echo "linux-other"
            fi
            ;;
        *) echo "unknown" ;;
    esac
}

OS=$(detect_os)
ARCH=$(uname -m)

step "环境检测"
info "OS:    $OS"
info "Arch:  $ARCH"
info "Shell: $SHELL"

# ── 装 Node ──────────────────────────────────────────
ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local nv=$(node --version | sed 's/^v//')
        local major=${nv%%.*}
        if [[ "$major" -ge 18 ]]; then
            ok "node $nv 已装"
            return 0
        else
            warn "node $nv 太旧(需 ≥ 18),升级"
        fi
    fi

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "brew install node"
                brew install node || fail "brew install node 失败"
            else
                info "通过 nvm 装 node 22"
                _install_nvm_node
            fi
            ;;
        debian)
            info "apt 装 node 22"
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        rhel)
            info "dnf/yum 装 node 22"
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
            if command -v dnf >/dev/null; then sudo dnf install -y nodejs; else sudo yum install -y nodejs; fi
            ;;
        arch)
            info "pacman 装 nodejs"
            sudo pacman -S --noconfirm nodejs npm
            ;;
        alpine)
            info "apk 装 nodejs"
            sudo apk add --no-cache nodejs npm
            ;;
        *)
            info "未知 OS,通过 nvm 装"
            _install_nvm_node
            ;;
    esac
    command -v node >/dev/null 2>&1 || fail "node 装失败"
    ok "node $(node --version) 已就位"
}

_install_nvm_node() {
    if [[ ! -s "$HOME/.nvm/nvm.sh" ]]; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    nvm install 22 || fail "nvm install 22 失败"
    nvm use 22
}

# ── 装 Bun(claude-mem worker 用)───────────────────
ensure_bun() {
    if command -v bun >/dev/null 2>&1; then
        ok "bun $(bun --version) 已装"
        return 0
    fi
    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "brew install bun"
                brew install oven-sh/bun/bun || fail "brew install bun 失败"
            else
                _install_bun_curl
            fi
            ;;
        *) _install_bun_curl ;;
    esac
    command -v bun >/dev/null 2>&1 || fail "bun 装失败"
    ok "bun $(bun --version) 已就位"
}

_install_bun_curl() {
    info "通过 install.sh 装 bun"
    curl -fsSL https://bun.sh/install | bash
    # 加 PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
}

# ── 装 claude-mem ───────────────────────────────────
install_claude_mem() {
    case "$PACKAGE_SOURCE" in
        npm)
            info "npm install -g $PACKAGE_NAME"
            npm install -g "$PACKAGE_NAME" || fail "npm 装 $PACKAGE_NAME 失败"
            ;;
        tarball)
            info "下载 tarball $TARBALL_URL"
            local tgz="/tmp/claude-mem-$$.tgz"
            curl -fSL "$TARBALL_URL" -o "$tgz" || fail "下载失败"
            npm install -g "$tgz" || fail "tarball 装失败"
            rm -f "$tgz"
            ;;
        git)
            info "git clone + 本地 build + 装"
            local tmp="/tmp/claude-mem-build-$$"
            git clone --depth 1 "$GIT_REPO" "$tmp" || fail "clone 失败"
            (cd "$tmp" && npm install && npm run build) || fail "build 失败"
            (cd "$tmp" && npm pack) || fail "pack 失败"
            local tgz=$(ls "$tmp"/claude-mem-*.tgz | head -1)
            npm install -g "$tgz" || fail "装失败"
            rm -rf "$tmp"
            ;;
    esac
    command -v claude-mem >/dev/null || fail "claude-mem 命令未生效,看 PATH"
    ok "claude-mem $(claude-mem --version 2>/dev/null | head -1) 已装"
}

# ── 注册 claude-code hook ───────────────────────────
register_hooks() {
    if [[ "$SKIP_HOOKS" -eq 1 ]]; then
        warn "跳过 hook 注册(--no-hooks)"
        return 0
    fi
    info "claude-mem install --ide claude-code(注册 SessionStart / PostToolUse 等 hook)"
    claude-mem install --ide claude-code 2>&1 | tail -3 \
        && ok "hook 已注册" \
        || warn "hook 注册可能失败,手动跑 'claude-mem install --ide claude-code'"
}

# ── 启动 worker ─────────────────────────────────────
start_worker() {
    info "claude-mem start"
    claude-mem start 2>&1 | head -1
    sleep 2
    if claude-mem --version >/dev/null 2>&1; then
        ok "worker 启动 ok"
    fi
}

# ── 可选:sync login ───────────────────────────────
sync_login_optional() {
    if [[ "$SKIP_SYNC" -eq 1 ]]; then
        warn "跳过 sync 配置(--no-sync)"
        return 0
    fi
    if [[ -z "$SERVER_URL" ]]; then
        info "未指定 --server,跳过 sync login(后续可手动:claude-mem sync login --server URL)"
        return 0
    fi
    info "claude-mem sync login --server $SERVER_URL"
    info "(交互式提示输入 username / password / machine_name)"
    claude-mem sync login --server "$SERVER_URL" || warn "sync login 失败,手动 retry"
}

# ── 主流程 ───────────────────────────────────────────
main() {
    log "${BOLD}claude-mem 客户端安装${RESET}"
    log "${DIM}  支持:macOS / Ubuntu / Debian / Rocky / Fedora / Arch / Alpine${RESET}"

    step "1/5 装 Node"
    ensure_node

    step "2/5 装 Bun(worker 运行时)"
    ensure_bun

    step "3/5 装 claude-mem(源:$PACKAGE_SOURCE)"
    install_claude_mem

    step "4/5 注册 claude-code hook"
    register_hooks

    step "5/5 启动 worker + 可选 sync 配置"
    start_worker
    sync_login_optional

    echo
    log "${BOLD}${GREEN}━━━ 完成 ━━━${RESET}"
    log "  数据目录: ~/.claude-mem/"
    log "  viewer:   http://127.0.0.1:\$(grep -o '\"CLAUDE_MEM_WORKER_PORT\":\\s*\"[^\"]*\"' ~/.claude-mem/settings.json | grep -o '[0-9]*')"
    log "  CLI 帮助: claude-mem --help"
    log "  sync 帮助: claude-mem sync --help"
    log "  停止 worker: claude-mem stop"
    log "  卸载: npm uninstall -g $PACKAGE_NAME && rm -rf ~/.claude-mem"
    if [[ -n "$SERVER_URL" ]]; then
        log "  你已连到 server: $SERVER_URL"
    fi
}

main "$@"
