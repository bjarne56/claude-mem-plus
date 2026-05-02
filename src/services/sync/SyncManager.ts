/**
 * SyncManager — cmem-sync client 的总入口,串起 push / pull / share / fork
 *
 * 设计:
 *   - 单例(per-process),持有 SyncState + ApiClient
 *   - push:从主库 observations 表读 server_seq IS NULL 的行,
 *       生成 uuid_v7,转换 schema,batch POST /api/sync/push,
 *       写回 server_seq + uuid_v7
 *   - pull:GET /api/sync/pull?since=<last_pulled_seq>,处理三类:
 *       own_observations → 写主库(uuid_v7 唯一索引去重)
 *       shared_observations → 按 share_mode 分流到 shared_view 或 主库副本
 *       pending_downgrades → 写 sync_pending_downgrades 表 + 显示 + ack
 *
 * 错误策略:
 *   - 网络错误:不抛、记 warn,push/pull 返回部分进度
 *   - 401 后 refresh 失败:抛 ApiError(NEED_LOGIN),CLI 给提示
 *   - schema 不一致:抛
 */
import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { ApiClient, type PullResponse, type PushObservationPayload, type PushResponse, type SharedObservation } from './ApiClient.js';
import { SyncState, type AutoSyncDirection } from './SyncState.js';
import { uuidV7 } from './uuid-v7.js';
import { resolveProjectMarker, normalizeProjectName } from './ProjectMarker.js';

interface PendingObservationRow {
  id: number;
  memory_session_id: string;
  project: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  content_hash: string | null;
  agent_type: string | null;
  prompt_number: number | null;
  created_at_epoch: number;
  uuid_v7: string | null;
}

export interface PushResult {
  pushed: number;
  duplicates: number;
  errors: number;
  serverSeqMax: number;
}

export interface PullResult {
  ownReceived: number;
  sharedReadOnly: number;
  sharedAutoCopy: number;
  downgrades: number;
  hasMore: boolean;
}

const PUSH_BATCH_SIZE = 200;

export interface AutoSyncConfig {
  enabled: boolean;
  intervalSecs: number;
  direction: AutoSyncDirection;
  /** 上次自动同步实际触发的时间(epoch),null = 还没触发过 */
  lastRunAt: number | null;
  /** 下次预计触发时间(epoch);timer 未启动时 null */
  nextRunAt: number | null;
}

/** UI 上限制最小间隔,防止配置成 1 秒打爆 server */
const MIN_AUTO_SYNC_INTERVAL_SECS = 60;
const MAX_AUTO_SYNC_INTERVAL_SECS = 24 * 3600;

export class SyncManager {
  readonly state: SyncState;
  readonly api: ApiClient;
  readonly db: Database;

  /** 自动同步定时器句柄;null = 未启动 */
  private autoSyncTimer: NodeJS.Timeout | null = null;
  /** 最近一次自动同步触发时间 — 仅内存,不持久化(进程重启重置) */
  private autoLastRunAt: number | null = null;
  /** 下次自动同步预计触发时间 — 仅内存 */
  private autoNextRunAt: number | null = null;

  constructor(db: Database) {
    this.db = db;
    this.state = new SyncState(db);
    this.api = new ApiClient(this.state);
  }

  // ===== auth helpers =====

  /**
   * 完整登录流程:
   *   1. /api/auth/login → 拿 access + refresh + user
   *   2. 写 sync_state(user_id / username / access_token / refresh_token)
   *   3. 如果还没注册过本机器,POST /api/machines → 拿 machine_token
   */
  async login(serverUrl: string, username: string, password: string, machineName: string, machineDescription?: string): Promise<void> {
    const cleanUrl = serverUrl.replace(/\/$/, '');
    this.state.update({ server_url: cleanUrl });

    const loginRes = await this.api.login(username, password);
    this.state.update({
      user_id: loginRes.user.id,
      username: loginRes.user.username,
      access_token: loginRes.access_token,
      access_token_expires_at: Math.floor(Date.parse(loginRes.access_token_expires_at) / 1000),
      refresh_token: loginRes.refresh_token,
    });

    // 注册机器
    const cur = this.state.get();
    if (!cur.machine_id) {
      const m = await this.api.createMachine(machineName, machineDescription);
      this.state.update({
        machine_id: m.machine.id,
        machine_name: m.machine.name,
        machine_token: m.machine_token,
      });
      logger.info('SYNC', '机器已注册', { machine_id: m.machine.id, name: m.machine.name });
    }

    // 登录成功后,如果配置打开了自动同步,立刻起 timer
    if (this.getAutoSyncConfig().enabled) {
      this.startAutoSync();
    }
  }

  async logout(): Promise<void> {
    // 先停 timer,避免登出后还在尝试用旧 token push/pull
    this.stopAutoSync();
    try {
      await this.api.logout();
    } catch (e) {
      logger.warn('SYNC', 'logout API 失败,本地仍清空', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
    this.state.clearAuth();
  }

  // ===== push =====

  async push(opts: { batchSize?: number; cwdHint?: string } = {}): Promise<PushResult> {
    const batchSize = opts.batchSize ?? PUSH_BATCH_SIZE;
    if (!this.state.isLoggedIn()) {
      throw new Error('未登录,请先 claude-mem sync login');
    }

    const result: PushResult = { pushed: 0, duplicates: 0, errors: 0, serverSeqMax: 0 };

    // 循环 batch 直到没有 pending
    for (;;) {
      const rows = this.db
        .query(
          `SELECT id, memory_session_id, project, type, title, subtitle, narrative,
                  facts, concepts, files_read, files_modified, content_hash, agent_type,
                  prompt_number, created_at_epoch, uuid_v7
           FROM observations
           WHERE server_seq IS NULL AND deleted_at IS NULL
           ORDER BY id ASC
           LIMIT ?`
        )
        .all(batchSize) as PendingObservationRow[];

      if (rows.length === 0) break;

      // 为每行生成 uuid_v7(如果还没有)+ 转 server schema
      const payloads: PushObservationPayload[] = rows.map(row => {
        const uuid = row.uuid_v7 ?? uuidV7();
        // 若是新生成的,先写回主库 — push 失败时也保留 uuid 一致
        if (!row.uuid_v7) {
          this.db.prepare('UPDATE observations SET uuid_v7 = ? WHERE id = ?').run(uuid, row.id);
          row.uuid_v7 = uuid;
        }
        return this.buildPushPayload(row, opts.cwdHint);
      });

      let pushRes: PushResponse;
      try {
        pushRes = await this.api.push(payloads);
      } catch (e) {
        logger.error('SYNC', 'push 失败', {
          batch: rows.length,
          message: e instanceof Error ? e.message : String(e),
        });
        // 不抛 — 让 caller 知道部分成功
        result.errors += rows.length;
        break;
      }

      // 写回 server_seq(批量更新)
      const updateStmt = this.db.prepare(
        'UPDATE observations SET server_seq = ?, server_user_id = ?, server_machine_id = ? WHERE uuid_v7 = ?'
      );
      const userId = this.state.get().user_id;
      const machineId = this.state.get().machine_id;
      const tx = this.db.transaction(() => {
        // 简化:服务端按入库顺序分配 server_seq,我们粗略按 server_seq_max - n + i 分配
        // 其实更准确做法:server 应该返回 per-id 的 seq;暂用 max 作为标记表"已 push"
        // 当前规范的 PushResponse 没有 per-id seq,所以我们只标记 = server_seq_max
        // 后续 pull 时看到自己 push 的 seq 会被正确 re-fetch(uuid_v7 已有,skip)
        for (const p of payloads) {
          updateStmt.run(pushRes.server_seq_max, userId, machineId, p.id);
        }
      });
      tx();

      // 同步 projects_sync 表(server 给的 project_id 写回)
      this.recordProjectsResolved(pushRes.projects_resolved);

      result.pushed += pushRes.accepted;
      result.duplicates += pushRes.duplicates;
      result.errors += pushRes.errors.length;
      result.serverSeqMax = Math.max(result.serverSeqMax, pushRes.server_seq_max);

      if (rows.length < batchSize) break;
    }

    if (result.pushed > 0 || result.duplicates > 0) {
      this.state.markPushed();
    }
    logger.info('SYNC', 'push 完成', result);
    return result;
  }

  /** 一行 observation → server push payload */
  private buildPushPayload(row: PendingObservationRow, cwdHint?: string): PushObservationPayload {
    const cwd = cwdHint ?? row.project; // observations 没存 cwd,先用 project 名占位
    const marker = resolveProjectMarker(cwd);

    const projectName = marker?.name ?? (normalizeProjectName(row.project) || row.project);

    const content = row.narrative || row.subtitle || row.title || '';

    const metadata: Record<string, unknown> = {
      title: row.title,
      subtitle: row.subtitle,
      facts: parseJson(row.facts),
      concepts: parseJson(row.concepts),
      files_read: parseJson(row.files_read),
      files_modified: parseJson(row.files_modified),
      agent_type: row.agent_type,
      content_hash: row.content_hash,
      claude_mem_id: row.id,
      claude_mem_session: row.memory_session_id,
      prompt_number: row.prompt_number,
    };

    return {
      id: row.uuid_v7!, // 上层保证已生成
      timestamp: row.created_at_epoch,
      project_marker_id: marker?.project_id ?? null,
      project_name: projectName,
      project_path: cwd,
      content,
      obs_type: row.type,
      metadata,
      derived_from: null,
      derivation_chain: null,
    };
  }

  private recordProjectsResolved(resolved: Array<{ submitted_name: string; project_id: string }>): void {
    if (!resolved || resolved.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO projects_sync (project_name, server_project_id, last_sync_at_epoch, created_at_epoch)
       VALUES (?, ?, unixepoch(), unixepoch())
       ON CONFLICT(project_name) DO UPDATE SET
         server_project_id = excluded.server_project_id,
         last_sync_at_epoch = unixepoch()`
    );
    const tx = this.db.transaction(() => {
      for (const r of resolved) {
        stmt.run(r.submitted_name, r.project_id);
      }
    });
    tx();
  }

  // ===== pull =====

  async pull(opts: { limit?: number } = {}): Promise<PullResult> {
    if (!this.state.isLoggedIn()) {
      throw new Error('未登录,请先 claude-mem sync login');
    }

    const since = this.state.get().last_pulled_seq;
    const res = await this.api.pull({ since_seq: since, limit: opts.limit ?? 500 });

    const result = this.applyPullResponse(res);

    if (result.downgrades > 0 && res.pending_downgrades.length > 0) {
      try {
        await this.api.ackDowngrades(res.pending_downgrades.map(d => d.id));
        // 本地标 acked
        const stmt = this.db.prepare('UPDATE sync_pending_downgrades SET acked_at_epoch = unixepoch() WHERE server_id = ?');
        const tx = this.db.transaction(() => {
          for (const d of res.pending_downgrades) stmt.run(d.id);
        });
        tx();
      } catch (e) {
        logger.warn('SYNC', '降级 ack 失败,下次 pull 会再次收到', {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.state.advancePullCursor(res.next_since_seq);
    logger.info('SYNC', 'pull 完成', result);
    return result;
  }

  /** 把 PullResponse 写入本地;独立方法便于测试 */
  applyPullResponse(res: PullResponse): PullResult {
    const result: PullResult = {
      ownReceived: 0,
      sharedReadOnly: 0,
      sharedAutoCopy: 0,
      downgrades: 0,
      hasMore: res.has_more,
    };

    // 1. 自己的 obs(从其他机器 pull 下来)
    const insertOwn = this.db.prepare(
      `INSERT OR IGNORE INTO observations
       (memory_session_id, project, type, title, subtitle, narrative,
        text, server_user_id, server_machine_id, server_seq, derived_from,
        derivation_chain, deleted_at, uuid_v7, content_hash,
        created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const ownTx = this.db.transaction(() => {
      for (const o of res.own_observations) {
        // 先看本地有没有
        const exists = this.db
          .prepare('SELECT 1 FROM observations WHERE uuid_v7 = ?')
          .get(o.id);
        if (exists) continue;

        const meta = parseJson<Record<string, unknown>>(o.metadata) ?? {};
        const session = (meta['claude_mem_session'] as string) ?? `pulled-${o.machine_id}`;
        const title = (meta['title'] as string) ?? null;
        const subtitle = (meta['subtitle'] as string) ?? null;
        const contentHash = (meta['content_hash'] as string) ?? randomHash();
        const createdAt = new Date(o.timestamp * 1000).toISOString();

        // 注意:memory_session_id 有 FK 约束,跨机器拉的可能没有对应 sdk_sessions 行
        // 简化策略:先 INSERT OR IGNORE,如果 FK 失败,跳过(后续 sessions 同步时补)
        try {
          insertOwn.run(
            session,
            this.resolveLocalProjectName(o),
            o.obs_type ?? 'observation',
            title,
            subtitle,
            o.content,
            o.content,
            o.user_id,
            o.machine_id,
            o.server_seq,
            o.derived_from,
            o.derivation_chain,
            o.deleted_at,
            o.id,
            contentHash,
            createdAt,
            o.timestamp
          );
          result.ownReceived++;
        } catch (e) {
          // FK 失败(memory_session_id 不存在)— 暂时忽略,需 sessions 同步先就位
          logger.debug('SYNC', '主库 insert own_observation 跳过(FK)', {
            uuid_v7: o.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
    ownTx();

    // 2. shared:按 share_mode 分流
    const insertShared = this.db.prepare(
      `INSERT OR REPLACE INTO shared_view
       (uuid_v7, memory_session_id, project, sharer_user_id, sharer_username,
        share_mode, server_project_id, server_seq, timestamp, obs_type,
        content, metadata, derived_from, derivation_chain, deleted_at, synced_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    );

    const sharedTx = this.db.transaction(() => {
      for (const s of res.shared_observations) {
        if (s.share_mode === 'auto-copy') {
          // 直接生成 Bob 名下副本,纳入 observations(derived_from 链)
          // TODO(M+):正式产生本机 uuid_v7 副本 + 写入主库 + 标 pending push
          // 当前简化:先放进 shared_view + 标记 share_mode=auto-copy,后续 push 路径再处理生成副本
          this.upsertShared(insertShared, s);
          result.sharedAutoCopy++;
        } else {
          this.upsertShared(insertShared, s);
          result.sharedReadOnly++;
        }
      }
    });
    sharedTx();

    // 3. pending downgrades — 写入本地表
    const insertDg = this.db.prepare(
      `INSERT OR IGNORE INTO sync_pending_downgrades
       (server_id, project_name, owner_username, old_mode, new_mode, created_at_server)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const dgTx = this.db.transaction(() => {
      for (const d of res.pending_downgrades) {
        insertDg.run(d.id, d.project_name, d.owner_username, d.old_mode, d.new_mode, d.created_at);
        result.downgrades++;
      }
    });
    dgTx();

    return result;
  }

  private upsertShared(stmt: ReturnType<Database['prepare']>, s: SharedObservation): void {
    const o = s.observation;
    stmt.run(
      o.id,
      null, // memory_session_id 在共享侧没语义
      s.project_name,
      s.sharer_user_id,
      s.sharer_username,
      s.share_mode,
      s.project_id,
      o.server_seq,
      o.timestamp,
      o.obs_type,
      o.content,
      o.metadata,
      o.derived_from,
      o.derivation_chain,
      o.deleted_at
    );
  }

  /**
   * 把 server side project_id 映射回本地项目名:
   *   1. 查 projects_sync 看有没有对应记录
   *   2. 没有的话用 server_project_id 作占位
   */
  private resolveLocalProjectName(o: { project_id: string | null; project_path: string | null }): string {
    if (!o.project_id) return 'shared-unassigned';
    const row = this.db
      .prepare('SELECT project_name FROM projects_sync WHERE server_project_id = ?')
      .get(o.project_id) as { project_name: string } | undefined;
    if (row) return row.project_name;
    if (o.project_path) {
      const name = normalizeProjectName(o.project_path) || 'pulled';
      return name;
    }
    return `pulled-${o.project_id.slice(0, 8)}`;
  }

  // ===== status =====

  /** 返回客户端汇总状态 — viewer / CLI 都用 */
  localStatus(): {
    configured: boolean;
    loggedIn: boolean;
    serverUrl: string | null;
    username: string | null;
    machineName: string | null;
    lastPulledSeq: number;
    lastPushedAt: number | null;
    lastPulledAt: number | null;
    pendingPush: number;
    pendingDowngrades: number;
  } {
    const row = this.state.get();
    const pending = this.db
      .query('SELECT COUNT(*) as c FROM observations WHERE server_seq IS NULL AND deleted_at IS NULL')
      .get() as { c: number };
    const downgrades = this.db
      .query('SELECT COUNT(*) as c FROM sync_pending_downgrades WHERE acked_at_epoch IS NULL')
      .get() as { c: number };

    return {
      configured: this.state.isConfigured(),
      loggedIn: this.state.isLoggedIn(),
      serverUrl: row.server_url,
      username: row.username,
      machineName: row.machine_name,
      lastPulledSeq: row.last_pulled_seq,
      lastPushedAt: row.last_pushed_at_epoch,
      lastPulledAt: row.last_pulled_at_epoch,
      pendingPush: pending.c,
      pendingDowngrades: downgrades.c,
    };
  }

  // ===== 自动同步 =====

  /** 读取持久化配置 + 内存里的 last/next 时间戳 */
  getAutoSyncConfig(): AutoSyncConfig {
    const row = this.state.get();
    return {
      enabled: row.auto_sync_enabled === 1,
      intervalSecs: row.auto_sync_interval_secs,
      direction: row.auto_sync_direction,
      lastRunAt: this.autoLastRunAt,
      nextRunAt: this.autoNextRunAt,
    };
  }

  /**
   * 写入配置 + 按需 (重)启动 / 停止 timer。
   * 校验:间隔在 [60, 86400] 秒;direction 必须 push/pull/both。
   * 配置变更后 timer 立即生效(立即重置,不等当前周期跑完)。
   */
  setAutoSyncConfig(patch: Partial<{ enabled: boolean; intervalSecs: number; direction: AutoSyncDirection }>): AutoSyncConfig {
    const cur = this.getAutoSyncConfig();
    const next = {
      enabled: patch.enabled ?? cur.enabled,
      intervalSecs: patch.intervalSecs ?? cur.intervalSecs,
      direction: patch.direction ?? cur.direction,
    };

    if (next.intervalSecs < MIN_AUTO_SYNC_INTERVAL_SECS || next.intervalSecs > MAX_AUTO_SYNC_INTERVAL_SECS) {
      throw new Error(`auto_sync_interval_secs 必须在 ${MIN_AUTO_SYNC_INTERVAL_SECS}-${MAX_AUTO_SYNC_INTERVAL_SECS} 之间`);
    }
    if (!['push', 'pull', 'both'].includes(next.direction)) {
      throw new Error(`auto_sync_direction 必须为 push / pull / both`);
    }

    this.state.update({
      auto_sync_enabled: next.enabled ? 1 : 0,
      auto_sync_interval_secs: next.intervalSecs,
      auto_sync_direction: next.direction,
    });

    if (next.enabled && this.state.isLoggedIn()) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }

    return this.getAutoSyncConfig();
  }

  /**
   * 启动定时器(如果已启动会先 stop 再 start,实现"应用配置")。
   * 注意:不立即触发一次同步,首次触发在 intervalSecs 之后,避免登录瞬间打 server。
   */
  startAutoSync(): void {
    this.stopAutoSync();
    const cfg = this.getAutoSyncConfig();
    if (!cfg.enabled || !this.state.isLoggedIn()) return;

    const intervalMs = cfg.intervalSecs * 1000;
    this.autoNextRunAt = Math.floor(Date.now() / 1000) + cfg.intervalSecs;

    this.autoSyncTimer = setInterval(() => {
      void this.runAutoSyncOnce(cfg.direction).catch(e => {
        logger.warn('SYNC', 'auto-sync 周期失败(已 swallow,下次继续)', {
          message: e instanceof Error ? e.message : String(e),
        });
      });
    }, intervalMs);
    // 让 unref 不阻止 worker 退出 — 避免 SIGINT 时 hang
    if (typeof this.autoSyncTimer.unref === 'function') {
      this.autoSyncTimer.unref();
    }

    logger.info('SYNC', 'auto-sync 已启动', {
      intervalSecs: cfg.intervalSecs,
      direction: cfg.direction,
    });
  }

  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
      this.autoNextRunAt = null;
      logger.debug('SYNC', 'auto-sync 已停止');
    }
  }

  /** 单次自动同步触发;direction='both' 时先 pull 再 push(避免推上去自己又拉下来) */
  private async runAutoSyncOnce(direction: AutoSyncDirection): Promise<void> {
    if (!this.state.isLoggedIn()) {
      logger.debug('SYNC', 'auto-sync skip:未登录');
      return;
    }
    this.autoLastRunAt = Math.floor(Date.now() / 1000);
    const cfg = this.getAutoSyncConfig();
    this.autoNextRunAt = this.autoLastRunAt + cfg.intervalSecs;

    if (direction === 'pull' || direction === 'both') {
      const r = await this.pull();
      logger.debug('SYNC', 'auto-sync pull', r);
    }
    if (direction === 'push' || direction === 'both') {
      const r = await this.push();
      logger.debug('SYNC', 'auto-sync push', r);
    }
  }
}

function parseJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function randomHash(): string {
  // 16 hex chars,跟 migration22 的 backfill 风格一致
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}
