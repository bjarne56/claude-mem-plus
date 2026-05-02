#!/usr/bin/env bun
/**
 * Viewer i18n 翻译脚本 — 用 Claude Agent SDK 把 messages-zh.ts 批量翻译到 29 种目标语言
 *
 * 用法:bun scripts/translate-i18n.ts [lang1 lang2 ...]
 *      bun scripts/translate-i18n.ts                  # 翻译所有非 zh/en 语言
 *      bun scripts/translate-i18n.ts ja ko de         # 只翻译指定语言
 *      bun scripts/translate-i18n.ts --force          # 忽略缓存重翻
 *
 * 输出:src/ui/viewer/i18n/messages-{lang}.ts(覆盖)
 * 缓存:scripts/.translate-i18n-cache.json(避免重翻)
 */

import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

const ROOT = path.resolve(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'src/ui/viewer/i18n');
const SOURCE_PATH = path.join(I18N_DIR, 'messages-zh.ts');
const CACHE_PATH = path.join(__dirname, '.translate-i18n-cache.json');

// 29 个目标语言(en + zh 已手写,跳过)
const TARGET_LANGS = [
  'zh-tw', 'ja', 'ko', 'es', 'pt-br', 'fr', 'de',
  'ru', 'ar', 'he', 'pl', 'cs', 'nl', 'tr', 'uk',
  'vi', 'id', 'th', 'hi', 'bn', 'ro', 'sv', 'ur',
  'it', 'el', 'hu', 'fi', 'da', 'no',
];

const LANG_NAMES: Record<string, string> = {
  'zh-tw': 'Traditional Chinese (Taiwan)',
  'ja': 'Japanese', 'ko': 'Korean', 'es': 'Spanish',
  'pt-br': 'Brazilian Portuguese', 'fr': 'French', 'de': 'German',
  'ru': 'Russian', 'ar': 'Arabic', 'he': 'Hebrew',
  'pl': 'Polish', 'cs': 'Czech', 'nl': 'Dutch',
  'tr': 'Turkish', 'uk': 'Ukrainian', 'vi': 'Vietnamese',
  'id': 'Indonesian', 'th': 'Thai', 'hi': 'Hindi',
  'bn': 'Bengali', 'ro': 'Romanian', 'sv': 'Swedish',
  'ur': 'Urdu', 'it': 'Italian', 'el': 'Greek',
  'hu': 'Hungarian', 'fi': 'Finnish', 'da': 'Danish', 'no': 'Norwegian',
};

const CONCURRENCY = 5;
const args = process.argv.slice(2);
const force = args.includes('--force');
const targets = args.filter(a => !a.startsWith('--'));
const langsToRun = targets.length > 0 ? targets : TARGET_LANGS;

interface CacheEntry {
  sourceHash: string;
  translation: Record<string, string>;
}
type Cache = Record<string, CacheEntry>;

async function loadCache(): Promise<Cache> {
  try {
    const text = await fs.readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * 从 messages-zh.ts 源文件解析出 key/value object
 * 简单做法:eval 不安全,改用正则匹配 export const messagesZh = { ... }
 * 实际上更稳的是动态 import 后读对象
 */
async function loadSourceMessages(): Promise<Record<string, string>> {
  const mod = await import(SOURCE_PATH);
  const obj = mod.messagesZh;
  if (!obj || typeof obj !== 'object') {
    throw new Error(`messagesZh export not found in ${SOURCE_PATH}`);
  }
  return obj as Record<string, string>;
}

function hashSource(src: Record<string, string>): string {
  const json = JSON.stringify(src, Object.keys(src).sort());
  return createHash('sha256').update(json).digest('hex');
}

function buildPrompt(targetLangName: string, source: Record<string, string>): string {
  // 构造一个 JSON,让 Claude 翻译 value 部分,key 不变
  return `Translate the following JSON object's VALUES (not keys) from Simplified Chinese to ${targetLangName}.

Rules:
1. Keep all keys exactly as-is. Only translate values.
2. Preserve placeholders like {name}, {n}, {msg}, {target}, {obs}, {sess}, {sum} EXACTLY in their original form.
3. Preserve ALL emoji and special characters (✓ ✗ ⚠ → ←).
4. Keep technical terms (observation, session, summary, fork, trash, project) translated to their natural ${targetLangName} equivalents — but if a term is universally English in tech (e.g. "fork"), keep it.
5. Preserve punctuation style and tone (concise UI labels).
6. Output VALID JSON only. No markdown fences. No commentary. Start with { and end with }.

Source JSON:
${JSON.stringify(source, null, 2)}

Output the translated JSON now:`;
}

function tryParseJson(text: string): Record<string, string> | null {
  let cleaned = text.trim();
  // 去掉 markdown fence(可能多行,贪婪匹配)
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
  // 找第一个 { 到最后一个 }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  cleaned = cleaned.slice(start, end + 1);
  // 第一次直接 parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, string>;
  } catch {/* fall through */}
  // 容错:line-by-line 提取 "key": "value" 模式(应付不规范的 JSON,如尾随逗号、多行字符串)
  const result: Record<string, string> = {};
  // 匹配 "key": "...value..." 直到下一个 ", 处理简单的转义
  const re = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    try {
      const key = m[1];
      // 反序列化 value(把 \" 还原)
      const val = JSON.parse(`"${m[2]}"`);
      result[key] = val;
    } catch {/* 跳过坏行 */}
  }
  return Object.keys(result).length > 10 ? result : null;
}

async function translateOne(
  lang: string,
  source: Record<string, string>,
  cache: Cache,
  sourceHash: string,
): Promise<{ lang: string; ok: boolean; cached: boolean; cost: number; missingKeys: number }> {
  const cached = cache[lang];
  if (!force && cached && cached.sourceHash === sourceHash) {
    await writeMessagesFile(lang, cached.translation);
    return { lang, ok: true, cached: true, cost: 0, missingKeys: 0 };
  }

  const langName = LANG_NAMES[lang] || lang;
  const prompt = buildPrompt(langName, source);

  let raw = '';
  let cost = 0;
  try {
    const stream = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt:
          'You are an expert technical translator specializing in software UI strings. Output ONLY valid JSON, no commentary.',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') raw += block.text;
        }
      }
      if (message.type === 'result') {
        const r = message as SDKResultMessage;
        if (r.subtype === 'success') {
          cost = r.total_cost_usd ?? 0;
          if (!raw && r.result) raw = r.result;
        }
      }
    }
  } catch (e) {
    console.error(`[${lang}] SDK error:`, e instanceof Error ? e.message : e);
    return { lang, ok: false, cached: false, cost: 0, missingKeys: 0 };
  }

  const parsed = tryParseJson(raw);
  if (!parsed) {
    console.error(`[${lang}] Could not parse JSON from response (head 200): ${raw.slice(0, 200)}`);
    return { lang, ok: false, cached: false, cost, missingKeys: 0 };
  }

  // 检查 missing keys + 用源 fallback
  const sourceKeys = Object.keys(source);
  const merged: Record<string, string> = {};
  let missing = 0;
  for (const k of sourceKeys) {
    if (typeof parsed[k] === 'string') {
      merged[k] = parsed[k];
    } else {
      // missing → fallback 到源中文(总比缺好)
      merged[k] = source[k];
      missing += 1;
    }
  }

  cache[lang] = { sourceHash, translation: merged };
  await writeMessagesFile(lang, merged);

  return { lang, ok: true, cached: false, cost, missingKeys: missing };
}

async function writeMessagesFile(lang: string, translation: Record<string, string>): Promise<void> {
  const safeIdent = lang.replace(/[^a-zA-Z0-9]/g, '');  // pt-br → ptbr
  const exportName = `messages${safeIdent.charAt(0).toUpperCase() + safeIdent.slice(1)}`;
  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED by scripts/translate-i18n.ts — 不要手动编辑`);
  lines.push(`// 源文件:src/ui/viewer/i18n/messages-zh.ts`);
  lines.push(`// 目标语言:${lang} (${LANG_NAMES[lang] || lang})`);
  lines.push(`// 重新生成:bun scripts/translate-i18n.ts ${lang} --force`);
  lines.push('');
  lines.push(`export const ${exportName}: Record<string, string> = {`);
  for (const [k, v] of Object.entries(translation)) {
    const escaped = JSON.stringify(v);  // JSON.stringify 处理转义最稳
    lines.push(`  ${JSON.stringify(k)}: ${escaped},`);
  }
  lines.push('};');
  const content = lines.join('\n') + '\n';
  const outPath = path.join(I18N_DIR, `messages-${lang}.ts`);
  await fs.writeFile(outPath, content, 'utf-8');
}

async function main(): Promise<void> {
  const source = await loadSourceMessages();
  const sourceHash = hashSource(source);
  const cache = await loadCache();

  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Keys: ${Object.keys(source).length}`);
  console.log(`Targets: ${langsToRun.length} languages`);
  console.log(`Force: ${force}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  let totalCost = 0;
  let okCount = 0;
  let cachedCount = 0;
  let failed: string[] = [];
  let totalMissing = 0;

  // 简单的并发池
  let i = 0;
  async function worker() {
    while (i < langsToRun.length) {
      const idx = i++;
      const lang = langsToRun[idx];
      const startedAt = Date.now();
      const r = await translateOne(lang, source, cache, sourceHash);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (r.ok) {
        okCount += 1;
        totalCost += r.cost;
        if (r.cached) cachedCount += 1;
        if (r.missingKeys > 0) totalMissing += r.missingKeys;
        console.log(
          `[${idx + 1}/${langsToRun.length}] ${r.lang.padEnd(6)} ✓ ${r.cached ? 'cached' : `$${r.cost.toFixed(4)}`} ${elapsed}s${r.missingKeys ? ` (missing ${r.missingKeys} keys → fell back to zh)` : ''}`
        );
        // 每完成一个就立刻 saveCache,中途中断也不丢已完成的
        await saveCache(cache);
      } else {
        failed.push(r.lang);
        console.log(`[${idx + 1}/${langsToRun.length}] ${r.lang.padEnd(6)} ✗ failed (${elapsed}s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  await saveCache(cache);

  console.log(`\n━━━ Summary ━━━`);
  console.log(`OK:           ${okCount} / ${langsToRun.length}`);
  console.log(`Cached:       ${cachedCount}`);
  console.log(`Failed:       ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`);
  console.log(`Total cost:   $${totalCost.toFixed(4)}`);
  console.log(`Missing keys: ${totalMissing} (fell back to source zh)`);
  console.log(`Cache:        ${CACHE_PATH}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
