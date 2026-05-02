import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Feed } from './components/Feed';
import { ContextSettingsModal } from './components/ContextSettingsModal';
import { LogsDrawer } from './components/LogsModal';
import { TrashModal } from './components/TrashModal';
import { SyncSettingsModal } from './components/SyncSettingsModal';
import { useSSE } from './hooks/useSSE';
import { useSettings } from './hooks/useSettings';
import { useStats } from './hooks/useStats';
import { usePagination } from './hooks/usePagination';
import { useTheme } from './hooks/useTheme';
import { Observation, Summary, UserPrompt } from './types';
import { mergeAndDeduplicateByProject } from './utils/data';
import { useI18n } from './i18n';
import { authFetch } from './utils/api';

export function App() {
  const { t } = useI18n();
  const [currentFilter, setCurrentFilter] = useState('');
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [paginatedObservations, setPaginatedObservations] = useState<Observation[]>([]);
  const [paginatedSummaries, setPaginatedSummaries] = useState<Summary[]>([]);
  const [paginatedPrompts, setPaginatedPrompts] = useState<UserPrompt[]>([]);
  // 删除按钮的 nonce —— 改值会触发 Feed 重新加载第一页(用 SSE 没法立刻反映 trash)
  const [deleteNonce, setDeleteNonce] = useState(0);

  const { observations, summaries, prompts, projects, isProcessing, queueDepth, isConnected } = useSSE();
  const { settings, saveSettings, isSaving, saveStatus } = useSettings();
  const { refreshStats } = useStats();
  const { preference, setThemePreference } = useTheme();
  const pagination = usePagination(currentFilter);

  const matchesSelection = useCallback((item: { project: string }) => {
    return !currentFilter || item.project === currentFilter;
  }, [currentFilter]);

  useEffect(() => {
    if (currentFilter && !projects.includes(currentFilter)) {
      setCurrentFilter('');
    }
  }, [projects, currentFilter]);

  const allObservations = useMemo(() => {
    const live = observations.filter(matchesSelection);
    const paginated = paginatedObservations.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [observations, paginatedObservations, matchesSelection]);

  const allSummaries = useMemo(() => {
    const live = summaries.filter(matchesSelection);
    const paginated = paginatedSummaries.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [summaries, paginatedSummaries, matchesSelection]);

  const allPrompts = useMemo(() => {
    const live = prompts.filter(matchesSelection);
    const paginated = paginatedPrompts.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [prompts, paginatedPrompts, matchesSelection]);

  const toggleContextPreview = useCallback(() => {
    setContextPreviewOpen(prev => !prev);
  }, []);

  const toggleLogsModal = useCallback(() => {
    setLogsModalOpen(prev => !prev);
  }, []);

  // Toggle trash modal
  const toggleTrashModal = useCallback(() => {
    setTrashModalOpen(prev => !prev);
  }, []);

  // Toggle sync modal
  const toggleSyncModal = useCallback(() => {
    setSyncModalOpen(prev => !prev);
  }, []);

  // Handle loading more data
  const handleLoadMore = useCallback(async () => {
    try {
      const [newObservations, newSummaries, newPrompts] = await Promise.all([
        pagination.observations.loadMore(),
        pagination.summaries.loadMore(),
        pagination.prompts.loadMore()
      ]);

      if (newObservations.length > 0) {
        setPaginatedObservations(prev => [...prev, ...newObservations]);
      }
      if (newSummaries.length > 0) {
        setPaginatedSummaries(prev => [...prev, ...newSummaries]);
      }
      if (newPrompts.length > 0) {
        setPaginatedPrompts(prev => [...prev, ...newPrompts]);
      }
    } catch (error) {
      console.error('Failed to load more data:', error);
    }
  }, [pagination.observations, pagination.summaries, pagination.prompts]);

  useEffect(() => {
    setPaginatedObservations([]);
    setPaginatedSummaries([]);
    setPaginatedPrompts([]);
    handleLoadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilter, currentSource, deleteNonce]);

  // 删除回调:走 DELETE API,成功后从本地 state 移除该项 + 刷新 stats + bump nonce 触发分页重载
  const handleDeleteObservation = useCallback(async (id: number) => {
    if (!window.confirm(t('delete.confirmObservation'))) return;
    try {
      const res = await authFetch(`/api/observations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      setPaginatedObservations(prev => prev.filter(o => o.id !== id));
      refreshStats();
    } catch (err) {
      window.alert(t('delete.failed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [t, refreshStats]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (!window.confirm(t('delete.confirmSession'))) return;
    try {
      const res = await authFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      setPaginatedSummaries(prev => prev.filter(s => s.session_id !== sessionId));
      setPaginatedObservations(prev => prev.filter(o => o.memory_session_id !== sessionId));
      setDeleteNonce(n => n + 1);
      refreshStats();
    } catch (err) {
      window.alert(t('delete.failed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [t, refreshStats]);

  const handleDeleteProject = useCallback(async (project: string) => {
    const total = allObservations.length + allSummaries.length;
    if (!window.confirm(t('delete.confirmProject', { name: project, n: total }))) return;
    try {
      const res = await authFetch(`/api/projects/${encodeURIComponent(project)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      setPaginatedObservations([]);
      setPaginatedSummaries([]);
      setPaginatedPrompts([]);
      setCurrentFilter('');
      setDeleteNonce(n => n + 1);
      refreshStats();
    } catch (err) {
      window.alert(t('delete.failed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [t, refreshStats, allObservations.length, allSummaries.length]);

  return (
    <>
      <Header
        isConnected={isConnected}
        projects={projects}
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        isProcessing={isProcessing}
        queueDepth={queueDepth}
        themePreference={preference}
        onThemeChange={setThemePreference}
        onContextPreviewToggle={toggleContextPreview}
        onDeleteProject={handleDeleteProject}
        onTrashOpen={toggleTrashModal}
      />

      <Feed
        observations={allObservations}
        summaries={allSummaries}
        prompts={allPrompts}
        onLoadMore={handleLoadMore}
        isLoading={pagination.observations.isLoading || pagination.summaries.isLoading || pagination.prompts.isLoading}
        hasMore={pagination.observations.hasMore || pagination.summaries.hasMore || pagination.prompts.hasMore}
        onDeleteObservation={handleDeleteObservation}
        onDeleteSession={handleDeleteSession}
      />

      {!welcomeDismissed && (
        <WelcomeCard onDismiss={() => setWelcomeDismissed(true)} />
      )}

      <ContextSettingsModal
        isOpen={contextPreviewOpen}
        onClose={toggleContextPreview}
        settings={settings}
        onSave={saveSettings}
        isSaving={isSaving}
        saveStatus={saveStatus}
      />

      <button
        className="console-toggle-btn"
        onClick={toggleLogsModal}
        title={t('logs.toggleConsole')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </button>

      <LogsDrawer
        isOpen={logsModalOpen}
        onClose={toggleLogsModal}
      />

      <TrashModal
        isOpen={trashModalOpen}
        onClose={toggleTrashModal}
        onChange={() => {
          // 恢复后让 Feed 重新拉取分页 + 刷 stats
          setDeleteNonce(n => n + 1);
          refreshStats();
        }}
      />

      {/* Sync 浮动按钮 + Modal — cmem-sync client */}
      <button
        className="console-toggle-btn"
        style={{ bottom: 64 }}
        onClick={toggleSyncModal}
        title={t('sync.title')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
        </svg>
      </button>

      <SyncSettingsModal isOpen={syncModalOpen} onClose={toggleSyncModal} />
    </>
  );
}
