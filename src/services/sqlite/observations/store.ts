
import { createHash } from 'crypto';
import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import { getProjectContext } from '../../../utils/project-name.js';
import { ProjectStore } from '../ProjectStore.js';
import type { ObservationInput, StoreObservationResult } from './types.js';

// 双写过渡:写 observation 时同步把 cwd 解析到稳定 project_id,与原 .project name 字段并行
// 不抛异常(任何 ProjectStore 错误都退化到 NULL,保留现有 .project name 行为完全不变)
//
// 注:name 命中已存在项目时直接返回 id,不主动 addPath(cwd)。原因:
// 同名跨项目场景(如 ~/work/Foo 与 ~/personal/Foo)会被错误合并到同一 v2 项目。
// 只有 resolveProject 第 5 层"新建项目"才会自动登记 cwd 为路径,这是安全语义:
// 新项目身份与首次出现的 cwd 一一绑定,后续路径登记由用户主动管理(web 后台 /
// .claude-mem 锚点文件)。
function resolveProjectIdSafely(db: Database, projectName: string): string | null {
  try {
    const ps = new ProjectStore(db);
    const existing = ps.getByName(projectName);
    if (existing) return existing.id;
    // 没有 → resolveProject 走 5 层兜底(env > anchor > exact > prefix > 新建+登记)
    return ps.resolveProject(process.cwd()).project.id;
  } catch (err) {
    logger.warn('PROJECT_ID', 'Failed to resolve project_id (双写降级到 NULL)', { projectName }, err as Error);
    return null;
  }
}

export function computeObservationContentHash(
  memorySessionId: string,
  title: string | null,
  narrative: string | null
): string {
  return createHash('sha256')
    .update([memorySessionId || '', title || '', narrative || ''].join('\x00'))
    .digest('hex')
    .slice(0, 16);
}

export function storeObservation(
  db: Database,
  memorySessionId: string,
  project: string,
  observation: ObservationInput,
  promptNumber?: number,
  discoveryTokens: number = 0,
  overrideTimestampEpoch?: number
): StoreObservationResult {
  const timestampEpoch = overrideTimestampEpoch ?? Date.now();
  const timestampIso = new Date(timestampEpoch).toISOString();

  const resolvedProject = project || getProjectContext(process.cwd()).primary;
  const resolvedProjectId = resolveProjectIdSafely(db, resolvedProject);

  const contentHash = computeObservationContentHash(memorySessionId, observation.title, observation.narrative);

  const stmt = db.prepare(`
    INSERT INTO observations
    (memory_session_id, project, project_id, type, title, subtitle, facts, narrative, concepts,
     files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_session_id, content_hash) DO NOTHING
    RETURNING id, created_at_epoch
  `);

  const inserted = stmt.get(
    memorySessionId,
    resolvedProject,
    resolvedProjectId,
    observation.type,
    observation.title,
    observation.subtitle,
    JSON.stringify(observation.facts),
    observation.narrative,
    JSON.stringify(observation.concepts),
    JSON.stringify(observation.files_read),
    JSON.stringify(observation.files_modified),
    promptNumber || null,
    discoveryTokens,
    observation.agent_type ?? null,
    observation.agent_id ?? null,
    contentHash,
    timestampIso,
    timestampEpoch
  ) as { id: number; created_at_epoch: number } | null;

  if (inserted) {
    return { id: inserted.id, createdAtEpoch: inserted.created_at_epoch };
  }

  const existing = db.prepare(
    'SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?'
  ).get(memorySessionId, contentHash) as { id: number; created_at_epoch: number } | null;

  if (!existing) {
    throw new Error(
      `storeObservation: ON CONFLICT fired but no row exists for (memory_session_id=${memorySessionId}, content_hash=${contentHash})`
    );
  }

  logger.debug('DEDUP', `Skipped duplicate observation | contentHash=${contentHash} | existingId=${existing.id}`);
  return { id: existing.id, createdAtEpoch: existing.created_at_epoch };
}
