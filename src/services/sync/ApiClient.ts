/**
 * ApiClient — 封装与 cmem-sync server (Rust) 的 HTTP 通信
 *
 * 责任:
 *   - 拼接 server URL
 *   - 自动加 Authorization 头(优先 machine_token,否则 access_token)
 *   - 401 时尝试用 refresh_token 刷新一次,刷新失败则向上抛
 *   - 统一错误格式(server 端按 { error: { code, message } } 返回)
 *
 * 不持久化任何状态;所有 token 通过 SyncState 注入。
 */
import { logger } from '../../utils/logger.js';
import { SyncState } from './SyncState.js';

export interface ApiError extends Error {
  code: string;
  status: number;
}

export interface LoginResponse {
  user: { id: string; username: string; email: string | null };
  access_token: string;
  access_token_expires_at: string; // RFC3339
  refresh_token: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  invite_code?: string;
}

export interface MachineCreateResponse {
  machine: { id: string; name: string; created_at: string };
  machine_token: string;
}

export interface PushObservationPayload {
  id: string;
  timestamp: number;
  project_marker_id: string | null;
  project_name: string;
  project_path: string;
  content: string;
  obs_type: string;
  metadata: Record<string, unknown>;
  derived_from?: string | null;
  derivation_chain?: string | null;
}

export interface PushResponse {
  accepted: number;
  duplicates: number;
  errors: Array<{ id: string; message: string }>;
  server_seq_max: number;
  projects_resolved: Array<{ submitted_name: string; project_id: string }>;
}

export interface PullObservationServer {
  id: string;
  user_id: string;
  machine_id: string;
  project_id: string | null;
  project_path: string | null;
  timestamp: number;
  content: string;
  obs_type: string | null;
  metadata: string | null;
  derived_from: string | null;
  derivation_chain: string | null;
  server_seq: number;
  deleted_at: number | null;
}

export interface SharedObservation {
  observation: PullObservationServer;
  share_mode: 'read-only' | 'fork-allowed' | 'auto-copy';
  sharer_user_id: string;
  sharer_username: string;
  project_id: string;
  project_name: string;
}

export interface PendingDowngrade {
  id: number;
  project_name: string;
  owner_username: string;
  old_mode: string;
  new_mode: string;
  created_at: number;
}

export interface PullResponse {
  own_observations: PullObservationServer[];
  shared_observations: SharedObservation[];
  pending_downgrades: PendingDowngrade[];
  revoked_shares?: Array<{ project_id: string; project_name: string; sharer: string }>;
  next_since_seq: number;
  has_more: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_excluded: boolean;
  forked_from: string | null;
  observation_count: number;
  paths: Array<{ machine_id: string; machine_name: string; path: string }>;
  shares: Array<{
    id: string;
    target_type: string;
    target_user?: { id: string; username: string };
    share_mode: string;
    created_at: string;
  }>;
  created_at: string;
}

function makeApiError(code: string, message: string, status: number): ApiError {
  const err = new Error(message) as ApiError;
  err.code = code;
  err.status = status;
  err.name = 'ApiError';
  return err;
}

export class ApiClient {
  constructor(private readonly state: SyncState) {}

  private serverUrl(): string {
    const url = this.state.get().server_url;
    if (!url) {
      throw makeApiError('NO_SERVER_URL', 'sync server URL 未配置;先运行 claude-mem sync login --server <url>', 0);
    }
    return url.replace(/\/$/, '');
  }

  private authHeader(): Record<string, string> {
    const row = this.state.get();
    // machine_token 优先 — 长期有效,无需 refresh
    if (row.machine_token) {
      return { Authorization: `Bearer ${row.machine_token}` };
    }
    if (row.access_token) {
      return { Authorization: `Bearer ${row.access_token}` };
    }
    return {};
  }

  /** 通用 HTTP 调用 */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { authenticated?: boolean; raw?: boolean } = {}
  ): Promise<T> {
    const { authenticated = true, raw = false } = options;
    const url = `${this.serverUrl()}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': raw ? 'application/x-ndjson' : 'application/json',
      Accept: 'application/json',
    };
    if (authenticated) Object.assign(headers, this.authHeader());

    const init: RequestInit = {
      method,
      headers,
      body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error('SYNC', 'fetch 失败', { url, method, message });
      throw makeApiError('NETWORK_ERROR', `网络错误: ${message}`, 0);
    }

    // 401:access_token 过期,尝试 refresh 一次
    if (res.status === 401 && authenticated && this.state.get().refresh_token && !path.startsWith('/api/auth/')) {
      logger.info('SYNC', '401,尝试 refresh token');
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        // 重发一次
        Object.assign(headers, this.authHeader());
        try {
          res = await fetch(url, { ...init, headers });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw makeApiError('NETWORK_ERROR', `refresh 后重发失败: ${message}`, 0);
        }
      }
    }

    // 处理错误
    if (!res.ok) {
      let code = 'HTTP_' + res.status;
      let message = res.statusText;
      try {
        const json = await res.json() as { error?: { code: string; message: string } };
        if (json.error) {
          code = json.error.code;
          message = json.error.message;
        }
      } catch {
        // body 不是 JSON,用默认 message
      }
      throw makeApiError(code, message, res.status);
    }

    // 204 / 空 body
    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  /** 尝试用 refresh_token 换新 access_token;成功返回 true,失败 false */
  private async tryRefreshAccessToken(): Promise<boolean> {
    const refresh_token = this.state.get().refresh_token;
    if (!refresh_token) return false;
    try {
      const res = await fetch(`${this.serverUrl()}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token }),
      });
      if (!res.ok) {
        logger.warn('SYNC', 'refresh token 失效', { status: res.status });
        // 失效,清掉旧 access token
        this.state.update({ access_token: null, access_token_expires_at: null });
        return false;
      }
      const json = (await res.json()) as { access_token: string; access_token_expires_at: string; refresh_token?: string };
      this.state.update({
        access_token: json.access_token,
        access_token_expires_at: Math.floor(Date.parse(json.access_token_expires_at) / 1000),
        ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
      });
      return true;
    } catch (e) {
      logger.error('SYNC', 'refresh 异常', { message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  // ===== auth =====
  login(username: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('POST', '/api/auth/login', { username, password }, { authenticated: false });
  }

  register(req: RegisterRequest): Promise<{ user: { id: string; username: string; email: string | null; created_at: string } }> {
    return this.request('POST', '/api/auth/register', req, { authenticated: false });
  }

  logout(): Promise<void> {
    return this.request<void>('POST', '/api/auth/logout', {});
  }

  // ===== machine =====
  createMachine(name: string, description?: string): Promise<MachineCreateResponse> {
    return this.request('POST', '/api/machines', { name, description: description ?? null });
  }

  // ===== sync =====
  /** push 用 ndjson 更高效;签名按规范第 7.5 节 */
  push(observations: PushObservationPayload[]): Promise<PushResponse> {
    const ndjson = observations.map(o => JSON.stringify(o)).join('\n');
    return this.request<PushResponse>('POST', '/api/sync/push', ndjson, { raw: true });
  }

  pull(opts: {
    since_seq: number;
    limit?: number;
    include_shared?: boolean;
    include_public?: boolean;
    exclude_machines?: string[];
  }): Promise<PullResponse> {
    return this.request<PullResponse>('POST', '/api/sync/pull', {
      since_seq: opts.since_seq,
      limit: opts.limit ?? 500,
      include_shared: opts.include_shared ?? true,
      include_public: opts.include_public ?? false,
      exclude_machines: opts.exclude_machines ?? [],
    });
  }

  ackDowngrades(downgradeIds: number[]): Promise<void> {
    return this.request<void>('POST', '/api/shared/notifications/ack', { downgrade_ids: downgradeIds });
  }

  status(): Promise<{
    user_id: string;
    machine_id: string;
    last_seq: number;
    counts: { owned_obs: number; shared_obs: number };
  }> {
    return this.request('GET', '/api/sync/status');
  }

  // ===== projects =====
  listProjects(): Promise<{ projects: ProjectInfo[] }> {
    return this.request('GET', '/api/projects');
  }

  createProject(name: string, description?: string): Promise<ProjectInfo> {
    return this.request('POST', '/api/projects', { name, description: description ?? null });
  }

  updateProject(id: string, patch: Partial<{ name: string; display_name: string; description: string; is_excluded: boolean }>): Promise<ProjectInfo> {
    return this.request('PATCH', `/api/projects/${id}`, patch);
  }

  deleteProject(id: string): Promise<void> {
    return this.request('DELETE', `/api/projects/${id}`);
  }

  forkProject(id: string, newName?: string): Promise<{ project: ProjectInfo; observations: PullObservationServer[] }> {
    return this.request('POST', `/api/projects/${id}/fork`, { new_name: newName ?? null });
  }

  // ===== shares =====
  shareWithUser(projectId: string, targetUsername: string, mode: string, expiresInSecs?: number): Promise<unknown> {
    return this.request('POST', `/api/projects/${projectId}/shares`, {
      target_type: 'user',
      target_username: targetUsername,
      share_mode: mode,
      expires_in_secs: expiresInSecs ?? null,
    });
  }

  sharePublic(projectId: string, mode: string): Promise<unknown> {
    return this.request('POST', `/api/projects/${projectId}/shares`, {
      target_type: 'public',
      share_mode: mode,
    });
  }

  shareLink(projectId: string, mode: string, expiresInSecs?: number): Promise<{ share: { share_token: string }; share_url: string }> {
    return this.request('POST', `/api/projects/${projectId}/shares`, {
      target_type: 'link',
      share_mode: mode,
      expires_in_secs: expiresInSecs ?? null,
    });
  }

  revokeShare(projectId: string, shareId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/projects/${projectId}/shares/${shareId}`);
  }

  listShared(): Promise<{
    shared_projects: Array<{ project: ProjectInfo; share: { share_mode: string; shared_at: string } }>;
    pending_downgrades: PendingDowngrade[];
  }> {
    return this.request('GET', '/api/shared');
  }

  // ===== users =====
  lookupUser(query: string): Promise<{ users: Array<{ id: string; username: string }> }> {
    return this.request('GET', `/api/users/lookup?q=${encodeURIComponent(query)}`);
  }
}
