/**
 * 轻量 i18n,31 种语言支持
 * - 优先级:settings.CLAUDE_MEM_MODE → localStorage viewer-lang → navigator.language → en fallback
 * - 切换语言时同步更新 localStorage + settings.json 的 CLAUDE_MEM_MODE
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { messagesZh } from './messages-zh';
import { messagesEn } from './messages-en';
import {
  SUPPORTED_LANGUAGES,
  LANG_BY_CODE,
  DEFAULT_LANG,
  matchBrowserLanguage,
  modeToLang,
  langToMode,
  type LangCode,
} from './languages';

export type Lang = LangCode;
export { SUPPORTED_LANGUAGES, langToMode, modeToLang, type LangCode } from './languages';

const STORAGE_KEY = 'viewer-lang';

/**
 * 语言 → 翻译表 的动态注册
 * en / zh 静态导入(总要有兜底);其他语言通过 setMessages 在第一次切到时按需加载
 *
 * 当前 build 阶段简化:翻译脚本生成的 messages-{lang}.ts 都会通过 register-all 一次性 import
 * 注册到 TABLES。这样可以利用 esbuild 的 dead-code-elimination 不打包不用的语言
 * (实际用 Vite/Webpack 时可改 dynamic import)
 */
const TABLES: Record<string, Record<string, string>> = {
  en: messagesEn,
  zh: messagesZh,
};

export function registerMessages(lang: string, table: Record<string, string>): void {
  TABLES[lang] = table;
}

export interface I18nContextValue {
  lang: Lang;
  /** 切换语言 — 写 localStorage,可选同步 settings.json */
  setLang: (lang: Lang, syncSettings?: boolean) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  // 1. localStorage(用户上次选过)
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LANG_BY_CODE[stored]) return stored as Lang;
  } catch {/* ignore */}
  // 2. navigator.language
  if (typeof navigator !== 'undefined' && navigator.language) {
    return matchBrowserLanguage(navigator.language);
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

async function syncLangToSettings(lang: Lang): Promise<void> {
  try {
    const mode = langToMode(lang);
    // 先读现有 settings,只更新 CLAUDE_MEM_MODE,不破坏其他字段
    const getRes = await fetch('/api/settings');
    if (!getRes.ok) return;
    const current = (await getRes.json()) as Record<string, string>;
    if (current.CLAUDE_MEM_MODE === mode) return;  // 已经是,跳过
    const next = { ...current, CLAUDE_MEM_MODE: mode };
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  } catch {
    // 离线或 worker 没起来,静默
  }
}

/** viewer 启动时拉一次 settings,如果 CLAUDE_MEM_MODE 跟当前 lang 不一致以 settings 为准 */
async function loadFromSettings(): Promise<Lang | null> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return null;
    const settings = (await res.json()) as Record<string, string>;
    const mode = settings.CLAUDE_MEM_MODE;
    if (!mode) return null;
    return modeToLang(mode);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  // 启动时尝试从 settings.json 读 CLAUDE_MEM_MODE 覆盖
  useEffect(() => {
    let cancelled = false;
    loadFromSettings().then(serverLang => {
      if (cancelled || !serverLang) return;
      // 只有当用户没在 localStorage 显式选过(或选过 en 默认)才用 server 值
      // 这里简化:总是优先 server 值,但 setLang 时 localStorage 也会被更新
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          setLangState(serverLang);
          window.localStorage.setItem(STORAGE_KEY, serverLang);
        }
      } catch {/* ignore */}
    });
    return () => { cancelled = true; };
  }, []);

  const setLang = useCallback((next: Lang, syncSettings = true) => {
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch {/* ignore */}
    if (typeof document !== 'undefined') {
      const info = LANG_BY_CODE[next];
      document.documentElement.lang = next;
      document.documentElement.dir = info?.rtl ? 'rtl' : 'ltr';
    }
    if (syncSettings) {
      void syncLangToSettings(next);
    }
  }, []);

  // 应用初次 mount 设置 dir / lang
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const info = LANG_BY_CODE[lang];
      document.documentElement.lang = lang;
      document.documentElement.dir = info?.rtl ? 'rtl' : 'ltr';
    }
  }, [lang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const table = TABLES[lang] || TABLES.en;
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
