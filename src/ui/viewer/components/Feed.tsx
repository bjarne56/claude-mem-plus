import React, { useMemo, useRef, useEffect } from 'react';
import { Observation, Summary, UserPrompt, FeedItem } from '../types';
import { ObservationCard } from './ObservationCard';
import { SummaryCard } from './SummaryCard';
import { PromptCard } from './PromptCard';
import { ScrollToTop } from './ScrollToTop';
import { UI } from '../constants/ui';
import { useI18n } from '../i18n';

interface FeedProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
  onDeleteObservation?: (id: number) => void;
  onDeleteSession?: (sessionId: string) => void;
}

export function Feed({
  observations,
  summaries,
  prompts,
  onLoadMore,
  isLoading,
  hasMore,
  onDeleteObservation,
  onDeleteSession,
}: FeedProps) {
  const { t } = useI18n();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !isLoading) {
          onLoadMoreRef.current?.();
        }
      },
      { threshold: UI.LOAD_MORE_THRESHOLD }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading]);

  const items = useMemo<FeedItem[]>(() => {
    const combined = [
      ...observations.map(o => ({ ...o, itemType: 'observation' as const })),
      ...summaries.map(s => ({ ...s, itemType: 'summary' as const })),
      ...prompts.map(p => ({ ...p, itemType: 'prompt' as const }))
    ];
    return combined.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
  }, [observations, summaries, prompts]);

  return (
    <div className="feed" ref={feedRef}>
      <ScrollToTop targetRef={feedRef} />
      <div className="feed-content">
        {items.map(item => {
          const key = `${item.itemType}-${item.id}`;
          if (item.itemType === 'observation') {
            return <ObservationCard key={key} observation={item} onDelete={onDeleteObservation} />;
          } else if (item.itemType === 'summary') {
            return <SummaryCard key={key} summary={item} onDeleteSession={onDeleteSession} />;
          } else {
            return <PromptCard key={key} prompt={item} />;
          }
        })}
        {items.length === 0 && !isLoading && (
          <div
            style={{
              maxWidth: '560px',
              margin: '60px auto',
              padding: '32px 28px',
              background: 'var(--color-bg-card, #1a1a1a)',
              border: '1px solid var(--color-border-primary, #2a2a2a)',
              borderRadius: '10px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📭</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'var(--color-text-primary)' }}>
              {t('feed.empty')}
            </h3>
            <p style={{ margin: '0 0 20px 0', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
              {t('feed.emptyHint')}
            </p>
            <div
              style={{
                background: 'var(--color-bg-input, #0d0d0d)',
                border: '1px solid var(--color-border-primary, #2a2a2a)',
                borderRadius: '6px',
                padding: '12px 16px',
                fontFamily: 'var(--font-terminal, monospace)',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                textAlign: 'left',
                marginBottom: '16px',
              }}
            >
              <div style={{ color: 'var(--color-accent-primary, #58a6ff)', marginBottom: '4px' }}>$ cd ~/your-project</div>
              <div style={{ color: 'var(--color-accent-primary, #58a6ff)', marginBottom: '4px' }}>$ claude</div>
              <div style={{ color: '#8b949e' }}># 任意 prompt → observation 实时入库 → 这里出现</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href="https://docs.claude-mem-plus.ai"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px',
                  background: 'var(--color-accent-primary, #58a6ff)',
                  color: '#fff',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontSize: '13px',
                }}
              >
                {t('feed.emptyAction.docs')}
              </a>
              <a
                href="https://github.com/bjarne56/claude-mem-plus-plus"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-primary, #2a2a2a)',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontSize: '13px',
                }}
              >
                {t('feed.emptyAction.github')}
              </a>
            </div>
          </div>
        )}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#8b949e' }}>
            <div className="spinner" style={{ display: 'inline-block', marginRight: '10px' }}></div>
            {t('feed.loadingMore')}
          </div>
        )}
        {hasMore && !isLoading && items.length > 0 && (
          <div ref={loadMoreRef} style={{ height: '20px', margin: '10px 0' }} />
        )}
        {!hasMore && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#8b949e', fontSize: '14px' }}>
            {t('feed.noMore')}
          </div>
        )}
      </div>
    </div>
  );
}
