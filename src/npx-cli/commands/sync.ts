/**
 * `npx claude-mem-plus sync ...` — cmem-sync client 子命令分发
 *
 * 所有子命令通过 worker 的 /api/sync/* 路由完成实际工作:
 *   - SyncManager 用 bun:sqlite,必须在 Bun 进程内跑
 *   - npx-cli 是 Node-only,这里只负责交互(输密码)+ HTTP 请求
 *
 * 子命令:
 *   sync login --server <url>       交互式 username/password,登记本机器
 *   sync logout                     清本地 token + 调 server logout
 *   sync register --server <url>    新用户注册(可选 invite_code)
 *   sync status                     server URL / user / pending counts
 *   sync push                       触发一次 push
 *   sync pull                       触发一次 pull
 *   sync me                         显示当前用户/机器/server 状态
 *   sync projects                   列出本地 + server 的项目
 *   sync share-project <name> --with <user> --mode <mode>
 *   sync unshare-project <name> [--target <user|public|link>]
 *   sync fork-project <user>/<name>
 */
import readline from 'readline';
import os from 'os';
import { Writable } from 'stream';
import pc from 'picocolors';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { isPluginInstalled } from '../utils/paths.js';

function ensureInstalled(): void {
  if (!isPluginInstalled()) {
    console.error(pc.red('claude-mem-plus 未安装。'));
    console.error(`运行: ${pc.bold('npx claude-mem-plus install')}`);
    process.exit(1);
  }
}

function workerBase(): string {
  const port = SettingsDefaultsManager.get('CLAUDE_MEM_WORKER_PORT');
  return `http://127.0.0.1:${port}`;
}

async function callWorker<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${workerBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === 'ECONNREFUSED') {
      console.error(pc.red('Worker 未运行。'));
      console.error(`先启动: ${pc.bold('npx claude-mem-plus start')}`);
      process.exit(1);
    }
    throw e;
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json() as { error?: { message?: string } | string };
      if (typeof j.error === 'string') detail = j.error;
      else if (j.error?.message) detail = j.error.message;
    } catch {/* ignore */}
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.indexOf(flag) >= 0;
}

/** 交互式 readline,支持 mute(密码) */
function ask(prompt: string, opts: { silent?: boolean } = {}): Promise<string> {
  const mutable = new (class extends Writable {
    muted = false;
    _write(chunk: unknown, _enc: BufferEncoding, cb: () => void): void {
      if (!this.muted) process.stdout.write(chunk as string);
      cb();
    }
  })();
  const rl = readline.createInterface({ input: process.stdin, output: mutable, terminal: true });
  return new Promise(resolve => {
    rl.question(prompt, ans => {
      if (opts.silent) process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
    if (opts.silent) mutable.muted = true;
  });
}

// =====================================================================
// 子命令
// =====================================================================

async function cmdLogin(args: string[]): Promise<void> {
  ensureInstalled();
  const server = parseFlag(args, '--server');
  if (!server) {
    console.error(pc.red('缺少 --server <url>'));
    process.exit(1);
  }

  console.log(pc.bold(`登录到 ${server}`));
  const username = await ask('用户名: ');
  const password = await ask('密码: ', { silent: true });
  const machineName = (await ask(`机器名(默认 ${os.hostname()}): `)) || os.hostname();
  const machineDescription = await ask('机器说明(可选): ');

  process.stdout.write(pc.dim('登录中...\n'));
  await callWorker<{ status: string }>('POST', '/api/sync/login', {
    server_url: server,
    username,
    password,
    machine_name: machineName,
    machine_description: machineDescription || undefined,
  });
  console.log(pc.green('登录成功'));
}

async function cmdLogout(): Promise<void> {
  ensureInstalled();
  await callWorker<void>('POST', '/api/sync/logout');
  console.log(pc.green('已注销本地凭据'));
}

async function cmdRegister(args: string[]): Promise<void> {
  ensureInstalled();
  const server = parseFlag(args, '--server');
  if (!server) {
    console.error(pc.red('缺少 --server <url>'));
    process.exit(1);
  }
  const username = await ask('用户名: ');
  const password = await ask('密码: ', { silent: true });
  const email = await ask('邮箱(可选): ');
  const inviteCode = await ask('邀请码(若需): ');

  await callWorker<unknown>('POST', '/api/sync/register', {
    server_url: server,
    username,
    password,
    email: email || undefined,
    invite_code: inviteCode || undefined,
  });
  console.log(pc.green('注册成功,接下来运行 sync login'));
}

async function cmdStatus(): Promise<void> {
  ensureInstalled();
  const s = await callWorker<{
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
  }>('GET', '/api/sync/state');

  console.log(pc.bold('cmem-sync 状态:'));
  console.log(`  Server URL:        ${s.serverUrl ?? pc.dim('(未配置)')}`);
  console.log(`  已登录:            ${s.loggedIn ? pc.green('yes') : pc.dim('no')}`);
  console.log(`  用户:              ${s.username ?? pc.dim('-')}`);
  console.log(`  机器:              ${s.machineName ?? pc.dim('-')}`);
  console.log(`  Last pull seq:     ${s.lastPulledSeq}`);
  console.log(`  最近 push:         ${formatEpoch(s.lastPushedAt)}`);
  console.log(`  最近 pull:         ${formatEpoch(s.lastPulledAt)}`);
  console.log(`  待 push 条数:      ${s.pendingPush}`);
  console.log(`  待 ack 降级通知:   ${s.pendingDowngrades}`);
}

async function cmdPush(): Promise<void> {
  ensureInstalled();
  process.stdout.write(pc.dim('push 中...\n'));
  const r = await callWorker<{ pushed: number; duplicates: number; errors: number; serverSeqMax: number }>('POST', '/api/sync/push');
  console.log(pc.green(`push 完成`));
  console.log(`  入库 ${r.pushed},重复 ${r.duplicates},失败 ${r.errors},server seq max=${r.serverSeqMax}`);
}

async function cmdPull(): Promise<void> {
  ensureInstalled();
  process.stdout.write(pc.dim('pull 中...\n'));
  const r = await callWorker<{
    ownReceived: number;
    sharedReadOnly: number;
    sharedAutoCopy: number;
    downgrades: number;
    hasMore: boolean;
  }>('POST', '/api/sync/pull');
  console.log(pc.green(`pull 完成`));
  console.log(`  自己 ${r.ownReceived},只读共享 ${r.sharedReadOnly},自动副本 ${r.sharedAutoCopy},降级通知 ${r.downgrades}`);
  if (r.hasMore) console.log(pc.dim('  还有更多数据,可再次运行 pull'));
}

async function cmdMe(): Promise<void> {
  ensureInstalled();
  const me = await callWorker<{ user: { username: string; id: string } | null; machine: { name: string; id: string } | null; server_url: string | null }>('GET', '/api/sync/me');
  if (!me.user) {
    console.log(pc.dim('未登录'));
    return;
  }
  console.log(pc.bold('当前会话:'));
  console.log(`  用户: ${me.user.username} (${me.user.id})`);
  if (me.machine) console.log(`  机器: ${me.machine.name} (${me.machine.id})`);
  console.log(`  Server: ${me.server_url ?? '-'}`);
}

async function cmdProjects(): Promise<void> {
  ensureInstalled();
  const r = await callWorker<{ projects: Array<{ name: string; observation_count?: number; share_state?: string; is_excluded?: boolean }> }>('GET', '/api/sync/projects');
  if (r.projects.length === 0) {
    console.log(pc.dim('暂无项目'));
    return;
  }
  console.log(pc.bold(`${r.projects.length} 个项目`));
  for (const p of r.projects) {
    const tag = p.is_excluded ? pc.dim(' [excluded]') : '';
    const share = p.share_state ? pc.cyan(` ${p.share_state}`) : '';
    const count = p.observation_count !== undefined ? pc.dim(` ${p.observation_count} obs`) : '';
    console.log(`  - ${p.name}${count}${share}${tag}`);
  }
}

async function cmdShareProject(args: string[]): Promise<void> {
  ensureInstalled();
  const name = args[0];
  if (!name) {
    console.error(pc.red('用法: claude-mem-plus sync share-project <name> --with <user> [--mode <mode>]'));
    process.exit(1);
  }
  const target = parseFlag(args, '--with');
  const mode = parseFlag(args, '--mode') ?? 'read-only';
  const isPublic = hasFlag(args, '--public');
  const isLink = hasFlag(args, '--link');

  const body: Record<string, unknown> = { project_name: name, share_mode: mode };
  if (isPublic) body.target_type = 'public';
  else if (isLink) body.target_type = 'link';
  else if (target) {
    body.target_type = 'user';
    body.target_username = target;
  } else {
    console.error(pc.red('须指定 --with <user> 或 --public 或 --link'));
    process.exit(1);
  }

  const r = await callWorker<{ share?: unknown; share_url?: string }>('POST', '/api/sync/share-project', body);
  console.log(pc.green('共享已创建'));
  if (r.share_url) console.log(`  URL: ${r.share_url}`);
}

async function cmdUnshareProject(args: string[]): Promise<void> {
  ensureInstalled();
  const name = args[0];
  if (!name) {
    console.error(pc.red('用法: claude-mem-plus sync unshare-project <name> [--target <user|public|link>]'));
    process.exit(1);
  }
  const target = parseFlag(args, '--target') ?? 'user';
  await callWorker<void>('POST', '/api/sync/unshare-project', { project_name: name, target_type: target });
  console.log(pc.green('共享已撤销'));
}

async function cmdForkProject(args: string[]): Promise<void> {
  ensureInstalled();
  const ref = args[0];
  if (!ref || !ref.includes('/')) {
    console.error(pc.red('用法: claude-mem-plus sync fork-project <user>/<name> [--name <new>]'));
    process.exit(1);
  }
  const [user, project] = ref.split('/');
  const newName = parseFlag(args, '--name');
  const r = await callWorker<{ project: { id: string; name: string }; copied: number }>('POST', '/api/sync/fork-project', {
    sharer_username: user,
    project_name: project,
    new_name: newName,
  });
  console.log(pc.green(`fork 成功: ${r.project.name} (${r.copied} 条 obs 已生成本地副本)`));
}

function formatEpoch(epoch: number | null): string {
  if (!epoch) return pc.dim('-');
  return new Date(epoch * 1000).toLocaleString();
}

// =====================================================================
// 入口
// =====================================================================

export async function runSyncCommand(args: string[]): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printSyncHelp();
      return;
    case 'login':           return cmdLogin(rest);
    case 'logout':          return cmdLogout();
    case 'register':        return cmdRegister(rest);
    case 'status':          return cmdStatus();
    case 'push':            return cmdPush();
    case 'pull':            return cmdPull();
    case 'me':              return cmdMe();
    case 'projects':        return cmdProjects();
    case 'share-project':   return cmdShareProject(rest);
    case 'unshare-project': return cmdUnshareProject(rest);
    case 'fork-project':    return cmdForkProject(rest);
    default:
      console.error(pc.red(`未知 sync 子命令: ${sub}`));
      printSyncHelp();
      process.exit(1);
  }
}

function printSyncHelp(): void {
  console.log(`
${pc.bold('claude-mem-plus sync')} — cmem-sync 客户端

  ${pc.cyan('claude-mem-plus sync login --server <url>')}        交互式登录并注册本机器
  ${pc.cyan('claude-mem-plus sync logout')}                       清本地 token
  ${pc.cyan('claude-mem-plus sync register --server <url>')}      新用户注册
  ${pc.cyan('claude-mem-plus sync status')}                       同步状态
  ${pc.cyan('claude-mem-plus sync push')}                         手动 push
  ${pc.cyan('claude-mem-plus sync pull')}                         手动 pull
  ${pc.cyan('claude-mem-plus sync me')}                           当前用户/机器
  ${pc.cyan('claude-mem-plus sync projects')}                     列出项目 + 共享状态
  ${pc.cyan('claude-mem-plus sync share-project <name> --with <user> [--mode <mode>]')}
  ${pc.cyan('claude-mem-plus sync share-project <name> --public [--mode <mode>]')}
  ${pc.cyan('claude-mem-plus sync share-project <name> --link [--mode <mode>]')}
  ${pc.cyan('claude-mem-plus sync unshare-project <name> [--target user|public|link]')}
  ${pc.cyan('claude-mem-plus sync fork-project <user>/<name> [--name <new>]')}

${pc.dim('share-mode: read-only | fork-allowed | auto-copy(默认 read-only)')}
`);
}
