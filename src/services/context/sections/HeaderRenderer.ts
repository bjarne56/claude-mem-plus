
import type { ContextConfig, Observation, SessionSummary, TokenEconomics } from '../types.js';
import { shouldShowContextEconomics } from '../TokenCalculator.js';
import { formatDateTime } from '../../../shared/timeline-formatting.js';
import { colors } from '../types.js';
import * as Agent from '../formatters/AgentFormatter.js';
import * as Human from '../formatters/HumanFormatter.js';

// 最新观察戳:把"最新 obs/summary 的 ID + 时间"放到 Header 顶部,
// 即使终端只预览前 2KB 也能立即确认数据新鲜度。
function renderFreshnessLine(
  latestObs: Observation | undefined,
  latestSummary: SessionSummary | undefined,
  forHuman: boolean
): string[] {
  if (!latestObs && !latestSummary) return [];

  // 取 obs / summary 中更新的那个作为"最新"
  const latestEpoch = latestObs?.created_at_epoch ?? 0;
  const summaryEpoch = latestSummary?.created_at_epoch ?? 0;
  const useObs = latestEpoch >= summaryEpoch;

  const id = useObs ? `#${latestObs!.id}` : `#S${latestSummary!.id}`;
  const time = useObs ? latestObs!.created_at : latestSummary!.created_at;
  const formatted = formatDateTime(time);

  if (forHuman) {
    return [`${colors.dim}📌 latest: ${id} (${formatted})${colors.reset}`, ''];
  }
  return [`Latest: ${id} (${formatted})`, ''];
}

export function renderHeader(
  project: string,
  economics: TokenEconomics,
  config: ContextConfig,
  forHuman: boolean,
  latestObs?: Observation,
  latestSummary?: SessionSummary
): string[] {
  const output: string[] = [];

  if (forHuman) {
    output.push(...Human.renderHumanHeader(project));
  } else {
    output.push(...Agent.renderAgentHeader(project));
  }

  output.push(...renderFreshnessLine(latestObs, latestSummary, forHuman));

  if (forHuman) {
    output.push(...Human.renderHumanLegend());
  } else {
    output.push(...Agent.renderAgentLegend());
  }

  if (forHuman) {
    output.push(...Human.renderHumanColumnKey());
  } else {
    output.push(...Agent.renderAgentColumnKey());
  }

  if (forHuman) {
    output.push(...Human.renderHumanContextIndex());
  } else {
    output.push(...Agent.renderAgentContextIndex());
  }

  if (shouldShowContextEconomics(config)) {
    if (forHuman) {
      output.push(...Human.renderHumanContextEconomics(economics, config));
    } else {
      output.push(...Agent.renderAgentContextEconomics(economics, config));
    }
  }

  return output;
}
