#!/usr/bin/env bash
# 容器内探测脚本:
#   1. snapshot 关键路径文件清单(before)
#   2. npm i -g claude-mem-plus
#   3. 非交互跑 claude-mem-plus install --ide claude-code 触发副作用
#   4. snapshot 同样的关键路径(after)
#   5. diff 出新增/修改的文件
#
# 输出:
#   /probe/out/before.txt
#   /probe/out/after.txt
#   /probe/out/diff.txt          # 给 host 抓走的最终清单
#   /probe/out/install.log
set -uo pipefail

OUT=/probe/out
mkdir -p "$OUT"

WATCH_PATHS=(
    "$HOME/.claude"
    "$HOME/.claude.json"
    "$HOME/.claude-mem-plus"
    "$HOME/.gemini"
    "$HOME/.codex"
    "$HOME/.cursor"
    "$HOME/.codeium"
    "$HOME/.config/opencode"
    "$HOME/.openclaw"
    "$HOME/.bun"
    "$HOME/.local/share/uv"
    "$HOME/.cache"
    "/usr/local/bin"
    "/usr/local/lib/node_modules"
)

snapshot() {
    local out="$1"
    : > "$out"
    for p in "${WATCH_PATHS[@]}"; do
        if [[ -e "$p" || -L "$p" ]]; then
            # 用 find 列出所有 entry,带类型标记;符号链接保留 readlink 目标
            find "$p" -maxdepth 8 -printf '%y %p -> %l\n' 2>/dev/null \
                | sed 's/ -> $//' >> "$out"
        fi
    done
    sort -u -o "$out" "$out"
}

echo "==> snapshot before" | tee -a "$OUT/install.log"
snapshot "$OUT/before.txt"

echo "==> npm i -g claude-mem-plus" | tee -a "$OUT/install.log"
npm i -g claude-mem-plus 2>&1 | tee -a "$OUT/install.log"

echo "==> claude-mem-plus --version" | tee -a "$OUT/install.log"
claude-mem-plus --version 2>&1 | tee -a "$OUT/install.log" || true

echo "==> claude-mem-plus install --ide claude-code --no-auto-start" | tee -a "$OUT/install.log"
# 非交互 + 不启 worker:install.ts 走 isInteractive=false 分支,
# 默认 IDE = claude-code(install.ts 第 789 行),
# provider 默认 claude(promptProvider 在 !isInteractive 且无 options.provider 返回 initialProvider)
CLAUDE_MEM_PROVIDER=claude \
    claude-mem-plus install --ide claude-code --no-auto-start 2>&1 | tee -a "$OUT/install.log" || true

echo "==> snapshot after" | tee -a "$OUT/install.log"
snapshot "$OUT/after.txt"

echo "==> diff(只看新增 / 修改)" | tee -a "$OUT/install.log"
# comm -13:只在 after 出现的行(= 新增 / 修改)
comm -13 "$OUT/before.txt" "$OUT/after.txt" > "$OUT/diff.txt"
wc -l "$OUT/diff.txt" | tee -a "$OUT/install.log"

echo "==> npm prefix 信息" | tee -a "$OUT/install.log"
{
    echo "npm prefix: $(npm config get prefix)"
    echo "npm bin: $(npm bin -g 2>/dev/null || true)"
    ls -la "$(npm config get prefix)/bin" 2>/dev/null | grep -i claude || true
    ls -la "$(npm config get prefix)/lib/node_modules/" 2>/dev/null | grep -i claude || true
} | tee -a "$OUT/install.log"

echo "==> 关键 JSON 文件内容" | tee -a "$OUT/install.log"
for f in \
    "$HOME/.claude/settings.json" \
    "$HOME/.claude.json" \
    "$HOME/.claude/plugins/known_marketplaces.json" \
    "$HOME/.claude/plugins/installed_plugins.json" \
    "$HOME/.claude-mem-plus/settings.json"; do
    if [[ -f "$f" ]]; then
        echo "----- $f -----" | tee -a "$OUT/install.log"
        cat "$f" 2>&1 | tee -a "$OUT/install.log"
    fi
done

echo "==> done" | tee -a "$OUT/install.log"
