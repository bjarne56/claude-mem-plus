#!/usr/bin/env bash
# claude-mem 客户端通用安装/检查/卸载脚本
# 支持:macOS / Ubuntu / Debian / Rocky / Fedora / Arch / Alpine
#
# 子命令:
#   install (默认)   全新安装 + 配置
#   check             检查已装环境健康度(node/bun/claude-mem/worker/hooks/sync)
#   uninstall         停 worker + 卸载 npm 包 + 可选清数据目录
#
# 用法:
#   curl -sSL .../install-client.sh | bash                          # install
#   curl -sSL .../install-client.sh | bash -s install --server URL  # install + 自动 sync login
#   ./install-client.sh check                                       # 验证当前安装
#   ./install-client.sh uninstall                                   # 卸载(交互式问要不要清数据)
#
# install 选项:
#   --server URL         装完自动 claude-mem sync login
#   --no-hooks           跳过 claude-code hook 注册
#   --no-sync            完全不做 sync 配置
#   --package NAME       npm 包名(默认 claude-mem)
#   --tarball URL        从 .tgz 装(适合 fork 自托管)
#   --git URL            从 git clone+build 装(适合开发版)
#
# uninstall 选项:
#   --keep-data          保留 ~/.claude-mem/(默认会问)
#   --purge              直接删 ~/.claude-mem/ 和 marketplace 插件,不问
#
# 标准路径:
#   ~/.claude-mem/                                  数据目录(可改 CLAUDE_MEM_DATA_DIR)
#   ~/.claude/plugins/marketplaces/thedotmack/      claude-code 插件
#   $(npm config get prefix)/bin/claude-mem         全局 CLI

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

# ── 解析子命令 + 参数 ──────────────────────────────────
# 第一个非 -h 的位置参数决定子命令(install / check / uninstall);
# 缺省 = install,保持向后兼容(老的 `bash install-client.sh --server X` 仍工作)
CMD="install"
case "${1:-}" in
    install|check|uninstall) CMD="$1"; shift ;;
    -h|--help|help)
        cat <<USAGE
claude-mem 客户端 — 安装 / 检查 / 卸载

子命令:
  install (默认)        全新安装
  check                 检查已装环境健康度
  uninstall             卸载

install 选项:
  --server URL          装完自动 'claude-mem sync login' 连该 server
  --no-hooks            跳过 claude-code hook 注册
  --no-sync             完全不做 sync 配置
  --package NAME        npm 包名(默认 claude-mem)
  --tarball URL         从 .tgz 装(适合 fork 自托管)
  --git URL             从 git clone+build 装

uninstall 选项:
  --keep-data           保留 ~/.claude-mem/
  --purge               直接清掉所有(数据 + 插件 marketplace),不问

什么会被改(install):
  - npm 全局装 claude-mem(node 必须先装好)
  - 创建 ~/.claude-mem/(数据目录,~10 MB 起步)
  - ~/.claude/plugins/marketplaces/thedotmack/(claude-code 插件,~6 MB)
  - ~/.claude-mem/settings.json(检测系统语言写 CLAUDE_MEM_MODE)
USAGE
        exit 0 ;;
esac

SERVER_URL=""
SKIP_HOOKS=0
SKIP_SYNC=0
PACKAGE_NAME="claude-mem"
PACKAGE_SOURCE="npm"
TARBALL_URL=""
GIT_REPO="https://github.com/thedotmack/claude-mem"
KEEP_DATA=0
PURGE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)        SERVER_URL="$2"; shift 2 ;;
        --no-hooks)      SKIP_HOOKS=1; shift ;;
        --no-sync)       SKIP_SYNC=1; shift ;;
        --package)       PACKAGE_NAME="$2"; shift 2 ;;
        --tarball)       PACKAGE_SOURCE="tarball"; TARBALL_URL="$2"; shift 2 ;;
        --git)           PACKAGE_SOURCE="git"; GIT_REPO="$2"; shift 2 ;;
        --keep-data)     KEEP_DATA=1; shift ;;
        --purge)         PURGE=1; shift ;;
        -h|--help)       exec "$0" help ;;
        *)               warn "未知参数:$1"; shift ;;
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

# ═══════════════════════════════════════════════════════════════
# check — 验证已装环境健康度;不改任何东西。
#   非 0 退出 = 至少一项失败,便于自动化脚本判断。
# ═══════════════════════════════════════════════════════════════
cmd_check() {
    log "${BOLD}claude-mem 健康检查${RESET}"
    local fails=0

    # 兼容非交互 bash:把常见 npm/bun 全局 bin 加进 PATH,避免明明装了却报 not found
    [[ -d "$HOME/.bun/bin" ]] && export PATH="$HOME/.bun/bin:$PATH"
    if command -v node >/dev/null 2>&1; then
        local npm_prefix
        npm_prefix=$(npm config get prefix 2>/dev/null)
        [[ -n "$npm_prefix" && -d "$npm_prefix/bin" ]] && export PATH="$npm_prefix/bin:$PATH"
    fi
    # nvm 装的 node 通常在这里
    for nvm_bin in "$HOME"/.nvm/versions/node/*/bin; do
        [[ -d "$nvm_bin" ]] && export PATH="$nvm_bin:$PATH"
    done

    step "1/7 系统环境"
    info "OS:    $OS  Arch: $ARCH  Shell: $SHELL"

    step "2/7 Node"
    if command -v node >/dev/null 2>&1; then
        local nv=$(node --version | sed 's/^v//')
        local major=${nv%%.*}
        if [[ "$major" -ge 18 ]]; then ok "node v$nv (≥ 18)"
        else warn "node v$nv 太旧(需 ≥ 18)"; fails=$((fails+1)); fi
    else
        fail_soft "node 未装"; fails=$((fails+1))
    fi

    step "3/7 Bun"
    if command -v bun >/dev/null 2>&1; then ok "bun $(bun --version)"
    else warn "bun 未装(worker 起不来)"; fails=$((fails+1)); fi

    step "4/7 claude-mem CLI"
    if command -v claude-mem >/dev/null 2>&1; then
        local cmv=$(claude-mem --version 2>/dev/null | head -1 || echo "?")
        ok "claude-mem $cmv"
        # 检测是否本 fork(支持 sync 子命令)
        if claude-mem sync --help >/dev/null 2>&1; then
            ok "支持 sync 子命令(本 fork)"
        else
            warn "不支持 sync(可能是 upstream;运行 'claude-mem sync --help' 看)"
        fi
    else
        # 区分两种 case:完全没装 vs 装了但 symlink broken
        local found_broken=""
        for nvm_bin in "$HOME"/.nvm/versions/node/*/bin/claude-mem "$(npm config get prefix 2>/dev/null)/bin/claude-mem"; do
            [[ -L "$nvm_bin" && ! -e "$nvm_bin" ]] && found_broken="$nvm_bin"
        done
        if [[ -n "$found_broken" ]]; then
            fail_soft "claude-mem symlink 坏:$found_broken → 目标不存在"
            info "    修:rm '$found_broken' && npm install -g $PACKAGE_NAME"
            info "    或开发模式:cd /path/to/fork && npm run build && npm link"
        else
            fail_soft "claude-mem CLI 未装(npm install -g $PACKAGE_NAME)"
        fi
        fails=$((fails+1))
    fi

    step "5/7 数据目录"
    local data_dir="${CLAUDE_MEM_DATA_DIR:-$HOME/.claude-mem}"
    if [[ -d "$data_dir" ]]; then
        ok "存在: $data_dir"
        if [[ -f "$data_dir/settings.json" ]]; then
            ok "settings.json 存在"
            local mode=$(command grep -o '"CLAUDE_MEM_MODE"[^,}]*' "$data_dir/settings.json" 2>/dev/null | head -1)
            [[ -n "$mode" ]] && info "$mode"
        else
            warn "settings.json 缺失(首次起 worker 会自建)"
        fi
        if [[ -f "$data_dir/claude-mem.db" ]]; then
            local sz=$(command du -h "$data_dir/claude-mem.db" 2>/dev/null | command awk '{print $1}')
            ok "claude-mem.db ($sz)"
        fi
    else
        warn "数据目录不存在(首次启动 worker 会自建)"
    fi

    step "6/7 Worker daemon"
    local pid_file="$data_dir/worker.pid"
    if [[ -f "$pid_file" ]]; then
        local pid=$(command cat "$pid_file" 2>/dev/null)
        if [[ -n "$pid" ]] && command kill -0 "$pid" 2>/dev/null; then
            ok "worker 运行中 (PID $pid)"
            # 探活 /healthz(从 port 文件读 port)
            local port_file="$data_dir/worker.port"
            local port=37777
            [[ -f "$port_file" ]] && port=$(command cat "$port_file" 2>/dev/null)
            local h=$(command curl -s --max-time 2 "http://127.0.0.1:$port/api/sync/state" 2>/dev/null | command head -c 100)
            if [[ -n "$h" ]]; then
                ok "/api/sync/state 响应 ok (端口 $port)"
                info "viewer: http://127.0.0.1:$port"
            else
                warn "worker 在跑但端口 $port 不响应"
                fails=$((fails+1))
            fi
        else
            warn "PID 文件存在但进程死了(可清:rm $pid_file 或 claude-mem start)"
            fails=$((fails+1))
        fi
    else
        warn "worker 未启动(claude-mem start)"
    fi

    step "7/7 claude-code hook"
    local cc_settings="$HOME/.claude/settings.json"
    if [[ -f "$cc_settings" ]] && command grep -q "claude-mem" "$cc_settings" 2>/dev/null; then
        ok "claude-code 配置里看到 claude-mem hook 引用"
    else
        warn "claude-code 没看到 hook 注册(claude-mem install --ide claude-code)"
    fi

    echo
    if [[ "$fails" -eq 0 ]]; then
        log "${BOLD}${GREEN}━━━ 全部通过 ━━━${RESET}"
        return 0
    else
        log "${BOLD}${YELLOW}━━━ 有 $fails 项警告/失败,见上方 ⚠/✗ ━━━${RESET}"
        return 1
    fi
}

# fail 是 exit;check 时希望继续而不是中断,所以单独一个软失败函数
fail_soft() { log "  ${FAIL} ${RED}$*${RESET}"; }

# ═══════════════════════════════════════════════════════════════
# uninstall — 停 worker + 卸 npm 包 + 可选清数据
# ═══════════════════════════════════════════════════════════════
cmd_uninstall() {
    log "${BOLD}claude-mem 卸载${RESET}"

    step "1/4 停 worker"
    if command -v claude-mem >/dev/null 2>&1; then
        claude-mem stop 2>&1 | head -2 || warn "stop 失败,继续"
    else
        warn "claude-mem CLI 不存在,跳过 stop"
    fi

    step "2/4 卸 npm 包"
    if command -v npm >/dev/null 2>&1; then
        npm uninstall -g "$PACKAGE_NAME" 2>&1 | head -3 || warn "npm uninstall 失败,可手动清"
        ok "npm 包已卸"
    else
        warn "npm 不存在"
    fi

    step "3/4 清 claude-code 插件 marketplace"
    local plugin_dir="$HOME/.claude/plugins/marketplaces/thedotmack"
    if [[ -d "$plugin_dir" ]]; then
        local sz=$(command du -sh "$plugin_dir" 2>/dev/null | command awk '{print $1}')
        if [[ "$PURGE" -eq 1 ]] || _ask_yn "删 $plugin_dir ($sz)?"; then
            command rm -rf "$plugin_dir"
            ok "插件目录已清"
        else
            info "保留:$plugin_dir"
        fi
    else
        info "插件目录不存在,跳过"
    fi

    step "4/4 数据目录"
    local data_dir="${CLAUDE_MEM_DATA_DIR:-$HOME/.claude-mem}"
    if [[ -d "$data_dir" ]]; then
        local sz=$(command du -sh "$data_dir" 2>/dev/null | command awk '{print $1}')
        if [[ "$KEEP_DATA" -eq 1 ]]; then
            info "保留(--keep-data):$data_dir ($sz)"
        elif [[ "$PURGE" -eq 1 ]] || _ask_yn "删数据目录 $data_dir ($sz)?这会丢所有 observations + 同步状态!"; then
            command rm -rf "$data_dir"
            ok "数据目录已清"
        else
            info "保留:$data_dir"
        fi
    else
        info "数据目录不存在"
    fi

    echo
    log "${BOLD}${GREEN}━━━ 卸载完成 ━━━${RESET}"
}

# y/n 询问;非交互(stdin 不是 tty)默认 No
_ask_yn() {
    local prompt="$1"
    if [[ ! -t 0 ]]; then
        warn "$prompt → No(非交互,默认保留)"
        return 1
    fi
    read -r -p "  ${YELLOW}? $prompt [y/N] ${RESET}" ans
    [[ "$ans" =~ ^[Yy]$ ]]
}

# ═══════════════════════════════════════════════════════════════
# install — 主流程
# ═══════════════════════════════════════════════════════════════
cmd_install() {
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
    log "  CLI 帮助: claude-mem --help"
    log "  sync 帮助: claude-mem sync --help"
    log "  健康检查: $0 check"
    log "  卸载:     $0 uninstall"
    if [[ -n "$SERVER_URL" ]]; then
        log "  已连到 server: $SERVER_URL"
    else
        log "  连 server: claude-mem sync login --server <URL>"
    fi
}

# ═══════════════════════════════════════════════════════════════
# dispatch
# ═══════════════════════════════════════════════════════════════
case "$CMD" in
    install)   cmd_install ;;
    check)     cmd_check ;;
    uninstall) cmd_uninstall ;;
    *)         fail "未知子命令 $CMD(用 $0 help 看用法)" ;;
esac
