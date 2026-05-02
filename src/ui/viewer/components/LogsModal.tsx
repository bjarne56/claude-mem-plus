import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { authFetch } from '../utils/api';
import { useI18n } from '../i18n';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogComponent = 'HOOK' | 'WORKER' | 'SDK' | 'PARSER' | 'DB' | 'SYSTEM' | 'HTTP' | 'SESSION' | 'CHROMA';

interface ParsedLogLine {
  raw: string;
  timestamp?: string;
  level?: LogLevel;
  component?: LogComponent;
  correlationId?: string;
  message?: string;
  isSpecial?: 'dataIn' | 'dataOut' | 'success' | 'failure' | 'timing' | 'happyPath';
}

const LEVEL_LABEL_KEYS: Record<LogLevel, string> = {
  DEBUG: 'logs.level.debug',
  INFO: 'logs.level.info',
  WARN: 'logs.level.warn',
  ERROR: 'logs.level.error',
};

const COMPONENT_LABEL_KEYS: Record<LogComponent, string> = {
  HOOK: 'logs.component.hook',
  WORKER: 'logs.component.worker',
  SDK: 'logs.component.sdk',
  PARSER: 'logs.component.parser',
  DB: 'logs.component.db',
  SYSTEM: 'logs.component.system',
  HTTP: 'logs.component.http',
  SESSION: 'logs.component.session',
  CHROMA: 'logs.component.chroma',
};

const LOG_LEVELS: { key: LogLevel; icon: string; color: string }[] = [
  { key: 'DEBUG', icon: '🔍', color: '#8b8b8b' },
  { key: 'INFO',  icon: 'ℹ️', color: '#58a6ff' },
  { key: 'WARN',  icon: '⚠️', color: '#d29922' },
  { key: 'ERROR', icon: '❌', color: '#f85149' },
];

const LOG_COMPONENTS: { key: LogComponent; icon: string; color: string }[] = [
  { key: 'HOOK',    icon: '🪝', color: '#a371f7' },
  { key: 'WORKER',  icon: '⚙️', color: '#58a6ff' },
  { key: 'SDK',     icon: '📦', color: '#3fb950' },
  { key: 'PARSER',  icon: '📄', color: '#79c0ff' },
  { key: 'DB',      icon: '🗄️', color: '#f0883e' },
  { key: 'SYSTEM',  icon: '💻', color: '#8b949e' },
  { key: 'HTTP',    icon: '🌐', color: '#39d353' },
  { key: 'SESSION', icon: '📋', color: '#db61a2' },
  { key: 'CHROMA',  icon: '🔮', color: '#a855f7' },
];

function parseLogLine(line: string): ParsedLogLine {
  const pattern = /^\[([^\]]+)\]\s+\[(\w+)\s*\]\s+\[(\w+)\s*\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/;
  const match = line.match(pattern);

  if (!match) {
    return { raw: line };
  }

  const [, timestamp, level, component, correlationId, message] = match;

  let isSpecial: ParsedLogLine['isSpecial'] = undefined;
  if (message.startsWith('→')) isSpecial = 'dataIn';
  else if (message.startsWith('←')) isSpecial = 'dataOut';
  else if (message.startsWith('✓')) isSpecial = 'success';
  else if (message.startsWith('✗')) isSpecial = 'failure';
  else if (message.startsWith('⏱')) isSpecial = 'timing';
  else if (message.includes('[HAPPY-PATH]')) isSpecial = 'happyPath';

  return {
    raw: line,
    timestamp,
    level: level?.trim() as LogLevel,
    component: component?.trim() as LogComponent,
    correlationId: correlationId || undefined,
    message,
    isSpecial,
  };
}

interface LogsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LogsDrawer({ isOpen, onClose }: LogsDrawerProps) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [height, setHeight] = useState(350);
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])
  );
  const [activeComponents, setActiveComponents] = useState<Set<LogComponent>>(
    new Set(['HOOK', 'WORKER', 'SDK', 'PARSER', 'DB', 'SYSTEM', 'HTTP', 'SESSION', 'CHROMA'])
  );
  const [alignmentOnly, setAlignmentOnly] = useState(false);

  const parsedLines = useMemo(() => {
    if (!logs) return [];
    return logs.split('\n').map(parseLogLine);
  }, [logs]);

  const filteredLines = useMemo(() => {
    return parsedLines.filter(line => {
      if (alignmentOnly) {
        return line.raw.includes('[ALIGNMENT]');
      }
      if (!line.level || !line.component) return true;
      return activeLevels.has(line.level) && activeComponents.has(line.component);
    });
  }, [parsedLines, activeLevels, activeComponents, alignmentOnly]);

  const checkIfAtBottom = useCallback(() => {
    if (!contentRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (contentRef.current && wasAtBottomRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    wasAtBottomRef.current = checkIfAtBottom();

    setIsLoading(true);
    setError(null);
    try {
      const response = await authFetch('/api/logs');
      if (!response.ok) {
        throw new Error(t('logs.fetchFail', { msg: response.statusText }));
      }
      const data = await response.json();
      setLogs(data.logs || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.unknownError'));
    } finally {
      setIsLoading(false);
    }
  }, [checkIfAtBottom, t]);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const handleClearLogs = useCallback(async () => {
    if (!confirm(t('logs.clearConfirm'))) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await authFetch('/api/logs/clear', { method: 'POST' });
      if (!response.ok) {
        throw new Error(t('logs.clearFail', { msg: response.statusText }));
      }
      setLogs('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.unknownError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.min(Math.max(150, startHeightRef.current + deltaY), window.innerHeight - 100);
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (isOpen) {
      wasAtBottomRef.current = true;
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  useEffect(() => {
    if (!isOpen || !autoRefresh) {
      return;
    }
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh, fetchLogs]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setActiveLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  }, []);

  const toggleComponent = useCallback((component: LogComponent) => {
    setActiveComponents(prev => {
      const next = new Set(prev);
      if (next.has(component)) next.delete(component); else next.add(component);
      return next;
    });
  }, []);

  const setAllLevels = useCallback((enabled: boolean) => {
    setActiveLevels(enabled ? new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']) : new Set());
  }, []);

  const setAllComponents = useCallback((enabled: boolean) => {
    setActiveComponents(enabled
      ? new Set(['HOOK', 'WORKER', 'SDK', 'PARSER', 'DB', 'SYSTEM', 'HTTP', 'SESSION', 'CHROMA'])
      : new Set());
  }, []);

  if (!isOpen) {
    return null;
  }

  const getLineStyle = (line: ParsedLogLine): React.CSSProperties => {
    const levelConfig = LOG_LEVELS.find(l => l.key === line.level);

    let color = 'var(--color-text-primary)';
    let backgroundColor = 'transparent';

    if (line.level === 'ERROR') {
      color = '#f85149';
      backgroundColor = 'rgba(248, 81, 73, 0.1)';
    } else if (line.level === 'WARN') {
      color = '#d29922';
      backgroundColor = 'rgba(210, 153, 34, 0.05)';
    } else if (line.isSpecial === 'success') {
      color = '#3fb950';
    } else if (line.isSpecial === 'failure') {
      color = '#f85149';
    } else if (line.isSpecial === 'happyPath') {
      color = '#d29922';
    } else if (levelConfig) {
      color = levelConfig.color;
    }

    return { color, fontWeight: 'normal', backgroundColor, padding: '1px 0', borderRadius: '2px' };
  };

  const renderLogLine = (line: ParsedLogLine, index: number) => {
    if (!line.timestamp) {
      return (
        <div key={index} className="log-line log-line-raw">
          {line.raw}
        </div>
      );
    }

    const levelConfig = LOG_LEVELS.find(l => l.key === line.level);
    const componentConfig = LOG_COMPONENTS.find(c => c.key === line.component);
    const levelLabel = line.level ? t(LEVEL_LABEL_KEYS[line.level]) : '';
    const compLabel = line.component ? t(COMPONENT_LABEL_KEYS[line.component]) : '';

    return (
      <div key={index} className="log-line" style={getLineStyle(line)}>
        <span className="log-timestamp">[{line.timestamp}]</span>
        {' '}
        <span className="log-level" style={{ color: levelConfig?.color }} title={levelLabel}>
          [{levelConfig?.icon || ''} {line.level?.padEnd(5)}]
        </span>
        {' '}
        <span className="log-component" style={{ color: componentConfig?.color }} title={compLabel}>
          [{componentConfig?.icon || ''} {line.component?.padEnd(7)}]
        </span>
        {' '}
        {line.correlationId && (
          <>
            <span className="log-correlation">[{line.correlationId}]</span>
            {' '}
          </>
        )}
        <span className="log-message">{line.message}</span>
      </div>
    );
  };

  return (
    <div className="console-drawer" style={{ height: `${height}px` }}>
      <div className="console-resize-handle" onMouseDown={handleMouseDown}>
        <div className="console-resize-bar" />
      </div>

      <div className="console-header">
        <div className="console-tabs">
          <div className="console-tab active">{t('logs.tab.console')}</div>
        </div>
        <div className="console-controls">
          <label className="console-auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t('logs.autoRefresh')}
          </label>
          <button className="console-control-btn" onClick={fetchLogs} disabled={isLoading} title={t('logs.refresh')}>↻</button>
          <button
            className="console-control-btn"
            onClick={() => { wasAtBottomRef.current = true; scrollToBottom(); }}
            title={t('logs.scrollBottom')}
          >⬇</button>
          <button className="console-control-btn console-clear-btn" onClick={handleClearLogs} disabled={isLoading} title={t('logs.clearLogs')}>🗑</button>
          <button className="console-control-btn" onClick={onClose} title={t('logs.closeConsole')}>✕</button>
        </div>
      </div>

      <div className="console-filters">
        <div className="console-filter-section">
          <span className="console-filter-label">{t('logs.filter.quick')}</span>
          <div className="console-filter-chips">
            <button
              className={`console-filter-chip ${alignmentOnly ? 'active' : ''}`}
              onClick={() => setAlignmentOnly(!alignmentOnly)}
              style={{ '--chip-color': '#f0883e' } as React.CSSProperties}
              title={t('logs.filter.alignmentTitle')}
            >
              {t('logs.filter.alignment')}
            </button>
          </div>
        </div>
        <div className="console-filter-section">
          <span className="console-filter-label">{t('logs.filter.levels')}</span>
          <div className="console-filter-chips">
            {LOG_LEVELS.map(level => {
              const label = t(LEVEL_LABEL_KEYS[level.key]);
              return (
                <button
                  key={level.key}
                  className={`console-filter-chip ${activeLevels.has(level.key) ? 'active' : ''}`}
                  onClick={() => toggleLevel(level.key)}
                  style={{ '--chip-color': level.color } as React.CSSProperties}
                  title={label}
                >
                  {level.icon} {label}
                </button>
              );
            })}
            <button
              className="console-filter-action"
              onClick={() => setAllLevels(activeLevels.size === 0)}
              title={activeLevels.size === LOG_LEVELS.length ? t('logs.filter.selectNone') : t('logs.filter.selectAll')}
            >
              {activeLevels.size === LOG_LEVELS.length ? '○' : '●'}
            </button>
          </div>
        </div>
        <div className="console-filter-section">
          <span className="console-filter-label">{t('logs.filter.components')}</span>
          <div className="console-filter-chips">
            {LOG_COMPONENTS.map(comp => {
              const label = t(COMPONENT_LABEL_KEYS[comp.key]);
              return (
                <button
                  key={comp.key}
                  className={`console-filter-chip ${activeComponents.has(comp.key) ? 'active' : ''}`}
                  onClick={() => toggleComponent(comp.key)}
                  style={{ '--chip-color': comp.color } as React.CSSProperties}
                  title={label}
                >
                  {comp.icon} {label}
                </button>
              );
            })}
            <button
              className="console-filter-action"
              onClick={() => setAllComponents(activeComponents.size === 0)}
              title={activeComponents.size === LOG_COMPONENTS.length ? t('logs.filter.selectNone') : t('logs.filter.selectAll')}
            >
              {activeComponents.size === LOG_COMPONENTS.length ? '○' : '●'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="console-error">
          {t('logs.warning', { msg: error })}
        </div>
      )}

      <div className="console-content" ref={contentRef}>
        <div className="console-logs">
          {filteredLines.length === 0 ? (
            <div className="log-line log-line-empty">{t('logs.empty')}</div>
          ) : (
            filteredLines.map((line, index) => renderLogLine(line, index))
          )}
        </div>
      </div>
    </div>
  );
}
