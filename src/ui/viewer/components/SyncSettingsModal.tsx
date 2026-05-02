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
  const [loginForm, setLoginForm] = useState({
    server_url: '',
    username: '',
    password: '',
    machine_name: defaultMachineName,  // 默认填,避免 zod min(1) 校验失败
    machine_description: '',
  });

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

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="context-settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <div className="modal-header">
          <h2>{t('sync.title')}</h2>
          <button onClick={onClose} className="modal-close-btn" title={t('settings.closeEsc')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body" style={{ padding: 24, overflow: 'auto' }}>
          {error && (
            <div style={{ color: '#ff6b6b', marginBottom: 12, padding: 8, background: '#2a0808', borderRadius: 4 }}>
              {error}
            </div>
          )}

          {loading && !status && <div>{t('common.loading')}</div>}

          {status && (
            <>
              {/* 状态摘要 */}
              <section style={{ marginBottom: 24 }}>
                <h3 style={{ marginTop: 0 }}>{t('sync.status')}</h3>
                <table style={{ width: '100%', fontSize: 14 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.serverUrl')}</td>
                      <td>{status.serverUrl ?? <em>{t('sync.notConfigured')}</em>}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.loggedIn')}</td>
                      <td>{status.loggedIn ? t('common.yes') : t('common.no')}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.user')}</td>
                      <td>{status.username ?? '-'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.machine')}</td>
                      <td>{status.machineName ?? '-'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.lastPulledSeq')}</td>
                      <td>{status.lastPulledSeq}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.lastPush')}</td>
                      <td>{fmtEpoch(status.lastPushedAt)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.lastPull')}</td>
                      <td>{fmtEpoch(status.lastPulledAt)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.pendingPush')}</td>
                      <td>{status.pendingPush}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#999' }}>{t('sync.pendingDowngrades')}</td>
                      <td>{status.pendingDowngrades}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Auth */}
              <section style={{ marginBottom: 24 }}>
                <h3>{t('sync.auth')}</h3>
                {status.loggedIn ? (
                  <button onClick={handleLogout} disabled={busy}>{t('sync.logout')}</button>
                ) : (
                  <>
                    {!showLoginForm && (
                      <button onClick={() => setShowLoginForm(true)} disabled={busy}>
                        {t('sync.login')}
                      </button>
                    )}
                    {showLoginForm && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
                          placeholder={t('sync.passwordPlaceholder')}
                          value={loginForm.password}
                          onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                        />
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
                          <button onClick={handleLogin} disabled={busy}>{t('sync.confirmLogin')}</button>
                          <button onClick={() => setShowLoginForm(false)} disabled={busy}>{t('common.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* 同步操作 */}
              {status.loggedIn && (
                <section style={{ marginBottom: 24 }}>
                  <h3>{t('sync.actions')}</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handlePush} disabled={busy}>{t('sync.pushNow')}</button>
                    <button onClick={handlePull} disabled={busy}>{t('sync.pullNow')}</button>
                    <button onClick={fetchStatus} disabled={busy}>{t('common.retry')}</button>
                  </div>
                </section>
              )}

              {/* 项目列表 — 未登录时显示引导,登录后但项目空显示 hint */}
              <section>
                <h3>{t('sync.projects')}</h3>
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
                ) : (
                  <table style={{ width: '100%', fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>{t('sync.colName')}</th>
                        <th style={{ textAlign: 'right' }}>{t('sync.colObsCount')}</th>
                        <th>{t('sync.colShare')}</th>
                        <th>{t('sync.colFlags')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map(p => (
                        <tr key={p.name}>
                          <td>{p.name}</td>
                          <td style={{ textAlign: 'right' }}>{p.observation_count}</td>
                          <td>{p.share_state ?? '-'}</td>
                          <td>
                            {p.is_excluded && <span style={{ color: '#999' }}>excl</span>}{' '}
                            {p.is_forked && <span style={{ color: '#9cf' }}>fork</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
