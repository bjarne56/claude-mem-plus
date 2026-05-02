
import { Database } from 'bun:sqlite';
import { SessionStore } from '../sqlite/SessionStore.js';
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { MigrationRunner } from '../sqlite/migrations/runner.js';
import { ChromaSync } from '../sync/ChromaSync.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, DB_PATH } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import type { DBSession } from '../worker-types.js';

export class DatabaseManager {
  private db: Database | null = null;
  private sessionStore: SessionStore | null = null;
  private sessionSearch: SessionSearch | null = null;
  private chromaSync: ChromaSync | null = null;

  async initialize(): Promise<void> {
    this.db = new Database(DB_PATH);

    // [zh-fork] 跑 migrations(包括 v31 sync_state / shared_view 等)
    // worker 自己的 DatabaseManager 之前没接 MigrationRunner,导致 sync_state 等
    // subagent 加的表只有 sqlite/Database.ts 这个 deprecated 入口才会建。
    // 现在 worker 启动时自己跑一遍 migration runner 保证 schema 最新。
    try {
      const runner = new MigrationRunner(this.db);
      runner.runAllMigrations();
      logger.info('DB', 'Migrations applied');
    } catch (e) {
      logger.warn('DB', 'Migration runner failed (continuing)', { error: e instanceof Error ? e.message : String(e) });
    }

    // Shared connection between store and search
    this.sessionStore = new SessionStore(this.db);
    this.sessionSearch = new SessionSearch(this.db);

    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const chromaEnabled = settings.CLAUDE_MEM_CHROMA_ENABLED !== 'false';
    if (chromaEnabled) {
      this.chromaSync = new ChromaSync('claude-mem');
    } else {
      logger.info('DB', 'Chroma disabled via CLAUDE_MEM_CHROMA_ENABLED=false, using SQLite-only search');
    }

    logger.info('DB', 'Database initialized (shared connection)');
  }

  async close(): Promise<void> {
    if (this.chromaSync) {
      await this.chromaSync.close();
      this.chromaSync = null;
    }

    this.sessionStore = null;
    this.sessionSearch = null;

    if (this.db) {
      this.db.close();
      this.db = null;
    }
    logger.info('DB', 'Database closed');
  }

  getSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('Database not initialized');
    }
    return this.sessionStore;
  }

  getSessionSearch(): SessionSearch {
    if (!this.sessionSearch) {
      throw new Error('Database not initialized');
    }
    return this.sessionSearch;
  }

  getChromaSync(): ChromaSync | null {
    return this.chromaSync;
  }

  /**
   * Expose underlying bun:sqlite Database for routes that need direct SQL
   * (used by DeleteRoutes for soft-delete to trash tables).
   */
  getDatabase(): Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  /**
   * Get session by ID (throws if not found)
   */
  getSessionById(sessionDbId: number): {
    id: number;
    content_session_id: string;
    memory_session_id: string | null;
    project: string;
    platform_source: string;
    user_prompt: string;
    custom_title: string | null;
    status: string;
  } {
    const session = this.getSessionStore().getSessionById(sessionDbId);
    if (!session) {
      throw new Error(`Session ${sessionDbId} not found`);
    }
    return session;
  }

}
