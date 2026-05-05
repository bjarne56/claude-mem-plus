/**
 * 31 种支持语言清单
 * - 来源:upstream claude-mem-plus 已有 plugin/modes/code--{lang}.json 翻译列表
 * - 与 CLAUDE_MEM_MODE 后缀一一对应:`code--zh` ↔ 'zh', `code` ↔ 'en'
 * - RTL 标记给 viewer 容器加 dir="rtl"
 */

export interface LanguageInfo {
  /** ISO 639-1 / locale 代码 */
  code: string;
  /** 原生语言名(显示在 LanguageSelect 下拉里) */
  nativeName: string;
  /** 英文名(用于搜索匹配) */
  englishName: string;
  /** 是否右到左 */
  rtl: boolean;
  /** 对应的 CLAUDE_MEM_MODE 值 */
  mode: string;
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  // Tier 1
  { code: 'en',    nativeName: 'English',     englishName: 'English',                rtl: false, mode: 'code' },
  { code: 'zh',    nativeName: '中文',        englishName: 'Chinese (Simplified)',   rtl: false, mode: 'code--zh' },
  { code: 'zh-tw', nativeName: '繁體中文',    englishName: 'Chinese (Traditional)',  rtl: false, mode: 'code--zh-tw' },
  { code: 'ja',    nativeName: '日本語',      englishName: 'Japanese',               rtl: false, mode: 'code--ja' },
  { code: 'ko',    nativeName: '한국어',      englishName: 'Korean',                 rtl: false, mode: 'code--ko' },
  { code: 'es',    nativeName: 'Español',     englishName: 'Spanish',                rtl: false, mode: 'code--es' },
  { code: 'pt-br', nativeName: 'Português (BR)', englishName: 'Portuguese (Brazil)',  rtl: false, mode: 'code--pt-br' },
  { code: 'fr',    nativeName: 'Français',    englishName: 'French',                 rtl: false, mode: 'code--fr' },
  { code: 'de',    nativeName: 'Deutsch',     englishName: 'German',                 rtl: false, mode: 'code--de' },

  // Tier 2
  { code: 'ru',    nativeName: 'Русский',     englishName: 'Russian',                rtl: false, mode: 'code--ru' },
  { code: 'ar',    nativeName: 'العربية',     englishName: 'Arabic',                 rtl: true,  mode: 'code--ar' },
  { code: 'he',    nativeName: 'עברית',       englishName: 'Hebrew',                 rtl: true,  mode: 'code--he' },
  { code: 'pl',    nativeName: 'Polski',      englishName: 'Polish',                 rtl: false, mode: 'code--pl' },
  { code: 'cs',    nativeName: 'Čeština',     englishName: 'Czech',                  rtl: false, mode: 'code--cs' },
  { code: 'nl',    nativeName: 'Nederlands',  englishName: 'Dutch',                  rtl: false, mode: 'code--nl' },
  { code: 'tr',    nativeName: 'Türkçe',      englishName: 'Turkish',                rtl: false, mode: 'code--tr' },
  { code: 'uk',    nativeName: 'Українська',  englishName: 'Ukrainian',              rtl: false, mode: 'code--uk' },

  // Tier 3
  { code: 'vi',    nativeName: 'Tiếng Việt',  englishName: 'Vietnamese',             rtl: false, mode: 'code--vi' },
  { code: 'id',    nativeName: 'Bahasa Indonesia', englishName: 'Indonesian',          rtl: false, mode: 'code--id' },
  { code: 'th',    nativeName: 'ไทย',          englishName: 'Thai',                   rtl: false, mode: 'code--th' },
  { code: 'hi',    nativeName: 'हिन्दी',        englishName: 'Hindi',                  rtl: false, mode: 'code--hi' },
  { code: 'bn',    nativeName: 'বাংলা',         englishName: 'Bengali',                rtl: false, mode: 'code--bn' },
  { code: 'ro',    nativeName: 'Română',      englishName: 'Romanian',               rtl: false, mode: 'code--ro' },
  { code: 'sv',    nativeName: 'Svenska',     englishName: 'Swedish',                rtl: false, mode: 'code--sv' },
  { code: 'ur',    nativeName: 'اردو',         englishName: 'Urdu',                   rtl: true,  mode: 'code--ur' },

  // Tier 4
  { code: 'it',    nativeName: 'Italiano',    englishName: 'Italian',                rtl: false, mode: 'code--it' },
  { code: 'el',    nativeName: 'Ελληνικά',    englishName: 'Greek',                  rtl: false, mode: 'code--el' },
  { code: 'hu',    nativeName: 'Magyar',      englishName: 'Hungarian',              rtl: false, mode: 'code--hu' },
  { code: 'fi',    nativeName: 'Suomi',       englishName: 'Finnish',                rtl: false, mode: 'code--fi' },
  { code: 'da',    nativeName: 'Dansk',       englishName: 'Danish',                 rtl: false, mode: 'code--da' },
  { code: 'no',    nativeName: 'Norsk',       englishName: 'Norwegian',              rtl: false, mode: 'code--no' },
];

export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANG_CODES: LangCode[] = SUPPORTED_LANGUAGES.map(l => l.code);
export const LANG_BY_CODE: Record<string, LanguageInfo> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map(l => [l.code, l])
);
export const LANG_BY_MODE: Record<string, LanguageInfo> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map(l => [l.mode, l])
);

/** 默认 fallback 语言 */
export const DEFAULT_LANG: LangCode = 'en';

/**
 * 把任意 BCP 47 浏览器 locale (如 zh-CN, pt-PT, en-US) 匹配到支持的语言代码
 * 匹配优先级:精确 > 主语言 > fallback
 */
export function matchBrowserLanguage(navigatorLang: string): LangCode {
  if (!navigatorLang) return DEFAULT_LANG;
  const lower = navigatorLang.toLowerCase();
  // 1. 精确匹配 (zh-tw / pt-br)
  if (LANG_BY_CODE[lower]) return lower as LangCode;
  // 2. 主语言匹配 (zh-CN → zh, en-US → en)
  const main = lower.split('-')[0];
  if (LANG_BY_CODE[main]) return main as LangCode;
  // 3. 特殊映射(常见的 BCP 47 → 我们的代码)
  const mainMap: Record<string, LangCode> = {
    'pt': 'pt-br',  // 任何 pt-* 都用 pt-br(我们没单独 pt-pt)
    'iw': 'he',     // 旧 ISO 639-1 希伯来语代码
    'in': 'id',     // 旧 ISO 639-1 印尼语代码
  };
  if (mainMap[main]) return mainMap[main];
  return DEFAULT_LANG;
}

/**
 * CLAUDE_MEM_MODE → viewer 语言代码
 * 例:'code--zh' → 'zh', 'code' → 'en', 'code--chill' → 'en' (chill 等非语言变体走默认)
 */
export function modeToLang(mode: string | undefined | null): LangCode {
  if (!mode) return DEFAULT_LANG;
  const info = LANG_BY_MODE[mode];
  if (info) return info.code as LangCode;
  return DEFAULT_LANG;
}

/** viewer 语言代码 → CLAUDE_MEM_MODE */
export function langToMode(lang: LangCode): string {
  return LANG_BY_CODE[lang]?.mode ?? 'code';
}
