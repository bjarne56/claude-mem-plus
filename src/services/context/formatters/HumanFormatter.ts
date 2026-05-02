
import type {
  ContextConfig,
  Observation,
  TokenEconomics,
  PriorMessages,
} from '../types.js';
import { colors } from '../types.js';
import { ModeManager } from '../../domain/ModeManager.js';
import { formatObservationTokenDisplay } from '../TokenCalculator.js';

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
    `${colors.bright}${colors.cyan}[${project}] 最近上下文, ${formatHeaderDateTime()}${colors.reset}`,
    `${colors.gray}${'─'.repeat(60)}${colors.reset}`,
    ''
  ];
}

export function renderHumanLegend(): string[] {
  const mode = ModeManager.getInstance().getActiveMode();
  const typeLegendItems = mode.observation_types.map(t => `${t.emoji} ${t.id}`).join(' | ');

  return [
    `${colors.dim}图例: 会话请求 | ${typeLegendItems}${colors.reset}`,
    ''
  ];
}

export function renderHumanColumnKey(): string[] {
  return [
    `${colors.bright}列说明${colors.reset}`,
    `${colors.dim}  Read: 阅读这条 observation 的词元数(现在学的成本)${colors.reset}`,
    `${colors.dim}  Work: 产出这条记录花的工作词元(调研 / 构建 / 决策)${colors.reset}`,
    ''
  ];
}

export function renderHumanContextIndex(): string[] {
  return [
    `${colors.dim}上下文索引: 这份语义索引(标题 / 类型 / 文件 / 词元)通常足以理解过往工作。${colors.reset}`,
    '',
    `${colors.dim}当你需要实现细节、原因或调试上下文时:${colors.reset}`,
    `${colors.dim}  - 按 ID 取: get_observations([IDs]) 拉取本索引可见的 observation${colors.reset}`,
    `${colors.dim}  - 搜历史: 用 mem-search skill 查过往决策、bug 与深度调研${colors.reset}`,
    `${colors.dim}  - 信任本索引,不必为查过往决策和学到的内容重新读代码${colors.reset}`,
    ''
  ];
}

export function renderHumanContextEconomics(
  economics: TokenEconomics,
  config: ContextConfig
): string[] {
  const output: string[] = [];

  output.push(`${colors.bright}${colors.cyan}上下文经济${colors.reset}`);
  output.push(`${colors.dim}  载入: ${economics.totalObservations} 条 observation (${economics.totalReadTokens.toLocaleString()} 词元待读)${colors.reset}`);
  output.push(`${colors.dim}  工作投入: ${economics.totalDiscoveryTokens.toLocaleString()} 词元用于调研、构建与决策${colors.reset}`);

  if (economics.totalDiscoveryTokens > 0 && (config.showSavingsAmount || config.showSavingsPercent)) {
    let savingsLine = '  你节省: ';
    if (config.showSavingsAmount && config.showSavingsPercent) {
      savingsLine += `${economics.savings.toLocaleString()} 词元(复用减少 ${economics.savingsPercent}%)`;
    } else if (config.showSavingsAmount) {
      savingsLine += `${economics.savings.toLocaleString()} 词元`;
    } else {
      savingsLine += `复用减少 ${economics.savingsPercent}%`;
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
  const title = obs.title || '未命名';
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
  const title = obs.title || '未命名';
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
  const summaryTitle = `${summary.request || '会话开始'} (${formattedTime})`;
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
    `${colors.bright}${colors.magenta}之前${colors.reset}`,
    '',
    `${colors.dim}A: ${priorMessages.assistantMessage}${colors.reset}`,
    ''
  ];
}

export function renderHumanFooter(totalDiscoveryTokens: number, totalReadTokens: number): string[] {
  const workTokensK = Math.round(totalDiscoveryTokens / 1000);
  return [
    '',
    `${colors.dim}用 ${totalReadTokens.toLocaleString()}t 词元访问过往 ${workTokensK}k 词元的调研与决策。用 claude-mem skill 按 ID 取记忆。${colors.reset}`
  ];
}

export function renderHumanEmptyState(project: string): string {
  return `\n${colors.bright}${colors.cyan}[${project}] 最近上下文, ${formatHeaderDateTime()}${colors.reset}\n${colors.gray}${'─'.repeat(60)}${colors.reset}\n\n${colors.dim}本项目暂无过往会话。${colors.reset}\n`;
}
