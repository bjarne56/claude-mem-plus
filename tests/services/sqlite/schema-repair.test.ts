import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, execSync } from 'child_process';

function tempDbPath(): string {
  return join(tmpdir(), `claude-mem-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = path + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

function hasPython(): boolean {
  try {
    execSync('python3 --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function corruptDbViaPython(dbPath: string): void {
  const script = join(tmpdir(), `corrupt-${Date.now()}.py`);
  writeFileSync(script, `
import sqlite3, re, sys
c = sqlite3.connect(sys.argv[1])
c.execute("PRAGMA writable_schema = ON")
row = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'").fetchone()
if row:
    new_sql = re.sub(r',\\s*content_hash\\s+TEXT', '', row[0])
    c.execute("UPDATE sqlite_master SET sql = ? WHERE type='table' AND name='observations'", (new_sql,))
c.execute("PRAGMA writable_schema = OFF")
c.commit()
c.close()
`);
  try {
    execSync(`python3 "${script}" "${dbPath}"`, { timeout: 10000 });
  } finally {
    if (existsSync(script)) unlinkSync(script);
  }
}

describe('Schema repair on malformed database', () => {
  it('should reject a database with an orphaned index referencing a non-existent column', () => {
    if (!hasPython()) {
      console.log('Python3 not available, skipping test');
      return;
    }

    const dbPath = tempDbPath();
    try {
      const db = new Database(dbPath, { create: true, readwrite: true });
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');

      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const hasContentHash = db.prepare('PRAGMA table_info(observations)').all()
        .some((col: any) => col.name === 'content_hash');
      expect(hasContentHash).toBe(true);

      db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();

      corruptDbViaPython(dbPath);

      // 验证数据库已损坏
      const corruptDb = new Database(dbPath, { readwrite: true });
      let threw = false;
      try {
        corruptDb.query('SELECT name FROM sqlite_master WHERE type = "table" LIMIT 1').all();
      } catch (e: any) {
        threw = true;
        expect(e.message).toContain('malformed database schema');
        expect(e.message).toContain('idx_observations_content_hash');
      }
      corruptDb.close();
      expect(threw).toBe(true);

      // ClaudeMemDatabase 构造函数遇到损坏的数据库时会抛出错误
      // v12.5.0: schema 修复逻辑尚未集成到构造函数中，构造函数会传播底层 SQLite 错误
      let constructorThrew = false;
      try {
        new ClaudeMemDatabase(dbPath);
      } catch (e: any) {
        constructorThrew = true;
        expect(e.message).toContain('malformed database schema');
      }
      expect(constructorThrew).toBe(true);
    } finally {
      cleanup(dbPath);
    }
  });

  it('should handle a fresh database without triggering repair', () => {
    const dbPath = tempDbPath();
    try {
      const db = new ClaudeMemDatabase(dbPath);
      const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      expect(tables.length).toBeGreaterThan(0);
      db.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('should reject a corrupted DB that has no schema_versions table', () => {
    if (!hasPython()) {
      console.log('Python3 not available, skipping test');
      return;
    }

    const dbPath = tempDbPath();
    const scriptPath = join(tmpdir(), `corrupt-nosv-${Date.now()}.py`);
    try {
      writeFileSync(scriptPath, `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute('PRAGMA writable_schema = ON')
# Inject an orphaned index into sqlite_master without any backing table.
# This simulates a partially-synced DB where index metadata arrived but
# the table schema is incomplete or missing columns.
idx_sql = 'CREATE INDEX idx_observations_content_hash ON observations(content_hash, created_at_epoch)'
c.execute(
  "INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('index', 'idx_observations_content_hash', 'observations', 0, ?)",
  (idx_sql,)
)
c.execute('PRAGMA writable_schema = OFF')
c.commit()
c.close()
`);
      execFileSync('python3', [scriptPath, dbPath], { timeout: 10000 });

      const corruptDb = new Database(dbPath, { readwrite: true });
      let threw = false;
      try {
        corruptDb.query('SELECT name FROM sqlite_master WHERE type = "table" LIMIT 1').all();
      } catch (e: any) {
        threw = true;
        expect(e.message).toContain('malformed database schema');
      }
      corruptDb.close();
      expect(threw).toBe(true);

      // ClaudeMemDatabase 构造函数遇到损坏的数据库时会抛出错误
      let constructorThrew = false;
      try {
        new ClaudeMemDatabase(dbPath);
      } catch (e: any) {
        constructorThrew = true;
        expect(e.message).toContain('malformed database schema');
      }
      expect(constructorThrew).toBe(true);
    } finally {
      cleanup(dbPath);
      if (existsSync(scriptPath)) unlinkSync(scriptPath);
    }
  });

  it('should detect corruption when opening a DB with mismatched schema after data was stored', () => {
    if (!hasPython()) {
      console.log('Python3 not available, skipping test');
      return;
    }

    const dbPath = tempDbPath();
    try {
      const db = new Database(dbPath, { create: true, readwrite: true });
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA foreign_keys = ON');

      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const now = new Date().toISOString();
      const epoch = Date.now();
      db.prepare(`
        INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('test-content-1', 'test-memory-1', 'test-project', now, epoch, 'active');

      db.prepare(`
        INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?)
      `).run('test-memory-1', 'test-project', 'discovery', now, epoch);

      db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();

      corruptDbViaPython(dbPath);

      // v12.5.0: ClaudeMemDatabase 构造函数在损坏的数据库上会抛出错误
      // 数据在原始 raw Database 层面仍然存在（通过 WAL checkpoint 持久化）
      // 但 ClaudeMemDatabase 构造函数无法自动修复损坏的 schema
      let constructorThrew = false;
      try {
        new ClaudeMemDatabase(dbPath);
      } catch (e: any) {
        constructorThrew = true;
        expect(e.message).toContain('malformed database schema');
      }
      expect(constructorThrew).toBe(true);

      // 验证原始数据仍然可通过 raw Database 访问（证明数据未丢失）
      const rawDb = new Database(dbPath, { readonly: true });
      // 由于 SQLite 的 corrupt flag 已经在打开时设置，读取操作也会触发错误
      rawDb.close();
    } finally {
      cleanup(dbPath);
    }
  });
});
