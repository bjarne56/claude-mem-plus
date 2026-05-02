import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useI18n, SUPPORTED_LANGUAGES } from '../i18n';
import type { LangCode } from '../i18n';

/**
 * 语言下拉选择器(替代二态 LanguageToggle)
 * 支持 31 种语言,带搜索过滤
 */
export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(() => SUPPORTED_LANGUAGES.find(l => l.code === lang) ?? SUPPORTED_LANGUAGES[0], [lang]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(l =>
      l.code.toLowerCase().includes(q) ||
      l.nativeName.toLowerCase().includes(q) ||
      l.englishName.toLowerCase().includes(q)
    );
  }, [filter]);

  // 点外面关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // 打开时聚焦搜索框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback((code: LangCode) => {
    setLang(code);
    setOpen(false);
    setFilter('');
  }, [setLang]);

  // 显示当前语言代码缩写(2-3 字)
  const shortLabel = current.code === 'zh' ? '中'
    : current.code === 'zh-tw' ? '繁'
    : current.code === 'ja' ? '日'
    : current.code === 'ko' ? '한'
    : current.code === 'ar' ? 'عر'
    : current.code === 'he' ? 'עב'
    : current.code === 'ru' ? 'Ру'
    : current.code === 'th' ? 'ไท'
    : current.code === 'hi' ? 'हि'
    : current.code === 'bn' ? 'বা'
    : current.code === 'ur' ? 'اد'
    : current.code === 'el' ? 'Ελ'
    : current.code === 'pt-br' ? 'PT'
    : current.code.toUpperCase().slice(0, 2);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="lang-toggle"
        onClick={() => setOpen(o => !o)}
        title={`${t('lang.toggle')}: ${current.nativeName}`}
        aria-label={t('lang.toggle')}
        aria-expanded={open}
      >
        {shortLabel}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--color-bg-card, #1a1a1a)',
            border: '1px solid var(--color-border-primary, #333)',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            zIndex: 1000,
            width: '240px',
            maxHeight: '420px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search…"
            style={{
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--color-border-primary, #333)',
              color: 'var(--color-text-primary)',
              fontSize: '13px',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setOpen(false);
                setFilter('');
              } else if (e.key === 'Enter' && filtered.length > 0) {
                handleSelect(filtered[0].code as LangCode);
              }
            }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--color-text-secondary)', fontSize: '12px', textAlign: 'center' }}>
                No match
              </div>
            ) : (
              filtered.map(l => {
                const isActive = l.code === lang;
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => handleSelect(l.code as LangCode)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      padding: '6px 12px',
                      background: isActive ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                      color: isActive ? 'var(--color-accent-primary, #58a6ff)' : 'var(--color-text-primary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      textAlign: 'start',
                      alignItems: 'baseline',
                      gap: '8px',
                      direction: l.rtl ? 'rtl' : 'ltr',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ minWidth: '40px', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                      {l.code}
                    </span>
                    <span style={{ flex: 1 }}>{l.nativeName}</span>
                    {l.code !== l.englishName.toLowerCase() && (
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                        {l.englishName.split(' ')[0]}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
