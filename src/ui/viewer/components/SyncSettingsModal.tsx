/**
 * SyncSettingsModal — viewer 里的 cmem-sync 设置
 *
 * 功能:
 *   - 显示当前同步状态(server URL / user / machine / pending push/pull)
 *   - 一键 Login / Logout(展开内嵌表单)
 *   - 项目共享列表(本地视角)
 *   - 触发 push / pull 按钮
 *
 * 通过 worker 的 /api/sync/* 路由完成所有操作。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n';

interface SyncStatusBlob {
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
}

interface SyncProject {
  name: string;
  server_project_id: string | null;
  share_state: string | null;
  is_excluded: boolean;
  is_forked: boolean;
  observation_count: number;
}

interface AutoSyncDto {
  enabled: boolean;
  interval_minutes: number;
  direction: 'push' | 'pull' | 'both';
  last_run_at: number | null;
  next_run_at: number | null;
}

/** 把秒数显示成 "HH:MM:SS" 或 "MM:SS"(< 1h);负数返回 "now" */
function fmtCountdown(secs: number): string {
  if (secs <= 0) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function fmtEpoch(epoch: number | null): string {
  if (!epoch) return '-';
  return new Date(epoch * 1000).toLocaleString();
}

export function SyncSettingsModal({ isOpen, onClose }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SyncStatusBlob | null>(null);
  const [projects, setProjects] = useState<SyncProject[]>([]);
  /// 远程 server 上各项目 obs 数(name → count),由 /api/sync/remote-projects 拉取。
  /// 未登录或失败时为空,UI 显示 "—"。
  const [remoteCounts, setRemoteCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /// 同步进度(push/pull 期间轮询 /api/sync/progress 拿)。idle 时不显示进度条。
  const [syncProgress, setSyncProgress] = useState<{ phase: 'push' | 'pull' | 'idle'; current: number; total: number } | null>(null);

  // login form — machine_name 给个默认值,从浏览器 platform 推
  // navigator.platform 已 deprecated 但还能用,fallback 'this-machine'
  const defaultMachineName = (() => {
    if (typeof navigator === 'undefined') return 'this-machine';
    const p = (navigator.platform || '').toLowerCase();
    const ua = (navigator.userAgent || '').toLowerCase();
    if (p.includes('mac') || ua.includes('mac os x')) return 'my-mac';
    if (p.includes('win') || ua.includes('windows')) return 'my-windows';
    if (p.includes('linux')) return 'my-linux';
    return 'this-machine';
  })();
  /** auth 表单模式:'login' 已有账号 / 'register' 新用户(用 invite code) */
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginForm, setLoginForm] = useState({
    server_url: '',
    username: '',
    password: '',
    machine_name: defaultMachineName,  // 默认填,避免 zod min(1) 校验失败
    machine_description: '',
  });
  /** 注册专用字段 — 邮箱可选 + 邀请码(server require_invite=true 时必填) */
  const [registerExtras, setRegisterExtras] = useState({
    email: '',
    invite_code: '',
  });

  // 项目列表搜索词(client filter)
  const [search, setSearch] = useState('');
  // 状态摘要默认折叠,只显示 chips
  const [statusExpanded, setStatusExpanded] = useState(false);
  // 自动同步配置 + 下次倒计时(每秒 tick)
  const [autoSync, setAutoSync] = useState<AutoSyncDto | null>(null);
  const [autoSyncDraft, setAutoSyncDraft] = useState<{ interval_minutes: number; direction: 'push' | 'pull' | 'both' }>({
    interval_minutes: 10,
    direction: 'both',
  });
  const [autoSavedHint, setAutoSavedHint] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  // share UI 状态 — 内联 share form,支持批量
  const [sharingProject, setSharingProject] = useState<string | null>(null);
  const [shareForm, setShareForm] = useState<{
    target_type: 'user' | 'public' | 'link';
    usernames: string;
    mode: 'read-only' | 'fork-allowed' | 'auto-copy';
    expires_days: string;
  }>({ target_type: 'user', usernames: '', mode: 'fork-allowed', expires_days: '7' });
  /** "3/5" — 批量进度;null = idle */
  const [shareProgress, setShareProgress] = useState<string | null>(null);
  /** link 模式下,server 返回的 share_url(显示 + 复制) */
  const [shareLinkResult, setShareLinkResult] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const sRes = await fetch('/api/sync/state');
      if (!sRes.ok) throw new Error(`sync/state HTTP ${sRes.status}`);
      const s = (await sRes.json()) as SyncStatusBlob;
      setStatus(s);
      setLoginForm(prev => ({ ...prev, server_url: s.serverUrl ?? prev.server_url }));

      const pRes = await fetch('/api/sync/projects');
      if (pRes.ok) {
        const p = (await pRes.json()) as { projects: SyncProject[] };
        setProjects(p.projects);
      }

      // 拉远程项目 obs 数,合并到 remoteCounts(map: name → count)。
      // 未登录或拉取失败 → 不影响本地视图。
      try {
        const rpRes = await fetch('/api/sync/remote-projects');
        if (rpRes.ok) {
          const rp = (await rpRes.json()) as { projects: Array<{ name: string; observation_count: number }>; loggedIn: boolean };
          const m: Record<string, number> = {};
          for (const r of rp.projects) m[r.name] = r.observation_count;
          setRemoteCounts(m);
        }
      } catch { /* swallow */ }

      // 拉自动同步配置(独立失败不影响主流程)
      try {
        const aRes = await fetch('/api/sync/auto');
        if (aRes.ok) {
          const a = (await aRes.json()) as AutoSyncDto;
          setAutoSync(a);
          setAutoSyncDraft({ interval_minutes: a.interval_minutes, direction: a.direction });
        }
      } catch { /* swallow */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchStatus();
    }
  }, [isOpen, fetchStatus]);

  // ESC 关闭
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', onEsc);
      return () => window.removeEventListener('keydown', onEsc);
    }
  }, [isOpen, onClose]);

  const callAction = useCallback(
    async (path: string, body?: unknown): Promise<unknown> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
        }
        return res.json().catch(() => null);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleLogin = useCallback(async (): Promise<void> => {
    // 前端校验必填字段(避免 zod 400 ValidationError)
    if (!loginForm.server_url.trim() || !loginForm.username.trim() || !loginForm.password || !loginForm.machine_name.trim()) {
      setError(t('sync.loginRequiredHint'));
      return;
    }
    try {
      await callAction('/api/sync/login', loginForm);
      setLoginForm(prev => ({ ...prev, password: '' }));
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, loginForm, fetchStatus, t]);

  /** 注册流程:先 register,成功后自动 login */
  const handleRegister = useCallback(async (): Promise<void> => {
    if (!loginForm.server_url.trim() || !loginForm.username.trim() || !loginForm.password) {
      setError(t('sync.registerRequiredHint'));
      return;
    }
    if (loginForm.password.length < 8) {
      setError(t('sync.registerPasswordTooShort'));
      return;
    }
    try {
      await callAction('/api/sync/register', {
        server_url: loginForm.server_url,
        username: loginForm.username,
        password: loginForm.password,
        email: registerExtras.email.trim() || undefined,
        invite_code: registerExtras.invite_code.trim() || undefined,
      });
      // 注册成功 → 自动 login(同 password,补 machine_name)
      await callAction('/api/sync/login', loginForm);
      setError(t('sync.registerSuccess', { username: loginForm.username }));
      setAuthMode('login');
      setLoginForm(prev => ({ ...prev, password: '' }));
      setRegisterExtras({ email: '', invite_code: '' });
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, loginForm, registerExtras, fetchStatus, t]);

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await callAction('/api/sync/logout');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, fetchStatus]);

  /// 启动 progress 轮询(每 500ms 拉一次 /api/sync/progress);返回 stop 函数。
  /// 同步结束(phase=idle)或 stop() 调用时停。
  const startProgressPolling = useCallback((): (() => void) => {
    let stopped = false;
    const id = setInterval(async () => {
      if (stopped) return;
      try {
        const r = await fetch('/api/sync/progress');
        if (r.ok) {
          const p = (await r.json()) as { phase: 'push' | 'pull' | 'idle'; current: number; total: number };
          setSyncProgress(p);
          if (p.phase === 'idle') {
            stopped = true;
            clearInterval(id);
          }
        }
      } catch { /* swallow */ }
    }, 500);
    return () => { stopped = true; clearInterval(id); setSyncProgress(null); };
  }, []);

  const handlePush = useCallback(async (): Promise<void> => {
    const stopPoll = startProgressPolling();
    try {
      const r = (await callAction('/api/sync/push')) as { pushed: number; duplicates: number; errors: number } | null;
      if (r) {
        setError(t('sync.pushDone', { pushed: r.pushed, dup: r.duplicates, err: r.errors }));
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      stopPoll();
    }
  }, [callAction, fetchStatus, t, startProgressPolling]);

  const handlePull = useCallback(async (): Promise<void> => {
    const stopPoll = startProgressPolling();
    try {
      const r = (await callAction('/api/sync/pull')) as { ownReceived: number; sharedReadOnly: number; sharedAutoCopy: number } | null;
      if (r) {
        setError(t('sync.pullDone', { own: r.ownReceived, ro: r.sharedReadOnly, ac: r.sharedAutoCopy }));
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      stopPoll();
    }
  }, [callAction, fetchStatus, t, startProgressPolling]);

  /**
   * Share UX 重构:不再用 window.prompt 链,改成项目卡内联 share panel。
   * 点击"共享"按钮 → setSharingProject(name) → 在项目表上方滑出表单 → 用户填完一次提交。
   * 关键能力:target_type=user 时支持多用户名(逗号 / 分号 / 换行 / 空格分隔),
   *          逐个调 share-project API,聚合成功 / 失败结果。
   */
  const handleShareProject = useCallback((projectName: string): void => {
    // 重置表单状态后打开
    setShareForm({
      target_type: 'user',
      usernames: '',
      mode: 'fork-allowed',
      expires_days: '7',
    });
    setShareProgress(null);
    setShareLinkResult(null);
    setSharingProject(projectName);
  }, []);

  /** parseUsernames:把 textarea 内容拆成 unique username 列表 */
  const parseUsernames = (raw: string): string[] => {
    return Array.from(
      new Set(
        raw
          .split(/[\s,;]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0)
      )
    );
  };

  /** 提交 share 表单 — target=user 时多次调用,聚合结果 */
  const submitShare = useCallback(async (): Promise<void> => {
    if (!sharingProject) return;
    const projectName = sharingProject;

    // 校验
    if (shareForm.target_type === 'user') {
      const us = parseUsernames(shareForm.usernames);
      if (us.length === 0) {
        setError(t('sync.shareNoUsernames'));
        return;
      }
      // 逐个调用,聚合结果
      const ok: string[] = [];
      const fail: Array<{ user: string; err: string }> = [];
      for (let i = 0; i < us.length; i++) {
        setShareProgress(`${i + 1}/${us.length}`);
        try {
          await callAction('/api/sync/share-project', {
            project_name: projectName,
            target_type: 'user',
            target_username: us[i],
            share_mode: shareForm.mode,
          });
          ok.push(us[i]);
        } catch (e) {
          fail.push({ user: us[i], err: e instanceof Error ? e.message : String(e) });
        }
      }
      setShareProgress(null);
      const summary = t('sync.shareBatchResult', {
        project: projectName,
        ok: ok.length,
        fail: fail.length,
        mode: shareForm.mode,
      });
      const detail = fail.length > 0
        ? '\n\n' + fail.map(f => `× @${f.user}: ${f.err}`).join('\n')
        : '';
      // 全成功 → 自动关闭;有失败 → 保持打开,让用户看错误
      if (fail.length === 0) {
        setSharingProject(null);
        setError(summary);
      } else {
        setError(summary + detail);
      }
      await fetchStatus();
      return;
    }

    // public 或 link — 单次调用
    const body: Record<string, unknown> = {
      project_name: projectName,
      target_type: shareForm.target_type,
      share_mode: shareForm.target_type === 'link' ? 'read-only' : shareForm.mode,
    };
    if (shareForm.target_type === 'link') {
      const n = parseInt(shareForm.expires_days.trim(), 10);
      if (!isNaN(n) && n > 0) body.expires_in_secs = n * 86400;
    }
    try {
      const result = (await callAction('/api/sync/share-project', body)) as
        { share_url?: string; share_token?: string } | null;
      if (shareForm.target_type === 'link' && result?.share_url) {
        setShareLinkResult(result.share_url);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(result.share_url).catch(() => { /* ignore */ });
        }
        // link 模式保持 form 打开,让用户看到链接 + 复制
      } else {
        setSharingProject(null);
        setError(t('sync.shareSuccess', {
          project: projectName,
          target: shareForm.target_type === 'public' ? t('sync.shareAllUsers') : '',
          mode: body.share_mode as string,
        }));
      }
      await fetchStatus();
    } catch (e) {
      setError(t('sync.shareFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }, [callAction, fetchStatus, t, sharingProject, shareForm]);

  const handleUnshareProject = useCallback(async (projectName: string): Promise<void> => {
    if (!window.confirm(t('sync.unshareConfirm', { project: projectName }))) return;
    try {
      await callAction('/api/sync/unshare-project', { project_name: projectName });
      setError(t('sync.unshareSuccess', { project: projectName }));
      await fetchStatus();
    } catch (e) {
      setError(t('sync.shareFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }, [callAction, fetchStatus, t]);

  /** 保存自动同步配置 — 后端会返回新的 next_run_at */
  const saveAutoSync = useCallback(async (patch: Partial<AutoSyncDto>): Promise<void> => {
    try {
      const body: Record<string, unknown> = {};
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      if (patch.interval_minutes !== undefined) body.interval_minutes = patch.interval_minutes;
      if (patch.direction !== undefined) body.direction = patch.direction;
      const r = (await callAction('/api/sync/auto', body)) as AutoSyncDto;
      setAutoSync(r);
      setAutoSyncDraft({ interval_minutes: r.interval_minutes, direction: r.direction });
      setAutoSavedHint(t('sync.autoSyncSavedHint'));
      setTimeout(() => setAutoSavedHint(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, t]);

  // 项目列表搜索过滤(client side,简单 includes)
  const filteredProjects = search.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  if (!isOpen) return null;

  // 通用样式 token
  const C = {
    chip: {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px',
      background: 'var(--color-bg-tertiary, rgba(255,255,255,0.04))',
      border: '1px solid var(--color-border-primary, #2a2a2a)',
      borderRadius: 12, fontSize: 12,
      color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
    } as React.CSSProperties,
    card: {
      padding: 14, marginBottom: 12,
      background: 'var(--color-bg-secondary, rgba(255,255,255,0.02))',
      border: '1px solid var(--color-border-primary, #2a2a2a)',
      borderRadius: 6,
    } as React.CSSProperties,
    cardTitle: {
      margin: 0, fontSize: 13, fontWeight: 600,
      color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: 0.5,
    } as React.CSSProperties,
    rowLabel: {
      fontSize: 11, color: '#999', marginBottom: 4,
    } as React.CSSProperties,
    smallBtn: {
      padding: '4px 10px', fontSize: 12, background: 'transparent',
      border: '1px solid var(--color-border-primary)', borderRadius: 3, cursor: 'pointer',
      color: 'var(--color-text-secondary)',
    } as React.CSSProperties,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="context-settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, width: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2>{t('sync.title')}</h2>
          <button onClick={onClose} className="modal-close-btn" title={t('settings.closeEsc')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/*
          注意:不要套 .modal-body 类 — 全局 CSS 把它设成 grid 70/30,
          会把我们的 children 强制塞成左右两列。这里直接 inline 单列 flex。
        */}
        <div style={{
          padding: 16, flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
          overflow: 'hidden',
        }}>
          {error && (
            <div style={{
              flexShrink: 0,
              color: '#ff6b6b', padding: 8,
              background: '#2a0808', borderRadius: 4, fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {loading && !status && <div style={{ flexShrink: 0 }}>{t('common.loading')}</div>}

          {/* ========== 未登录态:居中认证卡 ========== */}
          {status && !status.loggedIn && (
            <div style={{
              flexShrink: 0,
              maxWidth: 460, margin: '24px auto',
              padding: 24, borderRadius: 8,
              background: 'var(--color-bg-secondary, rgba(255,255,255,0.02))',
              border: '1px solid var(--color-border-primary, #2a2a2a)',
              overflow: 'auto',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 4 }}>☁</div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{t('sync.welcomeTitle')}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>
                  {t('sync.welcomeHint')}
                </p>
              </div>

              {/* tab */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--color-border-primary)' }}>
                {(['login', 'register'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAuthMode(m)}
                    style={{
                      flex: 1, padding: '8px 0', background: 'transparent',
                      border: 'none',
                      borderBottom: `2px solid ${authMode === m ? (m === 'register' ? '#3fb950' : 'var(--color-accent-primary, #58a6ff)') : 'transparent'}`,
                      color: authMode === m ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      cursor: 'pointer', fontSize: 13, fontWeight: authMode === m ? 600 : 400,
                    }}
                  >
                    {t(m === 'login' ? 'sync.tab.login' : 'sync.tab.register')}
                  </button>
                ))}
              </div>

              {authMode === 'register' && (
                <div style={{
                  padding: '6px 10px', marginBottom: 10,
                  background: 'rgba(63, 185, 80, 0.08)',
                  border: '1px dashed #3fb950', borderRadius: 4,
                  fontSize: 11, color: 'var(--color-text-secondary)',
                }}>
                  {t('sync.registerHint')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  placeholder={t('sync.serverUrlPlaceholder')}
                  value={loginForm.server_url}
                  onChange={(e) => setLoginForm({ ...loginForm, server_url: e.target.value })}
                />
                <input
                  type="text"
                  placeholder={t('sync.usernamePlaceholder')}
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                />
                <input
                  type="password"
                  placeholder={authMode === 'register' ? t('sync.passwordPlaceholderRegister') : t('sync.passwordPlaceholder')}
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                />
                {authMode === 'register' && (
                  <>
                    <input
                      type="email"
                      placeholder={t('sync.emailPlaceholder')}
                      value={registerExtras.email}
                      onChange={(e) => setRegisterExtras({ ...registerExtras, email: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder={t('sync.inviteCodePlaceholder')}
                      value={registerExtras.invite_code}
                      onChange={(e) => setRegisterExtras({ ...registerExtras, invite_code: e.target.value })}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                  </>
                )}
                {/* 机器名 / 描述折叠到一行 grid,减少视觉行数 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    placeholder={t('sync.machineNamePlaceholder')}
                    value={loginForm.machine_name}
                    onChange={(e) => setLoginForm({ ...loginForm, machine_name: e.target.value })}
                    required
                    aria-required="true"
                    style={{ borderColor: loginForm.machine_name.trim() ? undefined : '#d29922' }}
                    title={t('sync.machineNameRequired')}
                  />
                  <input
                    type="text"
                    placeholder={t('sync.machineDescriptionPlaceholder')}
                    value={loginForm.machine_description}
                    onChange={(e) => setLoginForm({ ...loginForm, machine_description: e.target.value })}
                  />
                </div>

                {authMode === 'login' ? (
                  <button onClick={handleLogin} disabled={busy} style={{ marginTop: 4 }}>
                    {t('sync.confirmLogin')}
                  </button>
                ) : (
                  <button
                    onClick={handleRegister}
                    disabled={busy}
                    style={{ marginTop: 4, background: '#3fb950', color: '#fff', border: 'none' }}
                  >
                    {t('sync.confirmRegister')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ========== 已登录态:紧凑顶栏 + 项目区 flex:1 占满剩余 ========== */}
          {status && status.loggedIn && (
            <>
              {/* === 顶部紧凑栏 — 不超过 2 行,flexShrink: 0 不被项目区挤压 === */}
              <div style={{
                flexShrink: 0,
                padding: '8px 10px',
                background: 'var(--color-bg-secondary, rgba(255,255,255,0.02))',
                border: '1px solid var(--color-border-primary, #2a2a2a)',
                borderRadius: 6,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                {/* 第 1 行:身份 + 同步操作 + Logout */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span style={{ ...C.chip, color: '#3fb950', borderColor: '#3fb950' }}>
                    ● {status.username}{status.machineName ? `@${status.machineName}` : ''}
                  </span>
                  {status.serverUrl && (
                    <span style={C.chip} title={status.serverUrl}>
                      {status.serverUrl.replace(/^https?:\/\//, '')}
                    </span>
                  )}
                  {status.pendingPush > 0 && (
                    <span style={{ ...C.chip, color: '#d29922', borderColor: '#d29922' }}
                          title={t('sync.pendingPush')}>
                      ⇧ {status.pendingPush}
                    </span>
                  )}
                  {status.pendingDowngrades > 0 && (
                    <span style={{ ...C.chip, color: '#f85149', borderColor: '#f85149' }}
                          title={t('sync.pendingDowngrades')}>
                      ⚠ {status.pendingDowngrades}
                    </span>
                  )}
                  {status.pendingPush === 0 && status.pendingDowngrades === 0 && (
                    <span style={{ ...C.chip, color: '#3fb950', borderColor: '#3fb95044' }}>
                      ✓ {t('sync.upToDate')}
                    </span>
                  )}

                  {/* 同步进度条:push/pull 期间显示 */}
                  {syncProgress && syncProgress.phase !== 'idle' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 10px',
                      background: 'rgba(56, 139, 253, 0.08)',
                      border: '1px solid #388bfd',
                      borderRadius: 4,
                      fontSize: 12,
                    }}>
                      <span>{syncProgress.phase === 'push' ? '⇧ Push' : '⇩ Pull'}</span>
                      <div style={{
                        width: 120, height: 6, borderRadius: 3,
                        background: 'rgba(255,255,255,0.1)',
                        overflow: 'hidden', position: 'relative',
                      }}>
                        {syncProgress.total > 0 ? (
                          <div style={{
                            width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%`,
                            height: '100%', background: '#388bfd',
                            transition: 'width 0.3s',
                          }} />
                        ) : (
                          // 进行中,total 未知 → 半透明铺满表示 indeterminate
                          <div style={{
                            width: '100%', height: '100%',
                            background: 'linear-gradient(90deg, #388bfd 0%, rgba(56,139,253,0.3) 100%)',
                          }} />
                        )}
                      </div>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#999' }}>
                        {syncProgress.total > 0
                          ? `${syncProgress.current}/${syncProgress.total}`
                          : '...'}
                      </span>
                    </div>
                  )}

                  {/* 操作按钮 — 推到右侧 */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={handlePush} disabled={busy} style={{ padding: '3px 10px', fontSize: 12 }}>
                      ⇧ {t('sync.pushNow')}
                    </button>
                    <button onClick={handlePull} disabled={busy} style={{ padding: '3px 10px', fontSize: 12 }}>
                      ⇩ {t('sync.pullNow')}
                    </button>
                    <button onClick={fetchStatus} disabled={busy} style={C.smallBtn} title={t('common.retry')}>↻</button>
                    <button onClick={() => setStatusExpanded(v => !v)} style={C.smallBtn}>
                      {statusExpanded ? '▴' : '▾'}
                    </button>
                    <button onClick={handleLogout} disabled={busy} style={{ ...C.smallBtn, color: '#f85149', borderColor: '#f85149' }}>
                      {t('sync.logout')}
                    </button>
                  </div>
                </div>

                {/* 第 2 行:自动同步内联(关时也只占一行) */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  fontSize: 12, color: 'var(--color-text-secondary)',
                  paddingTop: 6,
                  borderTop: '1px dashed var(--color-border-primary, #2a2a2a)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoSync?.enabled ?? false}
                      onChange={e => void saveAutoSync({ enabled: e.target.checked })}
                      disabled={busy}
                    />
                    <span>⏱ {t('sync.autoSync')}</span>
                  </label>
                  {autoSync?.enabled ? (
                    <>
                      <select
                        value={autoSyncDraft.interval_minutes}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10);
                          setAutoSyncDraft(d => ({ ...d, interval_minutes: v }));
                          void saveAutoSync({ interval_minutes: v });
                        }}
                        disabled={busy}
                        style={{ fontSize: 12, padding: '1px 4px' }}
                      >
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 h</option>
                        <option value={180}>3 h</option>
                        <option value={360}>6 h</option>
                        <option value={720}>12 h</option>
                        <option value={1440}>24 h</option>
                      </select>
                      <select
                        value={autoSyncDraft.direction}
                        onChange={e => {
                          const v = e.target.value as 'push' | 'pull' | 'both';
                          setAutoSyncDraft(d => ({ ...d, direction: v }));
                          void saveAutoSync({ direction: v });
                        }}
                        disabled={busy}
                        style={{ fontSize: 12, padding: '1px 4px' }}
                      >
                        <option value="both">{t('sync.autoSyncDirectionBoth')}</option>
                        <option value="push">{t('sync.autoSyncDirectionPush')}</option>
                        <option value="pull">{t('sync.autoSyncDirectionPull')}</option>
                      </select>
                      <span style={{ fontFamily: 'monospace', color: '#3fb950' }}>
                        →&nbsp;{autoSync.next_run_at ? fmtCountdown(autoSync.next_run_at - nowSec) : '-'}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#666', fontSize: 11 }}>{t('sync.autoSyncOffHint')}</span>
                  )}
                  {autoSavedHint && (
                    <span style={{ marginLeft: 'auto', color: '#3fb950', fontSize: 11 }}>{autoSavedHint}</span>
                  )}
                </div>

                {/* 展开:最近 push/pull 时间戳 */}
                {statusExpanded && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 16,
                    fontSize: 11, color: '#999',
                    paddingTop: 6,
                    borderTop: '1px dashed var(--color-border-primary, #2a2a2a)',
                  }}>
                    <span><span style={{ color: '#666' }}>{t('sync.lastPush')}:</span> {fmtEpoch(status.lastPushedAt)}</span>
                    <span><span style={{ color: '#666' }}>{t('sync.lastPull')}:</span> {fmtEpoch(status.lastPulledAt)}</span>
                    <span><span style={{ color: '#666' }}>{t('sync.lastPulledSeq')}:</span> {status.lastPulledSeq}</span>
                  </div>
                )}
              </div>

              {/* === 项目共享 — flex: 1 占满剩余空间,内部表格滚动 === */}
              <div style={{
                flex: 1, minHeight: 0,
                display: 'flex', flexDirection: 'column',
                border: '1px solid var(--color-border-primary, #2a2a2a)',
                borderRadius: 6,
                background: 'var(--color-bg-secondary, rgba(255,255,255,0.02))',
                overflow: 'hidden',
              }}>
                {/* 项目卡头部 */}
                <div style={{
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', gap: 8, flexWrap: 'wrap',
                  borderBottom: '1px solid var(--color-border-primary, #2a2a2a)',
                }}>
                  <h3 style={C.cardTitle}>
                    {t('sync.projects')}
                    {projects.length > 0 && (
                      <span style={{
                        marginLeft: 6, fontSize: 11, color: '#999',
                        fontWeight: 'normal', textTransform: 'none', letterSpacing: 0,
                      }}>
                        {filteredProjects.length}/{projects.length}
                      </span>
                    )}
                  </h3>
                  {projects.length > 5 && (
                    <input
                      type="text"
                      placeholder={t('sync.searchPlaceholder')}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{ width: 220, padding: '4px 8px', fontSize: 12 }}
                    />
                  )}
                </div>

                {/* === Share 表单面板 — sharingProject != null 时滑入 === */}
                {sharingProject && (
                  <div style={{
                    flexShrink: 0,
                    padding: 12, margin: '8px 12px',
                    background: 'rgba(63, 185, 80, 0.06)',
                    border: '1px solid #3fb950',
                    borderRadius: 6,
                    display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>
                        {t('sync.shareFormTitle', { project: sharingProject })}
                      </strong>
                      <button
                        type="button"
                        onClick={() => { setSharingProject(null); setShareLinkResult(null); }}
                        style={C.smallBtn}
                        disabled={busy}
                      >
                        ✕
                      </button>
                    </div>

                    {/* target_type 单选 */}
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      {(['user', 'public', 'link'] as const).map(tt => (
                        <label key={tt} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="share_target_type"
                            checked={shareForm.target_type === tt}
                            onChange={() => setShareForm(f => ({
                              ...f,
                              target_type: tt,
                              // link 强制 read-only
                              mode: tt === 'link' ? 'read-only' : f.mode,
                            }))}
                            disabled={busy}
                          />
                          <span>{t(`sync.shareTargetType.${tt}`)}</span>
                        </label>
                      ))}
                    </div>

                    {/* 按 type 显示不同字段 */}
                    {shareForm.target_type === 'user' && (
                      <div>
                        <div style={C.rowLabel}>{t('sync.shareUsernamesLabel')}</div>
                        <textarea
                          value={shareForm.usernames}
                          onChange={e => setShareForm(f => ({ ...f, usernames: e.target.value }))}
                          placeholder={t('sync.shareUsernamesPlaceholder')}
                          rows={3}
                          style={{
                            width: '100%', padding: '6px 8px', fontSize: 12,
                            fontFamily: 'monospace',
                            border: '1px solid var(--color-border-primary)', borderRadius: 3,
                            background: 'var(--color-bg-tertiary, #181818)',
                            color: 'var(--color-text-primary)',
                            resize: 'vertical',
                          }}
                          disabled={busy}
                        />
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          {t('sync.shareUsernamesHint')}
                          {parseUsernames(shareForm.usernames).length > 0 && (
                            <span style={{ marginLeft: 8, color: '#3fb950' }}>
                              ({parseUsernames(shareForm.usernames).length})
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {shareForm.target_type === 'link' && (
                      <div>
                        <div style={C.rowLabel}>{t('sync.shareLinkExpiresLabel')}</div>
                        <input
                          type="number"
                          min="0"
                          value={shareForm.expires_days}
                          onChange={e => setShareForm(f => ({ ...f, expires_days: e.target.value }))}
                          placeholder={t('sync.shareLinkExpiresPlaceholder')}
                          style={{ width: 120, padding: '4px 8px', fontSize: 12 }}
                          disabled={busy}
                        />
                        <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>
                          {t('sync.shareLinkExpiresHint')}
                        </span>
                      </div>
                    )}

                    {/* mode 单选 — link 强制 read-only,UI 锁住其他选项 */}
                    <div>
                      <div style={C.rowLabel}>{t('sync.shareModeLabel')}</div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                        {(['read-only', 'fork-allowed', 'auto-copy'] as const).map(m => {
                          const disabled = busy || (shareForm.target_type === 'link' && m !== 'read-only');
                          return (
                            <label key={m} style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              color: disabled && shareForm.target_type === 'link' ? '#666' : undefined,
                            }}>
                              <input
                                type="radio"
                                name="share_mode"
                                checked={shareForm.mode === m}
                                onChange={() => setShareForm(f => ({ ...f, mode: m }))}
                                disabled={disabled}
                              />
                              <span>{m}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* link 成功:显示 url + 复制按钮 */}
                    {shareLinkResult && (
                      <div style={{
                        padding: 8, background: 'var(--color-bg-tertiary, #181818)',
                        borderRadius: 3, fontSize: 11, fontFamily: 'monospace',
                        wordBreak: 'break-all',
                      }}>
                        <div style={{ color: '#3fb950', marginBottom: 4 }}>
                          ✓ {t('sync.shareLinkCreated')}{' '}
                          <button
                            type="button"
                            onClick={() => { void navigator.clipboard?.writeText(shareLinkResult); }}
                            style={{ ...C.smallBtn, fontSize: 11 }}
                          >
                            {t('sync.copyLink')}
                          </button>
                        </div>
                        <div>{shareLinkResult}</div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                      {shareProgress && (
                        <span style={{ marginRight: 'auto', fontSize: 12, color: '#d29922' }}>
                          {t('sync.shareProgress', { p: shareProgress })}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => { setSharingProject(null); setShareLinkResult(null); }}
                        style={C.smallBtn}
                        disabled={busy}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={submitShare}
                        disabled={busy || (shareForm.target_type === 'user' && parseUsernames(shareForm.usernames).length === 0)}
                        style={{
                          padding: '4px 14px', background: '#3fb950',
                          color: '#fff', border: 'none', borderRadius: 3,
                          cursor: 'pointer', fontSize: 12, fontWeight: 500,
                        }}
                      >
                        {t('sync.shareSubmit')}
                      </button>
                    </div>
                  </div>
                )}

                {/* 项目表格区 — flex:1 撑满,table 内 sticky head 自滚 */}
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {projects.length === 0 ? (
                    <div style={{
                      margin: 16, padding: 20, textAlign: 'center',
                      background: 'rgba(63, 185, 80, 0.05)',
                      border: '1px dashed var(--color-border-primary, #2a2a2a)',
                      borderRadius: 6, color: 'var(--color-text-secondary)', fontSize: 13,
                    }}>
                      {t('sync.noProjectsYet')}
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div style={{
                      margin: 16, padding: 16, textAlign: 'center', color: '#999', fontSize: 13,
                      border: '1px dashed var(--color-border-primary, #2a2a2a)', borderRadius: 6,
                    }}>
                      {t('sync.noMatch', { q: search })}
                    </div>
                  ) : (
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead style={{
                        position: 'sticky', top: 0, zIndex: 1,
                        background: 'var(--color-bg-tertiary, #181818)',
                      }}>
                        <tr style={{ fontSize: 11, textTransform: 'uppercase', color: '#999' }}>
                          <th style={{ textAlign: 'left', padding: '6px 12px' }}>{t('sync.colName')}</th>
                          <th style={{ textAlign: 'right', padding: '6px 12px' }} title="本地 obs 数">本地</th>
                          <th style={{ textAlign: 'right', padding: '6px 12px' }} title="远程 server 上的 obs 数">远程</th>
                          <th style={{ textAlign: 'center', padding: '6px 12px' }} title="本地 vs 远程 差量">Δ</th>
                          <th style={{ textAlign: 'left', padding: '6px 12px' }}>{t('sync.colShare')}</th>
                          <th style={{ textAlign: 'left', padding: '6px 12px' }}>{t('sync.colFlags')}</th>
                          <th style={{ textAlign: 'right', padding: '6px 12px' }}>{t('sync.colActions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProjects.map(p => {
                          const isShared = p.share_state && p.share_state !== '-' && p.share_state !== 'private';
                          return (
                            <tr key={p.name} style={{ borderTop: '1px solid var(--color-border-primary, #2a2a2a)' }}>
                              <td style={{ padding: '6px 12px' }}>{p.name}</td>
                              <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {p.observation_count}
                              </td>
                              <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#999' }}>
                                {remoteCounts[p.name] !== undefined ? remoteCounts[p.name] : '—'}
                              </td>
                              <td style={{ padding: '6px 12px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                                {(() => {
                                  const r = remoteCounts[p.name];
                                  if (r === undefined) return <span style={{ color: '#666' }}>—</span>;
                                  const d = p.observation_count - r;
                                  if (d === 0) return <span style={{ color: '#3fb950' }}>✓</span>;
                                  if (d > 0) return <span style={{ color: '#d29922' }} title={`本地多 ${d} 条未推`}>+{d}</span>;
                                  return <span style={{ color: '#9cf' }} title={`远程多 ${-d} 条`}>{d}</span>;
                                })()}
                              </td>
                              <td style={{ padding: '6px 12px', color: isShared ? '#3fb950' : '#999' }}>
                                {p.share_state ?? '-'}
                              </td>
                              <td style={{ padding: '6px 12px', fontSize: 11 }}>
                                {p.is_excluded && <span style={{ color: '#999' }}>excl </span>}
                                {p.is_forked && <span style={{ color: '#9cf' }}>fork</span>}
                              </td>
                              <td style={{ padding: '6px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <button
                                  type="button"
                                  onClick={() => handleShareProject(p.name)}
                                  disabled={busy || p.is_forked}
                                  title={p.is_forked ? t('sync.cantShareFork') : t('sync.share')}
                                  style={{
                                    padding: '3px 8px', marginRight: 4,
                                    background: 'transparent',
                                    color: p.is_forked ? '#666' : '#3fb950',
                                    border: `1px solid ${p.is_forked ? '#333' : '#3fb950'}`,
                                    borderRadius: 3,
                                    cursor: p.is_forked ? 'not-allowed' : 'pointer',
                                    fontSize: 11,
                                  }}
                                >
                                  {t('sync.share')}
                                </button>
                                {isShared && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnshareProject(p.name)}
                                    disabled={busy}
                                    title={t('sync.unshare')}
                                    style={{
                                      padding: '3px 8px',
                                      background: 'transparent', color: '#f85149',
                                      border: '1px solid #f85149',
                                      borderRadius: 3, cursor: 'pointer', fontSize: 11,
                                    }}
                                  >
                                    {t('sync.unshare')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
