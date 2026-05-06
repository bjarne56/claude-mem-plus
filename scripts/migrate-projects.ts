#!/usr/bin/env bun
/**
 * 一次性数据库升级脚本:把现有 observations.project (TEXT name) 的数据
 * 回填到新的 project_id 体系。
 *
 * 触发场景:
 *   - 升级 fork 到 v12.6.5-plus.2+(含 schema v33)后跑一次
 *   - 之后 worker 写新 observation 已自动双写 project_id,无需再跑
 *
 * 用法:
 *   bun scripts/migrate-projects.ts                    # dry-run,只看不改
 *   bun scripts/migrate-projects.ts --apply            # 真实写入
 *   bun scripts/migrate-projects.ts --db /path/to.db   # 指定 db 路径
 *
 * 行为(dry-run vs apply 差异:dry-run 不写入但跑全量逻辑)
 *   1. 扫 observations 里所有 distinct project(name)
 *   2. 每个 name 在 projects 表建一条(如已有同名 → 复用 ID,不重建)
 *   3. 扫 pending_messages 取 (project, cwd) 对,把每对 cwd 登记到该 project
 *   4. 给 observations / session_summaries / sdk_sessions 的 project_id 回填
 *   5. 输出报告:projects 新建/复用、paths 新登记、observations 回填等
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ProjectStore, normalizePath } from '../src/services/sqlite/ProjectStore';

interface CliOpts {
  dryRun: boolean;
  dbPath: string;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  let dryRun = true;
  let dbPath = process.env.CLAUDE_MEM_DATA_DIR
    ? join(process.env.CLAUDE_MEM_DATA_DIR, 'claude-mem.db')
    : join(homedir(), '.claude-mem-plus', 'claude-mem.db');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') dryRun = false;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--db') dbPath = args[++i];
    else if (a === '-h' || a === '--help') {
      console.log(`用法:\n  bun scripts/migrate-projects.ts [--apply] [--db PATH]\n\n  --dry-run  默认,只看不改\n  --apply    真实写入\n  --db PATH  指定 sqlite 路径(默认 ~/.claude-mem-plus/claude-mem.db)`);
      process.exit(0);
    }
  }
  return { dryRun, dbPath };
}

interface MigrationReport {
  projectsCreated: number;
  projectsReused: number;
  pathsAdded: number;
  pathsSkippedDuplicate: number;
  observationsBackfilled: number;
  summariesBackfilled: number;
  sessionsBackfilled: number;
  warnings: string[];
}

function migrate(db: Database, dryRun: boolean): MigrationReport {
  const report: MigrationReport = {
    projectsCreated: 0, projectsReused: 0,
    pathsAdded: 0, pathsSkippedDuplicate: 0,
    observationsBackfilled: 0, summariesBackfilled: 0, sessionsBackfilled: 0,
    warnings: [],
  };

  const store = new ProjectStore(db);

  // ── Step 1: 扫 observations 里 distinct project name
  const projectNames = (db.prepare(`
    SELECT DISTINCT project FROM observations
    WHERE project IS NOT NULL AND project != ''
    UNION
    SELECT DISTINCT project FROM session_summaries
    WHERE project IS NOT NULL AND project != ''
    UNION
    SELECT DISTINCT project FROM sdk_sessions
    WHERE project IS NOT NULL AND project != ''
  `).all() as Array<{ project: string }>).map(r => r.project);

  console.log(`📊 发现 ${projectNames.length} 个 distinct project name`);

  // ── Step 2: 给每个 name 找/建 project record
  const nameToId = new Map<string, string>();
  for (const name of projectNames) {
    const existing = store.getByName(name);
    if (existing) {
      nameToId.set(name, existing.id);
      report.projectsReused++;
      continue;
    }
    if (!dryRun) {
      const created = store.create(name, null);
      nameToId.set(name, created.id);
    } else {
      nameToId.set(name, `[dry-run-${name}]`);
    }
    report.projectsCreated++;
  }

  console.log(`  → 复用 ${report.projectsReused} 个 / 新建 ${report.projectsCreated} 个`);

  // ── Step 3: 扫 pending_messages 取 (project name, cwd) 对
  const cwdPairs = db.prepare(`
    SELECT DISTINCT s.project AS project, p.cwd AS cwd
    FROM pending_messages p
    JOIN sdk_sessions s ON s.id = p.session_db_id
    WHERE p.cwd IS NOT NULL AND p.cwd != '' AND s.project IS NOT NULL
  `).all() as Array<{ project: string; cwd: string }>;

  console.log(`📊 发现 ${cwdPairs.length} 个 (project, cwd) 历史关联`);

  for (const { project, cwd } of cwdPairs) {
    const projectId = nameToId.get(project);
    if (!projectId) {
      report.warnings.push(`pending_messages 提到的 project='${project}' 无对应 nameToId 映射`);
      continue;
    }
    if (dryRun) {
      report.pathsAdded++;
      continue;
    }
    try {
      const before = store.listPaths(projectId).length;
      store.addPath(projectId, cwd);
      const after = store.listPaths(projectId).length;
      if (after > before) report.pathsAdded++;
      else report.pathsSkippedDuplicate++;
    } catch (err) {
      report.pathsSkippedDuplicate++;
      report.warnings.push(`path '${normalizePath(cwd)}' 已被别的 project 占用(原 project='${project}'),跳过`);
    }
  }

  console.log(`  → 新增 paths ${report.pathsAdded} / 跳过(重复或冲突) ${report.pathsSkippedDuplicate}`);

  // ── Step 4: 回填 project_id
  const tables: Array<{ table: string; reportKey: keyof Pick<MigrationReport, 'observationsBackfilled' | 'summariesBackfilled' | 'sessionsBackfilled'> }> = [
    { table: 'observations', reportKey: 'observationsBackfilled' },
    { table: 'session_summaries', reportKey: 'summariesBackfilled' },
    { table: 'sdk_sessions', reportKey: 'sessionsBackfilled' },
  ];

  for (const { table, reportKey } of tables) {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'project_id')) {
      report.warnings.push(`${table} 表没有 project_id 列,跳过(确认 schema v33 已应用)`);
      continue;
    }

    const rowsToBackfill = db.prepare(`
      SELECT id, project FROM ${table}
      WHERE project_id IS NULL AND project IS NOT NULL AND project != ''
    `).all() as Array<{ id: number; project: string }>;

    let count = 0;
    if (!dryRun) {
      const updateStmt = db.prepare(`UPDATE ${table} SET project_id = ? WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const row of rowsToBackfill) {
          const projectId = nameToId.get(row.project);
          if (projectId && !projectId.startsWith('[dry-run')) {
            updateStmt.run(projectId, row.id);
            count++;
          }
        }
      });
      tx();
    } else {
      count = rowsToBackfill.filter(r => nameToId.has(r.project)).length;
    }
    report[reportKey] = count;
  }

  console.log(`  → 回填 observations ${report.observationsBackfilled} / summaries ${report.summariesBackfilled} / sessions ${report.sessionsBackfilled}`);

  return report;
}

function main() {
  const opts = parseArgs();

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`🛠  Project ID 升级脚本 ${opts.dryRun ? '【DRY-RUN】' : '【APPLY】'}`);
  console.log(`📁 数据库: ${opts.dbPath}`);
  console.log(`${'━'.repeat(60)}\n`);

  if (!existsSync(opts.dbPath)) {
    console.error(`❌ 数据库不存在: ${opts.dbPath}`);
    process.exit(1);
  }

  const db = new Database(opts.dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    const v33 = db.prepare('SELECT version FROM schema_versions WHERE version = 33').get();
    if (!v33) {
      console.error('❌ schema_versions 没有 v33 记录。请先重启 worker 自动跑 ensureProjectsTables');
      console.error('   命令: claude-mem-plus restart');
      process.exit(2);
    }
  } catch {
    console.error('❌ schema_versions 表不存在,数据库可能太老');
    process.exit(2);
  }

  const report = migrate(db, opts.dryRun);

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`📋 报告 ${opts.dryRun ? '(dry-run,未写入)' : '(已写入)'}:`);
  console.log(`   projects 新建:        ${report.projectsCreated}`);
  console.log(`   projects 复用已有:    ${report.projectsReused}`);
  console.log(`   project_paths 新增:   ${report.pathsAdded}`);
  console.log(`   project_paths 跳过:   ${report.pathsSkippedDuplicate}`);
  console.log(`   observations 回填:    ${report.observationsBackfilled}`);
  console.log(`   session_summaries 回填: ${report.summariesBackfilled}`);
  console.log(`   sdk_sessions 回填:    ${report.sessionsBackfilled}`);

  if (report.warnings.length > 0) {
    console.log(`\n⚠️  警告 ${report.warnings.length} 条:`);
    for (const w of report.warnings.slice(0, 10)) console.log(`   - ${w}`);
    if (report.warnings.length > 10) console.log(`   (省略 ${report.warnings.length - 10} 条)`);
  }

  console.log(`\n${opts.dryRun ? '💡 dry-run 完成。要真实写入,加 --apply 参数。' : '✅ 升级完成。'}\n`);

  db.close();
}

main();
