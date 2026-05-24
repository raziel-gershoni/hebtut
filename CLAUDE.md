# Project conventions

## User-facing strings live in `src/lib/i18n/`

Every Russian string that a user (student / teacher / admin) ever sees — bot
DM or Mini App UI — lives in one of the modules under `src/lib/i18n/` and is
accessed via the nested `ru.<surface>.<group>.<key>` shape exported by
`src/lib/i18n/index.ts`.

Modules:
- `ru.bot.*` — anything sent via `ctx.reply` / `bot.api.sendMessage`
  (`greetings`, `invites`, `access`, `quota`, `locked`, `subscription`,
  `onboarding`, `notifications`, `labels`).
- `ru.admin.*` — admin Mini App surfaces (users table, dialogs, settings,
  onboarding videos, tags, invites, banned, connections, audit, pages).
- `ru.student.*` — student Mini App surfaces (menu, summary card, freeze,
  referrals, response-window, home).
- `ru.inbox.*` — inbox + thread surfaces shared by teacher and admin
  (row, thread, message bubble, media picker, assign-teacher, feedback
  list/thread/chat, date separator).
- `ru.common.*` — generic action verbs (Сохранить, Отмена, Закрыть, etc.)
  plus the Slavic plural helpers `pluralDay` / `pluralLink` /
  `isSingularDay` (re-exported at the package root for convenience).

**Rule for new code:** new user-visible strings always go in the matching
surface module — never inline in a component, never as a fresh string
literal in a server handler. If a similar key already exists, reuse it
instead of adding a near-duplicate.

**What stays inline:**
- `src/lib/handle.ts` — generated handle word lists ("Смелый Лев"). These
  are data, not UI labels.
- `src/server/motivation.ts` — keyed motivation content registry.
- `console.warn` / `console.error` (developer-facing).
- Audit log `meta` JSON values (developer-facing).
- Tooling output (commit messages, npm script names, etc.).

This refactor is forward-compatible with `next-intl` if a second locale
is ever committed (~80% of the work transfers — only the function call
form `ru.x` → `t('x')` needs to change). Until then we ship Russian-only
with no i18n library.
