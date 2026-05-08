/**
 * DeleteRoutes — 项目/会话/单条 observation 三级软删 + 回收站 CRUD
 *
 * 路由表:
 *   DELETE /api/observations/:id          软删一条 observation → trash_observations
 *   DELETE /api/sessions/:id              软删一个 session → trash_sessions(级联其 obs/sum/prompt)
 *   DELETE /api/projects/:name            软删项目所有 session → trash_*
 *   POST   /api/projects/:name/rename     物理改名(UPDATE 主表 + trash 表 + payload JSON)
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
    app.post('/api/projects/:name/rename', requireLocalhost, this.wrapHandler(this.handleRenameProject));
    // 回收站 CRUD ——
    // 注意:Express 按注册顺序匹配,具体路径必须先于通配路径
    // 否则 /api/trash/projects/foo/restore 会被 /api/trash/:type/:trashId/restore 抢走,
    // :type 拿到 "projects" 然后校验失败
    app.get('/api/trash', requireLocalhost, this.wrapHandler(this.handleListTrash));
    app.delete('/api/trash', requireLocalhost, this.wrapHandler(this.handleTrashClearAll));
    // —— 项目维度(具体)在前 ——
    app.get('/api/trash/projects', requireLocalhost, this.wrapHandler(this.handleListTrashProjects));
    app.post('/api/trash/projects/:name/restore', requireLocalhost, this.wrapHandler(this.handleRestoreProject));
    app.delete('/api/trash/projects/:name', requireLocalhost, this.wrapHandler(this.handleProjectPermanentDelete));
    // —— 通配(:type)在后 ——
    app.post('/api/trash/:type/:trashId/restore', requireLocalhost, this.wrapHandler(this.handleRestore));
    app.delete('/api/trash/:type/:trashId', requireLocalhost, this.wrapHandler(this.handleTrashPermanentDelete));
    logger.info('SYSTEM', 'DeleteRoutes registered', {
      routes: [
        'DELETE /api/observations/:id',
        'DELETE /api/sessions/:id',
        'DELETE /api/projects/:name',
        'POST /api/projects/:name/rename',
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

    // sdk_sessions 没行不代表项目空 — observations / session_summaries / projects v2
    // 三表都可能有残留(历史 FK 未启用、人为清表等)。先扫一圈,真的全空才返回 404。
    const orphanSummaries = db.query('SELECT COUNT(*) AS n FROM session_summaries WHERE project = ?').get(project) as { n: number };
    const orphanObs = db.query('SELECT COUNT(*) AS n FROM observations WHERE project = ?').get(project) as { n: number };
    const v2Project = db.query('SELECT id FROM projects WHERE name = ?').get(project) as { id: number } | undefined;

    if (sessionRows.length === 0 && orphanSummaries.n === 0 && orphanObs.n === 0 && !v2Project) {
      this.notFound(res, `No data for project "${project}"`);
      return;
    }

    const counts = sessionRows.length > 0
      ? this.softDeleteSessions(db, sessionRows, 'project')
      : { observations: 0, summaries: 0, observationIds: [] as number[] };

    // 清 session_summaries 字符串残留(softDeleteSessions 走 sdk_session 关联,
    // 漏掉 sdk_sessions 已不存在但 sess 还在的孤儿场景)
    if (orphanSummaries.n > 0) {
      const now = Date.now();
      const sumRows = db.query('SELECT * FROM session_summaries WHERE project = ?').all(project) as Record<string, unknown>[];
      const tx = db.transaction(() => {
        const ins = db.prepare(`
          INSERT INTO trash_summaries
            (original_id, memory_session_id, project, payload, deleted_at_epoch, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const row of sumRows) {
          ins.run(row.id, row.memory_session_id ?? null, row.project ?? null, JSON.stringify(row), now, 'project');
        }
        db.prepare('DELETE FROM session_summaries WHERE project = ?').run(project);
      });
      tx();
      counts.summaries += sumRows.length;
    }

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

  // POST /api/projects/:name/rename  body: { newName: string }
  // 物理改名:UPDATE 主表 / 软删影子表 / 影子表 payload JSON 内的 project 字段
  // 不改:shared_view / projects_sync / sync_pending_downgrades(cmem-sync 与 server 端绑定的同步元数据)
  // 不改派生逻辑:下次同 cwd 触发 hook 仍按 basename 写入旧名,本接口仅整理历史
  private handleRenameProject = async (req: Request, res: Response): Promise<void> => {
    this.ensureTrashTables();
    const oldName = req.params.name;
    if (!oldName) {
      this.badRequest(res, 'Missing project name');
      return;
    }

    const rawNew = (req.body && typeof (req.body as Record<string, unknown>).newName === 'string')
      ? ((req.body as Record<string, string>).newName as string)
      : '';
    const newName = rawNew.trim();

    if (!newName) {
      this.badRequest(res, 'newName must be a non-empty string');
      return;
    }
    if (newName === oldName) {
      this.badRequest(res, 'newName must differ from current name');
      return;
    }
    if (newName.length > 200) {
      this.badRequest(res, 'newName too long (max 200 chars)');
      return;
    }
    if (/[\x00-\x1f]/.test(newName)) {
      this.badRequest(res, 'newName contains control characters');
      return;
    }

    const db = this.dbManager.getDatabase();

    const exists = db.query('SELECT 1 FROM sdk_sessions WHERE project = ? LIMIT 1').get(oldName);
    if (!exists) {
      this.notFound(res, `No sessions for project "${oldName}"`);
      return;
    }

    // 与现有项目重名 = 静默合并,默认拒绝(回收站里也算冲突,以免 restore 时撞)
    const conflict =
      db.query('SELECT 1 FROM sdk_sessions WHERE project = ? LIMIT 1').get(newName) ||
      db.query('SELECT 1 FROM observations WHERE project = ? LIMIT 1').get(newName) ||
      db.query('SELECT 1 FROM session_summaries WHERE project = ? LIMIT 1').get(newName);
    if (conflict) {
      res.status(409).json({
        error: `Project "${newName}" already exists; refusing to merge silently`,
        code: 'NAME_CONFLICT',
      });
      return;
    }

    const totals = {
      sessions: 0,
      observations: 0,
      summaries: 0,
      mergedObs: 0,
      mergedSum: 0,
      trashObs: 0,
      trashSess: 0,
      trashSum: 0,
    };

    const tx = db.transaction(() => {
      totals.sessions = db.prepare('UPDATE sdk_sessions SET project = ? WHERE project = ?')
        .run(newName, oldName).changes;
      totals.observations = db.prepare('UPDATE observations SET project = ? WHERE project = ?')
        .run(newName, oldName).changes;
      totals.summaries = db.prepare('UPDATE session_summaries SET project = ? WHERE project = ?')
        .run(newName, oldName).changes;
      totals.mergedObs = db.prepare('UPDATE observations SET merged_into_project = ? WHERE merged_into_project = ?')
        .run(newName, oldName).changes;
      totals.mergedSum = db.prepare('UPDATE session_summaries SET merged_into_project = ? WHERE merged_into_project = ?')
        .run(newName, oldName).changes;

      // trash 表:列 + payload JSON 一起改,否则 restore 出来的还是旧名
      const trashTables: Array<{ table: string; counter: 'trashObs' | 'trashSess' | 'trashSum' }> = [
        { table: 'trash_observations', counter: 'trashObs' },
        { table: 'trash_sessions',     counter: 'trashSess' },
        { table: 'trash_summaries',    counter: 'trashSum' },
      ];
      for (const { table, counter } of trashTables) {
        const rows = db.query(`SELECT trash_id, payload FROM ${table} WHERE project = ?`)
          .all(oldName) as Array<{ trash_id: number; payload: string }>;
        const update = db.prepare(`UPDATE ${table} SET project = ?, payload = ? WHERE trash_id = ?`);
        for (const row of rows) {
          let payloadOut = row.payload;
          try {
            const parsed = JSON.parse(row.payload) as Record<string, unknown>;
            if (parsed.project === oldName) parsed.project = newName;
            if (parsed.merged_into_project === oldName) parsed.merged_into_project = newName;
            payloadOut = JSON.stringify(parsed);
          } catch {
            // payload 已损坏,只改列名
          }
          update.run(newName, payloadOut, row.trash_id);
          totals[counter] += 1;
        }
      }
    });
    tx();

    this.rebroadcastProjects();
    // 通知 viewer 把内存里 live observations / summaries / prompts 中 project===old 的项 patch 成 new
    // 否则因 useSSE 累积旧 project 字段 + dedup 优先 live,UI 会一直显示旧名直到刷页
    this.sseBroadcaster.broadcast({
      type: 'project_renamed',
      oldName,
      newName,
    });
    logger.info('SYSTEM', 'Project renamed', { oldName, newName, ...totals });
    res.json({ ok: true, oldName, newName, updated: totals });
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
  // 行为:
  //   type=sessions: 恢复 sdk_sessions 行,同时把 trash 表里属于该 session 的
  //                  observations/summaries 也一并恢复(级联恢复子项)
  //   type=observations/summaries: 检查父 session 是否在主表;不在 → 409,
  //                  让 UI 引导用户通过会话或项目维度整批恢复
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

    // 子项(obs/sum)恢复前必须父 session 在主表存在(FK 约束)
    if (type === 'observations' || type === 'summaries') {
      const memSessionId = payload.memory_session_id as string | null;
      if (memSessionId) {
        const parent = db.query('SELECT id FROM sdk_sessions WHERE memory_session_id = ?').get(memSessionId);
        if (!parent) {
          res.status(409).json({
            error: `Parent session "${memSessionId}" not in sdk_sessions — cannot restore orphan ${type} row`,
            hint: 'Restore via the session row or the project tab so the session is recreated first.',
            code: 'ORPHAN_NO_PARENT',
          });
          return;
        }
      }
    }

    const restoredCounts = { observations: 0, sessions: 0, summaries: 0 };

    try {
      const tx = db.transaction(() => {
        db.run('PRAGMA defer_foreign_keys = ON');

        // 1. 恢复主行
        const cols = Object.keys(payload);
        const colNames = cols.map(c => `"${c}"`).join(',');
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT INTO ${mainTable} (${colNames}) VALUES (${placeholders})`).run(
          ...cols.map(c => payload[c] as string | number | null)
        );
        db.prepare(`DELETE FROM ${trashTable} WHERE trash_id = ?`).run(trashId);
        if (type === 'observations') restoredCounts.observations += 1;
        if (type === 'summaries')    restoredCounts.summaries    += 1;
        if (type === 'sessions')     restoredCounts.sessions     += 1;

        // 2. 如果是 session 级恢复,把 trash 表里同 memory_session_id 的 obs/sum 一并恢复
        if (type === 'sessions') {
          const memSessionId = payload.memory_session_id as string | null;
          if (memSessionId) {
            const childObs = db.query('SELECT * FROM trash_observations WHERE memory_session_id = ?').all(memSessionId) as TrashRow[];
            const childSums = db.query('SELECT * FROM trash_summaries WHERE memory_session_id = ?').all(memSessionId) as TrashRow[];

            for (const row of childObs) {
              const p = JSON.parse(row.payload) as Record<string, unknown>;
              const c = Object.keys(p);
              const cn = c.map(x => `"${x}"`).join(',');
              const ph = c.map(() => '?').join(',');
              db.prepare(`INSERT INTO observations (${cn}) VALUES (${ph})`).run(
                ...c.map(x => p[x] as string | number | null)
              );
              db.prepare('DELETE FROM trash_observations WHERE trash_id = ?').run(row.trash_id);
              restoredCounts.observations += 1;
            }
            for (const row of childSums) {
              const p = JSON.parse(row.payload) as Record<string, unknown>;
              const c = Object.keys(p);
              const cn = c.map(x => `"${x}"`).join(',');
              const ph = c.map(() => '?').join(',');
              db.prepare(`INSERT INTO session_summaries (${cn}) VALUES (${ph})`).run(
                ...c.map(x => p[x] as string | number | null)
              );
              db.prepare('DELETE FROM trash_summaries WHERE trash_id = ?').run(row.trash_id);
              restoredCounts.summaries += 1;
            }
          }
        }
      });
      tx();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('SYSTEM', 'Trash row restore failed', { type, trashId }, error as Error);
      res.status(500).json({ error: `Restore failed: ${msg}` });
      return;
    }

    this.rebroadcastProjects();
    logger.info('SYSTEM', 'Trash row restored', { type, trashId, originalId: payload.id, ...restoredCounts });
    res.json({ ok: true, restored: { type, originalId: payload.id, ...restoredCounts } });
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
