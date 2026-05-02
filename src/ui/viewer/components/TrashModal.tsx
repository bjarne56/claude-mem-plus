import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';

type RowTabType = 'observations' | 'sessions' | 'summaries';
type TabType = RowTabType | 'projects';

interface TrashRow {
  trash_id: number;
  original_id: number;
  memory_session_id: string | null;
  project: string | null;
  payload: string;  // JSON string
  deleted_at_epoch: number;
  reason: string;
}

interface TrashListResponse {
  ok: boolean;
  observations: TrashRow[];
  sessions: TrashRow[];
  summaries: TrashRow[];
  totals: { observations: number; sessions: number; summaries: number };
}

interface TrashProjectSummary {
  project: string;
  observations: number;
  sessions: number;
  summaries: number;
  lastDeletedAt: number;
}

interface TrashProjectsResponse {
  ok: boolean;
  projects: TrashProjectSummary[];
}

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChange?: () => void;  // 回收站变更后通知 App 刷新 Feed/projects
}

function formatTime(epoch: number): string {
  try {
    return new Date(epoch).toLocaleString();
  } catch {
    return String(epoch);
  }
}

function extractTitle(row: TrashRow, type: RowTabType): string {
  try {
    const p = JSON.parse(row.payload);
    if (type === 'observations') return p.title || p.subtitle || `#${row.original_id}`;
    if (type === 'summaries') return p.request || `Session #${row.original_id}`;
    if (type === 'sessions') return p.user_prompt || p.custom_title || `Session #${row.original_id}`;
  } catch {
    // ignore
  }
  return `#${row.original_id}`;
}

export function TrashModal({ isOpen, onClose, onChange }: TrashModalProps) {
  const { t } = useI18n();
  const [data, setData] = useState<TrashListResponse | null>(null);
  const [projectsData, setProjectsData] = useState<TrashProjectSummary[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('projects');  // 默认项目 tab,最常用
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [listRes, projRes] = await Promise.all([
        authFetch('/api/trash'),
        authFetch('/api/trash/projects'),
      ]);
      if (!listRes.ok) {
        const body = await listRes.json().catch(() => ({}));
        throw new Error(body.error || listRes.statusText);
      }
      if (!projRes.ok) {
        const body = await projRes.json().catch(() => ({}));
        throw new Error(body.error || projRes.statusText);
      }
      const listJson = (await listRes.json()) as TrashListResponse;
      const projJson = (await projRes.json()) as TrashProjectsResponse;
      setData(listJson);
      setProjectsData(projJson.projects);
    } catch (err) {
      setError(t('trash.fetchFailed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) fetchAll();
  }, [isOpen, fetchAll]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleRestore = useCallback(async (type: RowTabType, trashId: number) => {
    try {
      const res = await authFetch(`/api/trash/${type}/${trashId}/restore`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      await fetchAll();
      onChange?.();
    } catch (err) {
      window.alert(t('trash.restoreFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [fetchAll, onChange, t]);

  const handlePermanentDelete = useCallback(async (type: RowTabType, trashId: number) => {
    if (!window.confirm(t('trash.permanentDeleteConfirm'))) return;
    try {
      const res = await authFetch(`/api/trash/${type}/${trashId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      await fetchAll();
    } catch (err) {
      window.alert(t('trash.permanentDeleteFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [fetchAll, t]);

  const handleClearAll = useCallback(async () => {
    const total = data
      ? data.totals.observations + data.totals.sessions + data.totals.summaries
      : 0;
    if (total === 0) return;
    if (!window.confirm(t('trash.clearAllConfirm', { n: total }))) return;
    try {
      const res = await authFetch('/api/trash', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      const body = (await res.json()) as { cleared?: number };
      window.alert(t('trash.clearAllSuccess', { n: body.cleared ?? total }));
      await fetchAll();
      onChange?.();
    } catch (err) {
      window.alert(t('trash.clearAllFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [data, fetchAll, onChange, t]);

  const handleProjectRestore = useCallback(async (proj: TrashProjectSummary) => {
    const total = proj.observations + proj.sessions + proj.summaries;
    if (!window.confirm(t('trash.restoreProjectConfirm', { name: proj.project, n: total }))) return;
    try {
      const res = await authFetch(`/api/trash/projects/${encodeURIComponent(proj.project)}/restore`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      await fetchAll();
      onChange?.();
    } catch (err) {
      window.alert(t('trash.restoreFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [fetchAll, onChange, t]);

  const handleProjectPermanentDelete = useCallback(async (proj: TrashProjectSummary) => {
    const total = proj.observations + proj.sessions + proj.summaries;
    if (!window.confirm(t('trash.deleteProjectPermConfirm', { name: proj.project, n: total }))) return;
    try {
      const res = await authFetch(`/api/trash/projects/${encodeURIComponent(proj.project)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      await fetchAll();
    } catch (err) {
      window.alert(t('trash.permanentDeleteFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [fetchAll, t]);

  const rowsForActiveTab = useMemo<TrashRow[]>(() => {
    if (!data || activeTab === 'projects') return [];
    return data[activeTab];
  }, [data, activeTab]);

  const totals = data?.totals ?? { observations: 0, sessions: 0, summaries: 0 };
  const grandTotal = totals.observations + totals.sessions + totals.summaries;

  if (!isOpen) return null;

  const cellPad: React.CSSProperties = { padding: '8px' };
  const btnRestore: React.CSSProperties = {
    padding: '3px 8px', marginRight: '6px',
    background: 'transparent', color: '#3fb950',
    border: '1px solid #3fb950', borderRadius: '3px',
    cursor: 'pointer', fontSize: '11px',
  };
  const btnDelete: React.CSSProperties = {
    padding: '3px 8px',
    background: 'transparent', color: '#f85149',
    border: '1px solid #f85149', borderRadius: '3px',
    cursor: 'pointer', fontSize: '11px',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="trash-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-primary)',
          borderRadius: '8px',
          width: 'min(1100px, 90vw)',
          maxHeight: '85vh',
          margin: '40px auto',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--color-text-primary)',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '16px' }}>{t('trash.title')}</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={fetchAll}
              disabled={isLoading}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-primary)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {t('trash.refresh')}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isLoading || grandTotal === 0}
              style={{
                padding: '4px 10px',
                background: '#c43d3d',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: grandTotal === 0 ? 'not-allowed' : 'pointer',
                opacity: grandTotal === 0 ? 0.5 : 1,
                fontSize: '12px',
              }}
            >
              {t('trash.clearAll')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="modal-close-btn"
              title={t('settings.closeEsc')}
              style={{
                padding: '4px 8px',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-primary)',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-border-primary)',
            display: 'flex',
            gap: '8px',
          }}
          role="tablist"
        >
          {([
            { key: 'projects' as const,     labelKey: 'trash.tab.projects',     count: projectsData.length },
            { key: 'observations' as const, labelKey: 'trash.tab.observations', count: totals.observations },
            { key: 'sessions' as const,     labelKey: 'trash.tab.sessions',     count: totals.sessions },
            { key: 'summaries' as const,    labelKey: 'trash.tab.summaries',    count: totals.summaries },
          ]).map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '6px 12px',
                  background: isActive ? 'var(--color-accent-primary, #58a6ff)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-primary)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {t(tab.labelKey, { n: tab.count })}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {error && (
            <div style={{ color: '#f85149', marginBottom: '12px' }}>{error}</div>
          )}
          {isLoading && !data && !projectsData.length && (
            <div style={{ color: 'var(--color-text-secondary)' }}>{t('trash.loading')}</div>
          )}

          {/* Projects tab */}
          {activeTab === 'projects' && !isLoading && projectsData.length === 0 && (
            <div style={{ color: 'var(--color-text-secondary)', padding: '40px', textAlign: 'center' }}>
              {t('trash.projectsEmpty')}
            </div>
          )}
          {activeTab === 'projects' && projectsData.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <th style={{ ...cellPad, textAlign: 'left', width: '25%' }}>{t('trash.colProject')}</th>
                  <th style={{ ...cellPad, textAlign: 'left', width: '40%' }}>{t('trash.colCounts')}</th>
                  <th style={{ ...cellPad, textAlign: 'left', width: '15%' }}>{t('trash.colTime')}</th>
                  <th style={{ ...cellPad, textAlign: 'right', width: '20%' }}>{t('trash.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {projectsData.map(p => (
                  <tr key={p.project} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ ...cellPad, fontWeight: 500, wordBreak: 'break-word' }}>{p.project}</td>
                    <td style={{ ...cellPad, color: 'var(--color-text-secondary)' }}>
                      {t('trash.counts', { obs: p.observations, sess: p.sessions, sum: p.summaries })}
                    </td>
                    <td style={{ ...cellPad, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatTime(p.lastDeletedAt)}
                    </td>
                    <td style={{ ...cellPad, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => handleProjectRestore(p)}
                        style={btnRestore}
                        title={t('trash.restoreProject')}
                      >
                        {t('trash.restoreProject')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleProjectPermanentDelete(p)}
                        style={btnDelete}
                        title={t('trash.deleteProjectPerm')}
                      >
                        {t('trash.deleteProjectPerm')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Row tabs (observations / sessions / summaries) */}
          {activeTab !== 'projects' && !isLoading && rowsForActiveTab.length === 0 && (
            <div style={{ color: 'var(--color-text-secondary)', padding: '40px', textAlign: 'center' }}>
              {t('trash.empty')}
            </div>
          )}
          {activeTab !== 'projects' && rowsForActiveTab.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <th style={{ ...cellPad, textAlign: 'left', width: '40%' }}>{t('trash.colTitle')}</th>
                  <th style={{ ...cellPad, textAlign: 'left', width: '20%' }}>{t('trash.colProject')}</th>
                  <th style={{ ...cellPad, textAlign: 'left', width: '15%' }}>{t('trash.colTime')}</th>
                  <th style={{ ...cellPad, textAlign: 'left', width: '10%' }}>{t('trash.colReason')}</th>
                  <th style={{ ...cellPad, textAlign: 'right', width: '15%' }}>{t('trash.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rowsForActiveTab.map(row => {
                  const reasonKey =
                    row.reason === 'observation' ? 'trash.reason.observation' :
                    row.reason === 'session' ? 'trash.reason.session' :
                    row.reason === 'project' ? 'trash.reason.project' :
                    'trash.unknown';
                  return (
                    <tr key={row.trash_id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <td style={{ ...cellPad, wordBreak: 'break-word' }}>
                        {extractTitle(row, activeTab as RowTabType)}
                      </td>
                      <td style={{ ...cellPad, color: 'var(--color-text-secondary)' }}>
                        {row.project || t('trash.unknown')}
                      </td>
                      <td style={{ ...cellPad, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatTime(row.deleted_at_epoch)}
                      </td>
                      <td style={{ ...cellPad, color: 'var(--color-text-secondary)' }}>
                        {t(reasonKey)}
                      </td>
                      <td style={{ ...cellPad, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => handleRestore(activeTab as RowTabType, row.trash_id)}
                          style={btnRestore}
                        >
                          {t('trash.restore')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePermanentDelete(activeTab as RowTabType, row.trash_id)}
                          style={btnDelete}
                        >
                          {t('trash.permanentDelete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
