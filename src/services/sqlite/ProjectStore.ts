// ProjectStore — projects/project_paths 表 CRUD + resolveProject(cwd) 解析
//
// 解析优先级(claude-mem-改造需求.md 第 4 节):
//   1. CLAUDE_MEM_PROJECT env(显式指定 project_id 或 name)
//   2. cwd 内 .claude-mem 锚点文件存的 project_id(脱离路径依赖)
//   3. cwd 在 project_paths 精确匹配
//   4. cwd 父目录在 project_paths 最长前缀匹配(子目录场景)
//   5. 都没命中 → 新建 project + 登记 cwd

import { Database } from 'bun:sqlite';
import { realpathSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, DB_PATH, ensureDir } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { getProjectName } from '../../utils/project-name.js';

export const ANCHOR_FILE_NAME = '.claude-mem';
export const PROJECT_ID_PREFIX = 'p_';

export interface ProjectRecord {
  id: string;
  name: string;
  anchor_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectPathRecord {
  id: number;
  project_id: string;
  path: string;
  added_at: number;
  last_seen_at: number;
}

export interface ResolveResult {
  project: ProjectRecord;
  path: string;          // 实际命中/登记的路径(已规范化)
  source: 'env' | 'anchor' | 'exact-path' | 'parent-prefix' | 'created';
}

// ── 工具:生成 12 字符 base62 ID(碰撞概率足够低,不依赖外部 nanoid)
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function generateProjectId(): string {
  let s = PROJECT_ID_PREFIX;
  for (let i = 0; i < 10; i++) {
    s += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }
  return s;
}

// ── 工具:规范化路径(realpath + 去末尾斜杠)
export function normalizePath(p: string): string {
  if (!p || p.trim() === '') return p;
  let resolved = p;
  try {
    resolved = realpathSync(p);
  } catch {
    // 路径不存在或符号链接断了,保留原样(便于 UI 标记不可达)
  }
  // 去末尾斜杠(根目录 / 例外)
  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

// ── 工具:读 .claude-mem 锚点文件
export function readAnchorFile(cwd: string): string | null {
  const anchorPath = join(cwd, ANCHOR_FILE_NAME);
  if (!existsSync(anchorPath)) return null;
  try {
    const content = readFileSync(anchorPath, 'utf-8').trim();
    // 兼容两种格式:裸 project_id 或 JSON {projectId: "..."}
    if (content.startsWith('{')) {
      const parsed = JSON.parse(content);
      const id = parsed?.projectId || parsed?.project_id;
      return typeof id === 'string' && id.startsWith(PROJECT_ID_PREFIX) ? id : null;
    }
    return content.startsWith(PROJECT_ID_PREFIX) ? content : null;
  } catch (err) {
    logger.warn('PROJECT', 'Failed to read .claude-mem anchor file', { anchorPath }, err as Error);
    return null;
  }
}

export class ProjectStore {
  public db: Database;

  constructor(dbPathOrDb: string | Database = DB_PATH) {
    if (dbPathOrDb instanceof Database) {
      this.db = dbPathOrDb;
    } else {
      if (dbPathOrDb !== ':memory:') ensureDir(DATA_DIR);
      this.db = new Database(dbPathOrDb);
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // ── CRUD: projects ────────────────────────────────────────────

  list(): ProjectRecord[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRecord[];
  }

  getById(id: string): ProjectRecord | null {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | null;
  }

  getByName(name: string): ProjectRecord | null {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRecord | null;
  }

  create(name: string, anchorPath: string | null = null): ProjectRecord {
    const id = generateProjectId();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO projects (id, name, anchor_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, anchorPath, now, now);
    return { id, name, anchor_path: anchorPath, created_at: now, updated_at: now };
  }

  rename(id: string, newName: string): ProjectRecord | null {
    const existing = this.getByName(newName);
    if (existing && existing.id !== id) {
      throw new Error(`Project name '${newName}' already taken by ${existing.id}`);
    }
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE projects SET name = ?, updated_at = ? WHERE id = ?
    `).run(newName, now, id);
    return result.changes > 0 ? this.getById(id) : null;
  }

  delete(id: string): boolean {
    // ON DELETE CASCADE 会清掉 project_paths;observations.project_id 走 SET NULL
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── CRUD: project_paths ───────────────────────────────────────

  listPaths(projectId: string): ProjectPathRecord[] {
    return this.db.prepare(`
      SELECT * FROM project_paths WHERE project_id = ? ORDER BY last_seen_at DESC
    `).all(projectId) as ProjectPathRecord[];
  }

  addPath(projectId: string, rawPath: string): ProjectPathRecord {
    const path = normalizePath(rawPath);
    const now = Date.now();
    // 同 path 已被别的项目占用?抛出错误(全局 UNIQUE)
    const existing = this.db.prepare('SELECT * FROM project_paths WHERE path = ?').get(path) as ProjectPathRecord | null;
    if (existing) {
      if (existing.project_id !== projectId) {
        throw new Error(`Path '${path}' already bound to project ${existing.project_id}`);
      }
      // 同项目重复登记 → 更新 last_seen_at 并返回
      this.db.prepare('UPDATE project_paths SET last_seen_at = ? WHERE id = ?').run(now, existing.id);
      return { ...existing, last_seen_at: now };
    }
    const result = this.db.prepare(`
      INSERT INTO project_paths (project_id, path, added_at, last_seen_at) VALUES (?, ?, ?, ?)
    `).run(projectId, path, now, now);
    return {
      id: Number(result.lastInsertRowid),
      project_id: projectId, path, added_at: now, last_seen_at: now
    };
  }

  removePath(pathId: number): boolean {
    const result = this.db.prepare('DELETE FROM project_paths WHERE id = ?').run(pathId);
    return result.changes > 0;
  }

  touchPath(projectId: string, path: string): void {
    this.db.prepare(`
      UPDATE project_paths SET last_seen_at = ? WHERE project_id = ? AND path = ?
    `).run(Date.now(), projectId, path);
  }

  // ── merge: 把 fromProjectId 所有 observations/summaries 改 project_id 到 toProjectId,删 from
  merge(fromProjectId: string, toProjectId: string): { observationsMoved: number; summariesMoved: number; pathsMoved: number } {
    if (fromProjectId === toProjectId) {
      throw new Error('Cannot merge a project into itself');
    }
    const from = this.getById(fromProjectId);
    const to = this.getById(toProjectId);
    if (!from || !to) {
      throw new Error(`Both projects must exist (from=${fromProjectId}, to=${toProjectId})`);
    }

    return this.db.transaction(() => {
      const obsResult = this.db.prepare('UPDATE observations SET project_id = ? WHERE project_id = ?').run(toProjectId, fromProjectId);
      const sumResult = this.db.prepare('UPDATE session_summaries SET project_id = ? WHERE project_id = ?').run(toProjectId, fromProjectId);
      // 路径搬过去(避免 UNIQUE 冲突:同 path 已在 to,跳过)
      const fromPaths = this.listPaths(fromProjectId);
      let pathsMoved = 0;
      for (const p of fromPaths) {
        try {
          this.db.prepare('UPDATE project_paths SET project_id = ? WHERE id = ?').run(toProjectId, p.id);
          pathsMoved++;
        } catch {
          // UNIQUE 冲突 → path 已在 to 项目,把 from 这条删掉
          this.db.prepare('DELETE FROM project_paths WHERE id = ?').run(p.id);
        }
      }
      this.delete(fromProjectId);
      return {
        observationsMoved: obsResult.changes,
        summariesMoved: sumResult.changes,
        pathsMoved
      };
    })();
  }

  // ── 解析:cwd → project(核心,5 层优先级)──────────────────────

  resolveProject(cwd: string | null | undefined): ResolveResult {
    // ── 1. CLAUDE_MEM_PROJECT env(支持 id 或 name)
    const envOverride = process.env.CLAUDE_MEM_PROJECT?.trim();
    if (envOverride) {
      // 优先 id(以 p_ 前缀),否则当 name lookup
      const byId = envOverride.startsWith(PROJECT_ID_PREFIX) ? this.getById(envOverride) : null;
      const project = byId || this.getByName(envOverride) || this.create(envOverride, null);
      return { project, path: cwd || '', source: 'env' };
    }

    const safeCwd = cwd && cwd.trim() !== '' ? normalizePath(cwd) : null;

    // ── 2. .claude-mem 锚点文件
    if (safeCwd) {
      const anchorId = readAnchorFile(safeCwd);
      if (anchorId) {
        const project = this.getById(anchorId);
        if (project) {
          // 自动登记 cwd 为该项目的一条路径(touch 或新加)
          try { this.addPath(project.id, safeCwd); } catch { /* 忽略 UNIQUE 冲突 */ }
          return { project, path: safeCwd, source: 'anchor' };
        }
        logger.warn('PROJECT', 'Anchor file references unknown project', { cwd: safeCwd, anchorId });
      }
    }

    // ── 3. cwd 在 project_paths 精确匹配
    if (safeCwd) {
      const exact = this.db.prepare('SELECT * FROM project_paths WHERE path = ?').get(safeCwd) as ProjectPathRecord | null;
      if (exact) {
        const project = this.getById(exact.project_id)!;
        this.touchPath(project.id, safeCwd);
        return { project, path: safeCwd, source: 'exact-path' };
      }

      // ── 4. 父目录最长前缀匹配
      // 取所有 path 是 safeCwd 的前缀的(path == safeCwd 或 path 是 safeCwd 父目录)
      // 同 path 长度排序取最长
      const candidates = this.db.prepare(`
        SELECT * FROM project_paths
        WHERE ? = path OR ? LIKE path || '/%'
        ORDER BY length(path) DESC
        LIMIT 1
      `).all(safeCwd, safeCwd) as ProjectPathRecord[];
      if (candidates.length > 0) {
        const match = candidates[0];
        const project = this.getById(match.project_id)!;
        this.touchPath(project.id, match.path);
        return { project, path: match.path, source: 'parent-prefix' };
      }
    }

    // ── 5. 都没命中 → 新建 project,自动登记 cwd
    const baseName = getProjectName(cwd); // basename 兜底,与历史命名一致
    // name 已存在 → 复用(避免 UNIQUE 冲突,同名但不同 cwd 的多项目场景由用户后续手动 split)
    const existing = this.getByName(baseName);
    const project = existing || this.create(baseName, safeCwd);
    if (safeCwd) {
      try { this.addPath(project.id, safeCwd); } catch { /* 已被别的项目占用 → 忽略,touchPath 不可能因为 path 不属于这个项目 */ }
    }
    return { project, path: safeCwd || '', source: 'created' };
  }

  // ── 统计:用于 UI 显示项目卡片 ─────────────────────────────────
  getStats(projectId: string): { observationCount: number; summaryCount: number; pathCount: number } {
    const obsRow = this.db.prepare('SELECT COUNT(*) AS c FROM observations WHERE project_id = ?').get(projectId) as { c: number };
    const sumRow = this.db.prepare('SELECT COUNT(*) AS c FROM session_summaries WHERE project_id = ?').get(projectId) as { c: number };
    const pathRow = this.db.prepare('SELECT COUNT(*) AS c FROM project_paths WHERE project_id = ?').get(projectId) as { c: number };
    return {
      observationCount: obsRow.c,
      summaryCount: sumRow.c,
      pathCount: pathRow.c
    };
  }
}
