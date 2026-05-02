/**
 * 轻量 i18n,单 Provider + useI18n hook
 * - 默认中文 (zh)
 * - localStorage key: viewer-lang
 * - 翻译表扁平化 key: 'header.allProjects' 等
 * - 不引入 i18next,SPA 不值得
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { messagesZh } from './messages-zh';
import { messagesEn } from './messages-en';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'viewer-lang';
const DEFAULT_LANG: Lang = 'zh';

const TABLES: Record<Lang, Record<string, string>> = {
  zh: messagesZh,
  en: messagesEn,
};

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // localStorage 不可用 → 回落默认
  }
  return DEFAULT_LANG;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
  }, [lang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const table = TABLES[lang];
    const raw = table[key] ?? TABLES.en[key] ?? key;
    return interpolate(raw, vars);
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n 必须在 <I18nProvider> 内调用');
  }
  return ctx;
}
