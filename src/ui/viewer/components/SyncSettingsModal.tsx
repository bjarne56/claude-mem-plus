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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const [showLoginForm, setShowLoginForm] = useState(false);
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
      setShowLoginForm(false);
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
      setShowLoginForm(false);
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

  const handlePush = useCallback(async (): Promise<void> => {
    try {
      const r = (await callAction('/api/sync/push')) as { pushed: number; duplicates: number; errors: number } | null;
      if (r) {
        setError(t('sync.pushDone', { pushed: r.pushed, dup: r.duplicates, err: r.errors }));
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, fetchStatus, t]);

  const handlePull = useCallback(async (): Promise<void> => {
    try {
      const r = (await callAction('/api/sync/pull')) as { ownReceived: number; sharedReadOnly: number; sharedAutoCopy: number } | null;
      if (r) {
        setError(t('sync.pullDone', { own: r.ownReceived, ro: r.sharedReadOnly, ac: r.sharedAutoCopy }));
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [callAction, fetchStatus, t]);

  /** 共享某项目 — 三步 prompt:target_type → 详细字段 → mode */
  const handleShareProject = useCallback(async (projectName: string): Promise<void> => {
    // 步骤 1:选 target_type
    const targetTypeRaw = window.prompt(t('sync.promptShareType', { project: projectName }), 'user');
    if (!targetTypeRaw) return;
    const targetType = targetTypeRaw.trim().toLowerCase();
    if (!['user', 'public', 'link'].includes(targetType)) {
      window.alert(t('sync.shareInvalidType', { type: targetType }));
      return;
    }

    // 步骤 2:按 type 收集额外字段
    const body: Record<string, unknown> = {
      project_name: projectName,
      target_type: targetType,
    };
    let displayTarget = '';

    if (targetType === 'user') {
      const username = window.prompt(t('sync.promptShareTargetUser'));
      if (!username || !username.trim()) return;
      body.target_username = username.trim();
      displayTarget = `@${username.trim()}`;
    } else if (targetType === 'link') {
      const days = window.prompt(t('sync.promptShareLinkExpires'), '7');
      if (days === null) return;
      const n = parseInt(days.trim(), 10);
      if (!isNaN(n) && n > 0) {
        body.expires_in_secs = n * 86400;
      }
      displayTarget = t('sync.shareLinkAnonymous', { days: n > 0 ? String(n) : 'no expiry' });
    } else {
      // public:无额外字段
      displayTarget = t('sync.shareAllUsers');
    }

    // 步骤 3:选 mode(link 强制 read-only,server 端也会强制)
    const modeDefault = targetType === 'link' ? 'read-only' : 'fork-allowed';
    const modeRaw = window.prompt(t('sync.promptShareMode'), modeDefault);
    if (!modeRaw) return;
    const mode = modeRaw.trim();
    if (!['read-only', 'fork-allowed', 'auto-copy'].includes(mode)) {
      window.alert(t('sync.shareInvalidMode', { mode }));
      return;
    }
    body.share_mode = mode;

    try {
      const result = (await callAction('/api/sync/share-project', body)) as { share_url?: string; share_token?: string } | null;
      let msg = t('sync.shareSuccess', { project: projectName, target: displayTarget, mode });
      if (targetType === 'link' && result && (result.share_url || result.share_token)) {
        const url = result.share_url || `<token: ${result.share_token}>`;
        msg += `\n\n${t('sync.shareLinkCreated')}: ${url}`;
        // 自动复制到剪贴板(if 浏览器支持)
        if (navigator.clipboard && result.share_url) {
          navigator.clipboard.writeText(result.share_url).catch(() => { /* ignore */ });
        }
      }
      window.alert(msg);
      await fetchStatus();
    } catch (e) {
      setError(t('sync.shareFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }, [callAction, fetchStatus, t]);

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

  // chip 通用样式 — 状态摘要折叠形态
  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    background: 'var(--color-bg-tertiary, rgba(255,255,255,0.04))',
    border: '1px solid var(--color-border-primary, #2a2a2a)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    whiteSpace: 'nowrap',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="context-settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 880, width: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
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

        <div className="modal-body" style={{ padding: 20, overflow: 'auto', flex: 1, minHeight: 0 }}>
          {error && (
            <div style={{ color: '#ff6b6b', marginBottom: 12, padding: 8, background: '#2a0808', borderRadius: 4 }}>
              {error}
            </div>
          )}

          {loading && !status && <div>{t('common.loading')}</div>}

          {status && (
            <>
              {/* 状态摘要 — 默认 chips,展开看完整表 */}
              <section style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8, gap: 8, flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ ...chipStyle, color: status.loggedIn ? '#3fb950' : '#d29922' }}>
                      {status.loggedIn ? '● ' + (status.username ?? '?') : '○ ' + t('sync.notConfigured')}
                    </span>
                    {status.serverUrl && (
                      <span style={chipStyle} title={status.serverUrl}>
                        {status.serverUrl.replace(/^https?:\/\//, '')}
                      </span>
                    )}
                    {status.machineName && <span style={chipStyle}>{status.machineName}</span>}
                    {status.pendingPush > 0 && (
                      <span style={{ ...chipStyle, color: '#d29922', borderColor: '#d29922' }}>
                        ⇧ {status.pendingPush}
                      </span>
                    )}
                    {status.pendingDowngrades > 0 && (
                      <span style={{ ...chipStyle, color: '#f85149', borderColor: '#f85149' }}>
                        ⚠ {status.pendingDowngrades}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setStatusExpanded(v => !v)}
                    style={{
                      padding: '2px 8px', fontSize: 11, background: 'transparent',
                      border: '1px solid var(--color-border-primary)', borderRadius: 3, cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {statusExpanded ? t('sync.collapseDetails') : t('sync.expandDetails')}
                  </button>
                </div>
                {statusExpanded && (
                  <table style={{ width: '100%', fontSize: 13, marginTop: 4 }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '3px 8px', color: '#999', width: 140 }}>{t('sync.lastPulledSeq')}</td>
                        <td>{status.lastPulledSeq}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '3px 8px', color: '#999' }}>{t('sync.lastPush')}</td>
                        <td>{fmtEpoch(status.lastPushedAt)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '3px 8px', color: '#999' }}>{t('sync.lastPull')}</td>
                        <td>{fmtEpoch(status.lastPulledAt)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </section>

              {/* Auth */}
              <section style={{ marginBottom: 24 }}>
                <h3>{t('sync.auth')}</h3>
                {status.loggedIn ? (
                  <button onClick={handleLogout} disabled={busy}>{t('sync.logout')}</button>
                ) : (
                  <>
                    {!showLoginForm && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setAuthMode('login'); setShowLoginForm(true); }} disabled={busy}>
                          {t('sync.login')}
                        </button>
                        <button onClick={() => { setAuthMode('register'); setShowLoginForm(true); }} disabled={busy}
                                style={{ background: 'transparent', border: '1px solid #3fb950', color: '#3fb950' }}>
                          {t('sync.register')}
                        </button>
                      </div>
                    )}
                    {showLoginForm && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {/* tab 切 login / register */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          <button
                            type="button"
                            onClick={() => setAuthMode('login')}
                            style={{
                              padding: '4px 12px',
                              background: authMode === 'login' ? 'var(--color-accent-primary, #58a6ff)' : 'transparent',
                              color: authMode === 'login' ? '#fff' : 'var(--color-text-primary)',
                              border: '1px solid var(--color-border-primary)',
                              borderRadius: 3,
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                          >
                            {t('sync.tab.login')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuthMode('register')}
                            style={{
                              padding: '4px 12px',
                              background: authMode === 'register' ? '#3fb950' : 'transparent',
                              color: authMode === 'register' ? '#fff' : 'var(--color-text-primary)',
                              border: '1px solid var(--color-border-primary)',
                              borderRadius: 3,
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                          >
                            {t('sync.tab.register')}
                          </button>
                        </div>

                        {authMode === 'register' && (
                          <div style={{
                            padding: '8px 12px',
                            background: 'rgba(63, 185, 80, 0.08)',
                            border: '1px dashed #3fb950',
                            borderRadius: 4,
                            fontSize: 12,
                            color: 'var(--color-text-secondary)',
                            marginBottom: 4,
                          }}>
                            {t('sync.registerHint')}
                          </div>
                        )}

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
                        <div style={{ display: 'flex', gap: 8 }}>
                          {authMode === 'login' ? (
                            <button onClick={handleLogin} disabled={busy}>{t('sync.confirmLogin')}</button>
                          ) : (
                            <button onClick={handleRegister} disabled={busy}
                                    style={{ background: '#3fb950', color: '#fff', border: 'none' }}>
                              {t('sync.confirmRegister')}
                            </button>
                          )}
                          <button onClick={() => setShowLoginForm(false)} disabled={busy}>{t('common.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* 同步操作 + 自动同步 */}
              {status.loggedIn && (
                <>
                  <section style={{ marginBottom: 16 }}>
                    <h3 style={{ marginBottom: 8 }}>{t('sync.actions')}</h3>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={handlePush} disabled={busy}>{t('sync.pushNow')}</button>
                      <button onClick={handlePull} disabled={busy}>{t('sync.pullNow')}</button>
                      <button onClick={fetchStatus} disabled={busy}>{t('common.retry')}</button>
                    </div>
                  </section>

                  {/* 自动同步面板 */}
                  <section style={{
                    marginBottom: 16, padding: 12,
                    background: 'rgba(88, 166, 255, 0.04)',
                    border: '1px solid var(--color-border-primary, #2a2a2a)',
                    borderRadius: 6,
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: autoSync?.enabled ? 12 : 0,
                    }}>
                      <h3 style={{ margin: 0, fontSize: 14 }}>{t('sync.autoSync')}</h3>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={autoSync?.enabled ?? false}
                          onChange={e => void saveAutoSync({ enabled: e.target.checked })}
                          disabled={busy}
                        />
                        <span>{t('sync.autoSyncEnabled')}</span>
                      </label>
                    </div>
                    {autoSync?.enabled && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
                        <div>
                          <label style={{ display: 'block', color: '#999', fontSize: 11, marginBottom: 4 }}>
                            {t('sync.autoSyncInterval')}
                          </label>
                          <select
                            value={autoSyncDraft.interval_minutes}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10);
                              setAutoSyncDraft(d => ({ ...d, interval_minutes: v }));
                              void saveAutoSync({ interval_minutes: v });
                            }}
                            disabled={busy}
                            style={{ width: '100%' }}
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
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#999', fontSize: 11, marginBottom: 4 }}>
                            {t('sync.autoSyncDirection')}
                          </label>
                          <select
                            value={autoSyncDraft.direction}
                            onChange={e => {
                              const v = e.target.value as 'push' | 'pull' | 'both';
                              setAutoSyncDraft(d => ({ ...d, direction: v }));
                              void saveAutoSync({ direction: v });
                            }}
                            disabled={busy}
                            style={{ width: '100%' }}
                          >
                            <option value="both">{t('sync.autoSyncDirectionBoth')}</option>
                            <option value="push">{t('sync.autoSyncDirectionPush')}</option>
                            <option value="pull">{t('sync.autoSyncDirectionPull')}</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#999', fontSize: 11, marginBottom: 4 }}>
                            {t('sync.autoSyncNextRun')}
                          </label>
                          <div style={{ padding: '4px 0', color: '#3fb950', fontFamily: 'monospace' }}>
                            {autoSync.next_run_at
                              ? fmtCountdown(autoSync.next_run_at - nowSec)
                              : '-'}
                          </div>
                        </div>
                      </div>
                    )}
                    {autoSavedHint && (
                      <div style={{ marginTop: 8, color: '#3fb950', fontSize: 11 }}>{autoSavedHint}</div>
                    )}
                  </section>
                </>
              )}

              {/* 项目列表 — 未登录时显示引导,登录后但项目空显示 hint */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                  <h3 style={{ margin: 0 }}>
                    {t('sync.projects')}
                    {projects.length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#999', fontWeight: 'normal' }}>
                        ({filteredProjects.length}/{projects.length})
                      </span>
                    )}
                  </h3>
                  {projects.length > 5 && (
                    <input
                      type="text"
                      placeholder={t('sync.searchPlaceholder')}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{ width: 200, padding: '4px 8px', fontSize: 12 }}
                    />
                  )}
                </div>
                {!status.loggedIn ? (
                  <div
                    style={{
                      padding: '16px',
                      background: 'rgba(88, 166, 255, 0.05)',
                      border: '1px dashed var(--color-border-primary, #2a2a2a)',
                      borderRadius: '6px',
                      color: 'var(--color-text-secondary)',
                      fontSize: '13px',
                      textAlign: 'center',
                    }}
                  >
                    {t('sync.noLoginYet')}
                  </div>
                ) : projects.length === 0 ? (
                  <div
                    style={{
                      padding: '16px',
                      background: 'rgba(63, 185, 80, 0.05)',
                      border: '1px dashed var(--color-border-primary, #2a2a2a)',
                      borderRadius: '6px',
                      color: 'var(--color-text-secondary)',
                      fontSize: '13px',
                      textAlign: 'center',
                    }}
                  >
                    {t('sync.noProjectsYet')}
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div style={{
                    padding: '16px', textAlign: 'center', color: '#999', fontSize: 13,
                    border: '1px dashed var(--color-border-primary, #2a2a2a)', borderRadius: 6,
                  }}>
                    {t('sync.noMatch', { q: search })}
                  </div>
                ) : (
                  <div style={{
                    maxHeight: 320,
                    overflow: 'auto',
                    border: '1px solid var(--color-border-primary, #2a2a2a)',
                    borderRadius: 4,
                  }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead style={{
                      position: 'sticky', top: 0, zIndex: 1,
                      background: 'var(--color-bg-secondary, #1a1a1a)',
                    }}>
                      <tr style={{ fontSize: 11, textTransform: 'uppercase', color: '#999' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('sync.colName')}</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>{t('sync.colObsCount')}</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('sync.colShare')}</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('sync.colFlags')}</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>{t('sync.colActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.map(p => {
                        const isShared = p.share_state && p.share_state !== '-' && p.share_state !== 'private';
                        return (
                          <tr key={p.name} style={{ borderTop: '1px solid var(--color-border-primary, #2a2a2a)' }}>
                            <td>{p.name}</td>
                            <td style={{ textAlign: 'right' }}>{p.observation_count}</td>
                            <td>{p.share_state ?? '-'}</td>
                            <td>
                              {p.is_excluded && <span style={{ color: '#999' }}>excl</span>}{' '}
                              {p.is_forked && <span style={{ color: '#9cf' }}>fork</span>}
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                onClick={() => handleShareProject(p.name)}
                                disabled={busy || p.is_forked}
                                title={p.is_forked ? t('sync.cantShareFork') : t('sync.share')}
                                style={{
                                  padding: '3px 8px',
                                  marginRight: 4,
                                  background: 'transparent',
                                  color: p.is_forked ? '#999' : '#3fb950',
                                  border: `1px solid ${p.is_forked ? '#444' : '#3fb950'}`,
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
                                    background: 'transparent',
                                    color: '#f85149',
                                    border: '1px solid #f85149',
                                    borderRadius: 3,
                                    cursor: 'pointer',
                                    fontSize: 11,
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
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
