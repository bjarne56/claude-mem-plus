
import type {
  ContextConfig,
  Observation,
  TimelineItem,
  SummaryTimelineItem,
} from '../types.js';
import { formatTime, formatDate, formatDateTime, extractFirstFile, parseJsonArray } from '../../../shared/timeline-formatting.js';
import * as Agent from '../formatters/AgentFormatter.js';
import * as Human from '../formatters/HumanFormatter.js';

// 按日期分组,日期降序(最新一天在前);每天内 items 也按 epoch 降序(最新条目在前)。
// 这样输出顺序是 desc,Claude Code 终端的 2KB 预览能优先显示最新内容,
// AI 上下文总量不变,只是顺序倒过来。
export function groupTimelineByDay(timeline: TimelineItem[]): Map<string, TimelineItem[]> {
  const itemsByDay = new Map<string, TimelineItem[]>();

  for (const item of timeline) {
    const itemDate = item.type === 'observation' ? item.data.created_at : item.data.displayTime;
    const day = formatDate(itemDate);
    if (!itemsByDay.has(day)) {
      itemsByDay.set(day, []);
    }
    itemsByDay.get(day)!.push(item);
  }

  // 每天内按 epoch 降序排
  for (const [, dayItems] of itemsByDay) {
    dayItems.sort((a, b) => {
      const aEpoch = a.type === 'observation' ? a.data.created_at_epoch : a.data.displayEpoch;
      const bEpoch = b.type === 'observation' ? b.data.created_at_epoch : b.data.displayEpoch;
      return bEpoch - aEpoch;
    });
  }

  // 日期降序
  const sortedEntries = Array.from(itemsByDay.entries()).sort((a, b) => {
    const aDate = new Date(a[0]).getTime();
    const bDate = new Date(b[0]).getTime();
    return bDate - aDate;
  });

  return new Map(sortedEntries);
}

function getDetailField(obs: Observation, config: ContextConfig): string | null {
  if (config.fullObservationField === 'narrative') {
    return obs.narrative;
  }
  return obs.facts ? parseJsonArray(obs.facts).join('\n') : null;
}

function renderDayTimelineAgent(
  day: string,
  dayItems: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
): string[] {
  const output: string[] = [];

  output.push(...Agent.renderAgentDayHeader(day));

  let lastTime = '';

  for (const item of dayItems) {
    if (item.type === 'summary') {
      const summary = item.data as SummaryTimelineItem;
      const formattedTime = formatDateTime(summary.displayTime);
      output.push(...Agent.renderAgentSummaryItem(summary, formattedTime));
    } else {
      const obs = item.data as Observation;
      const time = formatTime(obs.created_at);
      const showTime = time !== lastTime;
      const timeDisplay = showTime ? time : '';
      lastTime = time;

      const shouldShowFull = fullObservationIds.has(obs.id);

      if (shouldShowFull) {
        const detailField = getDetailField(obs, config);
        output.push(...Agent.renderAgentFullObservation(obs, timeDisplay, detailField, config));
      } else {
        output.push(Agent.renderAgentTableRow(obs, timeDisplay, config));
      }
    }
  }

  return output;
}

function renderDayTimelineHuman(
  day: string,
  dayItems: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
): string[] {
  const output: string[] = [];

  output.push(...Human.renderHumanDayHeader(day));

  let currentFile: string | null = null;
  let lastTime = '';

  for (const item of dayItems) {
    if (item.type === 'summary') {
      currentFile = null;
      lastTime = '';

      const summary = item.data as SummaryTimelineItem;
      const formattedTime = formatDateTime(summary.displayTime);
      output.push(...Human.renderHumanSummaryItem(summary, formattedTime));
    } else {
      const obs = item.data as Observation;
      const file = extractFirstFile(obs.files_modified, cwd, obs.files_read);
      const time = formatTime(obs.created_at);
      const showTime = time !== lastTime;
      lastTime = time;

      const shouldShowFull = fullObservationIds.has(obs.id);

      if (file !== currentFile) {
        output.push(...Human.renderHumanFileHeader(file));
        currentFile = file;
      }

      if (shouldShowFull) {
        const detailField = getDetailField(obs, config);
        output.push(...Human.renderHumanFullObservation(obs, time, showTime, detailField, config));
      } else {
        output.push(Human.renderHumanTableRow(obs, time, showTime, config));
      }
    }
  }

  output.push('');

  return output;
}

export function renderDayTimeline(
  day: string,
  dayItems: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
  forHuman: boolean
): string[] {
  if (forHuman) {
    return renderDayTimelineHuman(day, dayItems, fullObservationIds, config, cwd);
  }
  return renderDayTimelineAgent(day, dayItems, fullObservationIds, config);
}

export function renderTimeline(
  timeline: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
  forHuman: boolean
): string[] {
  const output: string[] = [];
  const itemsByDay = groupTimelineByDay(timeline);

  for (const [day, dayItems] of itemsByDay) {
    output.push(...renderDayTimeline(day, dayItems, fullObservationIds, config, cwd, forHuman));
  }

  return output;
}
