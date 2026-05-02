/**
 * ProjectMarker — 解析 .cmem-project.toml,缓存 path → marker_id 映射
 *
 * 行为:
 *   - 给定 cwd,从 cwd 向上最多 10 层找 .cmem-project.toml
 *   - 找到则解析 project_id / name / description
 *   - 没找到则返回 null,SyncManager fallback 用 path basename
 *   - 内存缓存 path → result(per process)
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

export interface CmemProjectMarker {
  project_id: string | null;
  name: string;
  description: string | null;
}

const cache = new Map<string, CmemProjectMarker | null>();

const MAX_LEVELS = 10;

/** 简易 TOML 解析 — 只支持顶层 string/null,我们只读三个字段 */
function parseToml(text: string): Partial<CmemProjectMarker> {
  const out: Partial<CmemProjectMarker> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'project_id') out.project_id = val || null;
    else if (key === 'name') out.name = val;
    else if (key === 'description') out.description = val;
  }
  return out;
}

/** 从 cwd 沿父级找 .cmem-project.toml,最多 10 层 */
export function resolveProjectMarker(cwd: string): CmemProjectMarker | null {
  if (cache.has(cwd)) return cache.get(cwd) ?? null;

  let cur = cwd;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const candidate = path.join(cur, '.cmem-project.toml');
    if (existsSync(candidate)) {
      try {
        const text = readFileSync(candidate, 'utf8');
        const parsed = parseToml(text);
        const result: CmemProjectMarker = {
          project_id: parsed.project_id ?? null,
          name: parsed.name ?? path.basename(cur),
          description: parsed.description ?? null,
        };
        cache.set(cwd, result);
        return result;
      } catch (e) {
        logger.warn('SYNC', '.cmem-project.toml 解析失败', {
          path: candidate,
          message: e instanceof Error ? e.message : String(e),
        });
        cache.set(cwd, null);
        return null;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  cache.set(cwd, null);
  return null;
}

/** 路径 → 项目名规范化(小写,非字母数字 → -,去除连续 -) */
export function normalizeProjectName(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map(c => (/[a-z0-9]/.test(c) ? c : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-');
}

/** 测试用 */
export function clearMarkerCache(): void {
  cache.clear();
}
