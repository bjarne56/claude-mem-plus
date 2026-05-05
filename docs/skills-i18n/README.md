# claude-mem-plus Skills — Multi-Language User Manuals (PDF)

Operation manuals for the **10 built-in `/claude-mem-plus:*` slash commands**,
translated into **31 languages + English** so each user can read the workflow
guide in their own language.

Pair these PDFs with [the install-time SKILL.md description
auto-localization](../../install-client.sh) (v12.5.2+) — the menu shows
each command in your language, and these PDFs explain how to actually use them.

---

## Languages (alphabetical)

| Locale | Language | PDF |
|---|---|---|
| `ar`     | العربية              | [claude-mem-plus-skills-العربية.pdf](claude-mem-plus-skills-العربية.pdf) |
| `cs`     | Čeština              | [claude-mem-plus-skills-Čeština.pdf](claude-mem-plus-skills-Čeština.pdf) |
| `da`     | Dansk                | [claude-mem-plus-skills-Dansk.pdf](claude-mem-plus-skills-Dansk.pdf) |
| `de`     | Deutsch              | [claude-mem-plus-skills-Deutsch.pdf](claude-mem-plus-skills-Deutsch.pdf) |
| `el`     | Ελληνικά             | [claude-mem-plus-skills-Ελληνικά.pdf](claude-mem-plus-skills-Ελληνικά.pdf) |
| `en`     | English              | [claude-mem-plus-skills-English.pdf](claude-mem-plus-skills-English.pdf) |
| `es`     | Español              | [claude-mem-plus-skills-Español.pdf](claude-mem-plus-skills-Español.pdf) |
| `fi`     | Suomi                | [claude-mem-plus-skills-Suomi.pdf](claude-mem-plus-skills-Suomi.pdf) |
| `fil`    | Filipino             | [claude-mem-plus-skills-Filipino.pdf](claude-mem-plus-skills-Filipino.pdf) |
| `fr`     | Français             | [claude-mem-plus-skills-Français.pdf](claude-mem-plus-skills-Français.pdf) |
| `he`     | עברית                | [claude-mem-plus-skills-עברית.pdf](claude-mem-plus-skills-עברית.pdf) |
| `hi`     | हिन्दी                  | [claude-mem-plus-skills-हिन्दी.pdf](claude-mem-plus-skills-हिन्दी.pdf) |
| `hu`     | Magyar               | [claude-mem-plus-skills-Magyar.pdf](claude-mem-plus-skills-Magyar.pdf) |
| `id`     | Bahasa Indonesia     | [claude-mem-plus-skills-Indonesia.pdf](claude-mem-plus-skills-Indonesia.pdf) |
| `it`     | Italiano             | [claude-mem-plus-skills-Italiano.pdf](claude-mem-plus-skills-Italiano.pdf) |
| `ja`     | 日本語               | [claude-mem-plus-skills-日本語.pdf](claude-mem-plus-skills-日本語.pdf) |
| `ko`     | 한국어               | [claude-mem-plus-skills-한국어.pdf](claude-mem-plus-skills-한국어.pdf) |
| `ms`     | Bahasa Melayu        | [claude-mem-plus-skills-Melayu.pdf](claude-mem-plus-skills-Melayu.pdf) |
| `nb`     | Norsk Bokmål         | [claude-mem-plus-skills-Norsk.pdf](claude-mem-plus-skills-Norsk.pdf) |
| `nl`     | Nederlands           | [claude-mem-plus-skills-Nederlands.pdf](claude-mem-plus-skills-Nederlands.pdf) |
| `pl`     | Polski               | [claude-mem-plus-skills-Polski.pdf](claude-mem-plus-skills-Polski.pdf) |
| `pt`     | Português            | [claude-mem-plus-skills-Português.pdf](claude-mem-plus-skills-Português.pdf) |
| `pt-br`  | Português (Brasil)   | [claude-mem-plus-skills-Português-Brasil.pdf](claude-mem-plus-skills-Português-Brasil.pdf) |
| `ro`     | Română               | [claude-mem-plus-skills-Română.pdf](claude-mem-plus-skills-Română.pdf) |
| `ru`     | Русский              | [claude-mem-plus-skills-Русский.pdf](claude-mem-plus-skills-Русский.pdf) |
| `sv`     | Svenska              | [claude-mem-plus-skills-Svenska.pdf](claude-mem-plus-skills-Svenska.pdf) |
| `th`     | ไทย                  | [claude-mem-plus-skills-ไทย.pdf](claude-mem-plus-skills-ไทย.pdf) |
| `tr`     | Türkçe               | [claude-mem-plus-skills-Türkçe.pdf](claude-mem-plus-skills-Türkçe.pdf) |
| `uk`     | Українська           | [claude-mem-plus-skills-Українська.pdf](claude-mem-plus-skills-Українська.pdf) |
| `vi`     | Tiếng Việt           | [claude-mem-plus-skills-Tiếng-Việt.pdf](claude-mem-plus-skills-Tiếng-Việt.pdf) |
| `zh`     | 简体中文             | [claude-mem-plus-skills-简体中文.pdf](claude-mem-plus-skills-简体中文.pdf) |
| `zh-tw`  | 繁體中文             | [claude-mem-plus-skills-繁體中文.pdf](claude-mem-plus-skills-繁體中文.pdf) |

**Total**: 32 PDFs (31 locales + English).

---

## Coverage

Each PDF documents the **same 10 slash commands**, in the order they appear
in Claude Code's `/` menu:

1. `/claude-mem-plus:do` — execute a phased plan via subagents
2. `/claude-mem-plus:how-it-works` — explain claude-mem-plus's architecture
3. `/claude-mem-plus:knowledge-agent` — build / query AI knowledge bases
4. `/claude-mem-plus:learn-codebase` — prime an unfamiliar codebase
5. `/claude-mem-plus:make-plan` — write a phased implementation plan
6. `/claude-mem-plus:mem-search` — search persistent cross-session memory
7. `/claude-mem-plus:pathfinder` — feature flowcharts + unified architecture
8. `/claude-mem-plus:smart-explore` — token-efficient AST code search
9. `/claude-mem-plus:timeline-report` — narrative project history report
10. `/claude-mem-plus:version-bump` — automated SemVer + release workflow

---

## How to Update

1. Edit master English text in `scripts/skill-i18n/descriptions.json`.
2. Re-run `bun scripts/skill-i18n/generate.ts` to refresh translations
   (Claude Haiku, ~$0.50 for all 31 languages).
3. Re-render PDFs (manual step — drop the rendered files back into
   `docs/skills-i18n/`, replacing existing ones).
4. `npm run build-and-sync` — bundles the JSON into the plugin tree.

The frontmatter `description:` lines that show up in Claude Code's slash-menu
are auto-rewritten by `install-client.sh` based on system locale; these PDFs
are the long-form manual users open from the GitHub repo.
