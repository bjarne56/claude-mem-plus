
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import {
  executeWithWorkerFallback,
  isWorkerFallback,
  getWorkerPort,
} from '../../shared/worker-utils.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';
import { loadFromFileOnce } from '../../shared/hook-settings.js';
import { readStaleMarker } from '../../shared/oauth-token.js';

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const cwd = input.cwd ?? process.cwd();
    const port = getWorkerPort();

    const settings = loadFromFileOnce();
    const showTerminalOutput = settings.CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT === 'true';

    // 传 cwd 让 worker 走 ProjectStore.resolveProject 解析路径绑定的真实 project,
    // 避免 hook 端用 basename 做项目身份(同名项目串扰、cwd 与工作内容不一致等)。
    const apiPath = `/api/context/inject?cwd=${encodeURIComponent(cwd)}`;
    const colorApiPath = input.platform === 'claude-code' ? `${apiPath}&colors=true` : apiPath;

    const emptyResult: HookResult = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
      exitCode: HOOK_EXIT_CODES.SUCCESS,
    };

    const contextResult = await executeWithWorkerFallback<string>(apiPath, 'GET');
    if (isWorkerFallback(contextResult)) {
      return emptyResult;
    }

    let additionalContext: string;
    if (typeof contextResult === 'string') {
      additionalContext = contextResult.trim();
    } else if (contextResult === undefined) {
      additionalContext = '';
    } else {
      logger.warn('HOOK', 'Context response was not a string', { type: typeof contextResult });
      return emptyResult;
    }

    // Issue #2215: surface stale OAuth token marker as a session-start hint.
    // Marker is written by EnvManager.buildIsolatedEnvWithFreshOAuth() when
    // a previous worker spawn detected an expired keychain entry.
    const staleReason = readStaleMarker();
    if (staleReason) {
      const hint = `[claude-mem-plus] Claude Desktop OAuth token is stale: ${staleReason}\nPlease re-login via Claude Desktop to refresh the token.`;
      additionalContext = additionalContext
        ? `${hint}\n\n${additionalContext}`
        : hint;
    }

    let coloredTimeline = '';
    if (showTerminalOutput) {
      const colorResult = await executeWithWorkerFallback<string>(colorApiPath, 'GET');
      if (!isWorkerFallback(colorResult) && typeof colorResult === 'string') {
        coloredTimeline = colorResult.trim();
      }
    }

    const platform = input.platform;

    const displayContent = coloredTimeline || (platform === 'gemini-cli' || platform === 'gemini' ? additionalContext : '');

    // 短摘要 systemMessage:写入 transcript 给用户视觉反馈 + claude -c 时累积可控,
    // 完整内容仍由 additionalContext 给模型本回合(不写 transcript)。
    // 摘要 = 一行 header(obs 数 / token 估算 / viewer URL) + top 3 条标题预览。
    const obsMatch = additionalContext.match(/Stats:\s*(\d+)\s*obs/i);
    const obsPart = obsMatch ? `${obsMatch[1]} obs · ` : '';
    const tokenEstimate = Math.round(additionalContext.length / 4);
    const summaryHeader = `💉 ${obsPart}~${tokenEstimate.toLocaleString()}t → http://localhost:${port}`;

    // 抽 top 10 条(observation 含描述,session 仅标题),最后反转 → 旧在上 / 新在下。
    // OBS 完整格式:`**ID** TIME EMOJI **TITLE**` + 多行描述 + `~Nt 🛠️ M` 末行
    // SESS 行:`SXX TITLE (May D at HH:MM AM)`
    const OBS_HEAD_RE = /^\*\*(\d+)\*\*\s+\S+\s+(\S+)\s+\*\*(.+?)\*\*\s*$/;
    const SESS_RE = /^S(\d+)\s+(.+?)\s+\(\w+\s+\d+\s+at\s+/;
    const META_RE = /^~\d+t\s+🛠️/;
    const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;

    type Item = { type: 'obs' | 'sess'; id: string; emoji?: string; title: string; body?: string };
    const items: Item[] = [];
    let current: Item | null = null;
    let bodyLines: string[] = [];
    const flushCurrent = () => {
      if (current && items.length < 10) {
        if (bodyLines.length > 0) current.body = bodyLines.join(' ').trim();
        items.push(current);
      }
      current = null;
      bodyLines = [];
    };

    for (const line of additionalContext.split('\n')) {
      if (items.length >= 10) break;
      const obsM = line.match(OBS_HEAD_RE);
      if (obsM) {
        flushCurrent();
        if (items.length >= 10) break;
        current = { type: 'obs', id: obsM[1], emoji: obsM[2], title: obsM[3] };
        continue;
      }
      const sessM = line.match(SESS_RE);
      if (sessM) {
        flushCurrent();
        if (items.length >= 10) break;
        items.push({ type: 'sess', id: 'S' + sessM[1], title: sessM[2] });
        continue;
      }
      if (current) {
        if (META_RE.test(line)) {
          flushCurrent();
        } else if (line.trim()) {
          bodyLines.push(line.trim());
        }
      }
    }
    flushCurrent();

    // 反转:additionalContext 是新→旧顺序,反过来变成 旧→新(老在上,新在下)
    items.reverse();

    const topItems = items.map(it => {
      if (it.type === 'sess') {
        return `  ${it.id} ${truncate(it.title, 70)}`;
      }
      const head = `  #${it.id} ${it.emoji} ${it.title}`;
      return it.body ? `${head}\n      ${truncate(it.body, 180)}` : head;
    });

    const summary = topItems.length > 0
      ? `${summaryHeader}\n${topItems.join('\n')}`
      : summaryHeader;

    const systemMessage = showTerminalOutput && displayContent ? summary : undefined;

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      },
      systemMessage
    };
  }
};
