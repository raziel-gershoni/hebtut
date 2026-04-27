# Hebtutbot — Hebrew Tutoring Bot (PoC)

Voice / video-note Telegram tutoring loop for Russian-speaking students learning Hebrew.

- **Students** record voice or round-video messages in Telegram.
- **Teachers** triage incoming messages in a Telegram Mini App, claim one with a tap, then **reply from inside Telegram** by swipe-replying to the prompt the bot DMs them.
- **Telegram is the media CDN.** No bytes pass through our server — we only store `file_id` references and re-send them to the recipient.

## Stack

- Next.js 14 (App Router), TypeScript strict
- grammY (Telegram bot, webhook mode)
- Supabase (Postgres + Realtime + RLS)
- Tailwind CSS (Mini App)
- Vercel (hosting + Cron)
- Vitest (16 tests covering HMAC, quota math, claim state machine, reply routing)

## Project layout

```
src/
├── app/                 # Next.js App Router pages + API routes
│   ├── api/             # webhook, auth/session, admin/*, claim, inbox, threads, media, cron
│   ├── admin/           # admin dashboard
│   ├── inbox/           # teacher inbox
│   └── students/[id]/   # per-student thread
├── components/          # AppShell, InboxList, ClaimButton, AdminUsersTable, etc.
├── hooks/               # useInitDataAuth, useRealtimeMessages
├── lib/                 # env, auth (HMAC + JWT), i18n, time, supabase clients, tg bot
├── server/              # bot handlers, quota, claim, notifications, bootstrap
└── types/database.ts    # hand-rolled Supabase types (regen with `pnpm db:types`)

supabase/migrations/     # initial_schema.sql + rls_policies.sql
tests/                   # vitest (auth, quota, claim, reply-routing)
```

## Setup

See [`INFRA.md`](./INFRA.md) for the one-time infra checklist (Telegram bot, Supabase project, Vercel deploy).

After infra is provisioned and `.env.local` is filled in:

```bash
pnpm install
pnpm test          # 16 tests should pass
pnpm typecheck     # no errors
pnpm build         # production build
pnpm dev           # local dev (use ngrok for the webhook URL)
```

## Architecture quirks (read once)

- **Single `users` table** with a `role` enum (`pending` | `student` | `teacher` | `admin`). Self-registration via `/start` creates `pending` users; admins promote.
- **No browser recording.** The Mini App is read-only for media. Replying happens in Telegram via swipe-reply to a prompt DM'd by the bot.
- **`pending` users' messages** are stored as `status='orphaned'` and never fan out. After promotion, orphaned messages stay archived (don't surprise teachers with a backlog).
- **Duration is read from the webhook payload**, never by downloading the file. Over-quota → reject; under → store `file_id`.
- **Browser auth**: `initData` (Telegram-signed) → server validates HMAC → mints a Supabase JWT (`sub` = TG user id, `role: authenticated`) → browser uses it for both API calls and Realtime subscriptions, scoped by RLS.
- **Media playback**: `<audio src="/api/media/:id?token=...">` hits a server route that 302s to Telegram's CDN. ⚠ The redirect URL exposes the bot token (PoC shortcut documented in code).
- **Two `message_id` concepts**: our DB's `messages.id` (bigserial) is what conversations thread on; Telegram's per-chat `message_id` is stored separately for operational glue (matching reply prompts, editing notifications).
- **Claims expire** after `CLAIM_TTL_MINUTES` (default 15) via a Vercel Cron hitting `/api/cron/expire-claims` every minute.

## Tests

```bash
pnpm test
```

```
✓ tests/auth.test.ts          (5 tests)  — HMAC verify, tamper, freshness, parse
✓ tests/quota.test.ts         (3 tests)  — computeRemaining
✓ tests/claim.test.ts         (4 tests)  — canClaim state machine
✓ tests/reply-routing.test.ts (3 tests)  — matchesPrompt
✓ tests/sanity.test.ts        (1 test)
Tests: 16 passed
```

## Out of scope (PoC)

- Auto-assignment / load balancing across teachers (manual claim only).
- Student progress tracking, lesson plans, scheduling, payments.
- Push notifications outside Telegram.
- Token-leak proxying for `/api/media`.
