// ProjectsRoutes — 项目身份(project_id)+ 路径管理 v2 API
//
// 与已有 DeleteRoutes 里 /api/projects/:name(基于 name 字符串)共存,
// 新接口前缀 /api/projects-v2 走 ProjectStore + project_id 体系。
//
// claude-mem-改造需求.md 第 5 节后台编辑功能。

import express, { Request, Response } from 'express';
import { writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { homedir } from 'os';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { requireLocalhost } from '../../../server/Middleware.js';
import { ProjectStore, ANCHOR_FILE_NAME, normalizePath } from '../../../sqlite/ProjectStore.js';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { logger } from '../../../../utils/logger.js';

export class ProjectsRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  private store(): ProjectStore {
    return new ProjectStore(this.dbManager.getDatabase());
  }

  // 解析 URL 路径里的 :id 参数为 8 位数字 ID;无效 → 给 res 回 400 并返 null
  private parseProjectId(req: Request, res: Response): number | null {
    const raw = req.params.id;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || !/^\d+$/.test(raw)) {
      this.badRequest(res, `Invalid project id '${raw}' (expected 8-digit integer)`);
      return null;
    }
    return n;
  }

  setupRoutes(app: express.Application): void {
    // 列表 + stats
    app.get('/api/projects-v2', requireLocalhost, this.wrapHandler(this.handleList));
    app.get('/api/projects-v2/:id', requireLocalhost, this.wrapHandler(this.handleGet));

    // CRUD
    app.post('/api/projects-v2', requireLocalhost, this.wrapHandler(this.handleCreate));
    app.patch('/api/projects-v2/:id', requireLocalhost, this.wrapHandler(this.handleRename));
    app.delete('/api/projects-v2/:id', requireLocalhost, this.wrapHandler(this.handleDelete));

    // 路径管理
    app.get('/api/projects-v2/:id/paths', requireLocalhost, this.wrapHandler(this.handleListPaths));
    app.post('/api/projects-v2/:id/paths', requireLocalhost, this.wrapHandler(this.handleAddPath));
    app.delete('/api/projects-v2/:id/paths/:pathId', requireLocalhost, this.wrapHandler(this.handleRemovePath));

    // 合并
    app.post('/api/projects-v2/:id/merge', requireLocalhost, this.wrapHandler(this.handleMerge));

    // 锚点文件:在某 cwd 下写 .claude-mem 把目录绑定到 project
    app.post('/api/projects-v2/:id/anchor', requireLocalhost, this.wrapHandler(this.handleWriteAnchor));

    // 目录浏览器:供 UI 弹窗 picker 用,只读列目录
    app.get('/api/projects-v2/_/browse', requireLocalhost, this.wrapHandler(this.handleBrowse));

    logger.info('SYSTEM', 'ProjectsRoutes registered', {
      routes: [
        'GET /api/projects-v2',
        'GET /api/projects-v2/:id',
        'POST /api/projects-v2',
        'PATCH /api/projects-v2/:id',
        'DELETE /api/projects-v2/:id',
        'GET /api/projects-v2/:id/paths',
        'POST /api/projects-v2/:id/paths',
        'DELETE /api/projects-v2/:id/paths/:pathId',
        'POST /api/projects-v2/:id/merge',
        'POST /api/projects-v2/:id/anchor',
        'GET /api/projects-v2/_/browse?path=...',
      ],
    });
  }

  // ── 目录浏览器(localhost-only,只读)────────────────────────
  // 供 UI 弹窗 file picker 用。返回当前 path 的子目录列表。
  // 默认路径 = $HOME。不允许列出文件(只列目录,简化 picker UI)。
  // 限制:返回最多 500 项;限制 . 隐藏目录默认隐藏(可 ?showHidden=1 开)
  private handleBrowse = async (req: Request, res: Response): Promise<void> => {
    let target = (req.query.path as string | undefined)?.trim() || homedir();
    const showHidden = req.query.showHidden === '1' || req.query.showHidden === 'true';

    // 安全:必须是绝对路径,且去掉 .. 这种相对元素后还要存在
    if (!isAbsolute(target)) {
      this.badRequest(res, 'path must be absolute');
      return;
    }
    target = resolve(target);

    if (!existsSync(target)) {
      res.status(404).json({ error: 'Path does not exist', path: target });
      return;
    }
    let stat;
    try { stat = statSync(target); } catch (err) {
      res.status(403).json({ error: `Cannot stat path: ${(err as Error).message}` });
      return;
    }
    if (!stat.isDirectory()) {
      this.badRequest(res, 'path is not a directory');
      return;
    }

    let entries: Array<{ name: string; path: string; isDir: boolean; isLink: boolean }> = [];
    try {
      const dirents = readdirSync(target, { withFileTypes: true });
      for (const d of dirents) {
        if (!showHidden && d.name.startsWith('.')) continue;
        // 只列目录(picker 用,文件无意义)
        const fullPath = join(target, d.name);
        let isDir = d.isDirectory();
        const isLink = d.isSymbolicLink();
        // 符号链接需要 stat 确认指向是否为目录
        if (isLink) {
          try { isDir = statSync(fullPath).isDirectory(); } catch { isDir = false; }
        }
        if (!isDir) continue;
        entries.push({ name: d.name, path: fullPath, isDir: true, isLink });
        if (entries.length >= 500) break;
      }
    } catch (err) {
      res.status(403).json({ error: `Cannot read directory: ${(err as Error).message}` });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      cwd: target,
      parent: dirname(target) === target ? null : dirname(target),
      entries,
      truncated: entries.length >= 500,
      home: homedir(),
    });
  };

  // ── handlers ─────────────────────────────────────────────────

  private handleList = async (_req: Request, res: Response): Promise<void> => {
    const store = this.store();
    const projects = store.list();
    // 附带 stats
    const enriched = projects.map(p => ({ ...p, stats: store.getStats(p.id) }));
    res.json({ projects: enriched });
  };

  private handleGet = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const store = this.store();
    const project = store.getById(id);
    if (!project) { this.notFound(res, `Project ${id}`); return; }
    res.json({
      project,
      stats: store.getStats(id),
      paths: store.listPaths(id),
    });
  };

  private handleCreate = async (req: Request, res: Response): Promise<void> => {
    const name = ((req.body as Record<string, unknown>)?.name as string | undefined)?.trim();
    const anchorPath = ((req.body as Record<string, unknown>)?.anchor_path as string | undefined) || null;
    if (!name) { this.badRequest(res, 'name required'); return; }
    if (name.length > 200) { this.badRequest(res, 'name too long (max 200)'); return; }
    const store = this.store();
    if (store.getByName(name)) { res.status(409).json({ error: `Project name '${name}' already exists` }); return; }
    const created = store.create(name, anchorPath ? normalizePath(anchorPath) : null);
    res.status(201).json({ project: created });
  };

  private handleRename = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const newName = ((req.body as Record<string, unknown>)?.name as string | undefined)?.trim();
    if (!newName) { this.badRequest(res, 'name required'); return; }
    const store = this.store();
    try {
      const updated = store.rename(id, newName);
      if (!updated) { this.notFound(res, `Project ${id}`); return; }
      res.json({ project: updated });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  };

  private handleDelete = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const store = this.store();
    const ok = store.delete(id);
    if (!ok) { this.notFound(res, `Project ${id}`); return; }
    res.status(204).send();
  };

  // ── paths ────────────────────────────────────────────────────

  private handleListPaths = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const store = this.store();
    if (!store.getById(id)) { this.notFound(res, `Project ${id}`); return; }
    res.json({ paths: store.listPaths(id) });
  };

  private handleAddPath = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const rawPath = ((req.body as Record<string, unknown>)?.path as string | undefined)?.trim();
    if (!rawPath) { this.badRequest(res, 'path required'); return; }
    const store = this.store();
    if (!store.getById(id)) { this.notFound(res, `Project ${id}`); return; }
    try {
      const added = store.addPath(id, rawPath);
      res.status(201).json({ path: added });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  };

  private handleRemovePath = async (req: Request, res: Response): Promise<void> => {
    const pathId = parseInt(req.params.pathId, 10);
    if (!Number.isFinite(pathId)) { this.badRequest(res, 'pathId must be number'); return; }
    const ok = this.store().removePath(pathId);
    if (!ok) { this.notFound(res, `Path ${pathId}`); return; }
    res.status(204).send();
  };

  // ── merge ────────────────────────────────────────────────────

  private handleMerge = async (req: Request, res: Response): Promise<void> => {
    const fromId = this.parseProjectId(req, res); if (fromId === null) return;
    const rawTarget = (req.body as Record<string, unknown>)?.targetId;
    const targetId = typeof rawTarget === 'number' ? rawTarget : parseInt(String(rawTarget ?? ''), 10);
    if (!Number.isInteger(targetId)) { this.badRequest(res, 'targetId required (number)'); return; }
    try {
      const result = this.store().merge(fromId, targetId);
      res.json({ result, mergedFrom: fromId, mergedInto: targetId });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };

  // ── 锚点文件 ────────────────────────────────────────────────

  private handleWriteAnchor = async (req: Request, res: Response): Promise<void> => {
    const id = this.parseProjectId(req, res); if (id === null) return;
    const cwd = ((req.body as Record<string, unknown>)?.cwd as string | undefined)?.trim();
    if (!cwd) { this.badRequest(res, 'cwd required'); return; }
    const store = this.store();
    const project = store.getById(id);
    if (!project) { this.notFound(res, `Project ${id}`); return; }
    const normalized = normalizePath(cwd);
    const anchorPath = join(normalized, ANCHOR_FILE_NAME);
    try {
      writeFileSync(anchorPath, JSON.stringify({ projectId: id, name: project.name }, null, 2) + '\n');
      // 同时把这个路径登记到 project_paths
      try { store.addPath(id, normalized); } catch { /* 同 path 重复 → 忽略 */ }
      res.json({ anchorPath, projectId: id });
    } catch (err) {
      res.status(500).json({ error: `Failed to write anchor file: ${(err as Error).message}` });
    }
  };
}
