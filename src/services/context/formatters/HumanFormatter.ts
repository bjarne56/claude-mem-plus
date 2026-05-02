/**
 * HumanFormatter - Formats context output with ANSI colors for terminal
 *
 * Handles all colored formatting for context injection (terminal display).
 *
 * 多语言:zh + en 内置,其他 30 种语言 fallback en
 * 全局 currentLang 由 setHumanFormatterLang 控制(worker 启动时 + settings 变更时)
 * 也支持 handleContextPreview 入口处临时 override(?lang=xxx)
 */

import type {
  ContextConfig,
  Observation,
  TokenEconomics,
  PriorMessages,
} from '../types.js';
import { colors } from '../types.js';
import { ModeManager } from '../../domain/ModeManager.js';
import { formatObservationTokenDisplay } from '../TokenCalculator.js';

// ── 多语言字符串表 ──────────────────────────────────────
type Lang = 'zh' | 'en';
type Strings = {
  recentContext: string;       // 例:'最近上下文' / 'recent context'
  legend: string;              // 例:'图例' / 'Legend'
  legendSession: string;       // 例:'会话请求' / 'session-request'
  columnKey: string;           // 例:'列说明' / 'Column Key'
  colReadDesc: string;
  colWorkDesc: string;
  contextIndex: string;
  whenNeed: string;
  fetchById: string;
  searchHistory: string;
  trustIndex: string;
  contextEconomics: string;
  loading: (n: number, t: string) => string;
  workInvest: (t: string) => string;
  yourSavings: string;
  tokensSavings: (n: string, pct: number) => string;       // amount + %
  tokensOnly: (n: string) => string;
  pctOnly: (pct: number) => string;
  untitled: string;
  sessionStarted: string;
  previously: string;
  footerAccess: (workK: number, readN: string) => string;
  emptyState: string;
};

const STRINGS: Record<Lang, Strings> = {
  zh: {
    recentContext: '最近上下文',
    legend: '图例',
    legendSession: '会话请求',
    columnKey: '列说明',
    colReadDesc: '阅读这条 observation 的词元数(现在学的成本)',
    colWorkDesc: '产出这条记录花的工作词元(调研 / 构建 / 决策)',
    contextIndex: '上下文索引: 这份语义索引(标题 / 类型 / 文件 / 词元)通常足以理解过往工作。',
    whenNeed: '当你需要实现细节、原因或调试上下文时:',
    fetchById: '按 ID 取: get_observations([IDs]) 拉取本索引可见的 observation',
    searchHistory: '搜历史: 用 mem-search skill 查过往决策、bug 与深度调研',
    trustIndex: '信任本索引,不必为查过往决策和学到的内容重新读代码',
    contextEconomics: '上下文经济',
    loading: (n, t) => `载入: ${n} 条 observation (${t} 词元待读)`,
    workInvest: (t) => `工作投入: ${t} 词元用于调研、构建与决策`,
    yourSavings: '你节省',
    tokensSavings: (n, pct) => `${n} 词元(复用减少 ${pct}%)`,
    tokensOnly: (n) => `${n} 词元`,
    pctOnly: (pct) => `复用减少 ${pct}%`,
    untitled: '未命名',
    sessionStarted: '会话开始',
    previously: '之前',
    footerAccess: (workK, readN) => `用 ${readN}t 词元访问过往 ${workK}k 词元的调研与决策。用 claude-mem skill 按 ID 取记忆。`,
    emptyState: '本项目暂无过往会话。',
  },
  en: {
    recentContext: 'recent context',
    legend: 'Legend',
    legendSession: 'session-request',
    columnKey: 'Column Key',
    colReadDesc: 'Tokens to read this observation (cost to learn it now)',
    colWorkDesc: 'Tokens spent on work that produced this record (research, building, deciding)',
    contextIndex: 'Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.',
    whenNeed: 'When you need implementation details, rationale, or debugging context:',
    fetchById: 'Fetch by ID: get_observations([IDs]) for observations visible in this index',
    searchHistory: 'Search history: Use the mem-search skill for past decisions, bugs, and deeper research',
    trustIndex: 'Trust this index over re-reading code for past decisions and learnings',
    contextEconomics: 'Context Economics',
    loading: (n, t) => `Loading: ${n} observations (${t} tokens to read)`,
    workInvest: (t) => `Work investment: ${t} tokens spent on research, building, and decisions`,
    yourSavings: 'Your savings',
    tokensSavings: (n, pct) => `${n} tokens (${pct}% reduction from reuse)`,
    tokensOnly: (n) => `${n} tokens`,
    pctOnly: (pct) => `${pct}% reduction from reuse`,
    untitled: 'Untitled',
    sessionStarted: 'Session started',
    previously: 'Previously',
    footerAccess: (workK, readN) => `Access ${workK}k tokens of past research & decisions for just ${readN}t. Use the claude-mem skill to access memories by ID.`,
    emptyState: 'No previous sessions found for this project yet.',
  },
};

let currentLang: Lang = 'zh';  // 默认中文(用户多数中文,fallback 也合理)

/**
 * 由 worker 启动时 / settings 变更时 / handleContextPreview 入口调用
 * 接受任意 viewer lang 代码,zh / zh-tw → zh,其他全 → en
 */
export function setHumanFormatterLang(lang: string | undefined | null): void {
  if (!lang) { currentLang = 'en'; return; }
  const lower = lang.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-') || lower === 'zh-tw') {
    currentLang = 'zh';
  } else {
    currentLang = 'en';
  }
}

function s(): Strings {
  return STRINGS[currentLang] || STRINGS.en;
}

/**
 * Format current date/time for header display
 */
function formatHeaderDateTime(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA'); 
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase().replace(' ', '');
  const tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
  return `${date} ${time} ${tz}`;
}

export function renderHumanHeader(project: string): string[] {
  return [
    '',
    `${colors.bright}${colors.cyan}[${project}] ${s().recentContext}, ${formatHeaderDateTime()}${colors.reset}`,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ''
  ];
}

export function renderHumanLegend(): string[] {
  const mode = ModeManager.getInstance().getActiveMode();
  const typeLegendItems = mode.observation_types.map(t => `${t.emoji} ${t.id}`).join(' | ');

  return [
    `${colors.dim}${s().legend}: ${s().legendSession} | ${typeLegendItems}${colors.reset}`,
    ''
  ];
}

export function renderHumanColumnKey(): string[] {
  return [
    `${colors.bright}${s().columnKey}${colors.reset}`,
    `${colors.dim}  Read: ${s().colReadDesc}${colors.reset}`,
    `${colors.dim}  Work: ${s().colWorkDesc}${colors.reset}`,
    ''
  ];
}

export function renderHumanContextIndex(): string[] {
  return [
    `${colors.dim}${s().contextIndex}${colors.reset}`,
    '',
    `${colors.dim}${s().whenNeed}${colors.reset}`,
    `${colors.dim}  - ${s().fetchById}${colors.reset}`,
    `${colors.dim}  - ${s().searchHistory}${colors.reset}`,
    `${colors.dim}  - ${s().trustIndex}${colors.reset}`,
    ''
  ];
}

export function renderHumanContextEconomics(
  economics: TokenEconomics,
  config: ContextConfig
): string[] {
  const output: string[] = [];
  const t = s();

  output.push(`${colors.bright}${colors.cyan}${t.contextEconomics}${colors.reset}`);
  output.push(`${colors.dim}  ${t.loading(economics.totalObservations, economics.totalReadTokens.toLocaleString())}${colors.reset}`);
  output.push(`${colors.dim}  ${t.workInvest(economics.totalDiscoveryTokens.toLocaleString())}${colors.reset}`);

  if (economics.totalDiscoveryTokens > 0 && (config.showSavingsAmount || config.showSavingsPercent)) {
    let savingsLine = `  ${t.yourSavings}: `;
    if (config.showSavingsAmount && config.showSavingsPercent) {
      savingsLine += t.tokensSavings(economics.savings.toLocaleString(), economics.savingsPercent);
    } else if (config.showSavingsAmount) {
      savingsLine += t.tokensOnly(economics.savings.toLocaleString());
    } else {
      savingsLine += t.pctOnly(economics.savingsPercent);
    }
    output.push(`${colors.green}${savingsLine}${colors.reset}`);
  }
  output.push('');

  return output;
}

export function renderHumanDayHeader(day: string): string[] {
  return [
    `${colors.bright}${colors.cyan}${day}${colors.reset}`,
    ''
  ];
}

export function renderHumanFileHeader(file: string): string[] {
  return [
    `${colors.dim}${file}${colors.reset}`
  ];
}

export function renderHumanTableRow(
  obs: Observation,
  time: string,
  showTime: boolean,
  config: ContextConfig
): string {
  const title = obs.title || s().untitled;
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryTokens, workEmoji } = formatObservationTokenDisplay(obs, config);

  const timePart = showTime ? `${colors.dim}${time}${colors.reset}` : ' '.repeat(time.length);
  const readPart = (config.showReadTokens && readTokens > 0) ? `${colors.dim}(~${readTokens}t)${colors.reset}` : '';
  const discoveryPart = (config.showWorkTokens && discoveryTokens > 0) ? `${colors.dim}(${workEmoji} ${discoveryTokens.toLocaleString()}t)${colors.reset}` : '';

  return `  ${colors.dim}#${obs.id}${colors.reset}  ${timePart}  ${icon}  ${title} ${readPart} ${discoveryPart}`;
}

export function renderHumanFullObservation(
  obs: Observation,
  time: string,
  showTime: boolean,
  detailField: string | null,
  config: ContextConfig
): string[] {
  const output: string[] = [];
  const title = obs.title || s().untitled;
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const { readTokens, discoveryTokens, workEmoji } = formatObservationTokenDisplay(obs, config);

  const timePart = showTime ? `${colors.dim}${time}${colors.reset}` : ' '.repeat(time.length);
  const readPart = (config.showReadTokens && readTokens > 0) ? `${colors.dim}(~${readTokens}t)${colors.reset}` : '';
  const discoveryPart = (config.showWorkTokens && discoveryTokens > 0) ? `${colors.dim}(${workEmoji} ${discoveryTokens.toLocaleString()}t)${colors.reset}` : '';

  output.push(`  ${colors.dim}#${obs.id}${colors.reset}  ${timePart}  ${icon}  ${colors.bright}${title}${colors.reset}`);
  if (detailField) {
    output.push(`    ${colors.dim}${detailField}${colors.reset}`);
  }
  if (readPart || discoveryPart) {
    output.push(`    ${readPart} ${discoveryPart}`);
  }
  output.push('');

  return output;
}

export function renderHumanSummaryItem(
  summary: { id: number; request: string | null },
  formattedTime: string
): string[] {
  const summaryTitle = `${summary.request || s().sessionStarted} (${formattedTime})`;
  return [
    `${colors.yellow}#S${summary.id}${colors.reset} ${summaryTitle}`,
    ''
  ];
}

export function renderHumanSummaryField(label: string, value: string | null, color: string): string[] {
  if (!value) return [];
  return [`${color}${label}:${colors.reset} ${value}`, ''];
}

export function renderHumanPreviouslySection(priorMessages: PriorMessages): string[] {
  if (!priorMessages.assistantMessage) return [];

  return [
    '',
    '---',
    '',
    `${colors.bright}${colors.magenta}${s().previously}${colors.reset}`,
    '',
    `${colors.dim}A: ${priorMessages.assistantMessage}${colors.reset}`,
    ''
  ];
}

export function renderHumanFooter(totalDiscoveryTokens: number, totalReadTokens: number): string[] {
  const workTokensK = Math.round(totalDiscoveryTokens / 1000);
  return [
    '',
    `${colors.dim}${s().footerAccess(workTokensK, totalReadTokens.toLocaleString())}${colors.reset}`
  ];
}

export function renderHumanEmptyState(project: string): string {
  return `\n${colors.bright}${colors.cyan}[${project}] ${s().recentContext}, ${formatHeaderDateTime()}${colors.reset}\n${colors.gray}${'─'.repeat(60)}${colors.reset}\n\n${colors.dim}${s().emptyState}${colors.reset}\n`;
}
