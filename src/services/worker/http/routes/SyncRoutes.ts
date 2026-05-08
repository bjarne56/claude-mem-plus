/**
 * SyncRoutes — /api/sync/* HTTP 路由(worker 内,localhost 限定)
 *
 * 把 SyncManager 的能力暴露给:
 *   - npx-cli sync 子命令
 *   - viewer SyncSettingsModal
 *
 * 全部 localhost-only — sync_state 里有 token,不可远程访问。
 *
 * 路由:
 *   GET  /api/sync/state        当前 SyncManager.localStatus()
 *   GET  /api/sync/me           当前 user / machine / server
 *   POST /api/sync/login        交互登录,body: { server_url, username, password, machine_name, machine_description }
 *   POST /api/sync/logout
 *   POST /api/sync/register     body: { server_url, username, password, email?, invite_code? }
 *   POST /api/sync/push
 *   POST /api/sync/pull
 *   GET  /api/sync/projects     列出本地 projects_sync + 状态
 *   POST /api/sync/share-project    body: { project_name, share_mode, target_type, target_username? }
 *   POST /api/sync/unshare-project  body: { project_name, target_type }
 *   POST /api/sync/fork-project     body: { sharer_username, project_name, new_name? }
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../../../utils/logger.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';
import { requireLocalhost } from '../../../server/Middleware.js';
import { SyncManager } from '../../../sync/SyncManager.js';
import { ApiClient } from '../../../sync/ApiClient.js';
import type { Database } from 'bun:sqlite';

const loginSchema = z.object({
  server_url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  machine_name: z.string().min(1),
  machine_description: z.string().optional(),
});

const registerSchema = z.object({
  server_url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  email: z.string().email().optional(),
  invite_code: z.string().optional(),
});

const shareSchema = z.object({
  project_name: z.string().min(1),
  share_mode: z.enum(['read-only', 'fork-allowed', 'auto-copy']),
  target_type: z.enum(['user', 'public', 'link']),
  target_username: z.string().optional(),
  expires_in_secs: z.number().int().positive().optional(),
});

const unshareSchema = z.object({
  project_name: z.string().min(1),
  target_type: z.enum(['user', 'public', 'link']).default('user'),
});

const forkSchema = z.object({
  sharer_username: z.string().min(1),
  project_name: z.string().min(1),
  new_name: z.string().optional(),
});

const autoSyncSchema = z.object({
  enabled: z.boolean().optional(),
  // UI 用分钟更直观,server 端转秒
  interval_minutes: z.number().int().min(1).max(1440).optional(),
  direction: z.enum(['push', 'pull', 'both']).optional(),
});

export class SyncRoutes extends BaseRouteHandler {
  private syncManager: SyncManager;

  /**
   * 优先用外部传入的 SyncManager(worker-service 持有同一实例,便于启动时控 timer);
   * 兼容旧调用:只传 db 时内部 new 一个。
   */
  constructor(dbOrManager: Database | SyncManager) {
    super();
    if (dbOrManager instanceof SyncManager) {
      this.syncManager = dbOrManager;
    } else {
      this.syncManager = new SyncManager(dbOrManager);
    }
  }

  /** 外部访问 manager(worker-service 启动时用来 startAutoSync) */
  getSyncManager(): SyncManager {
    return this.syncManager;
  }

  setupRoutes(app: express.Application): void {
    // 全部 localhost-only — 防止远程网络访问偷 token
    app.get('/api/sync/state', requireLocalhost, this.handleState.bind(this));
    app.get('/api/sync/me', requireLocalhost, this.handleMe.bind(this));
    app.get('/api/sync/projects', requireLocalhost, this.handleProjects.bind(this));
    app.get('/api/sync/remote-projects', requireLocalhost, this.handleRemoteProjects.bind(this));
    app.get('/api/sync/progress', requireLocalhost, this.handleProgress.bind(this));

    app.post('/api/sync/login', requireLocalhost, validateBody(loginSchema), this.handleLogin.bind(this));
    app.post('/api/sync/logout', requireLocalhost, this.handleLogout.bind(this));
    app.post('/api/sync/register', requireLocalhost, validateBody(registerSchema), this.handleRegister.bind(this));
    app.post('/api/sync/push', requireLocalhost, this.handlePush.bind(this));
    app.post('/api/sync/pull', requireLocalhost, this.handlePull.bind(this));
    app.post('/api/sync/delete-remote-project', requireLocalhost, this.handleDeleteRemoteProject.bind(this));
    app.post('/api/sync/share-project', requireLocalhost, validateBody(shareSchema), this.handleShare.bind(this));
    app.post('/api/sync/unshare-project', requireLocalhost, validateBody(unshareSchema), this.handleUnshare.bind(this));
    app.post('/api/sync/fork-project', requireLocalhost, validateBody(forkSchema), this.handleFork.bind(this));

    // 自动同步配置 — 读 / 写
    app.get('/api/sync/auto', requireLocalhost, this.handleAutoGet.bind(this));
    app.post('/api/sync/auto', requireLocalhost, validateBody(autoSyncSchema), this.handleAutoPost.bind(this));
  }

  // ===== handlers =====

  private handleState = this.wrapHandler((_req: Request, res: Response): void => {
    res.json(this.syncManager.localStatus());
  });

  private handleMe = this.wrapHandler((_req: Request, res: Response): void => {
    const s = this.syncManager.state.get();
    res.json({
      user: s.user_id ? { id: s.user_id, username: s.username } : null,
      machine: s.machine_id ? { id: s.machine_id, name: s.machine_name } : null,
      server_url: s.server_url,
    });
  });

  /// 当前同步进度(push/pull 实时)。UI 启动同步后轮询此端点显示进度条。
  /// idle = 没有同步在跑;phase=push/pull 时 current/total 反映行数进度。
  /// total=0 + phase!=idle = indeterminate(已开始但还没拿到总数)。
  private handleProgress = this.wrapHandler((_req: Request, res: Response): void => {
    res.json(this.syncManager.getProgress());
  });

  /// 拉取远程 server 上当前 user 的项目 + 各项目的 obs 数。
  /// 客户端用这个数据 vs 本地 projects_sync 数据做对比,展示"本地 N / 远程 M"。
  /// 未登录时返回空数组(不抛错,UI 只显示本地数据)。
  private handleRemoteProjects = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const s = this.syncManager.state.get();
    if (!s.access_token || !s.server_url) {
      res.json({ projects: [], loggedIn: false });
      return;
    }
    try {
      const apiClient = new ApiClient(this.syncManager.state);
      const r = await apiClient.listProjects();
      const projects = (r.projects ?? []).map((p: { id: string; name: string; observation_count?: number }) => ({
        id: p.id,
        name: p.name,
        observation_count: p.observation_count ?? 0,
      }));
      res.json({ projects, loggedIn: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('SYNC', 'listRemoteProjects 失败', { message: msg });
      res.status(502).json({ error: { code: 'REMOTE_LIST_FAILED', message: msg } });
    }
  });

  /// 同步删:client 删项目时调用,把 server 上同名项目也软删进回收站。
  /// body: { project_name: string }。
  /// - 未登录:返回 { ok: false, reason: 'not_logged_in' }(不阻塞本地删除)
  /// - 项目从未 push 过 server:返回 { ok: false, reason: 'no_server_id' }
  /// - server 删除失败:静默 warn,返回 { ok: false, reason: 'remote_failed' }
  /// - 成功:返回 { ok: true }
  /// 调用方应忽略错误,不阻塞主流程(本地删除是权威操作)。
  private handleDeleteRemoteProject = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const projectName = (req.body as { project_name?: string })?.project_name?.trim();
    if (!projectName) { res.status(400).json({ ok: false, reason: 'missing project_name' }); return; }

    const s = this.syncManager.state.get();
    if (!s.access_token || !s.server_url) {
      res.json({ ok: false, reason: 'not_logged_in' });
      return;
    }

    // 查 projects_sync 拿 server_project_id
    const row = this.syncManager.db
      .prepare('SELECT server_project_id FROM projects_sync WHERE project_name = ?')
      .get(projectName) as { server_project_id: string | null } | undefined;
    const serverId = row?.server_project_id;
    if (!serverId || !/^[0-9a-f-]{32,}$/i.test(serverId)) {
      // 项目从未 push 或 server_id 无效(老 path-bug 残留),无需远程删
      res.json({ ok: false, reason: 'no_server_id' });
      return;
    }

    try {
      const apiClient = new ApiClient(this.syncManager.state);
      await apiClient.deleteProject(serverId);
      // 同时清掉 client 的 projects_sync 行(项目身份关系已断)
      this.syncManager.db
        .prepare('DELETE FROM projects_sync WHERE project_name = ?')
        .run(projectName);
      res.json({ ok: true });
    } catch (e) {
      logger.warn('SYNC', '远程删项目失败,本地继续', { projectName, serverId, message: e instanceof Error ? e.message : String(e) });
      res.json({ ok: false, reason: 'remote_failed' });
    }
  });

  private handleProjects = this.wrapHandler((_req: Request, res: Response): void => {
    // 数据源以 projects v2 表为权威(与项目管理列表一致),LEFT JOIN projects_sync
    // 拿共享/同步状态。让 viewer 各处的项目集合保持唯一来源,云同步对话框能列出
    // 用户能管理的全部项目供选择"共享",不再因 projects_sync 孤儿(如已删项目残留)
    // 与项目管理对不上。
    const rows = this.syncManager.db
      .query(
        `SELECT p.name AS name,
                ps.server_project_id,
                ps.share_state,
                COALESCE(ps.is_excluded, 0) AS is_excluded,
                COALESCE(ps.is_forked, 0) AS is_forked,
                COUNT(o.id) AS observation_count
         FROM projects p
         LEFT JOIN projects_sync ps ON ps.project_name = p.name
         LEFT JOIN observations o ON o.project = p.name AND o.deleted_at IS NULL
         GROUP BY p.name
         ORDER BY p.name`
      )
      .all() as Array<{
      name: string;
      server_project_id: string | null;
      share_state: string | null;
      is_excluded: number;
      is_forked: number;
      observation_count: number;
    }>;
    res.json({
      projects: rows.map(r => ({
        name: r.name,
        server_project_id: r.server_project_id,
        share_state: r.share_state,
        is_excluded: r.is_excluded === 1,
        is_forked: r.is_forked === 1,
        observation_count: r.observation_count,
      })),
    });
  });

  private handleLogin = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof loginSchema>;
    try {
      await this.syncManager.login(
        body.server_url,
        body.username,
        body.password,
        body.machine_name,
        body.machine_description,
      );
      res.json({ status: 'ok' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error('SYNC', 'login 失败', { username: body.username, message });
      res.status(401).json({ error: { code: 'LOGIN_FAILED', message } });
    }
  });

  private handleLogout = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    try {
      await this.syncManager.logout();
    } catch (e) {
      logger.warn('SYNC', 'logout 出错(本地仍清)', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
    res.json({ status: 'ok' });
  });

  private handleRegister = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof registerSchema>;
    // 注册需要先临时设置 server_url(login 成功才正式持久化)
    this.syncManager.state.update({ server_url: body.server_url });
    const apiClient = new ApiClient(this.syncManager.state);
    try {
      const r = await apiClient.register({
        username: body.username,
        password: body.password,
        email: body.email,
        invite_code: body.invite_code,
      });
      res.json(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: { code: 'REGISTER_FAILED', message } });
    }
  });

  private handlePush = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    try {
      const r = await this.syncManager.push();
      res.json(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error('SYNC', 'push 失败', { message });
      res.status(500).json({ error: { code: 'PUSH_FAILED', message } });
    }
  });

  private handlePull = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    try {
      const r = await this.syncManager.pull();
      res.json(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error('SYNC', 'pull 失败', { message });
      res.status(500).json({ error: { code: 'PULL_FAILED', message } });
    }
  });

  private handleShare = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof shareSchema>;
    // 1. 找本地 project → server_project_id
    const projectId = this.requireServerProjectId(body.project_name);
    if (!projectId) {
      res.status(404).json({ error: { code: 'PROJECT_NOT_PUSHED', message: '该项目还未 push,先 push 一次' } });
      return;
    }
    try {
      let r: unknown;
      if (body.target_type === 'user') {
        if (!body.target_username) {
          res.status(400).json({ error: { code: 'MISSING_TARGET', message: 'target_type=user 必须提供 target_username' } });
          return;
        }
        r = await this.syncManager.api.shareWithUser(projectId, body.target_username, body.share_mode, body.expires_in_secs);
      } else if (body.target_type === 'public') {
        r = await this.syncManager.api.sharePublic(projectId, body.share_mode);
      } else {
        r = await this.syncManager.api.shareLink(projectId, body.share_mode, body.expires_in_secs);
      }
      res.json(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: 'SHARE_FAILED', message } });
    }
  });

  private handleUnshare = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof unshareSchema>;
    const projectId = this.requireServerProjectId(body.project_name);
    if (!projectId) {
      res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: '本地未记录该项目的 server_project_id' } });
      return;
    }
    // 撤销:server 当前规范用 DELETE share_id;client 需要先拿当前共享列表找 id
    try {
      const projects = await this.syncManager.api.listProjects();
      const proj = projects.projects.find(p => p.id === projectId);
      if (!proj) {
        res.status(404).json({ error: { code: 'PROJECT_NOT_ON_SERVER', message: '项目在 server 上找不到' } });
        return;
      }
      const matches = proj.shares.filter(s => s.target_type === body.target_type);
      for (const m of matches) {
        await this.syncManager.api.revokeShare(projectId, m.id);
      }
      res.json({ revoked: matches.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: 'UNSHARE_FAILED', message } });
    }
  });

  private handleFork = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof forkSchema>;
    // 简化:fork 流程是 server 侧主导,client 拿到副本列表后写本地
    // 先查 server,找出该 sharer 的 project_id
    try {
      const shared = await this.syncManager.api.listShared();
      const target = shared.shared_projects.find(
        sp => sp.project.name === body.project_name && sp.project.shares.some(s => s.target_user?.username === body.sharer_username),
      );
      // listShared 里 project.shares 可能空,简化路径:直接用 project.name 匹配
      const candidate = target ?? shared.shared_projects.find(sp => sp.project.name === body.project_name);
      if (!candidate) {
        res.status(404).json({ error: { code: 'SHARED_NOT_FOUND', message: '没有该共享项目' } });
        return;
      }
      const r = await this.syncManager.api.forkProject(candidate.project.id, body.new_name);
      res.json({ project: r.project, copied: r.observations.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: 'FORK_FAILED', message } });
    }
  });

  // ===== auto-sync handlers =====

  private handleAutoGet = this.wrapHandler((_req: Request, res: Response): void => {
    const c = this.syncManager.getAutoSyncConfig();
    res.json({
      enabled: c.enabled,
      interval_minutes: Math.round(c.intervalSecs / 60),
      direction: c.direction,
      last_run_at: c.lastRunAt,
      next_run_at: c.nextRunAt,
    });
  });

  private handleAutoPost = this.wrapHandler((req: Request, res: Response): void => {
    const body = req.body as z.infer<typeof autoSyncSchema>;
    try {
      const updated = this.syncManager.setAutoSyncConfig({
        enabled: body.enabled,
        intervalSecs: body.interval_minutes !== undefined ? body.interval_minutes * 60 : undefined,
        direction: body.direction,
      });
      res.json({
        enabled: updated.enabled,
        interval_minutes: Math.round(updated.intervalSecs / 60),
        direction: updated.direction,
        last_run_at: updated.lastRunAt,
        next_run_at: updated.nextRunAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: { code: 'AUTO_SYNC_INVALID', message } });
    }
  });

  /** 根据本地 projects_sync 拿 server_project_id */
  private requireServerProjectId(projectName: string): string | null {
    const row = this.syncManager.db
      .query('SELECT server_project_id FROM projects_sync WHERE project_name = ?')
      .get(projectName) as { server_project_id: string | null } | undefined;
    return row?.server_project_id ?? null;
  }
}
