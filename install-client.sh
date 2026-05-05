#!/usr/bin/env bash
# claude-mem-plus 客户端通用安装/检查/卸载脚本
# 支持:macOS / Ubuntu / Debian / Rocky / Fedora / Arch / Alpine
#
# 子命令:
#   install (默认)   全新安装 + 配置
#   check             检查已装环境健康度(node/bun/claude-mem-plus/worker/hooks/sync)
#   uninstall         停 worker + 卸载 npm 包 + 可选清数据目录
#
# 用法:
#   curl -sSL .../install-client.sh | bash                          # install
#   curl -sSL .../install-client.sh | bash -s install --server URL  # install + 自动 sync login
#   ./install-client.sh check                                       # 验证当前安装
#   ./install-client.sh uninstall                                   # 卸载(交互式问要不要清数据)
#
# install 选项:
#   --server URL         装完自动 claude-mem-plus sync login
#   --no-hooks           跳过 claude-code hook 注册
#   --no-sync            完全不做 sync 配置
#   --package NAME       npm 包名(默认 claude-mem-plus)
#   --tarball URL        从 .tgz 装(适合 fork 自托管)
#   --git URL            从 git clone+build 装(适合开发版)
#
# uninstall 选项:
#   --keep-data          保留 ~/.claude-mem-plus/(默认会问)
#   --purge              直接删 ~/.claude-mem-plus/ 和 marketplace 插件,不问
#
# 标准路径:
#   ~/.claude-mem-plus/                             数据目录(可改 CLAUDE_MEM_DATA_DIR)
#   ~/.claude/plugins/marketplaces/bjarne56/      claude-code 插件
#   $(npm config get prefix)/bin/claude-mem-plus    全局 CLI

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
# 必须显式给子命令(install / check / uninstall);不带子命令默认显示 help,
# 防止用户误操作直接装。
CMD=""
case "${1:-}" in
    install|check|uninstall|localize|ensure-docker) CMD="$1"; shift ;;
    ""|-h|--help|help)
        cat <<USAGE
claude-mem-plus 客户端 — 安装 / 检查 / 卸载

⚠️  必须显式带子命令才会动作;裸跑 \`./install-client.sh\` 只显示本说明。

子命令:
  install               安装 / 升级 claude-mem-plus(必须显式给)
  check                 检查已装环境健康度
  uninstall             卸载
  localize              只重跑 SKILL.md frontmatter description 本地化
                        (用于:claude-mem-plus install --ide 覆盖了 marketplace
                         中文 patch 后救急,不需要重新装)

install 选项:
  --server URL          装完自动 'claude-mem-plus sync login' 连该 server
  --no-hooks            跳过 claude-code hook 注册
  --no-sync             完全不做 sync 配置
  --package NAME        npm 包名(默认 claude-mem-plus,fork 暂未发到 npm,
                        所以默认走本地源码或 git;指定本参数时走 npm registry)
  --tarball URL         从 .tgz 装(适合 fork 自托管)
  --git URL             从 git clone+build+pack+install 装(默认源,fork 仓库地址)
  --local [PATH]        从本地源码 build + npm link 装(默认 PATH = 脚本所在目录;
                        复用本地 node_modules,不下载、不打包、不重装 deps)
  --pack-install        配合 --local:改走 npm pack + npm install -g(慢,会重新拉
                        dependencies,但跟本地源码完全隔离;适合验证发布)
  --remote              强制从 git clone(即使脚本在源码仓库里也忽略本地源码)
  --data-dir PATH       把 ~/.claude-mem-plus 软链到 PATH(集中存储 / 多机共享场景);
                        已有 ~/.claude-mem-plus 真目录会自动迁内容到 PATH 后建软链
  --no-data-prompt      跳过"数据目录软链"交互问(curl-pipe 等非 TTY 默认就跳)
  --clean-legacy        强制清 legacy CLAUDE_MEM_DATA_DIR(.zshenv 等)+ 上游
                        chroma-mcp 僵尸进程(指向 ~/.claude-mem/chroma);非 TTY
                        也行;默认 TTY 询问 / 非 TTY 跳过仅 warn
  --keep-legacy-env     强制保留 legacy env(覆盖默认询问/清理),装完可能被
                        env 拽到错误数据目录,谨慎使用

源选择优先级:
  1. 显式 --local / --git / --tarball / --package(走 npm)
  2. 默认:如果脚本在 fork 源码仓库里(同目录有 package.json + name=claude-mem-plus)
         自动用 local;否则 git clone

数据保留(install / 升级 / 重装都不动):
  ~/.claude-mem-plus/            数据目录(SQLite + Chroma + settings.json + logs)
  从上游 claude-mem 切到本 fork claude-mem-plus 时,旧 ~/.claude-mem 自动迁名为
  ~/.claude-mem-plus(软链/真目录均支持),数据库自动延续。

uninstall 选项:
  --keep-data           保留 ~/.claude-mem-plus/
  --purge               直接清掉所有(数据 + 插件 marketplace),不问

什么会被改(install):
  - npm 全局装 claude-mem-plus(node 必须先装好)
  - 创建 ~/.claude-mem-plus/(数据目录,~10 MB 起步)
  - ~/.claude/plugins/marketplaces/bjarne56/(claude-code 插件,~6 MB)
  - ~/.claude-mem-plus/settings.json(检测系统语言写 CLAUDE_MEM_MODE)
  - 按系统语言本地化每个 SKILL.md 的 frontmatter description
    (31 种语言: zh / zh-tw / ja / ko / fr / de / es / it / pt / pt-br /
     ru / uk / pl / cs / hu / ro / nl / sv / nb / da / fi / el / tr /
     ar / he / hi / id / ms / fil / vi / th + en fallback)
    缺翻译的语言保持英文;翻译数据来自 plugin/skills/_descriptions.i18n.json
USAGE
        exit 0 ;;
esac

SERVER_URL=""
SKIP_HOOKS=0
SKIP_SYNC=0
PACKAGE_NAME="claude-mem-plus"   # 本 fork 的 npm 包名,bin 名也是 claude-mem-plus
TARBALL_URL=""
GIT_REPO="https://github.com/bjarne56/claude-mem-plus"
LOCAL_SRC=""                    # 检测到的本地源码根目录(空 = 没本地源码)
DATA_SYMLINK_TARGET=""           # 软链 ~/.claude-mem-plus → <这个目录>(空 = 不软链)
NO_SYMLINK_PROMPT=0              # 1 = 跳过交互问数据目录软链
KEEP_DATA=0
PURGE=0
PACK_INSTALL=0                   # 1 = local 模式走 npm pack + install -g(隔离;默认走 npm link 复用本地 node_modules)
CLEAN_LEGACY=0                   # 1 = 强制清 legacy CLAUDE_MEM_DATA_DIR env / 上游 chroma-mcp 僵尸(非 TTY 也行)
KEEP_LEGACY_ENV=0                # 1 = 强制保留 legacy env(覆盖默认询问/清理)

# ── 检测脚本是否在 fork 源码仓库里运行 ──────────────────
# 如果 install-client.sh 同目录有 package.json 且 name=claude-mem-plus,
# 优先用本地源码 build,跳过 git clone(省 1-2 分钟,也避免远程拉到旧代码)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/package.json" ]] \
   && command grep -q '"name": *"claude-mem-plus"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    LOCAL_SRC="$SCRIPT_DIR"
fi

# 默认源选择优先级:本地源码 > git clone(fork 未发 npm 时不能走 npm)
if [[ -n "$LOCAL_SRC" ]]; then
    PACKAGE_SOURCE="local"
else
    PACKAGE_SOURCE="git"
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)        SERVER_URL="$2"; shift 2 ;;
        --no-hooks)      SKIP_HOOKS=1; shift ;;
        --no-sync)       SKIP_SYNC=1; shift ;;
        --package)       PACKAGE_NAME="$2"; shift 2 ;;
        --tarball)       PACKAGE_SOURCE="tarball"; TARBALL_URL="$2"; shift 2 ;;
        --git)           PACKAGE_SOURCE="git"; GIT_REPO="$2"; shift 2 ;;
        --local)         PACKAGE_SOURCE="local"; LOCAL_SRC="${2:-$LOCAL_SRC}"; [[ -n "${2:-}" ]] && shift 2 || shift ;;
        --remote)        PACKAGE_SOURCE="git"; LOCAL_SRC=""; shift ;;
        --data-dir)      DATA_SYMLINK_TARGET="$2"; shift 2 ;;
        --no-data-prompt)NO_SYMLINK_PROMPT=1; shift ;;
        --keep-data)     KEEP_DATA=1; shift ;;
        --purge)         PURGE=1; shift ;;
        --pack-install)  PACK_INSTALL=1; shift ;;
        --clean-legacy)  CLEAN_LEGACY=1; shift ;;
        --keep-legacy-env) KEEP_LEGACY_ENV=1; shift ;;
        -h|--help)       exec "$0" help ;;
        *)               warn "未知参数:$1"; shift ;;
    esac
done

# ── uninstall 共用的独立备份根目录 ──────────────────────
# 与 claude-mem-un.sh 共用一个 root,通过 export 传给子脚本(子脚本会 ${VAR:-default} fallback)
# 命名:.claude-mem-uninstall-backup-<ts> 跟子脚本默认完全一致
export UNINSTALL_TS="${UNINSTALL_TS:-$(date +%Y%m%d_%H%M%S)}"
export UNINSTALL_BACKUP_DIR="${UNINSTALL_BACKUP_DIR:-$HOME/.claude-mem-uninstall-backup-${UNINSTALL_TS}}"

# 清单数组(install-client.sh 自己范围内的;子脚本会自己打它的)
declare -a UN_DELETED_PATHS=()
declare -a UN_KEPT_PATHS=()
declare -a UN_BACKED_UP_DATA=()

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

# ── 装 Bun(claude-mem-plus worker 用)──────────────
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

# ── 备份数据库 / chroma / settings 到 .pre-fork-backup-<ts>/ ──
# 在卸载任何已装版本前,先无脑备份。安全优先。
# 候选数据目录优先级:
#   1. ~/.claude-mem-plus 软链/真目录(fork 默认)
#   2. ~/.claude-mem 软链/真目录(老/上游默认)
#   3. 上述任一 settings.json 里指定的 CLAUDE_MEM_DATA_DIR(防软链丢失场景)
# 同一真实目录只备份一次(去重)。
#
# Bash 兼容性:不用 ((var++))(set -uo 下当 var=0 时 exit code = 1,
# 跟 && 链交互产生意外行为),改用 var=$((var+1))
_backup_data_dir() {
    local home_candidate
    local total_backed=0
    local -a candidates=("$HOME/.claude-mem-plus" "$HOME/.claude-mem")

    # 从 settings.json 读 CLAUDE_MEM_DATA_DIR 加进候选(防软链丢失)
    local s d
    for s in "$HOME/.claude-mem/settings.json" "$HOME/.claude-mem-plus/settings.json"; do
        if [[ -f "$s" ]] && command -v jq >/dev/null 2>&1; then
            d=$(jq -r '.env.CLAUDE_MEM_DATA_DIR // .CLAUDE_MEM_DATA_DIR // empty' "$s" 2>/dev/null)
            [[ -n "$d" && -d "$d" ]] && candidates+=("$d")
        fi
    done

    local seen=":"
    for home_candidate in "${candidates[@]}"; do
        [[ -e "$home_candidate" || -L "$home_candidate" ]] || continue
        local data_dir
        if [[ -L "$home_candidate" ]]; then
            data_dir=$(readlink "$home_candidate")
            # 解析相对软链(macOS readlink 不带 -f)
            [[ "$data_dir" != /* ]] && data_dir="$(cd "$(dirname "$home_candidate")" && cd "$(dirname "$data_dir")" 2>/dev/null && pwd)/$(basename "$data_dir")"
        else
            data_dir="$home_candidate"
        fi
        [[ -d "$data_dir" ]] || { info "  $home_candidate 无效目标 ($data_dir),跳过"; continue; }

        # 去重:同一真实目录只备份一次
        case "$seen" in
            *":$data_dir:"*) info "  $home_candidate → $data_dir 已处理过,跳过"; continue ;;
        esac
        seen="${seen}${data_dir}:"

        # 备份到独立目录 UNINSTALL_BACKUP_DIR/data-fork/<basename>/
        # 与旧版区别:旧版备份在 $data_dir/.pre-fork-backup-<ts>/(--purge 跟着删),现在独立
        # basename 唯一时直接用,冲突就加路径 hash
        local bk_basename
        bk_basename=$(basename "$data_dir")
        local backup_dir="$UNINSTALL_BACKUP_DIR/data-fork/$bk_basename"
        if [[ -e "$backup_dir" ]]; then
            # 同名冲突,加路径替换防覆盖
            backup_dir="$UNINSTALL_BACKUP_DIR/data-fork/$(echo "$data_dir" | sed -e 's|^/||' -e 's|/|__|g')"
        fi
        mkdir -p "$backup_dir"
        local backed=0
        local f
        for f in claude-mem.db claude-mem.db-wal claude-mem.db-shm \
                 settings.json chroma-sync-state.json supervisor.json \
                 transcript-watch.json; do
            if [[ -f "$data_dir/$f" ]]; then
                cp "$data_dir/$f" "$backup_dir/" 2>/dev/null && backed=$((backed + 1))
            fi
        done
        if [[ -d "$data_dir/chroma" ]]; then
            cp -R "$data_dir/chroma" "$backup_dir/" 2>/dev/null && backed=$((backed + 1))
        fi
        # 历史 backup 子目录也带上(.pre-fork-backup-* / .pre-uninstall-backup-*)
        local sub
        for sub in "$data_dir"/.pre-fork-backup-* "$data_dir"/.pre-uninstall-backup-*; do
            if [[ -d "$sub" ]]; then
                cp -R "$sub" "$backup_dir/" 2>/dev/null && backed=$((backed + 1))
            fi
        done

        if [[ "$backed" -eq 0 ]]; then
            # 备份目录是空的,删掉别留垃圾
            rmdir "$backup_dir" 2>/dev/null
            info "  $home_candidate → $data_dir:无可备份文件"
        else
            ok "  备份 $backed 项 ($home_candidate → $data_dir) → $backup_dir"
            total_backed=$((total_backed + backed))
            UN_BACKED_UP_DATA+=("$data_dir → $backup_dir ($backed 项)")
        fi

        # 删 stale PID 文件 / supervisor.json(防新 worker 启动时误读)
        local stale
        for stale in worker.pid supervisor.json; do
            if [[ -f "$data_dir/$stale" ]]; then
                rm -f "$data_dir/$stale"
            fi
        done
    done

    [[ "$total_backed" -eq 0 ]] && info "  无可备份数据(数据目录为空、软链断、settings.json 无 CLAUDE_MEM_DATA_DIR)"
    return 0
}

# ── 杀残留 worker-service 进程(PID 文件失联兜底)──
_kill_stale_worker_processes() {
    local killed=0
    local pid
    for pid in $(pgrep -f "worker-service\.cjs" 2>/dev/null); do
        kill -TERM "$pid" 2>/dev/null && killed=$((killed + 1))
    done
    if [[ "$killed" -gt 0 ]]; then
        sleep 1
        for pid in $(pgrep -f "worker-service\.cjs" 2>/dev/null); do
            kill -KILL "$pid" 2>/dev/null
        done
        info "  杀掉 $killed 个 worker 残留进程"
    fi
}

# 杀指向上游 ~/.claude-mem/chroma 的 chroma-mcp 僵尸进程
# fork plus 走 ~/.claude-mem-plus/chroma 或自定义,本函数只清上游残留
# 通过 ps 二次过滤排除 .claude-mem-plus 路径,防误杀 fork chroma
_kill_legacy_chroma_mcp() {
    if ! command -v pgrep >/dev/null 2>&1; then
        return 0
    fi
    local pids=()
    local pid cmd
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        cmd=$(/bin/ps -o command= -p "$pid" 2>/dev/null || true)
        [[ -z "$cmd" ]] && continue
        # 匹配规则:任何路径下的 claude-mem/chroma 都算 legacy(覆盖 ~/.claude-mem 默认 + ~/ai/claude-mem 等自定义),
        # 但要先排除 claude-mem-plus(fork)前缀,避免误杀
        case "$cmd" in
            *claude-mem-plus/*) ;;                        # fork chroma(任何路径),跳
            *claude-mem/chroma*) pids+=("$pid") ;;        # legacy chroma(任何路径),匹配
        esac
    done < <(pgrep -f 'chroma-mcp' 2>/dev/null)

    if [[ ${#pids[@]} -eq 0 ]]; then
        return 0
    fi
    kill -TERM "${pids[@]}" 2>/dev/null || true
    sleep 1
    local still=()
    for pid in "${pids[@]}"; do
        /bin/kill -0 "$pid" 2>/dev/null && still+=("$pid")
    done
    [[ ${#still[@]} -gt 0 ]] && kill -KILL "${still[@]}" 2>/dev/null || true
    ok "  杀掉 ${#pids[@]} 个 legacy chroma-mcp 僵尸(指向 ~/.claude-mem/chroma)"
}

# 杀 fork 自己的 chroma-mcp(指向 claude-mem-plus/chroma 任意路径)
# 用于 cmd_uninstall:worker 退出后 chroma-mcp 子进程不会自动回收,要主动杀
_kill_fork_chroma_mcp() {
    if ! command -v pgrep >/dev/null 2>&1; then
        return 0
    fi
    local pids=()
    local pid cmd
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        cmd=$(/bin/ps -o command= -p "$pid" 2>/dev/null || true)
        case "$cmd" in
            *claude-mem-plus/chroma*) pids+=("$pid") ;;
        esac
    done < <(pgrep -f 'chroma-mcp' 2>/dev/null)

    if [[ ${#pids[@]} -eq 0 ]]; then
        return 0
    fi
    kill -TERM "${pids[@]}" 2>/dev/null || true
    sleep 1
    local still=()
    for pid in "${pids[@]}"; do
        /bin/kill -0 "$pid" 2>/dev/null && still+=("$pid")
    done
    [[ ${#still[@]} -gt 0 ]] && kill -KILL "${still[@]}" 2>/dev/null || true
    ok "  杀掉 ${#pids[@]} 个 fork chroma-mcp(指向 claude-mem-plus/chroma)"
}

# 清 fork 自己在 claude-code 配置里的注册(plugin / mcpServer)
# 子脚本 claude-mem-un.sh 只清上游 'claude-mem@thedotmack'(注:thedotmack 是上游 marketplace 真名),
# 这里清 fork 自己的两种 marketplace key:
#   - claude-mem-plus@bjarne56(新 marketplace)
#   - claude-mem-plus@thedotmack(老,fork 改名前装在 thedotmack marketplace 下的 user 用)
_clean_fork_plugin_registrations() {
    if ! command -v jq >/dev/null 2>&1; then
        warn "  jq 未安装,跳过 fork plugin 注册清理"
        return 0
    fi
    local files_keys=(
        "$HOME/.claude/settings.json|enabledPlugins|claude-mem-plus@bjarne56"
        "$HOME/.claude/settings.json|enabledPlugins|claude-mem-plus@thedotmack"
        "$HOME/.claude/plugins/installed_plugins.json|plugins|claude-mem-plus@bjarne56"
        "$HOME/.claude/plugins/installed_plugins.json|plugins|claude-mem-plus@thedotmack"
        "$HOME/.claude.json|mcpServers|claude-mem-plus"
    )
    local entry
    for entry in "${files_keys[@]}"; do
        local f="${entry%%|*}"; local rest="${entry#*|}"
        local section="${rest%%|*}"; local key="${rest##*|}"
        [[ ! -f "$f" ]] && continue
        # 看是否有这个 key 才动手(避免空写)
        local has
        has=$(jq -r --arg s "$section" --arg k "$key" 'if .[$s] and .[$s][$k] then "yes" else "no" end' "$f" 2>/dev/null)
        if [[ "$has" != "yes" ]]; then
            continue
        fi
        local ts; ts=$(date +%Y%m%d_%H%M%S)
        command cp "$f" "${f}.bak.${ts}" 2>/dev/null
        local tmp="${f}.tmp.$$"
        if jq --arg s "$section" --arg k "$key" \
            'if .[$s] then .[$s] |= del(.[$k]) else . end' "$f" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$f"
            ok "  已清 $f.$section.$key (备份 ${f}.bak.${ts})"
        else
            rm -f "$tmp"
            warn "  jq 编辑失败:$f"
        fi
    done
}

# 递归删 ~/.claude.json 里任何 key 以 claude-mem(:|@) / claude-mem-plus(:|@) 开头的项
# 覆盖:skillUsage / commands / mcpServers / hooks / 等任何 Claude Code 写的命名空间统计数据
_clean_claude_namespace_keys() {
    local f="$HOME/.claude.json"
    [[ ! -f "$f" ]] && return 0
    if ! command -v jq >/dev/null 2>&1; then
        warn "  jq 未安装,跳过 .claude.json 命名空间清理"
        return 0
    fi
    # 先查有没有 match 的 key,避免空写
    local has
    has=$(jq -r '
        any(.. | objects | keys[]?; test("^claude-mem(-plus)?([:@]|$)"))
        | if . then "yes" else "no" end
    ' "$f" 2>/dev/null)
    if [[ "$has" != "yes" ]]; then
        return 0
    fi
    local ts; ts=$(date +%Y%m%d_%H%M%S)
    command cp "$f" "${f}.bak.${ts}" 2>/dev/null
    local tmp="${f}.tmp.$$"
    if jq '
        walk(
            if type == "object"
            then with_entries(select(.key | test("^claude-mem(-plus)?([:@]|$)") | not))
            else . end
        )
    ' "$f" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$f"
        ok "  已清 .claude.json 里所有 claude-mem(-plus){:|@} 命名空间 key (备份 ${f}.bak.${ts})"
    else
        rm -f "$tmp"
        warn "  jq walk 编辑失败:$f"
    fi
}

# 清空 plugin marketplace cache 父目录(子目录被删后空了就删)
# 同时清两套 marketplace 父目录:bjarne56(新)+ thedotmack(fork 改名前的老 marketplace,
# 上游本来也用 thedotmack,所以要看里面是不是空了再删,有上游残留就别删)
_cleanup_marketplace_cache_parent() {
    local parent
    for parent in "$HOME/.claude/plugins/cache/bjarne56" "$HOME/.claude/plugins/cache/thedotmack"; do
        if [[ -d "$parent" ]] && [[ -z "$(ls -A "$parent" 2>/dev/null)" ]]; then
            command rmdir "$parent" 2>/dev/null && ok "  已删空 cache 父目录:$parent"
        fi
    done
}

# 清 rc 文件里所有 CLAUDE_MEM_DATA_DIR 注册行(bash/zsh export + fish set -gx)
# 上游历史 install 版本写在 ~/.zshenv 等位置,fork plus 装完会被 env 拽到错路径
_clean_data_dir_env_in_rc() {
    local rcfile="$1"
    [[ ! -f "$rcfile" ]] && return 0
    local pattern='^[[:space:]]*(export[[:space:]]+CLAUDE_MEM_DATA_DIR=|set[[:space:]]+-gx[[:space:]]+CLAUDE_MEM_DATA_DIR[[:space:]])'
    if ! grep -qE "$pattern" "$rcfile" 2>/dev/null; then
        return 1   # 1 = 没 match 不算错,只是没活干
    fi
    local ts; ts=$(date +%Y%m%d_%H%M%S)
    command cp "$rcfile" "${rcfile}.bak.${ts}" 2>/dev/null
    local tmp="${rcfile}.tmp.$$"
    grep -vE "$pattern" "$rcfile" > "$tmp" && mv "$tmp" "$rcfile"
    ok "  已清 CLAUDE_MEM_DATA_DIR:$rcfile (备份 ${rcfile}.bak.${ts})"
    return 0
}

# 预检 + 处理上游残留(install/uninstall 都用)
# install 默认 TTY 询问 / 非 TTY 跳过 warn;--clean-legacy 强清;--keep-legacy-env 强留
# uninstall 默认无条件清(因为本来就是要走干净)
# 调用方式:_handle_legacy_residue install / _handle_legacy_residue uninstall
_handle_legacy_residue() {
    local mode="${1:-install}"

    # 1. 探测 rc 里有无 CLAUDE_MEM_DATA_DIR
    local found_env=0 rcfile
    local rcfiles=(
        "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.zprofile"
        "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"
        "$HOME/.config/fish/config.fish"
    )
    for rcfile in "${rcfiles[@]}"; do
        [[ ! -f "$rcfile" ]] && continue
        if grep -qE '^[[:space:]]*(export[[:space:]]+CLAUDE_MEM_DATA_DIR=|set[[:space:]]+-gx[[:space:]]+CLAUDE_MEM_DATA_DIR[[:space:]])' "$rcfile" 2>/dev/null; then
            found_env=1
            warn "$rcfile 含 CLAUDE_MEM_DATA_DIR 注册(可能是上游 claude-mem 残留)"
        fi
    done

    # 2. 探测 chroma-mcp 僵尸(只数,不杀)
    local zombie_count=0
    if command -v pgrep >/dev/null 2>&1; then
        local pid cmd
        while IFS= read -r pid; do
            [[ -z "$pid" ]] && continue
            cmd=$(/bin/ps -o command= -p "$pid" 2>/dev/null || true)
            # 匹配任何路径下的 claude-mem/chroma(home 默认 + 自定义路径如 ~/ai/claude-mem),
            # 但排除 claude-mem-plus 前缀(fork)
            case "$cmd" in
                *claude-mem-plus/*) ;;
                *claude-mem/chroma*) zombie_count=$((zombie_count + 1)) ;;
            esac
        done < <(pgrep -f 'chroma-mcp' 2>/dev/null)
    fi
    if [[ "$zombie_count" -gt 0 ]]; then
        warn "检测到 $zombie_count 个指向 ~/.claude-mem/chroma 的 legacy chroma-mcp 进程"
    fi

    if [[ "$found_env" -eq 0 && "$zombie_count" -eq 0 ]]; then
        info "无上游 claude-mem 残留"
        return 0
    fi

    # 3. 决定动不动
    local do_clean=0
    if [[ "$mode" == "uninstall" ]]; then
        do_clean=1   # uninstall 默认就清
    elif [[ "$KEEP_LEGACY_ENV" -eq 1 ]]; then
        warn "--keep-legacy-env: 跳过 legacy 清理;装完可能被 env 拽到错路径"
        return 0
    elif [[ "$CLEAN_LEGACY" -eq 1 ]]; then
        do_clean=1
    elif [[ ! -t 0 ]]; then
        warn "非 TTY 环境,默认保留(传 --clean-legacy 可强清)"
        return 0
    else
        echo
        read -r -p "  ${YELLOW}? 清理 legacy CLAUDE_MEM_DATA_DIR + chroma-mcp 僵尸 [Y/n] ${RESET}" ans
        if [[ "$ans" =~ ^[Nn]$ ]]; then
            warn "已跳过 legacy 清理"
            return 0
        fi
        do_clean=1
    fi

    [[ "$do_clean" -eq 0 ]] && return 0

    # 4. 实际清
    for rcfile in "${rcfiles[@]}"; do
        _clean_data_dir_env_in_rc "$rcfile" || true
    done
    # 当前 shell 也卸下 env,防 install 流程后续读到旧值
    unset CLAUDE_MEM_DATA_DIR

    if [[ "$zombie_count" -gt 0 ]]; then
        _kill_legacy_chroma_mcp
    fi
}

# ── 清理只剩 stale 文件的"垃圾真目录" ──
# 场景:卸载过程中软链 ~/.claude-mem 被某个步骤替换成真目录,
# 里面只有 worker.pid / supervisor.json 等 stale 文件 → 清掉别留垃圾
# 安全:有任何用户数据(settings.json 大于 0 字节、claude-mem.db、chroma 等)就保留
_cleanup_stale_data_dir() {
    local target="$1"
    [[ -d "$target" && ! -L "$target" ]] || return 0   # 只处理真目录

    # 找任何"非 stale"的文件
    local non_stale
    non_stale=$(find "$target" -mindepth 1 -maxdepth 1 \
        ! -name "worker.pid" \
        ! -name "supervisor.json" \
        ! -name "worker.port" \
        2>/dev/null | head -1)
    if [[ -z "$non_stale" ]]; then
        info "  $target 只剩 stale 文件,清理"
        command rm -rf "$target" && ok "  $target 已清"
    fi
}

# ── docker 自助:检查 + 装 Docker Desktop(macOS) ────
# fork 自家的 docker harness / 探测镜像 / chroma 容器化部署都需要 docker。
# 用户没装时 install-client.sh 会自动调 cmd_ensure_docker() 提供引导。
_check_docker() {
    if ! command -v docker &>/dev/null; then
        warn "docker 未装"
        return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        warn "Docker 守护进程没跑"
        return 1
    fi
    return 0
}

cmd_ensure_docker() {
    if _check_docker; then
        ok "docker 就绪($(docker --version 2>/dev/null | head -1))"
        return 0
    fi
    case "$(uname -s)" in
        Darwin)
            if [[ ! -d /Applications/Docker.app ]]; then
                if command -v brew &>/dev/null; then
                    info "装 Docker Desktop(brew cask)"
                    brew install --cask docker 2>&1 | tail -3
                else
                    fail "brew 未装,自己装:https://www.docker.com/products/docker-desktop"
                fi
            else
                ok "Docker Desktop 已装"
            fi
            if ! docker info >/dev/null 2>&1; then
                info "启动 Docker Desktop"
                open -a Docker
                local i
                for i in {1..60}; do
                    if docker info >/dev/null 2>&1; then
                        ok "Docker daemon 就绪($i 秒)"
                        return 0
                    fi
                    sleep 1
                done
                warn "60 秒守护进程还没起,看 Docker 菜单栏图标"
                return 1
            fi
            ok "Docker 已运行"
            ;;
        Linux)
            warn "Linux 自动装 docker:见 https://docs.docker.com/engine/install/"
            return 1
            ;;
        *)
            warn "未知 OS,docker 自助不支持"
            return 1
            ;;
    esac
}

# ── 清理 docker 资源(容器 + 镜像 + host 数据卷)──
# 范围:fork 自家的 docker harness + 探测镜像
#   容器:image 名含 claude-mem* 的所有(running 或 stopped)
#   镜像:claude-mem-plus:*、claude-mem-upstream-probe:*、claude-mem:basic 等
#   host 卷:fork 仓库下的 .docker-claude-mem*-data
# 不动:与 claude-mem 无关的 docker 资源
_cleanup_docker_resources() {
    if ! command -v docker >/dev/null 2>&1; then
        info "  docker 不可用,跳过"
        return 0
    fi

    # 1) 容器:列所有 image 名含 claude-mem 的
    local cids=""
    local cid img
    while IFS=$'\t' read -r cid img; do
        [[ -z "$cid" ]] && continue
        case "$img" in
            *claude-mem*) cids+="$cid "; info "  容器 $cid (image=$img)" ;;
        esac
    done < <(docker ps -a --format '{{.ID}}\t{{.Image}}' 2>/dev/null)

    if [[ -n "$cids" ]]; then
        docker stop $cids >/dev/null 2>&1 || true
        docker rm -f $cids >/dev/null 2>&1 || true
        ok "  停 + 删容器完成"
    else
        info "  无 claude-mem 相关容器"
    fi

    # 2) 镜像:repo:tag 名含 claude-mem
    local imgs=""
    while IFS= read -r img; do
        [[ -z "$img" || "$img" == "<none>:<none>" ]] && continue
        case "$img" in
            *claude-mem*) imgs+="$img "; info "  镜像 $img" ;;
        esac
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)

    if [[ -n "$imgs" ]]; then
        docker rmi -f $imgs >/dev/null 2>&1 || true
        ok "  删镜像完成"
    else
        info "  无 claude-mem 相关镜像"
    fi

    # 3) host 数据卷(fork 仓库下的 .docker-*-data)
    local vol_dir
    for vol_dir in "$SCRIPT_DIR/.docker-claude-mem-plus-data" "$SCRIPT_DIR/.docker-claude-mem-data"; do
        if [[ -d "$vol_dir" ]]; then
            local sz
            sz=$(command du -sh "$vol_dir" 2>/dev/null | command awk '{print $1}')
            if [[ "$KEEP_DATA" -eq 1 ]]; then
                info "  保留(--keep-data):$vol_dir ($sz)"
            elif [[ "$PURGE" -eq 1 ]] || _ask_yn "  删 host 数据卷 $vol_dir ($sz)?"; then
                command rm -rf "$vol_dir"
                ok "  $vol_dir 已删"
            else
                info "  保留:$vol_dir"
            fi
        fi
    done
}

# ── 上游 / 旧 fork 完整检测 + 安全卸载 ────────────────
# 触发条件:npm 全局有 'claude-mem' 或 'claude-mem-plus' 任意版本
# 行为:
#   1. 先备份 DB/chroma/settings 到 .pre-fork-backup-<ts>/(_backup_data_dir)
#   2. 上游 claude-mem → 调用 ./claude-mem-un.sh --keep-data 完整清理
#      (覆盖 marketplace / cache / settings.json hook / MCP / IDE 集成等 33 项)
#   3. 旧 fork claude-mem-plus → 直接 npm uninstall(数据/cache 由后续 install 重建)
#   4. 杀残留 worker 进程
#
# 安全保证:
#   - 数据目录 npm 不会动;un 脚本带 --keep-data 显式保留
#   - 软链场景:readlink 取真实目录后备份
detect_and_remove_upstream() {
    # 没有 npm 直接跳
    command -v npm >/dev/null 2>&1 || return 0

    local upstream_installed fork_installed
    upstream_installed=$(npm ls -g --depth=0 2>/dev/null | command grep -E "── claude-mem@" | head -1)
    fork_installed=$(npm ls -g --depth=0 2>/dev/null | command grep -E "── claude-mem-plus@" | head -1)

    # 啥都没装,直接返回
    if [[ -z "$upstream_installed" && -z "$fork_installed" ]]; then
        info "未检测到任何 claude-mem / claude-mem-plus 包,跳过卸载步骤"
        return 0
    fi

    [[ -n "$upstream_installed" ]] && info "检测到上游  : $upstream_installed"
    [[ -n "$fork_installed"     ]] && info "检测到旧 fork: $fork_installed"
    info "执行:备份数据 → (上游) un 脚本卸载 → (旧 fork) npm uninstall → 杀残留"

    # 1) 备份(永远先备份,在动任何东西前)
    _backup_data_dir

    # 2) 停 worker(*-plus 优先,旧 bin 兜底)
    if command -v claude-mem-plus >/dev/null 2>&1; then
        info "  claude-mem-plus stop ..."
        claude-mem-plus stop >/dev/null 2>&1 || true
        sleep 1
    fi
    if command -v claude-mem >/dev/null 2>&1; then
        info "  claude-mem stop ..."
        claude-mem stop >/dev/null 2>&1 || true
        sleep 1
    fi

    # 3) 上游 claude-mem 卸载:交给独立 un 脚本(--keep-data 显式保留数据目录)
    if [[ -n "$upstream_installed" ]]; then
        local un_script="$SCRIPT_DIR/claude-mem-un.sh"
        if [[ -x "$un_script" ]]; then
            info "  调用 $un_script --keep-data 卸载上游 ..."
            "$un_script" --keep-data 2>&1 | command sed 's/^/    /' \
                || warn "  un 脚本退出码非 0(已尽力清理,继续)"
            ok "  上游 claude-mem 卸载完成"
        elif [[ -f "$un_script" ]]; then
            warn "  $un_script 存在但不可执行,fallback 到 'npm uninstall -g claude-mem'"
            npm uninstall -g claude-mem >/dev/null 2>&1 || warn "  npm 卸 claude-mem 报错(忽略)"
        else
            warn "  未找到 $un_script,fallback 到 'npm uninstall -g claude-mem'"
            npm uninstall -g claude-mem >/dev/null 2>&1 || warn "  npm 卸 claude-mem 报错(忽略)"
        fi
    fi

    # 4) 旧 fork claude-mem-plus 卸载:un 脚本不管 fork,这里直接 npm uninstall
    #    (数据/marketplace/cache 由后续 install 流程自动重建,无需 un 脚本)
    if [[ -n "$fork_installed" ]]; then
        info "  npm uninstall -g claude-mem-plus ..."
        npm uninstall -g claude-mem-plus >/dev/null 2>&1 || warn "  npm 卸 claude-mem-plus 报错(忽略)"
    fi

    # 5) 杀残留 worker(PID 文件失联兜底,适用于 un 脚本和 npm uninstall 都可能漏的)
    _kill_stale_worker_processes

    # 6) 清旧版本 plugin cache(claude-code 缓存的多版本目录,留最新一个就够)
    #    路径是 claude-code 自己生成的(基于 marketplace 名 bjarne56/claude-mem),
    #    跟 fork 包名无关,保留 claude-mem 字面量
    local cache_root="$HOME/.claude/plugins/cache/bjarne56/claude-mem"
    if [[ -d "$cache_root" ]]; then
        local versions
        versions=$(/bin/ls -1 "$cache_root" 2>/dev/null | command grep -E "^[0-9]+\.[0-9]+\.[0-9]+$" | sort -V)
        local count
        count=$(echo "$versions" | command grep -c .)
        if [[ "$count" -gt 1 ]]; then
            local latest
            latest=$(echo "$versions" | tail -1)
            local removed=0
            while IFS= read -r v; do
                [[ "$v" == "$latest" ]] && continue
                rm -rf "$cache_root/$v" 2>/dev/null && ((removed++))
            done <<< "$versions"
            info "  清旧版 plugin cache:删 $removed 个,留 $latest"
        fi
    fi

    ok "完整卸载完成;数据保留(+ 备份目录)"
}

# ── 把老数据目录 ~/.claude-mem 重命名为 ~/.claude-mem-plus ─
# 触发场景:从上游 claude-mem(或旧 fork bin=claude-mem)升到本 fork bin=claude-mem-plus 时,
# 默认数据目录从 ~/.claude-mem 迁到 ~/.claude-mem-plus。
# 行为:
#   - ~/.claude-mem-plus 已存在(真目录或软链)→ 不动
#   - ~/.claude-mem 是真目录 → mv 到 ~/.claude-mem-plus
#   - ~/.claude-mem 是软链 → 原地 mv 软链文件(指向不变)
#   - 都不存在 → 跳过
_migrate_legacy_data_home() {
    local old="$HOME/.claude-mem"
    local new="$HOME/.claude-mem-plus"

    if [[ -e "$new" || -L "$new" ]]; then
        # 新位置已就绪;但若旧位置也存在(用户两边都建过),保留旧目录别动,提醒一下
        if [[ -e "$old" || -L "$old" ]]; then
            warn "$old 与 $new 同时存在;新版只读 $new,旧目录保持原样请手动确认"
        fi
        return 0
    fi

    if [[ ! -e "$old" && ! -L "$old" ]]; then
        # 全新机器,啥都没有
        return 0
    fi

    info "迁移数据目录 $old → $new(默认数据目录改名)"
    mv "$old" "$new" || { warn "迁移失败,后续 worker 会用空 $new"; return 0; }
    ok "$new 已就位(原 $old 不再存在)"
}

# ── 装 claude-mem-plus ──────────────────────────────
install_claude_mem() {
    # 先检测+卸载上游(npm uninstall 会带走旧 bin 软链,后续 install -g
    # 会重新生成,所以顺序必须 detect → migrate → npm install)
    detect_and_remove_upstream
    _migrate_legacy_data_home

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
        local)
            [[ -n "$LOCAL_SRC" && -d "$LOCAL_SRC" ]] || fail "本地源码路径无效: $LOCAL_SRC"
            if [[ "$PACK_INSTALL" -eq 1 ]]; then
                # 隔离模式:npm pack 出 .tgz,npm install -g 装到全局(会重新拉 prod deps)
                # 适用场景:验证可发布性、跟全局环境彻底隔离
                info "本地源码 pack + install(源:$LOCAL_SRC,--pack-install 模式)"
                (
                    cd "$LOCAL_SRC" || exit 1
                    if [[ ! -d node_modules ]]; then
                        npm install || exit 1
                    fi
                    npm run build || exit 1
                    rm -f claude-mem*-*.tgz
                    npm pack || exit 1
                ) || fail "本地 build/pack 失败"
                local tgz
                tgz=$(ls "$LOCAL_SRC"/claude-mem*-*.tgz 2>/dev/null | head -1)
                [[ -n "$tgz" && -f "$tgz" ]] || fail "找不到 npm pack 产物 (期望 $LOCAL_SRC/claude-mem*.tgz)"
                npm install -g "$tgz" || fail "装失败"
                rm -f "$tgz"
            else
                # 默认:npm link — 全局软链 → LOCAL_SRC,完全跳过下载和打包,
                # 复用本地 node_modules 的 dependencies(运行时 Node 会从那 require)
                info "本地源码 build + npm link(源:$LOCAL_SRC,无 .tgz 无 deps 重装)"
                (
                    cd "$LOCAL_SRC" || exit 1
                    if [[ ! -d node_modules ]]; then
                        info "  node_modules 缺失,先 npm install ..."
                        npm install || exit 1
                    fi
                    npm run build || exit 1
                    # 清旧 .tgz(如果之前 --pack-install 跑过留下的)
                    rm -f claude-mem*-*.tgz
                    # 关键:npm link 创建全局软链,bin 也软链,deps 复用本地 node_modules
                    npm link || exit 1
                ) || fail "本地 build/link 失败"
            fi
            ;;
        git)
            info "git clone + 本地 build + 装(源:$GIT_REPO)"
            local tmp="/tmp/claude-mem-build-$$"
            git clone --depth 1 "$GIT_REPO" "$tmp" || fail "clone 失败"
            (cd "$tmp" && npm install && npm run build) || fail "build 失败"
            (cd "$tmp" && npm pack) || fail "pack 失败"
            # fork 包名是 claude-mem-plus,上游是 claude-mem,通配兼容
            local tgz=$(ls "$tmp"/claude-mem*-*.tgz 2>/dev/null | head -1)
            [[ -n "$tgz" && -f "$tgz" ]] || fail "找不到 npm pack 产物 (期望 $tmp/claude-mem*.tgz)"
            npm install -g "$tgz" || fail "装失败"
            rm -rf "$tmp"
            ;;
    esac
    command -v claude-mem-plus >/dev/null || fail "claude-mem-plus 命令未生效,看 PATH"
    ok "claude-mem-plus $(claude-mem-plus --version 2>/dev/null | head -1) 已装"
}

# ── 注册 claude-code hook ───────────────────────────
register_hooks() {
    if [[ "$SKIP_HOOKS" -eq 1 ]]; then
        warn "跳过 hook 注册(--no-hooks)"
        return 0
    fi
    # 防御性清理:删 marketplace plugin/ 子目录(不动 marketplace 根的 node_modules
    # 等 npm install 装的 deps 共享内容)。
    # 原因:fork install.ts 的 copyPluginToMarketplace 用 rmSync+cpSync 应该总是覆盖,
    # 但实测在某些情况下 marketplace plugin.json 可能残留旧 version,直接预删能保证
    # 下面 'claude-mem-plus install --ide' 一定从干净状态开始 copy
    local mp_plugin="$HOME/.claude/plugins/marketplaces/bjarne56/plugin"
    if [[ -d "$mp_plugin" ]]; then
        info "预清理 marketplace plugin/(防旧版本残留)"
        command rm -rf "$mp_plugin"
    fi
    # 自动选最新 model(claude-haiku-4-5-20251001),避免交互问题卡 install 流程
    # --no-auto-start 跳过 install 命令末尾的 worker 自启(本脚本 step 7 会自己启)
    info "claude-mem-plus install --ide claude-code --model claude-haiku-4-5-20251001 --no-auto-start"
    info "  (这一步包含 copyPluginToMarketplace + plugin npm install,可能 30s~2 分钟)"
    # 不再用 | tail -3,让 install 命令的 stdout 流式显示(进度可见)
    # 缩进 4 格区分本脚本输出
    if claude-mem-plus install --ide claude-code --model claude-haiku-4-5-20251001 --no-auto-start 2>&1 \
        | command sed 's/^/    /'; then
        ok "hook 已注册"
    else
        warn "hook 注册可能失败,手动跑 'claude-mem-plus install --ide claude-code --model claude-haiku-4-5-20251001'"
    fi
}

# ── 检测系统 locale,规范化为 BCP-47 lang code ─────────
# 支持的 31 种 lang code:
#   zh zh-tw ja ko fr de es it pt pt-br ru uk pl cs hu ro nl sv nb da
#   fi el tr ar he hi id ms fil vi th
# (en 是 fallback,SKILL.md 默认就是英文)
detect_system_lang() {
    local raw=""
    # macOS:AppleLocale 优先(更准确,反映用户在系统设置选的语言)
    if command -v defaults >/dev/null 2>&1; then
        raw=$(defaults read NSGlobalDomain AppleLocale 2>/dev/null | head -1)
    fi
    # Linux / fallback:LC_ALL > LC_MESSAGES > LANG
    if [[ -z "$raw" ]]; then
        raw="${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}"
    fi
    raw="${raw%%.*}"   # 去掉 .UTF-8
    raw="${raw%%@*}"   # 去掉 @calendar=...
    raw="${raw//_/-}"  # 下划线转连字符
    raw=$(echo "$raw" | tr '[:upper:]' '[:lower:]')

    case "$raw" in
        zh|zh-cn|zh-hans*) echo "zh" ;;
        zh-tw|zh-hk|zh-mo|zh-hant*) echo "zh-tw" ;;
        pt-br) echo "pt-br" ;;
        pt|pt-pt) echo "pt" ;;
        nb*|no*|nn*) echo "nb" ;;
        fil*|tl|tl-*) echo "fil" ;;
        ms|ms-*) echo "ms" ;;
        # 其余取主语言代码,Claude Code 显示该语言或 fallback en
        *) echo "${raw%%-*}" ;;
    esac
}

# ── 在每个 SKILL.md 里 in-place 替换 frontmatter description: 为本机语言 ──
# 缺翻译的 lang 默认保留英文(SKILL.md 自带的)。
# JSON 由 build-hooks.js 复制到 plugin/skills/_descriptions.i18n.json。
apply_mode_locale() {
    # 按系统语言把 settings.json 的 CLAUDE_MEM_MODE 设成 code--<lang>(如 zh → code--zh)
    # 让 claude-mem-plus 写 observation/summary 时用对应语言的 prompt
    # en 默认 code,不动;无对应 mode 文件时也不动(防误设)
    local lang="${1:-$(detect_system_lang)}"
    if [[ "$lang" == "en" ]]; then
        return 0
    fi

    if ! command -v jq >/dev/null 2>&1; then
        warn "jq 未装,跳过 CLAUDE_MEM_MODE 本地化"
        return 0
    fi

    # 检查至少一个 mode 文件存在(marketplace 路径)
    local mode_file="$HOME/.claude/plugins/marketplaces/bjarne56/plugin/modes/code--$lang.json"
    if [[ ! -f "$mode_file" ]]; then
        info "无 code--$lang.json 模式文件,保留默认 CLAUDE_MEM_MODE=code"
        return 0
    fi

    # 改 user settings.json 里的 CLAUDE_MEM_MODE(若 user 已自定义为别的就跳过,尊重 user)
    local SF="$HOME/.claude-mem-plus/settings.json"
    if [[ ! -f "$SF" ]]; then
        return 0
    fi
    local cur new
    cur=$(jq -r '.CLAUDE_MEM_MODE // "code"' "$SF" 2>/dev/null)
    new="code--$lang"
    # 只在当前是 'code'(default) 或已是同一 lang 时才更新,user 自定义为其他 mode 不动
    if [[ "$cur" == "code" || "$cur" == "$new" ]]; then
        if [[ "$cur" != "$new" ]]; then
            local tmp="$SF.tmp.$$"
            jq --arg m "$new" '.CLAUDE_MEM_MODE = $m' "$SF" > "$tmp" && mv "$tmp" "$SF"
            ok "CLAUDE_MEM_MODE: $cur → $new(按系统语言)"
        else
            info "CLAUDE_MEM_MODE 已是 $new,跳过"
        fi
    else
        info "CLAUDE_MEM_MODE = $cur(user 自定义),不动"
    fi
}

apply_skill_locale() {
    local lang="${1:-$(detect_system_lang)}"
    if [[ "$lang" == "en" ]]; then
        info "系统语言 = en,SKILL.md 已是英文,无需 patch"
        return 0
    fi

    if ! command -v node >/dev/null 2>&1; then
        warn "未装 node,跳过 SKILL.md 本地化"
        return 0
    fi

    # 收集**用户安装产物**的 skills 目录;不动 LOCAL_SRC / npm 全局(那些是源码 / 软链
    # → 源码,patch 会污染 git working tree)。
    # claude-code 加载链路:
    #   marketplaces/.../plugin/skills/  (源,源 install 复制来)
    #   cache/.../<ver>/skills/          (实际加载,installed_plugins.json.installPath 指向此)
    # 两个都得 patch — claude-code 启动时实际读 cache,marketplace 是 reload 源。
    local -a skills_dirs=()
    local cand
    # marketplace(plugin/ 下含 skills/_descriptions.i18n.json)
    cand="$HOME/.claude/plugins/marketplaces/bjarne56/plugin/skills"
    if [[ -d "$cand" && -f "$cand/_descriptions.i18n.json" ]]; then
        skills_dirs+=("$cand")
    fi
    # cache 所有版本(留作多版本兼容;skills/ 直接在版本 root 下,没 plugin/ 中间层)
    for cand in "$HOME/.claude/plugins/cache/bjarne56/claude-mem-plus"/*/skills; do
        if [[ -d "$cand" && -f "$cand/_descriptions.i18n.json" ]]; then
            # 防御:跳过软链(npm link 场景下 cache 不会是软链,但保险起见)
            [[ -L "$cand" ]] && continue
            skills_dirs+=("$cand")
        fi
    done

    if [[ "${#skills_dirs[@]}" -eq 0 ]]; then
        warn "找不到含 _descriptions.i18n.json 的 plugin/skills/,跳过 SKILL.md 本地化"
        return 0
    fi

    info "patch SKILL.md description → $lang(共 ${#skills_dirs[@]} 个目录)"

    # 循环 patch 每个目录
    local total_count=0 total_missed=0 total_unverified=0
    local skills_dir
    for skills_dir in "${skills_dirs[@]}"; do
        local i18n_json="$skills_dir/_descriptions.i18n.json"
        local count=0 missed=0 unverified=0 unverified_files=()
        local skill_md skill_name desc actual_desc
        for skill_md in "$skills_dir"/*/SKILL.md; do
            [[ -f "$skill_md" ]] || continue
            skill_name=$(basename "$(dirname "$skill_md")")
            desc=$(node -e "
                const j = require('$i18n_json');
                const m = j['$skill_name'];
                if (m && typeof m['$lang'] === 'string') process.stdout.write(m['$lang']);
            ")
            if [[ -z "$desc" ]]; then
                missed=$((missed + 1))
                continue
            fi
            # frontmatter description 行用 node 直接替换(避免 sed 的转义噩梦)
            node -e "
                const fs = require('fs');
                const f = '$skill_md';
                const desc = process.argv[1];
                let txt = fs.readFileSync(f, 'utf8');
                const m = txt.match(/^---\n([\s\S]*?)\n---/);
                if (!m) process.exit(0);
                const newFm = m[1].replace(/^description: .*\$/m, 'description: ' + desc);
                txt = txt.replace(m[0], '---\n' + newFm + '\n---');
                fs.writeFileSync(f, txt);
            " "$desc"

            # verify:读回 SKILL.md 对比 description 跟 expected 是否一致
            actual_desc=$(node -e "
                const fs = require('fs');
                const txt = fs.readFileSync('$skill_md', 'utf8');
                const m = txt.match(/^---\n([\s\S]*?)\n---/);
                if (!m) process.exit(0);
                const dm = m[1].match(/^description: (.*)\$/m);
                if (dm) process.stdout.write(dm[1]);
            ")
            if [[ "$actual_desc" == "$desc" ]]; then
                count=$((count + 1))
            else
                unverified=$((unverified + 1))
                unverified_files+=("$skill_name")
            fi
        done

        # 路径相对显示(脱敏 $HOME)
        local short="${skills_dir/#$HOME/~}"
        if [[ "$unverified" -gt 0 ]]; then
            warn "  $short:patch $count,verify 失败 $unverified [${unverified_files[*]}]"
        else
            ok "  $short:patch $count,跳过 $missed"
        fi
        total_count=$((total_count + count))
        total_missed=$((total_missed + missed))
        total_unverified=$((total_unverified + unverified))
    done

    if [[ "$total_unverified" -gt 0 ]]; then
        warn "总计:已本地化 $total_count 项;${total_unverified} 项 verify 失败"
        warn "  可能原因:frontmatter 损坏 / 写入被覆盖 / SKILL.md 不可写"
        return 1
    fi
    ok "总计:已本地化 $total_count 项(跳过 $total_missed 项无翻译)"
}

# ── 数据目录软链(可选) ───────────────────────────────
# 把 ~/.claude-mem-plus 改成 → 用户指定目录(集中存储 / 多机同步 / 共享盘等场景)。
# v12.x 起 settings.json / worker.pid / 全部数据都从 CLAUDE_MEM_DATA_DIR 派生,
# 所以 ~/.claude-mem-plus 真目录可以整个换成单根软链,upstream 加新文件也自动落到
# 软链目标,无需后续维护。
#
# 触发逻辑:
#   1. --data-dir PATH        显式指定,直接用
#   2. --no-data-prompt       跳过提问,什么也不做
#   3. 交互 TTY                问用户(回车跳过 = 什么也不做)
#   4. 非 TTY (curl-pipe)     什么也不做(默认安全)
setup_data_symlink() {
    local target="$DATA_SYMLINK_TARGET"

    # 没显式给路径 → 看要不要交互问
    if [[ -z "$target" ]]; then
        # 检测可用 TTY:看 /dev/tty 可读,而不是 [[ -t 0 ]](stdin 可能被前面的子命令
        # 如 claude-mem-plus install 消耗到 EOF 状态,导致 [[ -t 0 ]] 误判)
        if [[ "$NO_SYMLINK_PROMPT" -eq 1 ]] || [[ ! -r /dev/tty ]]; then
            info "跳过数据目录软链(--no-data-prompt 或无 /dev/tty 可用)"
            return 0
        fi
        echo
        log "  ${INFO} 是否把 ~/.claude-mem-plus 软链到自定义目录?(集中存储 / 多机共享场景)"
        log "  ${DIM}     例:~/ai/claude-mem-plus    /Volumes/work/cmem    回车跳过${RESET}"
        printf "  → 目标路径(回车跳过): "
        # 显式从 /dev/tty 读,绕开 stdin 可能被子命令消耗的状态
        read -r target </dev/tty
        if [[ -z "$target" ]]; then
            info "未输入路径,跳过软链"
            return 0
        fi
    fi

    # 解析 ~ 和相对路径
    target="${target/#\~/$HOME}"
    target="$(cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")"

    local mem_home="$HOME/.claude-mem-plus"

    # 已经是单根软链且目标对,跳
    if [[ -L "$mem_home" ]] && [[ "$(readlink "$mem_home")" == "$target" ]]; then
        ok "~/.claude-mem-plus → $target(已是单根软链)"
        return 0
    fi

    # 要改动文件系统,先停 worker 防写入
    info "停 worker(准备迁移数据)..."
    claude-mem-plus stop >/dev/null 2>&1 || true
    sleep 1

    mkdir -p "$target"

    if [[ -d "$mem_home" && ! -L "$mem_home" ]]; then
        # 真目录 → 把所有内容迁到 target,然后删空目录建软链
        info "迁移 ~/.claude-mem-plus 已有数据到 $target"
        local entry name target_path
        while IFS= read -r entry; do
            name=$(basename "$entry")
            target_path="$target/$name"
            if [[ -L "$entry" ]]; then
                command rm "$entry"
            elif [[ -e "$target_path" ]]; then
                if [[ -d "$entry" ]]; then
                    command rsync -a "$entry/" "$target_path/" 2>/dev/null
                    command rm -rf "$entry"
                else
                    command mv -f "$entry" "$target_path"
                fi
            else
                command mv "$entry" "$target_path"
            fi
        done < <(find "$mem_home" -mindepth 1 -maxdepth 1)
        command rmdir "$mem_home" 2>/dev/null || command rm -rf "$mem_home"
    elif [[ -L "$mem_home" ]]; then
        # 软链但指错 → 删了重建
        command rm "$mem_home"
    fi

    ln -s "$target" "$mem_home"
    ok "~/.claude-mem-plus → $target(单根软链已建)"

    # 同步 settings.json 里的 CLAUDE_MEM_DATA_DIR(防 worker update 把它重置)
    if [[ -f "$target/settings.json" ]]; then
        local cur_dir
        cur_dir=$(command grep -oE '"CLAUDE_MEM_DATA_DIR": *"[^"]*"' "$target/settings.json" 2>/dev/null \
                  | command sed -E 's/.*"([^"]*)"$/\1/')
        if [[ "$cur_dir" != "$target" ]]; then
            # macOS / GNU sed 通用:用 perl in-place
            perl -i -pe "s|\"CLAUDE_MEM_DATA_DIR\": \"[^\"]*\"|\"CLAUDE_MEM_DATA_DIR\": \"$target\"|" "$target/settings.json"
            info "settings.json 里 CLAUDE_MEM_DATA_DIR 已更新为 $target"
        fi
    fi
}

# ── 启动 worker ─────────────────────────────────────
start_worker() {
    info "claude-mem-plus start"
    claude-mem-plus start 2>&1 | head -1
    sleep 2
    if claude-mem-plus --version >/dev/null 2>&1; then
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
        info "未指定 --server,跳过 sync login(后续可手动:claude-mem-plus sync login --server URL)"
        return 0
    fi
    info "claude-mem-plus sync login --server $SERVER_URL"
    info "(交互式提示输入 username / password / machine_name)"
    claude-mem-plus sync login --server "$SERVER_URL" || warn "sync login 失败,手动 retry"
}

# ═══════════════════════════════════════════════════════════════
# check — 验证已装环境健康度;不改任何东西。
#   非 0 退出 = 至少一项失败,便于自动化脚本判断。
# ═══════════════════════════════════════════════════════════════
cmd_check() {
    log "${BOLD}claude-mem-plus 健康检查${RESET}"
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

    step "4/7 claude-mem-plus CLI"
    if command -v claude-mem-plus >/dev/null 2>&1; then
        local cmv=$(claude-mem-plus --version 2>/dev/null | head -1 || echo "?")
        ok "claude-mem-plus $cmv"
        # 检测是否本 fork(支持 sync 子命令)
        if claude-mem-plus sync --help >/dev/null 2>&1; then
            ok "支持 sync 子命令(本 fork)"
        else
            warn "不支持 sync(运行 'claude-mem-plus sync --help' 看)"
        fi
    else
        # 区分三种 case:旧 bin=claude-mem 还在 / symlink broken / 完全没装
        if command -v claude-mem >/dev/null 2>&1; then
            warn "检测到旧 bin 'claude-mem'(上游或旧 fork);新版 bin 是 claude-mem-plus"
            info "    重装:./install-client.sh install"
        fi
        local found_broken=""
        for nvm_bin in "$HOME"/.nvm/versions/node/*/bin/claude-mem-plus "$(npm config get prefix 2>/dev/null)/bin/claude-mem-plus"; do
            [[ -L "$nvm_bin" && ! -e "$nvm_bin" ]] && found_broken="$nvm_bin"
        done
        if [[ -n "$found_broken" ]]; then
            fail_soft "claude-mem-plus symlink 坏:$found_broken → 目标不存在"
            info "    修:rm '$found_broken' && npm install -g $PACKAGE_NAME"
            info "    或开发模式:cd /path/to/fork && npm run build && npm link"
        else
            fail_soft "claude-mem-plus CLI 未装(npm install -g $PACKAGE_NAME)"
        fi
        fails=$((fails+1))
    fi

    step "5/7 数据目录"
    local data_dir="${CLAUDE_MEM_DATA_DIR:-$HOME/.claude-mem-plus}"
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
            warn "PID 文件存在但进程死了(可清:rm $pid_file 或 claude-mem-plus start)"
            fails=$((fails+1))
        fi
    else
        warn "worker 未启动(claude-mem-plus start)"
    fi

    step "7/7 claude-code hook"
    local cc_settings="$HOME/.claude/settings.json"
    # hook 注册时命令名是 claude-mem-plus 或旧 claude-mem,任一存在即视为已注册
    if [[ -f "$cc_settings" ]] && command grep -qE "claude-mem(-plus)?" "$cc_settings" 2>/dev/null; then
        ok "claude-code 配置里看到 claude-mem(-plus) hook 引用"
    else
        warn "claude-code 没看到 hook 注册(claude-mem-plus install --ide claude-code)"
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
# uninstall — 完整卸载:fork + 上游 claude-mem(后者交给 claude-mem-un.sh)
# ═══════════════════════════════════════════════════════════════
# 流程:
#   1. 备份 DB/chroma/settings(防误删)
#   2. 停 worker(*-plus + claude-mem 都试)
#   3. 卸 fork npm 包(claude-mem-plus)
#   4. 调用 claude-mem-un.sh 完整清上游 + 共享路径(33 项):
#      - npm 包 claude-mem(如还装着)
#      - claude-code marketplace / cache / settings.json hooks / installed_plugins.json
#      - ~/.claude.json MCP 条目
#      - Cursor / Windsurf / Gemini / OpenCode / OpenClaw / Codex / Copilot / Antigravity / Warp 集成
#      - shell alias / npx 残留
#      - 上游数据目录 ~/.claude-mem(老用户位置)
#      共享路径(marketplace/cache/settings.json hook)被 fork 和上游共用,清了是预期
#   5. 清 fork 自己的数据目录 ~/.claude-mem-plus(un 脚本不动这个)
#
# 用户选项透传给 un 脚本:--keep-data → --keep-data,--purge → --purge
cmd_uninstall() {
    log "${BOLD}claude-mem-plus 卸载${RESET}"

    step "1/6 备份数据"
    _backup_data_dir

    step "2/6 停 worker"
    # 新 bin = claude-mem-plus,旧 bin = claude-mem;两个都试
    if command -v claude-mem-plus >/dev/null 2>&1; then
        claude-mem-plus stop 2>&1 | head -2 || warn "claude-mem-plus stop 失败,继续"
    fi
    if command -v claude-mem >/dev/null 2>&1; then
        claude-mem stop 2>&1 | head -2 || warn "claude-mem stop 失败,继续"
    fi
    _kill_stale_worker_processes
    # 杀 fork 自己的 chroma-mcp 子进程(worker 退出后不会自动回收)
    _kill_fork_chroma_mcp
    # 卸载时无条件清 legacy env / 上游 chroma-mcp 僵尸(走干净)
    _handle_legacy_residue uninstall

    step "3/6 卸 fork npm 包(claude-mem-plus)"
    if command -v npm >/dev/null 2>&1; then
        npm uninstall -g "$PACKAGE_NAME" 2>&1 | head -3 || warn "npm uninstall 失败,可手动清"
        ok "fork npm 包已卸"
    else
        warn "npm 不存在"
    fi

    step "4/6 调用 claude-mem-un.sh 清上游 + 共享路径"
    local un_script="$SCRIPT_DIR/claude-mem-un.sh"
    if [[ -x "$un_script" ]]; then
        # 透传用户选项:--keep-data 保留 ~/.claude-mem,--purge 强删,无则交互问
        local un_args=()
        if [[ "$KEEP_DATA" -eq 1 ]]; then
            un_args+=(--keep-data)
        elif [[ "$PURGE" -eq 1 ]]; then
            un_args+=(--purge)
        fi
        info "  $un_script ${un_args[*]:-(交互模式)}"
        "$un_script" "${un_args[@]}" 2>&1 | command sed 's/^/    /' \
            || warn "  un 脚本退出码非 0(已尽力清理,继续)"
    elif [[ -f "$un_script" ]]; then
        warn "  $un_script 存在但不可执行;chmod +x 后重跑或手动清上游"
    else
        warn "  未找到 $un_script;只清了 fork,上游残留请手动处理"
        # fallback 最小清理:只清 fork 自己的 marketplace
        local plugin_dir="$HOME/.claude/plugins/marketplaces/bjarne56"
        if [[ -d "$plugin_dir" ]]; then
            local sz=$(command du -sh "$plugin_dir" 2>/dev/null | command awk '{print $1}')
            if [[ "$PURGE" -eq 1 ]] || _ask_yn "  fallback:删 $plugin_dir ($sz)?"; then
                command rm -rf "$plugin_dir"
                ok "  marketplace 已清"
            fi
        fi
    fi

    step "5/6 fork 数据目录 + 残留清理"
    # 5a) fork 数据目录处理。备份已独立放在 $UNINSTALL_BACKUP_DIR/data-fork/,默认无脑删
    #     行为:--keep-data 保留;否则全删(软链 + 真实目录都删,因为备份已独立)
    local data_dir="${CLAUDE_MEM_DATA_DIR:-$HOME/.claude-mem-plus}"
    if [[ -L "$data_dir" ]]; then
        local real_target
        real_target=$(readlink "$data_dir")
        # 解析相对软链
        [[ "$real_target" != /* ]] && real_target="$(cd "$(dirname "$data_dir")" && cd "$(dirname "$real_target")" 2>/dev/null && pwd)/$(basename "$real_target")"
        info "$data_dir 是软链 → $real_target"
        if [[ "$KEEP_DATA" -eq 1 ]]; then
            info "保留软链 + 目标(--keep-data):$data_dir → $real_target"
            UN_KEPT_PATHS+=("$data_dir (软链 → $real_target,--keep-data)")
        else
            command rm -f "$data_dir"
            UN_DELETED_PATHS+=("$data_dir (软链 → $real_target)")
            ok "软链已删:$data_dir"
            if [[ -d "$real_target" ]]; then
                command rm -rf "$real_target"
                UN_DELETED_PATHS+=("$real_target (软链真实目标)")
                ok "真实目录已删:$real_target"
            fi
        fi
    elif [[ -d "$data_dir" ]]; then
        local sz
        sz=$(/usr/bin/du -sh "$data_dir" 2>/dev/null | command awk '{print $1}')
        if [[ "$KEEP_DATA" -eq 1 ]]; then
            info "保留(--keep-data):$data_dir ($sz)"
            UN_KEPT_PATHS+=("$data_dir ($sz,--keep-data)")
        else
            command rm -rf "$data_dir"
            UN_DELETED_PATHS+=("$data_dir ($sz)")
            ok "fork 数据目录已清:$data_dir ($sz)"
        fi
    else
        info "fork 数据目录不存在,跳过"
    fi

    # 5b) 清残留 stale-only 真目录(场景:卸载过程中 ~/.claude-mem 软链被替换成真目录,
    #     里面只剩 worker.pid / supervisor.json — 清掉别留垃圾)
    if [[ "$KEEP_DATA" -ne 1 ]]; then
        _cleanup_stale_data_dir "$HOME/.claude-mem"
        _cleanup_stale_data_dir "$HOME/.claude-mem-plus"
    fi

    # 5c) fork marketplace plugin 目录:同时清两套 marketplace
    #     - marketplaces/bjarne56(新 marketplace,改名后)
    #     - marketplaces/thedotmack(老 marketplace,fork 改名前装的 user 残留)
    # 注意:thedotmack 也是上游 marketplace 真名,如果用户**只**装上游而没装 fork,
    # marketplaces/thedotmack/ 里是上游 plugin,子脚本 claude-mem-un.sh 会清。这里
    # 兜底重复清 marketplaces/thedotmack/plugin(若 fork 装在那里且子脚本漏了)
    if [[ "$KEEP_DATA" -ne 1 ]]; then
        local mp_dir
        for mp_dir in "$HOME/.claude/plugins/marketplaces/bjarne56" \
                      "$HOME/.claude/plugins/marketplaces/thedotmack"; do
            if [[ -d "$mp_dir" ]]; then
                local psz
                psz=$(/usr/bin/du -sh "$mp_dir" 2>/dev/null | command awk '{print $1}')
                command rm -rf "$mp_dir"
                UN_DELETED_PATHS+=("$mp_dir ($psz)")
                ok "marketplace 已清:$mp_dir ($psz)"
            fi
        done
    fi

    # 5c-2) fork plugin marketplace cache(claude-code 装 plugin 时拉下来的,可能很大)
    # 同时清两套 marketplace 下 claude-mem-plus cache
    if [[ "$KEEP_DATA" -ne 1 ]]; then
        local fork_cache_dir
        for fork_cache_dir in "$HOME/.claude/plugins/cache/bjarne56/claude-mem-plus" \
                              "$HOME/.claude/plugins/cache/thedotmack/claude-mem-plus"; do
            if [[ -d "$fork_cache_dir" ]]; then
                local fcsz
                fcsz=$(/usr/bin/du -sh "$fork_cache_dir" 2>/dev/null | command awk '{print $1}')
                command rm -rf "$fork_cache_dir"
                UN_DELETED_PATHS+=("$fork_cache_dir ($fcsz)")
                ok "fork plugin cache 已清:$fork_cache_dir ($fcsz)"
            fi
        done
    fi

    # 5d) 清 fork 自己在 claude-code 配置 JSON 里的注册
    # 子脚本 claude-mem-un.sh 只清上游 'claude-mem@bjarne56',这里清 fork 'claude-mem-plus@bjarne56'
    _clean_fork_plugin_registrations

    # 5d-2) 清 ~/.claude.json 里所有 claude-mem-plus / claude-mem 命名空间残留
    # (skillUsage / commands / hooks 等任何 section 下的 key,Claude Code 自己写的统计数据)
    _clean_claude_namespace_keys

    # 5e) plugin marketplace cache 父目录(子目录被删后空了就删)
    _cleanup_marketplace_cache_parent

    step "6/6 Docker 资源清理(image 名含 claude-mem)"
    _cleanup_docker_resources

    # ── 清单 ──
    echo
    log "${BOLD}━━━ 卸载清单(fork 范围)━━━${RESET}"
    log "${DIM}  上游 / IDE 集成 / shell rc 清理已由 claude-mem-un.sh 子脚本汇报(见上方)${RESET}"
    echo

    if [[ ${#UN_BACKED_UP_DATA[@]} -gt 0 ]]; then
        log "${BOLD}${GREEN}[备份]${RESET} fork 数据(SQLite + chroma + 历史 backups):"
        for item in "${UN_BACKED_UP_DATA[@]}"; do
            log "  • $item"
        done
    else
        info "无 fork 数据可备份"
    fi

    if [[ ${#UN_DELETED_PATHS[@]} -gt 0 ]]; then
        log "${BOLD}${RED}[已删]${RESET} ${#UN_DELETED_PATHS[@]} 项:"
        for item in "${UN_DELETED_PATHS[@]}"; do
            log "  • $item"
        done
    fi

    if [[ ${#UN_KEPT_PATHS[@]} -gt 0 ]]; then
        log "${BOLD}${YELLOW}[保留]${RESET} ${#UN_KEPT_PATHS[@]} 项:"
        for item in "${UN_KEPT_PATHS[@]}"; do
            log "  • $item"
        done
    fi

    echo
    log "${BOLD}独立备份根目录:${RESET} ${UNINSTALL_BACKUP_DIR}"
    log "${DIM}  ├─ data/         上游 ~/.claude-mem 内容(由 claude-mem-un.sh 备份)${RESET}"
    log "${DIM}  ├─ data-fork/    fork ~/.claude-mem-plus 内容(本脚本备份)${RESET}"
    log "${DIM}  └─ rc-backups/   所有 rc 配置文件 *.bak.<ts>(集中归档)${RESET}"
    if [[ -d "$UNINSTALL_BACKUP_DIR" ]]; then
        local total
        total=$(/usr/bin/du -sh "$UNINSTALL_BACKUP_DIR" 2>/dev/null | command awk '{print $1}')
        [[ -n "$total" ]] && log "${DIM}  总大小: $total${RESET}"
    fi
    log "${DIM}  确认无误后可整目录删:rm -rf \"$UNINSTALL_BACKUP_DIR\"${RESET}"
    echo
    log "${BOLD}${GREEN}━━━ 完整卸载完成 ━━━${RESET}"
    log "  彻底重装: ./install-client.sh install"
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
    log "${BOLD}claude-mem-plus 客户端安装${RESET}"
    log "${DIM}  支持:macOS / Ubuntu / Debian / Rocky / Fedora / Arch / Alpine${RESET}"

    # 上游 claude-mem 残留预检(.zshenv 里的 CLAUDE_MEM_DATA_DIR 会让 plus
    # worker 写到错误数据目录;遗留 chroma-mcp 僵尸会让 vector 检索打到错位置)
    step "0/7 上游 claude-mem 残留检查"
    _handle_legacy_residue install

    step "1/7 装 Node"
    ensure_node

    step "2/7 装 Bun(worker 运行时)"
    ensure_bun

    if [[ "$PACKAGE_SOURCE" == "local" ]]; then
        step "3/7 装 claude-mem-plus(本地源码:$LOCAL_SRC)"
    else
        step "3/7 装 claude-mem-plus(源:$PACKAGE_SOURCE)"
    fi
    install_claude_mem

    step "4/7 注册 claude-code hook"
    register_hooks

    step "5/7 按系统语言本地化 SKILL.md description + CLAUDE_MEM_MODE"
    apply_skill_locale
    apply_mode_locale

    step "6/7 数据目录软链(可选)"
    setup_data_symlink

    step "7/7 启动 worker + 可选 sync 配置"
    start_worker
    sync_login_optional

    echo
    log "${BOLD}${GREEN}━━━ 完成 ━━━${RESET}"
    log "  数据目录: ~/.claude-mem-plus/"
    log "  CLI 帮助: claude-mem-plus --help"
    log "  sync 帮助: claude-mem-plus sync --help"
    log "  健康检查: $0 check"
    log "  卸载:     $0 uninstall"
    if [[ -n "$SERVER_URL" ]]; then
        log "  已连到 server: $SERVER_URL"
    else
        log "  连 server: claude-mem-plus sync login --server <URL>"
    fi
}

# ═══════════════════════════════════════════════════════════════
# localize — 只重跑 SKILL.md 本地化(给"被 claude-mem-plus install --ide 覆盖
# 中文 patch"的场景救急,不重装 npm 包不动数据目录)
# ═══════════════════════════════════════════════════════════════
cmd_localize() {
    log "${BOLD}claude-mem-plus 重新本地化 SKILL.md${RESET}"
    local lang
    lang=$(detect_system_lang)
    log "${DIM}  系统语言:$lang${RESET}"

    if [[ "$lang" == "en" ]]; then
        info "系统语言 = en,SKILL.md 已是英文,无需 patch"
        return 0
    fi

    step "1/1 patch SKILL.md description"
    apply_skill_locale "$lang"

    echo
    log "${BOLD}${GREEN}━━━ 本地化完成 ━━━${RESET}"
    log "  ${DIM}如有 verify 失败:检查 marketplace plugin/ 是否被外部覆盖${RESET}"
    log "  ${DIM}重启 claude-code 让新 description 生效${RESET}"
}

# ═══════════════════════════════════════════════════════════════
# dispatch
# ═══════════════════════════════════════════════════════════════
case "$CMD" in
    install)       cmd_install ;;
    check)         cmd_check ;;
    uninstall)     cmd_uninstall ;;
    localize)      cmd_localize ;;
    ensure-docker) cmd_ensure_docker ;;
    "")            # 不带子命令应该已经走 help 退出,这里是兜底
                   exec "$0" help ;;
    *)             fail "未知子命令 $CMD(用 $0 help 看用法)" ;;
esac
