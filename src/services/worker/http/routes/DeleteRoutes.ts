/**
 * DeleteRoutes — 项目/会话/单条 observation 三级软删除
 *
 * 设计点:
 *  - 软删: 行进 trash_observations / trash_sessions / trash_summaries 影子表(JSON payload),再 DELETE 主表
 *  - trash 表用 CREATE IF NOT EXISTS 在路由初始化时建,**不走 schema migration**,
 *    避免与 upstream 的 migration 版本冲突 (rebase 友好)
 *  - 主表外键 ON DELETE CASCADE 已经处理 observations / summaries / prompts / pending_messages 级联
 *  - Chroma 向量异步删,失败只 log warn (SQLite trash 是真相源)
 *  - 全部路由 requireLocalhost,跟 admin 路由策略一致
 */

import express, { Request, Response } from 'express';
import { Database } from 'bun:sqlite';
import { logger } from '../../../../utils/logger.js';
import { DatabaseManager } from '../../DatabaseManager.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { requireLocalhost } from '../../../server/Middleware.js';

interface SessionRow {
  id: number;
  memory_session_id: string | null;
  project: string;
}

interface ObservationRow {
  id: number;
  memory_session_id: string;
  project: string;
}

export class DeleteRoutes extends BaseRouteHandler {
  private trashTablesEnsured = false;

  constructor(private dbManager: DatabaseManager) {
    super();
    // 注意:不在构造时建表 —— worker-service 的 registerRoutes() 在 dbManager.initialize()
    // 之前调用,此时 getDatabase() 会抛 "Database not initialized"
    // 改成 lazy,首次 DELETE 请求时建表(此时 init 已完成,有 /api/* guard middleware 保证)
  }

  setupRoutes(app: express.Application): void {
    app.delete('/api/observations/:id', requireLocalhost, this.wrapHandler(this.handleDeleteObservation));
    app.delete('/api/sessions/:id', requireLocalhost, this.wrapHandler(this.handleDeleteSession));
    app.delete('/api/projects/:name', requireLocalhost, this.wrapHandler(this.handleDeleteProject));
    logger.info('SYSTEM', 'DeleteRoutes registered', {
      routes: ['/api/observations/:id', '/api/sessions/:id', '/api/projects/:name'],
    });
  }

  // ── 影子表 lazy 初始化(首次请求时调一次)──────────────────────
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
    logger.info('DB', 'trash_observations / trash_sessions / trash_summaries ensured');
  }

  // ── DELETE /api/observations/:id ─────────────────────────────
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

    // Chroma 异步清,失败不阻塞响应
    const chromaSync = this.dbManager.getChromaSync();
    if (chromaSync) {
      chromaSync.deleteByObservationIds([id]).catch(() => { /* logged inside */ });
    }

    logger.info('SYSTEM', 'Observation soft-deleted', { id, project: row.project });
    res.json({ ok: true, deleted: { observations: 1, sessions: 0, summaries: 0 } });
  };

  // ── DELETE /api/sessions/:id ─────────────────────────────────
  // :id = memory_session_id (前端 SummaryCard 用 summary.session_id 传过来)
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

    // 异步删 Chroma 向量
    const chromaSync = this.dbManager.getChromaSync();
    if (chromaSync && counts.observationIds.length > 0) {
      chromaSync.deleteByObservationIds(counts.observationIds).catch(() => { /* logged inside */ });
    }

    logger.info('SYSTEM', 'Session soft-deleted', {
      memorySessionId,
      project: sessionRow.project,
      observations: counts.observations,
      summaries: counts.summaries,
    });
    res.json({
      ok: true,
      deleted: {
        sessions: 1,
        observations: counts.observations,
        summaries: counts.summaries,
      },
    });
  };

  // ── DELETE /api/projects/:name ───────────────────────────────
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

    logger.info('SYSTEM', 'Project soft-deleted', {
      project,
      sessions: sessionRows.length,
      observations: counts.observations,
      summaries: counts.summaries,
    });
    res.json({
      ok: true,
      deleted: {
        sessions: sessionRows.length,
        observations: counts.observations,
        summaries: counts.summaries,
      },
    });
  };

  /**
   * 把若干 sdk_sessions 行连同其 observations / summaries 一起软删。
   * 走单事务:先把 obs/sum 复制到 trash 并 DELETE,再把 session 复制到 trash 并 DELETE
   * (DELETE FROM sdk_sessions 会通过 FK CASCADE 把 user_prompts / pending_messages 也带走)
   */
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
        // 实际删除 — sdk_sessions 的 CASCADE 会把 user_prompts / pending_messages
        // 自动清掉(observations / session_summaries 我们上面已显式 DELETE,
        // 但 CASCADE 重复 DELETE 也无副作用,所以保留显式 DELETE 让逻辑清晰)
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
}
