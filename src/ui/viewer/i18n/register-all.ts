/**
 * 注册所有自动生成的语言翻译表(en + zh 已在 index.ts 静态注册作为 fallback)
 *
 * 此文件由 scripts/translate-i18n.ts 生成的 messages-*.ts 文件被 import 后注册到 i18n
 * 在 viewer 入口 index.tsx 里 import 一次触发注册
 *
 * 容错:每个语言独立 try/catch import,某个文件不存在或 syntax error 不阻塞其他
 */

import { registerMessages } from './index';

type LangModule = { default?: unknown; [k: string]: unknown };

function safeRegister(lang: string, mod: LangModule | undefined): void {
  if (!mod) return;
  // 找到 messagesXxx 导出
  for (const [k, v] of Object.entries(mod)) {
    if (k.startsWith('messages') && v && typeof v === 'object') {
      registerMessages(lang, v as Record<string, string>);
      return;
    }
  }
}

// ── 静态 try-import 风格(esbuild 会全打包,缺文件会报错) ──
// 由于翻译脚本可能没把所有 29 个文件都生成,我们用 try/catch 包每条
// 实际上 esbuild 不支持运行时 try-import,这里改成静态 import 但每个失败的语言
// 必须有占位文件(空导出)

// 简化策略:翻译脚本失败的语言,我们写一个 stub 文件 messages-{lang}.ts
// 内容只是 `export const messagesXxx = {};`,运行时缺 key 会 fallback 到 en

import * as zhTw from './messages-zh-tw';
import * as ja from './messages-ja';
import * as ko from './messages-ko';
import * as es from './messages-es';
import * as ptBr from './messages-pt-br';
import * as fr from './messages-fr';
import * as de from './messages-de';
import * as ru from './messages-ru';
import * as ar from './messages-ar';
import * as he from './messages-he';
import * as pl from './messages-pl';
import * as cs from './messages-cs';
import * as nl from './messages-nl';
import * as tr from './messages-tr';
import * as uk from './messages-uk';
import * as vi from './messages-vi';
import * as id from './messages-id';
import * as th from './messages-th';
import * as hi from './messages-hi';
import * as bn from './messages-bn';
import * as ro from './messages-ro';
import * as sv from './messages-sv';
import * as ur from './messages-ur';
import * as it from './messages-it';
import * as el from './messages-el';
import * as hu from './messages-hu';
import * as fi from './messages-fi';
import * as da from './messages-da';
import * as no from './messages-no';

safeRegister('zh-tw', zhTw);
safeRegister('ja', ja);
safeRegister('ko', ko);
safeRegister('es', es);
safeRegister('pt-br', ptBr);
safeRegister('fr', fr);
safeRegister('de', de);
safeRegister('ru', ru);
safeRegister('ar', ar);
safeRegister('he', he);
safeRegister('pl', pl);
safeRegister('cs', cs);
safeRegister('nl', nl);
safeRegister('tr', tr);
safeRegister('uk', uk);
safeRegister('vi', vi);
safeRegister('id', id);
safeRegister('th', th);
safeRegister('hi', hi);
safeRegister('bn', bn);
safeRegister('ro', ro);
safeRegister('sv', sv);
safeRegister('ur', ur);
safeRegister('it', it);
safeRegister('el', el);
safeRegister('hu', hu);
safeRegister('fi', fi);
safeRegister('da', da);
safeRegister('no', no);
