import React from 'react';
import { useI18n, Lang } from '../i18n';

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();

  const next: Lang = lang === 'zh' ? 'en' : 'zh';
  const label = lang === 'zh' ? t('lang.zh') : t('lang.en');

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => setLang(next)}
      title={t('lang.toggle')}
      aria-label={t('lang.toggle')}
    >
      {label}
    </button>
  );
}
