# claude-mem Skills — Multi-Language User Manuals (PDF)

Operation manuals for the **10 built-in `/claude-mem:*` slash commands**,
translated into **31 languages + English** so each user can read the workflow
guide in their own language.

Pair these PDFs with [the install-time SKILL.md description
auto-localization](../../install-client.sh) (v12.5.2+) — the menu shows
each command in your language, and these PDFs explain how to actually use them.

---

## Languages (alphabetical)

| Locale | Language | PDF |
|---|---|---|
| `ar`     | العربية              | [claude-mem-skills-العربية.pdf](claude-mem-skills-العربية.pdf) |
| `cs`     | Čeština              | [claude-mem-skills-Čeština.pdf](claude-mem-skills-Čeština.pdf) |
| `da`     | Dansk                | [claude-mem-skills-Dansk.pdf](claude-mem-skills-Dansk.pdf) |
| `de`     | Deutsch              | [claude-mem-skills-Deutsch.pdf](claude-mem-skills-Deutsch.pdf) |
| `el`     | Ελληνικά             | [claude-mem-skills-Ελληνικά.pdf](claude-mem-skills-Ελληνικά.pdf) |
| `en`     | English              | [claude-mem-skills-English.pdf](claude-mem-skills-English.pdf) |
| `es`     | Español              | [claude-mem-skills-Español.pdf](claude-mem-skills-Español.pdf) |
| `fi`     | Suomi                | [claude-mem-skills-Suomi.pdf](claude-mem-skills-Suomi.pdf) |
| `fil`    | Filipino             | [claude-mem-skills-Filipino.pdf](claude-mem-skills-Filipino.pdf) |
| `fr`     | Français             | [claude-mem-skills-Français.pdf](claude-mem-skills-Français.pdf) |
| `he`     | עברית                | [claude-mem-skills-עברית.pdf](claude-mem-skills-עברית.pdf) |
| `hi`     | हिन्दी                  | [claude-mem-skills-हिन्दी.pdf](claude-mem-skills-हिन्दी.pdf) |
| `hu`     | Magyar               | [claude-mem-skills-Magyar.pdf](claude-mem-skills-Magyar.pdf) |
| `id`     | Bahasa Indonesia     | [claude-mem-skills-Indonesia.pdf](claude-mem-skills-Indonesia.pdf) |
| `it`     | Italiano             | [claude-mem-skills-Italiano.pdf](claude-mem-skills-Italiano.pdf) |
| `ja`     | 日本語               | [claude-mem-skills-日本語.pdf](claude-mem-skills-日本語.pdf) |
| `ko`     | 한국어               | [claude-mem-skills-한국어.pdf](claude-mem-skills-한국어.pdf) |
| `ms`     | Bahasa Melayu        | [claude-mem-skills-Melayu.pdf](claude-mem-skills-Melayu.pdf) |
| `nb`     | Norsk Bokmål         | [claude-mem-skills-Norsk.pdf](claude-mem-skills-Norsk.pdf) |
| `nl`     | Nederlands           | [claude-mem-skills-Nederlands.pdf](claude-mem-skills-Nederlands.pdf) |
| `pl`     | Polski               | [claude-mem-skills-Polski.pdf](claude-mem-skills-Polski.pdf) |
| `pt`     | Português            | [claude-mem-skills-Português.pdf](claude-mem-skills-Português.pdf) |
| `pt-br`  | Português (Brasil)   | [claude-mem-skills-Português-Brasil.pdf](claude-mem-skills-Português-Brasil.pdf) |
| `ro`     | Română               | [claude-mem-skills-Română.pdf](claude-mem-skills-Română.pdf) |
| `ru`     | Русский              | [claude-mem-skills-Русский.pdf](claude-mem-skills-Русский.pdf) |
| `sv`     | Svenska              | [claude-mem-skills-Svenska.pdf](claude-mem-skills-Svenska.pdf) |
| `th`     | ไทย                  | [claude-mem-skills-ไทย.pdf](claude-mem-skills-ไทย.pdf) |
| `tr`     | Türkçe               | [claude-mem-skills-Türkçe.pdf](claude-mem-skills-Türkçe.pdf) |
| `uk`     | Українська           | [claude-mem-skills-Українська.pdf](claude-mem-skills-Українська.pdf) |
| `vi`     | Tiếng Việt           | [claude-mem-skills-Tiếng-Việt.pdf](claude-mem-skills-Tiếng-Việt.pdf) |
| `zh`     | 简体中文             | [claude-mem-skills-简体中文.pdf](claude-mem-skills-简体中文.pdf) |
| `zh-tw`  | 繁體中文             | [claude-mem-skills-繁體中文.pdf](claude-mem-skills-繁體中文.pdf) |

**Total**: 32 PDFs (31 locales + English).

---

## Coverage

Each PDF documents the **same 10 slash commands**, in the order they appear
in Claude Code's `/` menu:

1. `/claude-mem:do` — execute a phased plan via subagents
2. `/claude-mem:how-it-works` — explain claude-mem's architecture
3. `/claude-mem:knowledge-agent` — build / query AI knowledge bases
4. `/claude-mem:learn-codebase` — prime an unfamiliar codebase
5. `/claude-mem:make-plan` — write a phased implementation plan
6. `/claude-mem:mem-search` — search persistent cross-session memory
7. `/claude-mem:pathfinder` — feature flowcharts + unified architecture
8. `/claude-mem:smart-explore` — token-efficient AST code search
9. `/claude-mem:timeline-report` — narrative project history report
10. `/claude-mem:version-bump` — automated SemVer + release workflow

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
