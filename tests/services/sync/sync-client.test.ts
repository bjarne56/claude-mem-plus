/**
 * cmem-sync client 集成测试
 *
 * 覆盖:
 *   - Migration 31:observations 新加列、sync_state、shared_view、projects_sync 都建好
 *   - SyncState:get/update/clearAuth/advancePullCursor 行为
 *   - SyncManager.applyPullResponse:把 server 数据写入主库 / shared_view / pending_downgrades
 *   - uuidV7:符合 v7 时序与 variant
 *
 * 不依赖真实 server,网络相关全部跳过。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { SyncState } from '../../../src/services/sync/SyncState.js';
import { SyncManager } from '../../../src/services/sync/SyncManager.js';
import { uuidV7 } from '../../../src/services/sync/uuid-v7.js';
import { normalizeProjectName } from '../../../src/services/sync/ProjectMarker.js';
import type { PullResponse } from '../../../src/services/sync/ApiClient.js';

interface ColInfo { name: string }
interface IdxInfo { name: string }
interface CountRow { c: number }

function freshDb(): Database {
  const db = new Database(':memory:');
  // 老版 schema_versions(没就建)
  db.run(`CREATE TABLE IF NOT EXISTS schema_versions (id INTEGER PRIMARY KEY, version INTEGER UNIQUE NOT NULL, applied_at TEXT NOT NULL)`);
  new MigrationRunner(db).runAllMigrations();
  return db;
}

describe('migration 31 — cmem-sync schema', () => {
  it('在 observations 表加齐 7 个新列', () => {
    const db = freshDb();
    const cols = (db.prepare('PRAGMA table_info(observations)').all() as ColInfo[]).map(c => c.name);
    for (const expected of [
      'server_user_id',
      'server_machine_id',
      'server_seq',
      'derived_from',
      'derivation_chain',
      'deleted_at',
      'uuid_v7',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('建好 sync_state / shared_view / projects_sync / sync_pending_downgrades 表', () => {
    const db = freshDb();
    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map(r => r.name);
    for (const t of ['sync_state', 'shared_view', 'projects_sync', 'sync_pending_downgrades']) {
      expect(tables).toContain(t);
    }
  });

  it('sync_state 启动时已经有单例行 (id=1)', () => {
    const db = freshDb();
    const row = db.prepare('SELECT id, last_pulled_seq FROM sync_state WHERE id = 1').get() as { id: number; last_pulled_seq: number };
    expect(row.id).toBe(1);
    expect(row.last_pulled_seq).toBe(0);
  });

  it('uuid_v7 唯一索引存在', () => {
    const db = freshDb();
    const idx = (db.prepare('PRAGMA index_list(observations)').all() as IdxInfo[]).map(i => i.name);
    expect(idx).toContain('ux_obs_uuid_v7');
  });

  it('migration 31 可重入 — 二次运行不报错', () => {
    const db = freshDb();
    new MigrationRunner(db).runAllMigrations();
    new MigrationRunner(db).runAllMigrations();
    // 仍然只有一行
    const row = db.prepare('SELECT COUNT(*) as c FROM sync_state').get() as CountRow;
    expect(row.c).toBe(1);
  });
});

describe('SyncState', () => {
  it('update + get 往返一致', () => {
    const db = freshDb();
    const state = new SyncState(db);
    state.update({ server_url: 'https://x.example', username: 'alice', user_id: 'u1' });
    const r = state.get();
    expect(r.server_url).toBe('https://x.example');
    expect(r.username).toBe('alice');
    expect(r.user_id).toBe('u1');
    expect(r.id).toBe(1);
  });

  it('isLoggedIn — 有 access 或 machine token 都算', () => {
    const db = freshDb();
    const state = new SyncState(db);
    expect(state.isLoggedIn()).toBe(false);
    state.update({ access_token: 'a' });
    expect(state.isLoggedIn()).toBe(true);
    state.clearAuth();
    expect(state.isLoggedIn()).toBe(false);
    state.update({ machine_token: 'm' });
    expect(state.isLoggedIn()).toBe(true);
  });

  it('clearAuth 不动 server_url 和 last_pulled_seq', () => {
    const db = freshDb();
    const state = new SyncState(db);
    state.update({ server_url: 'https://s', access_token: 'a', last_pulled_seq: 42 });
    state.clearAuth();
    const r = state.get();
    expect(r.server_url).toBe('https://s');
    expect(r.access_token).toBeNull();
    expect(r.last_pulled_seq).toBe(42);
  });

  it('advancePullCursor 单调,回退被拒', () => {
    const db = freshDb();
    const state = new SyncState(db);
    state.advancePullCursor(10);
    expect(state.get().last_pulled_seq).toBe(10);
    state.advancePullCursor(5);
    expect(state.get().last_pulled_seq).toBe(10); // 不退
    state.advancePullCursor(20);
    expect(state.get().last_pulled_seq).toBe(20);
  });
});

describe('uuidV7', () => {
  it('生成的 ID 符合 v7 格式(version 0x7,variant 10)', () => {
    const id = uuidV7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('两次相邻生成时序递增', async () => {
    const a = uuidV7();
    await new Promise(r => setTimeout(r, 5));
    const b = uuidV7();
    expect(b > a).toBe(true);
  });
});

describe('normalizeProjectName', () => {
  it('Nginx RCE → nginx-rce', () => {
    expect(normalizeProjectName('Nginx RCE')).toBe('nginx-rce');
  });
  it('55.ai/research → 55-ai-research', () => {
    expect(normalizeProjectName('55.ai/research')).toBe('55-ai-research');
  });
  it('---empty--- → empty', () => {
    expect(normalizeProjectName('---empty---')).toBe('empty');
  });
});

describe('SyncManager.applyPullResponse', () => {
  it('shared read-only 写入 shared_view,不写 observations', () => {
    const db = freshDb();
    const manager = new SyncManager(db);

    const res: PullResponse = {
      own_observations: [],
      shared_observations: [
        {
          observation: {
            id: uuidV7(),
            user_id: 'alice',
            machine_id: 'm-1',
            project_id: 'p-1',
            project_path: '/home/alice/nginx-rce',
            timestamp: 1714000000,
            content: '某条 alice 的 obs',
            obs_type: 'decision',
            metadata: null,
            derived_from: null,
            derivation_chain: null,
            server_seq: 100,
            deleted_at: null,
          },
          share_mode: 'read-only',
          sharer_user_id: 'alice',
          sharer_username: 'alice',
          project_id: 'p-1',
          project_name: 'nginx-rce',
        },
      ],
      pending_downgrades: [],
      next_since_seq: 100,
      has_more: false,
    };

    const r = manager.applyPullResponse(res);
    expect(r.sharedReadOnly).toBe(1);
    expect(r.ownReceived).toBe(0);

    const sharedCount = db.prepare('SELECT COUNT(*) as c FROM shared_view').get() as CountRow;
    expect(sharedCount.c).toBe(1);

    const obsCount = db.prepare('SELECT COUNT(*) as c FROM observations').get() as CountRow;
    expect(obsCount.c).toBe(0);
  });

  it('pending_downgrades 写到 sync_pending_downgrades', () => {
    const db = freshDb();
    const manager = new SyncManager(db);
    const res: PullResponse = {
      own_observations: [],
      shared_observations: [],
      pending_downgrades: [
        {
          id: 7,
          project_name: 'nginx-rce',
          owner_username: 'alice',
          old_mode: 'fork-allowed',
          new_mode: 'read-only',
          created_at: 1714000000,
        },
      ],
      next_since_seq: 1,
      has_more: false,
    };

    const r = manager.applyPullResponse(res);
    expect(r.downgrades).toBe(1);

    const dg = db.prepare('SELECT * FROM sync_pending_downgrades WHERE server_id = 7').get() as { project_name: string; old_mode: string; new_mode: string; acked_at_epoch: number | null };
    expect(dg.project_name).toBe('nginx-rce');
    expect(dg.old_mode).toBe('fork-allowed');
    expect(dg.new_mode).toBe('read-only');
    expect(dg.acked_at_epoch).toBeNull();
  });

  it('localStatus 反映 pending_push 计数', () => {
    const db = freshDb();
    const manager = new SyncManager(db);

    // 注入两条 pending observation(无 server_seq)
    db.run(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch) VALUES ('cs-1', 'ms-1', 'p1', 'now', 0)`);
    db.run(`INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch) VALUES ('ms-1', 'p1', 'decision', 't1', 'now', 0)`);
    db.run(`INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch) VALUES ('ms-1', 'p1', 'decision', 't2', 'now', 0)`);

    const s = manager.localStatus();
    expect(s.pendingPush).toBe(2);
    expect(s.loggedIn).toBe(false);
    expect(s.configured).toBe(false);
  });
});
