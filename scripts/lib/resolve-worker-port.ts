// Worker 端口解析(单一权威源)
//
// 默认端口与上游 claude-mem 保持一致(37777),自定义靠以下三层覆盖:
//   1. $CLAUDE_MEM_WORKER_PORT env(最高,allow per-shell 切换)
//   2. $data_dir/settings.json 里 CLAUDE_MEM_WORKER_PORT(持久化)
//   3. $data_dir/worker.port 文件(老路径,兼容)
//   4. fallback 默认 37777(与 src/shared/SettingsDefaultsManager.ts 对齐)

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FALLBACK_DEFAULT_PORT = 37777;

function dataDir(): string {
  return process.env.CLAUDE_MEM_DATA_DIR || join(homedir(), '.claude-mem-plus');
}

function readPortFromSettings(dir: string): number | null {
  const settingsPath = join(dir, 'settings.json');
  if (!existsSync(settingsPath)) return null;
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 兼容两种 schema: 平铺 + 旧的 nested {env: {...}}
    const env = parsed?.env && typeof parsed.env === 'object' ? parsed.env : parsed;
    const v = env?.CLAUDE_MEM_WORKER_PORT;
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  } catch {
    return null;
  }
}

function readPortFile(dir: string): number | null {
  const portFile = join(dir, 'worker.port');
  if (!existsSync(portFile)) return null;
  try {
    const raw = readFileSync(portFile, 'utf-8').trim();
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  } catch {
    return null;
  }
}

export function resolveWorkerPort(opts: { warnFn?: (msg: string) => void } = {}): number {
  const warn = opts.warnFn ?? (() => {});

  // 1) env(最高)
  const envRaw = process.env.CLAUDE_MEM_WORKER_PORT;
  if (envRaw !== undefined && envRaw !== '') {
    const n = parseInt(envRaw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
    warn(`Invalid CLAUDE_MEM_WORKER_PORT=${JSON.stringify(envRaw)}; falling back`);
  }

  const dir = dataDir();

  // 2) settings.json
  const fromSettings = readPortFromSettings(dir);
  if (fromSettings !== null) return fromSettings;

  // 3) worker.port 文件(老路径)
  const fromFile = readPortFile(dir);
  if (fromFile !== null) return fromFile;

  // 4) 公式默认
  return FALLBACK_DEFAULT_PORT;
}

export function resolveWorkerUrl(opts?: { host?: string; warnFn?: (msg: string) => void }): string {
  const host = opts?.host ?? process.env.CLAUDE_MEM_WORKER_HOST ?? '127.0.0.1';
  return `http://${host}:${resolveWorkerPort(opts)}`;
}
