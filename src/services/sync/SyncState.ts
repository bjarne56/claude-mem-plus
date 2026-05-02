/**
 * SyncState — 读写主库 sync_state 单行
 *
 * 单例,所有 cmem-sync client 状态(server URL / 用户身份 / token / 同步游标)
 * 都在这一行里,主库 SQLite 直接操作。
 */
import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface SyncStateRow {
  id: 1;
  server_url: string | null;
  user_id: string | null;
  username: string | null;
  machine_id: string | null;
  machine_name: string | null;
  machine_token: string | null;
  access_token: string | null;
  access_token_expires_at: number | null;
  refresh_token: string | null;
  last_pulled_seq: number;
  last_pushed_at_epoch: number | null;
  last_pulled_at_epoch: number | null;
  updated_at_epoch: number;
}

export type SyncStatePatch = Partial<Omit<SyncStateRow, 'id' | 'updated_at_epoch'>>;

export class SyncState {
  constructor(private readonly db: Database) {}

  /** 读取当前同步状态 — sync_state 表保证一行 (id=1) */
  get(): SyncStateRow {
    const row = this.db
      .query('SELECT * FROM sync_state WHERE id = 1')
      .get() as SyncStateRow | undefined;

    if (!row) {
      // migration 31 已经 INSERT OR IGNORE,正常路径不会走到这里
      // 防御:再补一行
      const now = Math.floor(Date.now() / 1000);
      this.db
        .prepare('INSERT OR IGNORE INTO sync_state (id, last_pulled_seq, updated_at_epoch) VALUES (1, 0, ?)')
        .run(now);
      logger.warn('SYNC', 'sync_state 行缺失,已补建');
      return this.get();
    }

    return row;
  }

  /** 部分更新 sync_state(原子) */
  update(patch: SyncStatePatch): SyncStateRow {
    const keys = Object.keys(patch) as Array<keyof SyncStatePatch>;
    if (keys.length === 0) return this.get();

    const now = Math.floor(Date.now() / 1000);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => patch[k] ?? null);
    values.push(now);

    this.db
      .prepare(`UPDATE sync_state SET ${setClause}, updated_at_epoch = ? WHERE id = 1`)
      .run(...(values as Array<string | number | null>));

    return this.get();
  }

  /** 是否已登录(有 access token 或 machine token) */
  isLoggedIn(): boolean {
    const row = this.get();
    return Boolean(row.access_token || row.machine_token);
  }

  /** 是否已配置 server URL */
  isConfigured(): boolean {
    return Boolean(this.get().server_url);
  }

  /** 清登录态(保留 server_url + last_pulled_seq) */
  clearAuth(): void {
    this.update({
      user_id: null,
      username: null,
      machine_id: null,
      machine_name: null,
      machine_token: null,
      access_token: null,
      access_token_expires_at: null,
      refresh_token: null,
    });
  }

  /** 推进 pull 游标 */
  advancePullCursor(nextSeq: number): void {
    if (nextSeq < this.get().last_pulled_seq) {
      logger.warn('SYNC', 'pull 游标回退被拒绝', {
        current: this.get().last_pulled_seq,
        requested: nextSeq,
      });
      return;
    }
    this.update({
      last_pulled_seq: nextSeq,
      last_pulled_at_epoch: Math.floor(Date.now() / 1000),
    });
  }

  /** 标记一次成功 push */
  markPushed(): void {
    this.update({
      last_pushed_at_epoch: Math.floor(Date.now() / 1000),
    });
  }
}
