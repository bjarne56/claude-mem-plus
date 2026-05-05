#!/usr/bin/env bash
# claude-mem-un.sh — 上游 thedotmack/claude-mem 完整卸载脚本
# 基于 Docker 实测改动 + 上游源码静态分析(src/npx-cli/commands/install.ts、
# src/services/integrations/*.ts、src/shared/paths.ts)产出,覆盖所有已知 install 副作用
#
# 兼容:macOS / Linux,不依赖 GNU coreutils 专有选项(如 realpath -e)
# 范围:仅清理 **上游 claude-mem(npm 包名 claude-mem,作者 thedotmack)** 的痕迹,
#       不动 fork(claude-mem-plus)的任何路径
#
# ─── 此脚本会动的全部位置(改动点全清单) ────────────────────────────────────
#
# A. 进程 / npm 包
#    1. claude-mem stop / shutdownWorkerAndWait(由 claude-mem 本体接管)
#    2. pkill -f 'worker-service\.cjs'(兜底)
#    2a. pkill -f 'chroma-mcp.*\.claude-mem/chroma'(legacy chroma-mcp 僵尸,
#        排除 .claude-mem-plus 路径,只清上游残留)
#    3. npm uninstall -g claude-mem
#    4. $(npm prefix -g)/bin/claude-mem 软链残留
#    5. $(npm prefix -g)/lib/node_modules/claude-mem 残目录
#
# B. claude-code 插件 / 配置(~/.claude/)
#    6. ~/.claude/plugins/marketplaces/thedotmack/                整个 marketplace 目录
#    7. ~/.claude/plugins/cache/thedotmack/claude-mem/            插件 cache(所有版本)
#    8. ~/.claude/plugins/cache/thedotmack/                       cache 父目录(若空)
#    9. ~/.claude/plugins/data/claude-mem-thedotmack/             插件 data 目录
#   10. ~/.claude/plugins/known_marketplaces.json                 删 thedotmack key
#   11. ~/.claude/plugins/installed_plugins.json                  删 plugins['claude-mem@thedotmack']
#   12. ~/.claude/settings.json                                   删 enabledPlugins['claude-mem@thedotmack']
#
# C. claude-code MCP / 命令(~/.claude.json,如有)
#   13. ~/.claude.json                                            删 mcpServers['claude-mem'] 等条目
#
# D. npx 缓存 / mcp 日志
#   14. ~/.npm/_npx/<hash>/node_modules/claude-mem/               所有 hash 目录里的残留
#   15. ~/.cache/claude-cli-nodejs/*/mcp-logs-plugin-claude-mem-* mcp 插件日志
#
# E. shell 别名 + PATH 注册块 + env 注册
#   16. ~/.bashrc / ~/.zshrc 里的 'alias claude-mem='             清掉(grep -v 写回)
#   17. macOS 上 ~/.bash_profile 的同名 alias
#   17a. ~/.zshrc / ~/.bashrc / ~/.bash_profile / ~/.config/fish/config.fish
#        清 install.ts:applyClaudeCodePathSetupIfNeeded 写入的 PATH 注册块:
#          # Added by claude-mem installer for Claude Code
#          export PATH="$HOME/.local/bin:$PATH"     (fish: set -gx PATH ...)
#        删除标记注释行 + 下一行(2 行 block)
#   17b. ~/.zshenv / ~/.zshrc / ~/.zprofile / ~/.bashrc / .bash_profile / .profile /
#        ~/.config/fish/config.fish 里的 CLAUDE_MEM_DATA_DIR 注册:
#          export CLAUDE_MEM_DATA_DIR="..."     (bash/zsh)
#          set -gx CLAUDE_MEM_DATA_DIR ...      (fish)
#        上游历史版本会写,不清掉的话装 fork plus 后会被 env 拽到错误数据目录
#
# F. 其它 IDE 集成(若上游 install 注册过对应 IDE)
#   18. ~/.gemini/settings.json                                   删 hooks 里 worker-service / gemini-cli 项
#   19. ~/.gemini/GEMINI.md                                       清 claude-mem 段落标记内文本
#   20. ~/.codex/AGENTS.md                                        清 claude-mem 段落
#   21. ~/.codex 下若产生 watch 配置 → 由 ~/.claude-mem/transcript-watch.json 控,不需碰 ~/.codex
#   22. ~/.cursor/hooks.json + 命令脚本 + 项目级 rules            删 claude-mem 项
#   23. ~/.cursor/mcp.json                                        删 claude-mem MCP 条目
#   24. ~/.codeium/windsurf/hooks.json                            删 claude-mem hooks 项
#   25. ~/.config/opencode/plugins/claude-mem.js                  插件文件
#   26. ~/.config/opencode/AGENTS.md                              清 claude-mem 段落
#   27. ~/.openclaw/openclaw.json                                 注销 extension
#   28. ~/.openclaw/extensions/claude-mem/                        extension 目录
#   29. ~/.github/copilot/mcp.json                                删 claude-mem
#   30. ~/.gemini/antigravity/mcp_config.json                     删 claude-mem
#   31. ~/.warp/mcp.json                                          删 claude-mem
#   32. ~/.config/goose/config.yaml                               删 mcp.claude-mem 段(本脚本只警告,不动 yaml)
#
# G. 数据目录(默认直接删,备份独立放好不会丢)
#   33. ~/.claude-mem/                                            默认直接删;--keep-data 强留
#       注意:若是软链(指向 fork 真目录或外置存储),只删软链文件,绝不跟到目标
#       删之前会先 cp 关键文件(claude-mem.db / chroma / settings.json 等)
#       到 UNINSTALL_BACKUP_DIR/data/(独立目录,不在被删目录里)
#
# H. Docker 资源(image 名含 'claude-mem' 的所有容器/镜像)
#   34. docker ps -a → 停 + 删所有 image 包含 claude-mem 的容器
#   35. docker images → 删所有 repo 包含 claude-mem 的镜像
#       覆盖:claude-mem-upstream-probe、claude-mem(:basic 等)、老 fork tag
#
# 不会动的:
#   - 任何 ~/.claude-mem-plus 相关路径(那是 fork)
#   - 系统 node / npm / bun 本体
#   - ~/.bun/bin/bun(install.ts 的 ensureBun 装的是 fork 也用的 bun)
#   - claude-mem-plus:* docker 镜像(那是 fork harness,由 install-client.sh uninstall 处理)
#
# ────────────────────────────────────────────────────────────────────────────
#
# 用法:
#   ./claude-mem-un.sh                  默认问数据目录是否删
#   ./claude-mem-un.sh --purge          连数据目录一起删,不问
#   ./claude-mem-un.sh --keep-data      保留数据目录,不问
#   ./claude-mem-un.sh --dry-run        只打印不实际执行
#   ./claude-mem-un.sh --help           显示帮助

set -uo pipefail

# ── 颜色 ─────────────────────────────────────────────
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
OK="${GREEN}✓${RESET}"; FAIL_S="${RED}✗${RESET}"
INFO="${BLUE}ℹ${RESET}"; WARN_S="${YELLOW}⚠${RESET}"

log()  { echo -e "$@"; }
ok()   { log "  ${OK} $*"; }
warn() { log "  ${WARN_S} ${YELLOW}$*${RESET}"; }
info() { log "  ${INFO} $*"; }
fail() { log "  ${FAIL_S} ${RED}$*${RESET}"; }
step() { echo; log "${BOLD}${BLUE}▶ $*${RESET}"; }

# ── 解析参数 ──────────────────────────────────────────
DRY_RUN=0
DATA_MODE="ask"  # ask | purge | keep
KILL_SHELLS=1    # 1 = 自动 SIGHUP 中毒 shell(默认);0 = 仅检测不杀

show_help() {
    cat <<EOF
${BOLD}claude-mem-un.sh${RESET} — 上游 claude-mem 完整卸载

用法:
  $(basename "$0") [选项]

选项:
  --purge          (默认行为)直接删 ~/.claude-mem/
  --keep-data      保留 ~/.claude-mem/
  --close-shells   (默认行为)检测到污染 shell 后自动 SIGHUP 关闭
  --keep-shells    仅检测不关闭(保守模式,适合担心活跃 vim/编辑器丢失的场景)
  --dry-run        只打印会做什么,不实际执行
  -h, --help       显示帮助

默认行为:
  • 直接删数据目录(备份已独立放在 ~/.claude-mem-uninstall-backup-<ts>/data/)
  • 自动关闭被污染的终端 shell(脚本自身进程链会被排除,绝不自杀)
保守需求请加 --keep-data 和/或 --keep-shells。
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge)        DATA_MODE="purge"; shift ;;
        --keep-data)    DATA_MODE="keep";  shift ;;
        --dry-run)      DRY_RUN=1; shift ;;
        --keep-shells)  KILL_SHELLS=0; shift ;;
        --close-shells) KILL_SHELLS=1; shift ;;
        -h|--help)      show_help; exit 0 ;;
        *) fail "未知参数:$1"; show_help; exit 2 ;;
    esac
done

# ── 工具函数 ──────────────────────────────────────────
run() {
    # 包一层,dry-run 时只打不跑
    if [[ $DRY_RUN -eq 1 ]]; then
        log "    ${DIM}[dry-run]${RESET} $*"
        return 0
    fi
    eval "$@"
}

safe_rm() {
    # 删文件 / 目录,但绝不跟软链(防止 ~/.claude-mem 是软链时连 fork 数据一起删)
    # 系统路径黑名单 + claude-mem 合法白名单(npm 全局 bin / node_modules 下的 claude-mem)
    local target="$1"
    [[ -z "$target" ]] && return 0
    case "$target" in
        # 白名单:这些是 npm i -g claude-mem 的合法残留位置,允许删
        */bin/claude-mem|*/lib/node_modules/claude-mem) ;;
        # 黑名单:绝不动的系统路径
        /|/usr|/etc|/etc/*|/var|/var/*|/bin|/sbin|/Users|/home|/usr/local|/usr/local/bin|/usr/local/lib|/usr/local/lib/node_modules)
            fail "拒绝删系统路径:$target"; return 1 ;;
    esac
    if [[ -L "$target" ]]; then
        run "rm -f \"$target\""
        DELETED_PATHS+=("$target (软链)")
    elif [[ -e "$target" ]]; then
        run "rm -rf \"$target\""
        DELETED_PATHS+=("$target")
    fi
}

backup_file() {
    # 原地备份 *.bak.<ts>;脚本末尾会把这些 .bak 移到 UNINSTALL_BACKUP_DIR/rc-backups/
    # dry-run 时不实际备份(但路径仍记入清单,方便预览)
    local f="$1"
    [[ ! -f "$f" ]] && return 0
    local dst="${f}.bak.${UNINSTALL_TS}"
    run "cp \"$f\" \"$dst\""
    info "已备份:$f → $dst"
    CREATED_BAK_FILES+=("$dst")
}

# 清掉 rc 文件里所有 CLAUDE_MEM_DATA_DIR 注册行(bash/zsh export + fish set -gx)
# 上游历史 install 版本会写,不清掉的话装 fork plus 后被 env 拽到错路径
clean_data_dir_env() {
    local rcfile="$1"
    [[ ! -f "$rcfile" ]] && return 0
    local pattern='^[[:space:]]*(export[[:space:]]+CLAUDE_MEM_DATA_DIR=|set[[:space:]]+-gx[[:space:]]+CLAUDE_MEM_DATA_DIR[[:space:]])'
    if ! grep -qE "$pattern" "$rcfile" 2>/dev/null; then
        return 0
    fi
    backup_file "$rcfile"
    if [[ $DRY_RUN -eq 0 ]]; then
        local tmp="${rcfile}.tmp.$$"
        grep -vE "$pattern" "$rcfile" > "$tmp" && mv "$tmp" "$rcfile"
    fi
    ok "已清 CLAUDE_MEM_DATA_DIR:$rcfile"
}

# 杀指向上游 ~/.claude-mem/chroma 的 chroma-mcp 僵尸进程
# fork plus 走 ~/.claude-mem-plus/chroma 或自定义路径,本脚本只清上游残留
kill_legacy_chroma_mcp() {
    if ! command -v pgrep >/dev/null 2>&1; then
        info "无 pgrep,跳过 chroma-mcp 清理"
        return 0
    fi
    # 用 ps 二次过滤排除 .claude-mem-plus(防误杀 fork chroma)
    local pids=()
    local pid
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        local cmd
        cmd=$(/bin/ps -o command= -p "$pid" 2>/dev/null || true)
        [[ -z "$cmd" ]] && continue
        # 匹配任何路径下的 claude-mem/chroma(home 默认 + 自定义路径如 ~/ai/claude-mem),
        # 但排除 claude-mem-plus 前缀(fork)
        case "$cmd" in
            *claude-mem-plus/*) ;;       # fork 的,不杀(任何路径)
            *claude-mem/chroma*) pids+=("$pid") ;;   # legacy(任何路径),杀
        esac
    done < <(pgrep -f 'chroma-mcp' 2>/dev/null)

    if [[ ${#pids[@]} -eq 0 ]]; then
        info "无 legacy chroma-mcp 僵尸"
        return 0
    fi
    run "kill -TERM ${pids[*]} 2>/dev/null || true"
    sleep 1
    # 兜底 SIGKILL(只对仍存活的)
    local still_alive=()
    for pid in "${pids[@]}"; do
        if /bin/kill -0 "$pid" 2>/dev/null; then
            still_alive+=("$pid")
        fi
    done
    if [[ ${#still_alive[@]} -gt 0 ]]; then
        run "kill -KILL ${still_alive[*]} 2>/dev/null || true"
    fi
    ok "已杀 ${#pids[@]} 个 legacy chroma-mcp 僵尸进程"
}

# 列出脚本自身的进程链(自己 + 所有祖先 PID),kill 时排除,绝不自杀
# 用法:_self_pid_chain → 输出多行 PID,从自己到 PID 1
_self_pid_chain() {
    local p="$$"
    local guard=0
    while [[ "$p" != "1" && "$p" != "0" && -n "$p" && $guard -lt 64 ]]; do
        echo "$p"
        p=$(/bin/ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
        guard=$((guard + 1))
    done
}

# 沿 PPID 链回溯,找最近的 user shell(zsh/bash/fish 等)
# 输入:任意 PID
# 输出:第一个遇到的 shell 进程 PID(最远祖先 shell);若沿途没遇到 shell,空
# 用例:claude PID → 找它的"父终端 shell",那个 shell 几乎确定被污染
_walk_to_ancestor_shell() {
    local p="$1"
    local guard=0
    local last_shell=""
    while [[ -n "$p" && "$p" != "1" && "$p" != "0" && $guard -lt 32 ]]; do
        local cmd
        cmd=$(/bin/ps -o comm= -p "$p" 2>/dev/null | tr -d ' ')
        case "$cmd" in
            zsh|-zsh|bash|-bash|fish|-fish|dash|-dash|ksh|-ksh|sh|-sh)
                last_shell="$p"
                ;;
        esac
        p=$(/bin/ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
        guard=$((guard + 1))
    done
    [[ -n "$last_shell" ]] && echo "$last_shell"
}

# 找所有跑 claude / claude-mem-plus / claude-mem(legacy)的进程,反推到它们的父 shell
# 这些 shell 几乎确定还残留 CLAUDE_MEM_DATA_DIR env(claude code 通常从带 env 的 shell 启)
# 把结果 PID 加进 CONTAMINATED_PIDS(去重 + 排除自己链)
_detect_claude_using_shells() {
    local claude_pids=()
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local p
        p=$(echo "$line" | awk '{print $1}')
        [[ -n "$p" ]] && claude_pids+=("$p")
    done < <(/bin/ps -axo pid=,command= 2>/dev/null \
        | grep -E '^[[:space:]]*[0-9]+[[:space:]]+(/[^ ]+/)?(claude|claude-mem|claude-mem-plus)([[:space:]]|$|--)')

    [[ ${#claude_pids[@]} -eq 0 ]] && return 0

    local pid shell_pid
    declare -A added=()
    # 把已在数组里的 PID 标记
    local p
    for p in "${CONTAMINATED_PIDS[@]}"; do
        added[$p]=1
    done

    for pid in "${claude_pids[@]}"; do
        # 排除自己链(自己跑的 claude / 父 shell 都不杀)
        case "$SELF_CHAIN_CSV" in
            *",$pid,"*) continue ;;
        esac
        shell_pid=$(_walk_to_ancestor_shell "$pid")
        [[ -z "$shell_pid" ]] && continue
        case "$SELF_CHAIN_CSV" in
            *",$shell_pid,"*) continue ;;
        esac
        if [[ -z "${added[$shell_pid]:-}" ]]; then
            CONTAMINATED_PIDS+=("$shell_pid")
            added[$shell_pid]=1
            local cmd_summary
            cmd_summary=$(/bin/ps -o command= -p "$pid" 2>/dev/null | head -c 80)
            warn "  • PID $shell_pid: 父进程链含 claude (PID $pid: $cmd_summary)"
        fi
    done
}

# 检测被污染的终端 shell 进程(env 里仍残留 CLAUDE_MEM_DATA_DIR)
# 工作原理:
#   - 优先用 /bin/ps -E -ww 读 env(macOS / Linux 通常都能读自己用户的进程 env)
#   - 拿不到 env 时退回到"列出所有当前用户的交互 shell",让用户自己排查
# 调用约定:
#   - 把命中的 PID 写到全局数组 CONTAMINATED_PIDS(供 close_contaminated_shells 用)
#   - 把脚本自身进程链放到 SELF_CHAIN 字典里(防自杀)
declare -a CONTAMINATED_PIDS=()
declare SELF_CHAIN_CSV=""
detect_contaminated_shells() {
    CONTAMINATED_PIDS=()
    SELF_CHAIN_CSV=",$(_self_pid_chain | tr '\n' ',')"

    local self_user
    self_user=$(id -un 2>/dev/null)
    [[ -z "$self_user" ]] && return 0

    # 列所有当前用户的交互 shell 进程
    local shell_pids=()
    local pid comm
    while IFS=$'\t' read -r pid comm; do
        case "$comm" in
            zsh|-zsh|bash|-bash|fish|-fish|dash|-dash|ksh|-ksh|sh|-sh)
                # 排除自己 + 祖先(防自杀)
                case "$SELF_CHAIN_CSV" in
                    *",$pid,"*) continue ;;
                esac
                shell_pids+=("$pid")
                ;;
        esac
    done < <(/bin/ps -axo user=,pid=,comm= 2>/dev/null \
        | awk -v u="$self_user" '$1 == u { printf "%s\t", $2; for (i=3; i<=NF; i++) printf "%s%s", $i, (i==NF?"":" "); print "" }')

    if [[ ${#shell_pids[@]} -eq 0 ]]; then
        return 0
    fi

    # Pass 1:用 ps -E 精确读 env
    local contaminated=()
    local env_dump
    for pid in "${shell_pids[@]}"; do
        env_dump=$(/bin/ps -E -ww -p "$pid" 2>/dev/null \
            | tr ' ' '\n' \
            | grep -E '^CLAUDE_MEM_DATA_DIR=' \
            | head -1 || true)
        if [[ -n "$env_dump" ]]; then
            contaminated+=("$pid|$env_dump")
            CONTAMINATED_PIDS+=("$pid")
        fi
    done

    if [[ ${#contaminated[@]} -gt 0 ]]; then
        warn ""
        warn "Pass 1(env 精确命中):${#contaminated[@]} 个 shell 残留 CLAUDE_MEM_DATA_DIR env"
        local item pid_only cmd
        for item in "${contaminated[@]}"; do
            pid_only="${item%%|*}"
            cmd=$(/bin/ps -o command= -p "$pid_only" 2>/dev/null | head -c 100)
            warn "  • PID $pid_only: ${item#*|}"
            warn "    cmd: $cmd"
        done
    fi

    # Pass 1.5:不靠 env,直接找跑 claude / claude-mem-plus 的进程,反推它们的父 shell
    # 这些 shell 几乎确定也被污染(macOS SIP 读不到 env 时这是唯一可靠 signal)
    local before_count=${#CONTAMINATED_PIDS[@]}
    warn ""
    warn "Pass 1.5(claude 子进程反推父 shell):"
    _detect_claude_using_shells
    local added_by_15=$(( ${#CONTAMINATED_PIDS[@]} - before_count ))
    if [[ "$added_by_15" -eq 0 ]]; then
        warn "  (无 claude / claude-mem-plus 进程在跑)"
    fi

    if [[ ${#contaminated[@]} -eq 0 && "$added_by_15" -eq 0 ]]; then
        # Pass 2:env 读不到 + 没有 claude 在跑,只能列所有 user shell 让用户排查
        warn ""
        warn "Pass 2(fallback):无法精确判断,列出所有当前用户的交互 shell:"
        for pid in "${shell_pids[@]}"; do
            local pinfo
            pinfo=$(/bin/ps -o pid=,tty=,etime=,command= -p "$pid" 2>/dev/null | awk '{$1=$1; print}')
            [[ -n "$pinfo" ]] && warn "  • $pinfo"
        done
    fi
}

# 关闭被检测到的污染 shell 进程
# - 先 SIGHUP(温和,shell 走 logout 流程)
# - 兜底 SIGKILL
# - 每个 PID 都打印关闭提醒(PID + cmd)
close_contaminated_shells() {
    if [[ ${#CONTAMINATED_PIDS[@]} -eq 0 ]]; then
        return 0
    fi
    if [[ "$KILL_SHELLS" -eq 0 ]]; then
        warn ""
        warn "--keep-shells 已开,跳过自动关闭。手动修复:"
        warn "  • kill -HUP <PID>(关 shell 进程)"
        warn "  • 或关闭终端窗口 / unset CLAUDE_MEM_DATA_DIR"
        return 0
    fi

    echo
    log "${BOLD}${BLUE}▶ 自动关闭污染 shell(SIGHUP)${RESET}"
    log "${DIM}  默认行为:--keep-shells 反向开关可保留${RESET}"

    local pid tty etime cmd
    local closed_count=0
    for pid in "${CONTAMINATED_PIDS[@]}"; do
        # 一次性读 tty / etime / command,提醒里全显示
        local pinfo
        pinfo=$(/bin/ps -o tty=,etime=,command= -p "$pid" 2>/dev/null | awk '{tty=$1; et=$2; $1=$2=""; sub(/^[ \t]+/,""); cmd=$0; printf "%s\t%s\t%s", tty, et, cmd}')
        tty=$(echo "$pinfo" | awk -F'\t' '{print $1}')
        etime=$(echo "$pinfo" | awk -F'\t' '{print $2}')
        cmd=$(echo "$pinfo" | awk -F'\t' '{print $3}' | head -c 80)

        if [[ $DRY_RUN -eq 1 ]]; then
            log "    ${DIM}[dry-run]${RESET} kill -HUP $pid  (tty=$tty  etime=$etime  cmd: $cmd)"
            continue
        fi
        if /bin/kill -0 "$pid" 2>/dev/null; then
            if kill -HUP "$pid" 2>/dev/null; then
                ok "已关闭 PID $pid  ${BOLD}(tty=$tty)${RESET}  etime=$etime"
                log "         cmd: $cmd"
                closed_count=$((closed_count + 1))
            else
                warn "SIGHUP 失败:PID $pid (tty=$tty)"
            fi
        else
            info "PID $pid 已不存在(同名其他进程结束)"
        fi
    done

    # 等 1s 让 shell 走 logout 流程,再 SIGKILL 兜底
    [[ $DRY_RUN -eq 0 ]] && sleep 1

    local still=()
    for pid in "${CONTAMINATED_PIDS[@]}"; do
        if [[ $DRY_RUN -eq 0 ]] && /bin/kill -0 "$pid" 2>/dev/null; then
            still+=("$pid")
        fi
    done
    if [[ ${#still[@]} -gt 0 ]]; then
        warn "${#still[@]} 个 shell 没响应 SIGHUP,SIGKILL 兜底"
        for pid in "${still[@]}"; do
            kill -KILL "$pid" 2>/dev/null && warn "  已 SIGKILL PID $pid"
        done
    fi

    # 汇总(仅实跑模式打印)
    if [[ $DRY_RUN -eq 0 ]]; then
        echo
        log "${BOLD}${GREEN}━━ 已关闭 ${#CONTAMINATED_PIDS[@]} 个污染 shell ━━${RESET}"
        log "${DIM}  → 这些终端窗口里跑的 claude / 其他子进程会随之退出${RESET}"
    fi
    warn ""
    warn "提醒:刚关闭的终端窗口里如有未保存的工作(vim/编辑器/正在跑的命令),"
    warn "      可能已丢失。重新打开终端继续。"
}

jq_edit() {
    # jq_edit <file> <jq filter>
    # 先备份,再原子写回(写到 tmp 再 mv)
    local f="$1" filter="$2"
    [[ ! -f "$f" ]] && return 0
    if ! command -v jq >/dev/null 2>&1; then
        warn "jq 未安装,跳过 $f 的 JSON 编辑(请手动清理或装 jq)"
        return 0
    fi
    backup_file "$f"
    local tmp="${f}.tmp.$$"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "    ${DIM}[dry-run]${RESET} jq '$filter' \"$f\""
        return 0
    fi
    if jq "$filter" "$f" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$f"
        ok "已更新:$f"
    else
        rm -f "$tmp"
        warn "jq 编辑失败:$f(filter=$filter)"
    fi
}

# ── 独立备份目录 + 清单追踪 ────────────────────────────
# 备份目录放在 home 下(独立于被删的 ~/.claude-mem),--purge 模式不会丢
# CREATED_BAK_FILES:backup_file 创建的所有 *.bak.<ts>(脚本末尾归集到 UNINSTALL_BACKUP_DIR)
# DELETED_PATHS / KEPT_PATHS:safe_rm / decide_purge 经过的路径,末尾打印清单
#
# 共用 backup root:被 install-client.sh uninstall 调用时,父脚本会 export 这两个 env;
# 单跑本脚本则使用默认值
UNINSTALL_TS="${UNINSTALL_TS:-$(date +%Y%m%d_%H%M%S)}"
UNINSTALL_BACKUP_DIR="${UNINSTALL_BACKUP_DIR:-$HOME/.claude-mem-uninstall-backup-${UNINSTALL_TS}}"
declare -a CREATED_BAK_FILES=()
declare -a DELETED_PATHS=()
declare -a KEPT_PATHS=()
declare -a BACKED_UP_DATA=()

# ── banner ────────────────────────────────────────────
log "${BOLD}claude-mem-un.sh — 上游 claude-mem 完整卸载${RESET}"
log "${DIM}基于 thedotmack/claude-mem 实测改动 + 源码静态分析,覆盖所有已知 install 副作用${RESET}"
log "${DIM}独立备份目录:${UNINSTALL_BACKUP_DIR}${RESET}"
[[ $DRY_RUN -eq 1 ]] && log "${YELLOW}[DRY-RUN] 不会实际修改任何文件${RESET}"

# ── 1. 停 worker ──────────────────────────────────────
step "1/9  停止 worker / 后台进程"
if command -v claude-mem >/dev/null 2>&1; then
    run "claude-mem stop >/dev/null 2>&1 || true"
    ok "claude-mem stop 已尝试"
else
    info "未发现 claude-mem 命令(可能已被卸载或 PATH 不含 npm bin)"
fi
# 兜底:pkill 任何 worker-service.cjs(thedotmack/claude-mem 才会有这名字)
if pgrep -f 'worker-service\.cjs' >/dev/null 2>&1; then
    run "pkill -f 'worker-service\\.cjs' || true"
    ok "已 pkill worker-service.cjs"
else
    info "无残留 worker-service.cjs 进程"
fi

# 杀 legacy chroma-mcp 僵尸(指向 ~/.claude-mem/chroma,排除 fork plus)
kill_legacy_chroma_mcp

# ── 2. npm 全局包 ─────────────────────────────────────
step "2/9  卸载 npm 全局包 claude-mem"
if command -v npm >/dev/null 2>&1; then
    if npm ls -g --depth=0 2>/dev/null | grep -q ' claude-mem@'; then
        run "npm uninstall -g claude-mem 2>/dev/null || true"
        ok "npm uninstall -g claude-mem 完成"
    else
        info "npm 全局未安装 claude-mem"
    fi
    # 兜底:有时 npm uninstall 后还有残链(POSIX 上 readlink 不带 -e,直接判 -L)
    NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo '')"
    if [[ -n "$NPM_PREFIX" ]]; then
        for residual in \
            "$NPM_PREFIX/bin/claude-mem" \
            "$NPM_PREFIX/lib/node_modules/claude-mem"; do
            if [[ -L "$residual" || -e "$residual" ]]; then
                if safe_rm "$residual"; then
                    ok "已清残留:$residual"
                fi
            fi
        done
    fi
else
    warn "未找到 npm,跳过 npm uninstall(可能用 bun/pnpm 装的,需手动卸)"
fi

# ── 3. claude-code 插件目录 + cache ───────────────────
step "3/9  清理 claude-code 插件目录"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

MARKETPLACE_DIR="$CLAUDE_DIR/plugins/marketplaces/thedotmack"
PLUGIN_CACHE_DIR="$CLAUDE_DIR/plugins/cache/thedotmack/claude-mem"
PLUGIN_CACHE_PARENT="$CLAUDE_DIR/plugins/cache/thedotmack"
PLUGIN_DATA_DIR="$CLAUDE_DIR/plugins/data/claude-mem-thedotmack"

for d in "$MARKETPLACE_DIR" "$PLUGIN_CACHE_DIR" "$PLUGIN_DATA_DIR"; do
    if [[ -e "$d" || -L "$d" ]]; then
        safe_rm "$d"
        ok "已删:$d"
    else
        info "不存在:$d"
    fi
done

# cache 父目录若空就删
if [[ -d "$PLUGIN_CACHE_PARENT" ]] && [[ -z "$(ls -A "$PLUGIN_CACHE_PARENT" 2>/dev/null || true)" ]]; then
    safe_rm "$PLUGIN_CACHE_PARENT"
    ok "已删空目录:$PLUGIN_CACHE_PARENT"
fi

# ── 4. claude-code 插件注册表 + settings.json ─────────
step "4/9  清理 claude-code 配置(JSON 安全编辑)"

CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"
KNOWN_MKT="$CLAUDE_DIR/plugins/known_marketplaces.json"
INSTALLED_PLUGINS="$CLAUDE_DIR/plugins/installed_plugins.json"

# settings.json:删 enabledPlugins['claude-mem@thedotmack']
jq_edit "$CLAUDE_SETTINGS" \
    'if .enabledPlugins then .enabledPlugins |= del(."claude-mem@thedotmack") else . end'

# known_marketplaces.json:删 thedotmack key
jq_edit "$KNOWN_MKT" 'del(.thedotmack)'

# installed_plugins.json:删 plugins['claude-mem@thedotmack']
jq_edit "$INSTALLED_PLUGINS" \
    'if .plugins then .plugins |= del(."claude-mem@thedotmack") else . end'

# ~/.claude.json(MCP 配置):删 mcpServers.claude-mem(若上游某 IDE 注册到这里)
CLAUDE_JSON="$HOME/.claude.json"
jq_edit "$CLAUDE_JSON" \
    'if .mcpServers then .mcpServers |= del(."claude-mem") else . end'

# ── 4b. 兜底清 ~/.claude.json 里所有上游 claude-mem 命名空间 key ─────
# 用 jq walk 递归扫所有 section(skillUsage / commands / hooks / 等),
# 删任何 key 以 'claude-mem:' 或 'claude-mem@' 开头 *且不带 -plus*(只清上游,不碰 fork plus)
# 跟 jq_edit step 4 的精确删除互补:这里覆盖任何 Claude Code 自己写的命名空间统计
if [[ -f "$CLAUDE_JSON" ]] && command -v jq >/dev/null 2>&1; then
    has=$(jq -r '
        any(.. | objects | keys[]?; test("^claude-mem([:@]|$)"))
        | if . then "yes" else "no" end
    ' "$CLAUDE_JSON" 2>/dev/null)
    if [[ "$has" == "yes" ]]; then
        backup_file "$CLAUDE_JSON"
        if [[ $DRY_RUN -eq 1 ]]; then
            log "    ${DIM}[dry-run]${RESET} jq walk del .claude.json claude-mem(:|@) 命名空间 key"
        else
            tmp="${CLAUDE_JSON}.tmp.$$"
            if jq '
                walk(
                    if type == "object"
                    then with_entries(select(.key | test("^claude-mem([:@]|$)") | not))
                    else . end
                )
            ' "$CLAUDE_JSON" > "$tmp" 2>/dev/null; then
                mv "$tmp" "$CLAUDE_JSON"
                ok "已清 ~/.claude.json 里所有 claude-mem(:|@) 上游命名空间 key"
            else
                rm -f "$tmp"
                warn "jq walk 编辑失败:$CLAUDE_JSON"
            fi
        fi
    fi
fi

# ── 5. npx / mcp-logs / shell alias 残留 ───────────────
step "5/9  清理 npx 残留 / mcp 日志 / shell alias"

# ~/.npm/_npx/<hash>/node_modules/claude-mem/
NPX_ROOT="$HOME/.npm/_npx"
if [[ -d "$NPX_ROOT" ]]; then
    while IFS= read -r -d '' candidate; do
        safe_rm "$candidate"
        ok "已删 npx 残留:$candidate"
    done < <(find "$NPX_ROOT" -mindepth 3 -maxdepth 3 -type d -name claude-mem -print0 2>/dev/null)
fi

# ~/.cache/claude-cli-nodejs/*/mcp-logs-plugin-claude-mem-*
MCP_LOG_ROOT="$HOME/.cache/claude-cli-nodejs"
if [[ -d "$MCP_LOG_ROOT" ]]; then
    while IFS= read -r -d '' candidate; do
        safe_rm "$candidate"
        ok "已删 mcp 日志:$candidate"
    done < <(find "$MCP_LOG_ROOT" -mindepth 2 -maxdepth 2 -type d -name 'mcp-logs-plugin-claude-mem-*' -print0 2>/dev/null)
fi

# shell alias(uninstall.ts 里有同样的逻辑)
for rcfile in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; do
    [[ ! -f "$rcfile" ]] && continue
    if grep -qE '^[[:space:]]*alias[[:space:]]+claude-mem[[:space:]]*=' "$rcfile" 2>/dev/null; then
        backup_file "$rcfile"
        if [[ $DRY_RUN -eq 0 ]]; then
            tmp="${rcfile}.tmp.$$"
            grep -vE '^[[:space:]]*alias[[:space:]]+claude-mem[[:space:]]*=' "$rcfile" > "$tmp" \
                && mv "$tmp" "$rcfile"
        fi
        ok "已清 alias:$rcfile"
    fi
done

# claude-code PATH 注册块(install.ts:applyClaudeCodePathSetupIfNeeded 写入)
# 标记:`# Added by claude-mem installer for Claude Code` + 紧接的一行 export PATH
# 删法:用 awk 跳过标记行 + 下一行;同时也尝试清掉标记行前面的空行(install 写入时
#       会在 block 前加换行,留空行不好看)
PATH_MARKER="Added by claude-mem installer for Claude Code"
for rcfile in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.config/fish/config.fish"; do
    [[ ! -f "$rcfile" ]] && continue
    if grep -qF "$PATH_MARKER" "$rcfile" 2>/dev/null; then
        backup_file "$rcfile"
        if [[ $DRY_RUN -eq 0 ]]; then
            tmp="${rcfile}.tmp.$$"
            awk -v marker="$PATH_MARKER" '
                /^[[:space:]]*#.*Added by claude-mem installer for Claude Code/ {
                    # 标记注释行:跳过自己 + 下一行(export PATH 行)
                    skip = 2
                    # 同时回退最后一个空行(install 写入时 block 前可能加了换行)
                    if (last_blank) { delete buf[last_blank]; last_blank = 0 }
                    next
                }
                skip > 0 { skip--; next }
                {
                    if ($0 ~ /^[[:space:]]*$/) { last_blank = NR }
                    else { last_blank = 0 }
                    buf[NR] = $0
                }
                END {
                    for (i = 1; i <= NR; i++) if (i in buf) print buf[i]
                }
            ' "$rcfile" > "$tmp" && mv "$tmp" "$rcfile"
        fi
        ok "已清 claude-code PATH 注册块:$rcfile"
    fi
done

# 清 CLAUDE_MEM_DATA_DIR 注册(.zshenv 是上游历史最常写的位置,本脚本必扫)
# 漏掉这一步是 docker-less 机器上"卸了上游再装 fork plus,数据目录被 env 拽到错路径"的根因
for rcfile in "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.zprofile" \
              "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" \
              "$HOME/.config/fish/config.fish"; do
    clean_data_dir_env "$rcfile"
done

# ── 6. 其它 IDE 集成 ───────────────────────────────────
step "6/9  清理其它 IDE 集成(若装过)"

# Gemini CLI
GEMINI_SETTINGS="$HOME/.gemini/settings.json"
if [[ -f "$GEMINI_SETTINGS" ]]; then
    # 删 hooks 里 command 含 worker-service.cjs 且 gemini-cli 的项
    jq_edit "$GEMINI_SETTINGS" '
        if .hooks then
          .hooks |= with_entries(
            .value |= map(select(
              (.command // "" | test("worker-service") | not)
              or (.command // "" | test("gemini-cli") | not)
            ))
          )
        else . end
    '
fi

# Cursor
CURSOR_HOOKS="$HOME/.cursor/hooks.json"
CURSOR_MCP="$HOME/.cursor/mcp.json"
if [[ -f "$CURSOR_HOOKS" ]]; then
    jq_edit "$CURSOR_HOOKS" '
        if .hooks then
          .hooks |= with_entries(
            .value |= map(select((.command // "" | test("worker-service|claude-mem") | not)))
          )
        else . end
    '
fi
if [[ -f "$CURSOR_MCP" ]]; then
    jq_edit "$CURSOR_MCP" '
        if .mcpServers then .mcpServers |= del(."claude-mem") else . end
    '
fi

# Windsurf
WINDSURF_HOOKS="$HOME/.codeium/windsurf/hooks.json"
if [[ -f "$WINDSURF_HOOKS" ]]; then
    jq_edit "$WINDSURF_HOOKS" '
        if type == "object" then
          to_entries
          | map(.value |= (if type=="array" then
              map(select((.command // "" | test("worker-service|claude-mem") | not)))
            else . end))
          | from_entries
        else . end
    '
fi

# OpenCode
OPENCODE_PLUGIN="$HOME/.config/opencode/plugins/claude-mem.js"
if [[ -e "$OPENCODE_PLUGIN" || -L "$OPENCODE_PLUGIN" ]]; then
    safe_rm "$OPENCODE_PLUGIN" && ok "已删:$OPENCODE_PLUGIN"
fi

# OpenClaw
OPENCLAW_CFG="$HOME/.openclaw/openclaw.json"
OPENCLAW_EXT="$HOME/.openclaw/extensions/claude-mem"
if [[ -f "$OPENCLAW_CFG" ]]; then
    jq_edit "$OPENCLAW_CFG" '
        if .extensions then .extensions |= del(."claude-mem") else . end
    '
fi
if [[ -d "$OPENCLAW_EXT" ]]; then
    safe_rm "$OPENCLAW_EXT" && ok "已删:$OPENCLAW_EXT"
fi

# 其它 MCP 集成(McpIntegrations.ts 里的 IDE)
for mcp_path in \
    "$HOME/.github/copilot/mcp.json" \
    "$HOME/.gemini/antigravity/mcp_config.json" \
    "$HOME/.warp/mcp.json"; do
    if [[ -f "$mcp_path" ]]; then
        jq_edit "$mcp_path" '
            if .mcpServers then .mcpServers |= del(."claude-mem") else . end
        '
    fi
done

# Goose 用 yaml,jq 不能直接编辑;只警告
GOOSE_CFG="$HOME/.config/goose/config.yaml"
if [[ -f "$GOOSE_CFG" ]] && grep -q 'claude-mem' "$GOOSE_CFG" 2>/dev/null; then
    warn "$GOOSE_CFG 含 claude-mem 段(yaml,本脚本不动);手动编辑或运行:claude-mem 卸载前用对应集成 uninstall"
fi

# Codex / Gemini MD 段落清理(用 sed 边界清,标记是 install.ts 写入的固定文案)
for md in "$HOME/.gemini/GEMINI.md" "$HOME/.codex/AGENTS.md" "$HOME/.config/opencode/AGENTS.md"; do
    if [[ -f "$md" ]] && grep -q 'claude-mem' "$md" 2>/dev/null; then
        backup_file "$md"
        if [[ $DRY_RUN -eq 0 ]]; then
            # 删 <!-- claude-mem:start --> 到 <!-- claude-mem:end --> 之间(若有标记);
            # 没有标记时只保留警告,让用户自己清,避免误伤
            if grep -q 'claude-mem:start' "$md" 2>/dev/null; then
                # POSIX sed:macOS / Linux 都用 -i '' 形式,但 Linux 不接受空字符串参数
                # 兜底:写到 tmp 再 mv
                tmp="${md}.tmp.$$"
                awk '
                    /claude-mem:start/ {skip=1}
                    !skip {print}
                    /claude-mem:end/ {skip=0}
                ' "$md" > "$tmp" && mv "$tmp" "$md"
                ok "已清 claude-mem 段:$md"
            else
                warn "$md 含 claude-mem 文案但无明确标记,请手动检查"
            fi
        fi
    fi
done

# ── 7. 处理 ~/.claude-mem 数据目录 ────────────────────
step "7/9  处理数据目录 ~/.claude-mem(先备份再处理)"

DATA_DIR="$HOME/.claude-mem"
DATA_DIR_LINK_TARGET=""
DATA_DIR_REAL=""  # 真实数据所在(软链解析后)

if [[ -L "$DATA_DIR" ]]; then
    # 软链:不能跟过去,可能指向 fork 真目录
    DATA_DIR_LINK_TARGET="$(readlink "$DATA_DIR" 2>/dev/null || true)"
    # 解析相对软链
    if [[ -n "$DATA_DIR_LINK_TARGET" && "$DATA_DIR_LINK_TARGET" != /* ]]; then
        DATA_DIR_REAL="$(cd "$(dirname "$DATA_DIR")" && cd "$(dirname "$DATA_DIR_LINK_TARGET")" 2>/dev/null && pwd)/$(basename "$DATA_DIR_LINK_TARGET")"
    else
        DATA_DIR_REAL="$DATA_DIR_LINK_TARGET"
    fi
    warn "$DATA_DIR 是软链 → $DATA_DIR_LINK_TARGET"
    warn "本脚本只会删软链文件本身,绝不跟过去"
elif [[ -d "$DATA_DIR" ]]; then
    DATA_DIR_REAL="$DATA_DIR"
fi

# 7a) 数据备份:把 db/chroma/settings 等关键文件 cp 到 UNINSTALL_BACKUP_DIR/data/
#     备份目录在 home 下,独立于被删的 ~/.claude-mem,--purge 也不会丢
#     与旧版区别:旧版备份在 $data_real/.pre-uninstall-backup-<ts>/(--purge 会跟着删)
backup_data_dir() {
    local data_real="$1"
    [[ -z "$data_real" || ! -d "$data_real" ]] && return 0

    local backup_data_dir="$UNINSTALL_BACKUP_DIR/data"
    if [[ $DRY_RUN -eq 1 ]]; then
        log "    ${DIM}[dry-run]${RESET} 备份 db/chroma/settings → $backup_data_dir"
        BACKED_UP_DATA+=("$data_real → $backup_data_dir (dry-run)")
        return 0
    fi

    mkdir -p "$backup_data_dir" 2>/dev/null || { warn "无法创建 $backup_data_dir,跳过备份"; return 0; }
    local backed=0 f
    for f in claude-mem.db claude-mem.db-wal claude-mem.db-shm \
             settings.json chroma-sync-state.json supervisor.json \
             transcript-watch.json; do
        if [[ -f "$data_real/$f" ]]; then
            cp "$data_real/$f" "$backup_data_dir/" 2>/dev/null && backed=$((backed + 1))
        fi
    done
    if [[ -d "$data_real/chroma" ]]; then
        cp -R "$data_real/chroma" "$backup_data_dir/" 2>/dev/null && backed=$((backed + 1))
    fi
    # 历史 .pre-uninstall-backup-* / .pre-fork-backup-* 子目录也带上(不漏更早期备份)
    local sub
    for sub in "$data_real"/.pre-uninstall-backup-* "$data_real"/.pre-fork-backup-*; do
        if [[ -d "$sub" ]]; then
            cp -R "$sub" "$backup_data_dir/" 2>/dev/null && backed=$((backed + 1))
        fi
    done
    if [[ "$backed" -eq 0 ]]; then
        rmdir "$backup_data_dir" 2>/dev/null
        info "$data_real 没有可备份内容(空目录)"
    else
        ok "备份 $backed 项 → $backup_data_dir"
        BACKED_UP_DATA+=("$data_real → $backup_data_dir ($backed 项)")
    fi
}

if [[ -n "$DATA_DIR_REAL" ]]; then
    backup_data_dir "$DATA_DIR_REAL"
fi

# 7b) 删 / 留 — 默认无脑删(备份已独立放在 UNINSTALL_BACKUP_DIR/data/)
#     --keep-data: 保留
#     --purge / 默认 / ask: 一律直接删,不再询问
decide_purge() {
    case "$DATA_MODE" in
        keep)
            KEPT_PATHS+=("$DATA_DIR (--keep-data)")
            return 1
            ;;
        *)
            # purge / ask 都走"直接删"
            if [[ ! -e "$DATA_DIR" && ! -L "$DATA_DIR" ]]; then
                return 1
            fi
            return 0
            ;;
    esac
}

if [[ -e "$DATA_DIR" || -L "$DATA_DIR" ]]; then
    if decide_purge; then
        if [[ -L "$DATA_DIR" ]]; then
            run "rm -f \"$DATA_DIR\""
            DELETED_PATHS+=("$DATA_DIR (软链 → $DATA_DIR_LINK_TARGET 保留)")
            ok "已删软链:$DATA_DIR(目标 $DATA_DIR_LINK_TARGET 保留)"
        else
            safe_rm "$DATA_DIR"
            ok "已删数据目录:$DATA_DIR(备份在 $UNINSTALL_BACKUP_DIR/data/,可放心删)"
        fi
    else
        info "保留数据目录:$DATA_DIR"
    fi
else
    info "数据目录 $DATA_DIR 不存在,跳过"
fi

# ── 8. Docker 资源清理 ────────────────────────────────
# 范围:image 名含 'claude-mem' 但不含 'claude-mem-plus' 的容器和镜像
# 覆盖:claude-mem-upstream-probe(探测镜像)、claude-mem:basic(老 fork tag)、上游 docker 部署
# 不动:claude-mem-plus:*(fork harness,由 install-client.sh uninstall 处理)
step "8/9  Docker 资源清理(image 名含 claude-mem 但不含 claude-mem-plus)"

if ! command -v docker >/dev/null 2>&1; then
    info "docker 不可用,跳过"
else
    # 8a) 容器:先列所有,再 grep image 名
    local_containers=""
    while IFS=$'\t' read -r cid img; do
        [[ -z "$cid" ]] && continue
        case "$img" in
            *claude-mem-plus*) ;;     # 跳过 fork harness
            *claude-mem*) local_containers+="$cid "; info "容器 $cid (image=$img)" ;;
        esac
    done < <(docker ps -a --format '{{.ID}}\t{{.Image}}' 2>/dev/null)

    if [[ -n "$local_containers" ]]; then
        run "docker stop $local_containers >/dev/null 2>&1 || true"
        run "docker rm -f $local_containers >/dev/null 2>&1 || true"
        ok "停 + 删容器完成"
    else
        info "无 claude-mem 相关容器(image 不含 claude-mem-plus)"
    fi

    # 8b) 镜像:repo:tag 名含 claude-mem 但不含 claude-mem-plus
    local_images=""
    while IFS= read -r img; do
        [[ -z "$img" || "$img" == "<none>:<none>" ]] && continue
        case "$img" in
            *claude-mem-plus*) ;;
            *claude-mem*) local_images+="$img "; info "镜像 $img" ;;
        esac
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)

    if [[ -n "$local_images" ]]; then
        run "docker rmi -f $local_images >/dev/null 2>&1 || true"
        ok "删镜像完成"
    else
        info "无 claude-mem 相关镜像"
    fi
fi

# ── 9. 归集 *.bak.<ts> + 打印清单 ─────────────────────
step "9/9  归集备份 + 清单"

# 9a) 把所有 backup_file 创建的 *.bak.<ts> 从原位 mv 到独立备份目录
#     好处:rc 文件附近不留垃圾,所有备份集中在一处
if [[ ${#CREATED_BAK_FILES[@]} -gt 0 ]]; then
    if [[ $DRY_RUN -eq 0 ]]; then
        mkdir -p "$UNINSTALL_BACKUP_DIR/rc-backups" 2>/dev/null
    fi
    for bak in "${CREATED_BAK_FILES[@]}"; do
        if [[ $DRY_RUN -eq 1 ]]; then
            log "    ${DIM}[dry-run]${RESET} mv \"$bak\" \"$UNINSTALL_BACKUP_DIR/rc-backups/\""
            continue
        fi
        [[ -f "$bak" ]] || continue
        # 用 basename 作目标名(原路径里有 / 不能直接当文件名),前缀加目录名防冲突
        local_dst_name="$(echo "$bak" | sed -e 's|^/||' -e 's|/|__|g')"
        mv "$bak" "$UNINSTALL_BACKUP_DIR/rc-backups/$local_dst_name" 2>/dev/null || true
    done
    ok "rc 备份归集 ${#CREATED_BAK_FILES[@]} 项 → $UNINSTALL_BACKUP_DIR/rc-backups/"
fi

# 9b) 打印明确清单:备份在哪、删了什么、留了什么
echo
log "${BOLD}━━━ 卸载清单 ━━━${RESET}"

if [[ ${#BACKED_UP_DATA[@]} -gt 0 ]]; then
    log "${BOLD}${GREEN}[备份]${RESET} 数据目录(SQLite + chroma + 历史 backups):"
    for item in "${BACKED_UP_DATA[@]}"; do
        log "  • $item"
    done
fi

if [[ ${#CREATED_BAK_FILES[@]} -gt 0 ]]; then
    log "${BOLD}${GREEN}[备份]${RESET} rc 配置文件 ${#CREATED_BAK_FILES[@]} 份 → ${UNINSTALL_BACKUP_DIR}/rc-backups/"
fi

if [[ ${#DELETED_PATHS[@]} -gt 0 ]]; then
    log "${BOLD}${RED}[已删]${RESET} ${#DELETED_PATHS[@]} 项:"
    for item in "${DELETED_PATHS[@]}"; do
        log "  • $item"
    done
fi

if [[ ${#KEPT_PATHS[@]} -gt 0 ]]; then
    log "${BOLD}${YELLOW}[保留]${RESET} ${#KEPT_PATHS[@]} 项:"
    for item in "${KEPT_PATHS[@]}"; do
        log "  • $item"
    done
fi

# 备份目录可能没建出来(整个流程没有任何 backup 发生)
if [[ -d "$UNINSTALL_BACKUP_DIR" ]] || [[ $DRY_RUN -eq 1 && (${#BACKED_UP_DATA[@]} -gt 0 || ${#CREATED_BAK_FILES[@]} -gt 0) ]]; then
    echo
    log "${BOLD}独立备份根目录:${RESET} ${UNINSTALL_BACKUP_DIR}"
    if [[ $DRY_RUN -eq 0 && -d "$UNINSTALL_BACKUP_DIR" ]] && command -v du >/dev/null 2>&1; then
        local_total=$(/usr/bin/du -sh "$UNINSTALL_BACKUP_DIR" 2>/dev/null | awk '{print $1}')
        [[ -n "$local_total" ]] && log "${DIM}  总大小: $local_total${RESET}"
    fi
    log "${DIM}  确认无误后可整目录删:rm -rf \"$UNINSTALL_BACKUP_DIR\"${RESET}"
fi

# 9c) 检测被污染的终端 shell(rc 已清,但已打开的 shell 进程仍残留旧 env)
# 默认还会自动 SIGHUP 关闭(--keep-shells 保留只检测)
detect_contaminated_shells
close_contaminated_shells

echo
if [[ $DRY_RUN -eq 1 ]]; then
    log "${YELLOW}DRY-RUN 完成,以上为将要执行的操作${RESET}"
else
    log "${BOLD}${GREEN}claude-mem 卸载完成。${RESET}"
fi

log "${DIM}如发现遗漏,请检查:${RESET}"
log "${DIM}  - 任何 ~/.* 路径下含 'claude-mem' 但本脚本未涵盖的自定义集成${RESET}"
log "${DIM}  - bun / pnpm 的全局包列表(本脚本只处理 npm)${RESET}"
