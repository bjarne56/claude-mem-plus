/**
 * DeleteRoutes — 项目/会话/单条 observation 三级软删 + 回收站 CRUD
 *
 * 路由表:
 *   DELETE /api/observations/:id          软删一条 observation → trash_observations
 *   DELETE /api/sessions/:id              软删一个 session → trash_sessions(级联其 obs/sum/prompt)
 *   DELETE /api/projects/:name            软删项目所有 session → trash_*
 *   GET    /api/trash                     列回收站(三类,按 deleted_at_epoch desc)
 *   POST   /api/trash/:type/:trashId/restore   从 trash 表恢复回主表
 *   DELETE /api/trash/:type/:trashId      永久删除单行
 *   DELETE /api/trash                     清空整个回收站
 *
 * 设计点:
 *   - 影子表 CREATE IF NOT EXISTS,不走 schema migration(rebase 友好)
 *   - 软删完后调 SSEBroadcaster 重新广播 projects(否则 viewer 项目下拉里删了的项目还在)
 *   - Chroma 向量异步删,失败只 log warn
 *   - 全部路由 requireLocalhost
 */

import express, { Request, Response } from 'express';
import { Database } from 'bun:sqlite';
import { logger } from '../../../../utils/logger.js';
import { DatabaseManager } from '../../DatabaseManager.js';
import { SSEBroadcaster } from '../../SSEBroadcaster.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { requireLocalhost } from '../../../server/Middleware.js';

type TrashType = 'observations' | 'sessions' | 'summaries';
const TRASH_TYPES: readonly TrashType[] = ['observations', 'sessions', 'summaries'] as const;
const TRASH_TABLE: Record<TrashType, string> = {
  observations: 'trash_observations',
  sessions: 'trash_sessions',
  summaries: 'trash_summaries',
};
const MAIN_TABLE: Record<TrashType, string> = {
  observations: 'observations',
  sessions: 'sdk_sessions',
  summaries: 'session_summaries',
};

interface ObservationRow {
  id: number;
  memory_session_id: string;
  project: string;
}

interface TrashRow {
  trash_id: number;
  original_id: number;
  memory_session_id: string | null;
  project: string | null;
  payload: string;
  deleted_at_epoch: number;
  reason: string;
}

export class DeleteRoutes extends BaseRouteHandler {
  private trashTablesEnsured = false;

  constructor(
    private dbManager: DatabaseManager,
    private sseBroadcaster: SSEBroadcaster,
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    // 软删
    app.delete('/api/observations/:id', requireLocalhost, this.wrapHandler(this.handleDeleteObservation));
    app.delete('/api/sessions/:id', requireLocalhost, this.wrapHandler(this.handleDeleteSession));
    app.delete('/api/projects/:name', requireLocalhost, this.wrapHandler(this.handleDeleteProject));
    // 回收站 CRUD —— 单行
    app.get('/api/trash', requireLocalhost, this.wrapHandler(this.handleListTrash));
    app.post('/api/trash/:type/:trashId/restore', requireLocalhost, this.wrapHandler(this.handleRestore));
    app.delete('/api/trash/:type/:trashId', requireLocalhost, this.wrapHandler(this.handleTrashPermanentDelete));
    app.delete('/api/trash', requireLocalhost, this.wrapHandler(this.handleTrashClearAll));
    // 回收站按项目维度 —— 聚合视图 + 整批恢复 / 永久删
    app.get('/api/trash/projects', requireLocalhost, this.wrapHandler(this.handleListTrashProjects));
    app.post('/api/trash/projects/:name/restore', requireLocalhost, this.wrapHandler(this.handleRestoreProject));
    app.delete('/api/trash/projects/:name', requireLocalhost, this.wrapHandler(this.handleProjectPermanentDelete));
    logger.info('SYSTEM', 'DeleteRoutes registered', {
      routes: [
        'DELETE /api/observations/:id',
        'DELETE /api/sessions/:id',
        'DELETE /api/projects/:name',
        'GET /api/trash',
        'POST /api/trash/:type/:trashId/restore',
        'DELETE /api/trash/:type/:trashId',
        'DELETE /api/trash',
        'GET /api/trash/projects',
        'POST /api/trash/projects/:name/restore',
        'DELETE /api/trash/projects/:name',
      ],
    });
  }

  // ── 影子表 lazy 初始化 ──────────────────────────────────────
  private ensureTrashTables(): void {
    if (this.trashTablesEnsured) return;
    const db = this.dbManager.getDatabase();
    db.run(`
      CREATE TABLE IF NOT EXISTS trash_observations (
        trash_id           INTEGER PRIMARY KEY AUTOINCREMENT,
        original_id        INTEGER NOT NULL,
        memory_session_id  TEXT,
        project            TEXT,
        payload            TEXT NOT NULL,
        deleted_at_epoch   INTEGER NOT NULL,
        reason             TEXT NOT NULL
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_obs_deleted ON trash_observations(deleted_at_epoch DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_obs_project ON trash_observations(project)');

    db.run(`
      CREATE TABLE IF NOT EXISTS trash_sessions (
        trash_id           INTEGER PRIMARY KEY AUTOINCREMENT,
        original_id        INTEGER NOT NULL,
        memory_session_id  TEXT,
        project            TEXT,
        payload            TEXT NOT NULL,
        deleted_at_epoch   INTEGER NOT NULL,
        reason             TEXT NOT NULL
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_sess_deleted ON trash_sessions(deleted_at_epoch DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_sess_project ON trash_sessions(project)');

    db.run(`
      CREATE TABLE IF NOT EXISTS trash_summaries (
        trash_id           INTEGER PRIMARY KEY AUTOINCREMENT,
        original_id        INTEGER NOT NULL,
        memory_session_id  TEXT,
        project            TEXT,
        payload            TEXT NOT NULL,
        deleted_at_epoch   INTEGER NOT NULL,
        reason             TEXT NOT NULL
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_sum_deleted ON trash_summaries(deleted_at_epoch DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_trash_sum_project ON trash_summaries(project)');

    this.trashTablesEnsured = true;
    logger.info('DB', 'trash tables ensured');
  }

  // ── 公共:软删完后重新广播 projects 列表 ─────────────────────
  // viewer 项目下拉靠 SSE 的 initial_load.projects;不重新广播,删了的项目还在
  private rebroadcastProjects(): void {
    try {
      const catalog = this.dbManager.getSessionStore().getProjectCatalog();
      this.sseBroadcaster.broadcast({
        type: 'initial_load',
        projects: catalog.projects,
        sources: catalog.sources,
        projectsBySource: catalog.projectsBySource,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn('HTTP', 'Failed to rebroadcast projects after delete', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 软删除路由
  // ═══════════════════════════════════════════════════════════

  private handleDeleteObservation = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const id = this.parseIntParam(req, res, 'id');
    if (id === null) return;

    const db = this.dbManager.getDatabase();
    const row = db.query('SELECT * FROM observations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      this.notFound(res, `Observation ${id} not found`);
      return;
    }

    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO trash_observations
          (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        (row.memory_session_id as string | null) ?? null,
        (row.project as string | null) ?? null,
        JSON.stringify(row),
        now,
        'observation',
      );
      db.prepare('DELETE FROM observations WHERE id = ?').run(id);
    });
    tx();

    const chromaSync = this.dbManager.getChromaSync();
    if (chromaSync) {
      chromaSync.deleteByObservationIds([id]).catch(() => { /* logged inside */ });
    }

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Observation soft-deleted', { id, project: row.project });
    res.json({ ok: true, deleted: { observations: 1, sessions: 0, summaries: 0 } });
  };

  private handleDeleteSession = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const memorySessionId = req.params.id;
    if (!memorySessionId) {
      this.badRequest(res, 'Missing session id');
      return;
    }

    const db = this.dbManager.getDatabase();
    const sessionRow = db.query('SELECT * FROM sdk_sessions WHERE memory_session_id = ?').get(memorySessionId) as Record<string, unknown> | undefined;
    if (!sessionRow) {
      this.notFound(res, `Session ${memorySessionId} not found`);
      return;
    }

    const counts = this.softDeleteSessions(db, [sessionRow], 'session');

    const chromaSync = this.dbManager.getChromaSync();
    if (chromaSync && counts.observationIds.length > 0) {
      chromaSync.deleteByObservationIds(counts.observationIds).catch(() => { /* logged inside */ });
    }

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Session soft-deleted', {
      memorySessionId,
      project: sessionRow.project,
      observations: counts.observations,
      summaries: counts.summaries,
    });
    res.json({
      ok: true,
      deleted: { sessions: 1, observations: counts.observations, summaries: counts.summaries },
    });
  };

  private handleDeleteProject = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const project = req.params.name;
    if (!project) {
      this.badRequest(res, 'Missing project name');
      return;
    }

    const db = this.dbManager.getDatabase();
    const sessionRows = db.query('SELECT * FROM sdk_sessions WHERE project = ?').all(project) as Record<string, unknown>[];
    if (sessionRows.length === 0) {
      this.notFound(res, `No sessions for project "${project}"`);
      return;
    }

    const counts = this.softDeleteSessions(db, sessionRows, 'project');

    // 项目下还可能有不属于任何 session 的孤立 observation(理论上不应该,但兜底)
    const orphanRows = db.query('SELECT * FROM observations WHERE project = ?').all(project) as ObservationRow[];
    if (orphanRows.length > 0) {
      const orphanIds = orphanRows.map(r => r.id);
      const now = Date.now();
      const tx = db.transaction(() => {
        const insertObs = db.prepare(`
          INSERT INTO trash_observations
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of orphanRows) {
          insertObs.run(row.id, row.memory_session_id ?? null, row.project ?? null, JSON.stringify(row), now, 'project');
        }
        db.prepare('DELETE FROM observations WHERE project = ?').run(project);
      });
      tx();
      counts.observations += orphanRows.length;
      counts.observationIds.push(...orphanIds);
    }

    const chromaSync = this.dbManager.getChromaSync();
    if (chromaSync && counts.observationIds.length > 0) {
      chromaSync.deleteByObservationIds(counts.observationIds).catch(() => { /* logged inside */ });
    }

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Project soft-deleted', {
      project,
      sessions: sessionRows.length,
      observations: counts.observations,
      summaries: counts.summaries,
    });
    res.json({
      ok: true,
      deleted: { sessions: sessionRows.length, observations: counts.observations, summaries: counts.summaries },
    });
  };

  private softDeleteSessions(
    db: Database,
    sessionRows: Record<string, unknown>[],
    reason: 'session' | 'project',
  ): { observations: number; summaries: number; observationIds: number[] } {
    const now = Date.now();
    const memorySessionIds = sessionRows
      .map(r => (r.memory_session_id as string | null) ?? null)
      .filter((id): id is string => id !== null);

    let observations = 0;
    let summaries = 0;
    const observationIds: number[] = [];

    if (memorySessionIds.length > 0) {
      const placeholders = memorySessionIds.map(() => '?').join(',');
      const obsRows = db.query(`SELECT * FROM observations WHERE memory_session_id IN (${placeholders})`).all(...memorySessionIds) as ObservationRow[];
      observations = obsRows.length;
      observationIds.push(...obsRows.map(r => r.id));
      const sumRows = db.query(`SELECT * FROM session_summaries WHERE memory_session_id IN (${placeholders})`).all(...memorySessionIds) as Record<string, unknown>[];
      summaries = sumRows.length;

      const tx = db.transaction(() => {
        const insertObs = db.prepare(`
          INSERT INTO trash_observations
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of obsRows) {
          insertObs.run(row.id, row.memory_session_id ?? null, row.project ?? null, JSON.stringify(row), now, reason);
        }
        const insertSum = db.prepare(`
          INSERT INTO trash_summaries
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of sumRows) {
          insertSum.run(row.id as number, (row.memory_session_id as string | null) ?? null, (row.project as string | null) ?? null, JSON.stringify(row), now, reason);
        }
        const insertSess = db.prepare(`
          INSERT INTO trash_sessions
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of sessionRows) {
          insertSess.run(row.id as number, (row.memory_session_id as string | null) ?? null, (row.project as string | null) ?? null, JSON.stringify(row), now, reason);
        }
        db.prepare(`DELETE FROM observations WHERE memory_session_id IN (${placeholders})`).run(...memorySessionIds);
        db.prepare(`DELETE FROM session_summaries WHERE memory_session_id IN (${placeholders})`).run(...memorySessionIds);
        const sessionDbIds = sessionRows.map(r => r.id as number);
        const sessionPlaceholders = sessionDbIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM sdk_sessions WHERE id IN (${sessionPlaceholders})`).run(...sessionDbIds);
      });
      tx();
    } else {
      // 极端兜底:session 没有 memory_session_id (active 但还没 ready),只删 sdk_sessions 行
      const tx = db.transaction(() => {
        const insertSess = db.prepare(`
          INSERT INTO trash_sessions
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of sessionRows) {
          insertSess.run(row.id as number, null, (row.project as string | null) ?? null, JSON.stringify(row), now, reason);
        }
        const sessionDbIds = sessionRows.map(r => r.id as number);
        const sessionPlaceholders = sessionDbIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM sdk_sessions WHERE id IN (${sessionPlaceholders})`).run(...sessionDbIds);
      });
      tx();
    }

    return { observations, summaries, observationIds };
  }

  // ═══════════════════════════════════════════════════════════
  // 回收站 CRUD
  // ═══════════════════════════════════════════════════════════

  // GET /api/trash?type=observations|sessions|summaries&project=X&limit=200
  private handleListTrash = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const db = this.dbManager.getDatabase();
    const filterType = (req.query.type as string | undefined) || null;
    const project = (req.query.project as string | undefined) || null;
    const limit = Math.min(parseInt((req.query.limit as string) || '500', 10) || 500, 2000);

    const types: TrashType[] = filterType && (TRASH_TYPES as readonly string[]).includes(filterType)
      ? [filterType as TrashType]
      : [...TRASH_TYPES];

    const result: Record<TrashType, TrashRow[]> = {
      observations: [],
      sessions: [],
      summaries: [],
    };

    for (const t of types) {
      const table = TRASH_TABLE[t];
      const sql = project
        ? `SELECT * FROM ${table} WHERE project = ? ORDER BY deleted_at_epoch DESC LIMIT ?`
        : `SELECT * FROM ${table} ORDER BY deleted_at_epoch DESC LIMIT ?`;
      const rows = (project
        ? db.query(sql).all(project, limit)
        : db.query(sql).all(limit)) as TrashRow[];
      result[t] = rows;
    }

    res.json({
      ok: true,
      observations: result.observations,
      sessions: result.sessions,
      summaries: result.summaries,
      totals: {
        observations: result.observations.length,
        sessions: result.sessions.length,
        summaries: result.summaries.length,
      },
    });
  };

  // POST /api/trash/:type/:trashId/restore
  private handleRestore = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const type = req.params.type as TrashType;
    if (!(TRASH_TYPES as readonly string[]).includes(type)) {
      this.badRequest(res, `Invalid trash type "${type}"`);
      return;
    }
    const trashId = parseInt(req.params.trashId, 10);
    if (isNaN(trashId)) {
      this.badRequest(res, 'Invalid trashId');
      return;
    }

    const db = this.dbManager.getDatabase();
    const trashTable = TRASH_TABLE[type];
    const mainTable = MAIN_TABLE[type];
    const trashRow = db.query(`SELECT * FROM ${trashTable} WHERE trash_id = ?`).get(trashId) as TrashRow | undefined;
    if (!trashRow) {
      this.notFound(res, `Trash ${type} #${trashId} not found`);
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(trashRow.payload);
    } catch (error) {
      logger.error('SYSTEM', 'Trash payload corrupted', { type, trashId }, error as Error);
      res.status(500).json({ error: 'Trash payload corrupted (cannot parse JSON)' });
      return;
    }

    // 主表是否已有同 id?(并发或半恢复状态)
    const existing = db.query(`SELECT id FROM ${mainTable} WHERE id = ?`).get(payload.id as number);
    if (existing) {
      res.status(409).json({ error: `${mainTable} id=${payload.id} already exists in main table — restore would conflict` });
      return;
    }

    const columns = Object.keys(payload);
    const placeholders = columns.map(() => '?').join(',');
    const colNames = columns.map(c => `"${c}"`).join(',');
    const values = columns.map(c => payload[c] as unknown);

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO ${mainTable} (${colNames}) VALUES (${placeholders})`).run(...values as (string | number | null)[]);
      db.prepare(`DELETE FROM ${trashTable} WHERE trash_id = ?`).run(trashId);
    });
    tx();

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Trash row restored', { type, trashId, originalId: payload.id });
    res.json({ ok: true, restored: { type, originalId: payload.id } });
  };

  // DELETE /api/trash/:type/:trashId
  private handleTrashPermanentDelete = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const type = req.params.type as TrashType;
    if (!(TRASH_TYPES as readonly string[]).includes(type)) {
      this.badRequest(res, `Invalid trash type "${type}"`);
      return;
    }
    const trashId = parseInt(req.params.trashId, 10);
    if (isNaN(trashId)) {
      this.badRequest(res, 'Invalid trashId');
      return;
    }

    const db = this.dbManager.getDatabase();
    const result = db.prepare(`DELETE FROM ${TRASH_TABLE[type]} WHERE trash_id = ?`).run(trashId);
    if (result.changes === 0) {
      this.notFound(res, `Trash ${type} #${trashId} not found`);
      return;
    }
    logger.info('SYSTEM', 'Trash row permanently deleted', { type, trashId });
    res.json({ ok: true });
  };

  // DELETE /api/trash  (清空所有)
  private handleTrashClearAll = async (_req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const db = this.dbManager.getDatabase();
    let totalCleared = 0;
    const tx = db.transaction(() => {
      for (const t of TRASH_TYPES) {
        const result = db.prepare(`DELETE FROM ${TRASH_TABLE[t]}`).run();
        totalCleared += result.changes;
      }
    });
    tx();
    logger.info('SYSTEM', 'Trash cleared (all)', { totalRows: totalCleared });
    res.json({ ok: true, cleared: totalCleared });
  };

  // ═══════════════════════════════════════════════════════════
  // 回收站按项目聚合视图 + 整批操作
  // ═══════════════════════════════════════════════════════════

  // GET /api/trash/projects → [{ project, observations, sessions, summaries, lastDeletedAt }]
  private handleListTrashProjects = async (_req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const db = this.dbManager.getDatabase();

    // 按 project 聚合三类 trash + 取最近删除时间
    const sql = `
      SELECT project,
             SUM(observations) AS observations,
             SUM(sessions)     AS sessions,
             SUM(summaries)    AS summaries,
             MAX(last_deleted) AS last_deleted_at
      FROM (
        SELECT project, COUNT(*) AS observations, 0 AS sessions, 0 AS summaries,
               MAX(deleted_at_epoch) AS last_deleted
          FROM trash_observations WHERE project IS NOT NULL GROUP BY project
        UNION ALL
        SELECT project, 0, COUNT(*), 0, MAX(deleted_at_epoch)
          FROM trash_sessions WHERE project IS NOT NULL GROUP BY project
        UNION ALL
        SELECT project, 0, 0, COUNT(*), MAX(deleted_at_epoch)
          FROM trash_summaries WHERE project IS NOT NULL GROUP BY project
      )
      GROUP BY project
      ORDER BY last_deleted_at DESC
    `;
    const rows = db.query(sql).all() as Array<{
      project: string;
      observations: number;
      sessions: number;
      summaries: number;
      last_deleted_at: number;
    }>;

    res.json({
      ok: true,
      projects: rows.map(r => ({
        project: r.project,
        observations: Number(r.observations) || 0,
        sessions: Number(r.sessions) || 0,
        summaries: Number(r.summaries) || 0,
        lastDeletedAt: Number(r.last_deleted_at) || 0,
      })),
    });
  };

  // POST /api/trash/projects/:name/restore → 整批恢复某项目所有 trash 行
  private handleRestoreProject = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const project = req.params.name;
    if (!project) {
      this.badRequest(res, 'Missing project name');
      return;
    }

    const db = this.dbManager.getDatabase();
    const trashSessions = db.query('SELECT * FROM trash_sessions WHERE project = ?').all(project) as TrashRow[];
    const trashObs = db.query('SELECT * FROM trash_observations WHERE project = ?').all(project) as TrashRow[];
    const trashSums = db.query('SELECT * FROM trash_summaries WHERE project = ?').all(project) as TrashRow[];

    if (trashSessions.length + trashObs.length + trashSums.length === 0) {
      this.notFound(res, `No trash for project "${project}"`);
      return;
    }

    let restored = { observations: 0, sessions: 0, summaries: 0 };
    const errors: string[] = [];

    try {
      const tx = db.transaction(() => {
        // 关 FK 直到事务结束(SQLite 在 commit 时再校验,允许临时不一致)
        // 必要:obs/sum 引用 sdk_sessions(memory_session_id),不延迟会因顺序问题 FK 失败
        db.run('PRAGMA defer_foreign_keys = ON');

        // 1. 先恢复 sessions(父表)
        for (const row of trashSessions) {
          const payload = JSON.parse(row.payload) as Record<string, unknown>;
          const cols = Object.keys(payload);
          const colNames = cols.map(c => `"${c}"`).join(',');
          const placeholders = cols.map(() => '?').join(',');
          db.prepare(`INSERT INTO sdk_sessions (${colNames}) VALUES (${placeholders})`).run(
            ...cols.map(c => payload[c] as string | number | null)
          );
          db.prepare('DELETE FROM trash_sessions WHERE trash_id = ?').run(row.trash_id);
          restored.sessions += 1;
        }

        // 2. 再恢复 observations
        for (const row of trashObs) {
          const payload = JSON.parse(row.payload) as Record<string, unknown>;
          const cols = Object.keys(payload);
          const colNames = cols.map(c => `"${c}"`).join(',');
          const placeholders = cols.map(() => '?').join(',');
          db.prepare(`INSERT INTO observations (${colNames}) VALUES (${placeholders})`).run(
            ...cols.map(c => payload[c] as string | number | null)
          );
          db.prepare('DELETE FROM trash_observations WHERE trash_id = ?').run(row.trash_id);
          restored.observations += 1;
        }

        // 3. 最后恢复 summaries
        for (const row of trashSums) {
          const payload = JSON.parse(row.payload) as Record<string, unknown>;
          const cols = Object.keys(payload);
          const colNames = cols.map(c => `"${c}"`).join(',');
          const placeholders = cols.map(() => '?').join(',');
          db.prepare(`INSERT INTO session_summaries (${colNames}) VALUES (${placeholders})`).run(
            ...cols.map(c => payload[c] as string | number | null)
          );
          db.prepare('DELETE FROM trash_summaries WHERE trash_id = ?').run(row.trash_id);
          restored.summaries += 1;
        }
      });
      tx();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('SYSTEM', 'Project restore failed', { project }, error as Error);
      res.status(500).json({
        error: `Project restore failed: ${msg}`,
        hint: 'Likely an id collision (the original ids were re-used by new data). Inspect /api/trash for affected rows.',
      });
      return;
    }

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Project trash restored', { project, ...restored });
    res.json({ ok: true, restored });
  };

  // DELETE /api/trash/projects/:name → 整批永久删项目所有 trash 行
  private handleProjectPermanentDelete = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const project = req.params.name;
    if (!project) {
      this.badRequest(res, 'Missing project name');
      return;
    }

    const db = this.dbManager.getDatabase();
    let total = 0;
    const tx = db.transaction(() => {
      for (const t of TRASH_TYPES) {
        const result = db.prepare(`DELETE FROM ${TRASH_TABLE[t]} WHERE project = ?`).run(project);
        total += result.changes;
      }
    });
    tx();

    if (total === 0) {
      this.notFound(res, `No trash for project "${project}"`);
      return;
    }

    logger.info('SYSTEM', 'Project trash permanently deleted', { project, totalRows: total });
    res.json({ ok: true, deleted: total });
  };
}
