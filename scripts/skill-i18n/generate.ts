#!/usr/bin/env bun
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const JSON_PATH = path.join(ROOT, "scripts/skill-i18n/descriptions.json");

// 31 supported locales (en is the source / fallback, so excluded here).
// Aligned with bjarne56 fork user list — includes ms / fil / nb / pt
// alongside zh / zh-tw and friends.
const TARGET_LOCALES = [
  "zh", "zh-tw", "ja", "ko", "fr", "de", "es", "it", "pt", "pt-br",
  "ru", "uk", "pl", "cs", "hu", "ro", "nl", "sv", "nb", "da",
  "fi", "el", "tr", "ar", "he", "hi", "id", "ms", "fil", "vi",
  "th",
];

interface DescDoc {
  _meta: Record<string, unknown>;
  [skill: string]: Record<string, string> | Record<string, unknown>;
}

const doc = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8")) as DescDoc;
const skills = Object.keys(doc).filter((k) => k !== "_meta");

const force = process.argv.includes("--force");

function missing(): { lang: string; needed: string[] }[] {
  return TARGET_LOCALES.map((lang) => ({
    lang,
    needed: skills.filter((s) => {
      const m = doc[s] as Record<string, string>;
      return force || !m[lang];
    }),
  })).filter((x) => x.needed.length > 0);
}

const queue = missing();
if (queue.length === 0) {
  console.log("All locales complete. Use --force to re-translate.");
  process.exit(0);
}

console.log(`Locales pending: ${queue.length}`);

for (const { lang, needed } of queue) {
  console.log(`\n[${lang}] translating ${needed.length} entries...`);

  const sourceMap = Object.fromEntries(
    needed.map((s) => [s, (doc[s] as Record<string, string>).en])
  );

  const prompt = `Translate the following SKILL command descriptions from English to **${lang}** (BCP-47).

These are short descriptions shown next to slash commands in a CLI; keep them
concise, technical, and idiomatic. Preserve:
- Technical terms / proper names (claude-mem-plus, tree-sitter, AST, subagent, etc.)
- Backticks, code spans, file names, variable names
- Markdown punctuation
- The natural sentence boundaries (do not merge or split sentences)

Output **ONLY** a JSON object mapping each skill name to its translated string,
no markdown fences, no commentary. Schema:
\`\`\`
{ "<skill>": "<translation>", ... }
\`\`\`

Source (English):
\`\`\`json
${JSON.stringify(sourceMap, null, 2)}
\`\`\``;

  let raw = "";
  const stream = query({
    prompt,
    options: {
      model: "haiku",
      systemPrompt:
        "You are an expert UI/CLI localizer. Output only valid JSON, no commentary.",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
    },
  });

  for await (const m of stream) {
    if (m.type === "stream_event") {
      const ev = m.event as {
        type: string;
        delta?: { type: string; text?: string };
      };
      if (
        ev.type === "content_block_delta" &&
        ev.delta?.type === "text_delta" &&
        ev.delta.text
      ) {
        raw += ev.delta.text;
      }
    }
  }

  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error(`  [${lang}] failed to parse JSON, raw output:\n${raw}`);
    throw err;
  }

  for (const s of needed) {
    const t = parsed[s];
    if (typeof t !== "string" || t.length === 0) {
      throw new Error(`[${lang}] missing translation for skill '${s}'`);
    }
    (doc[s] as Record<string, string>)[lang] = t;
  }

  fs.writeFileSync(JSON_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  [${lang}] saved ${needed.length} translations`);
}

console.log("\nAll done.");
