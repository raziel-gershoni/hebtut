# Hebrew Tutoring Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Telegram-based Hebrew tutoring PoC where Russian-speaking students send voice/video-note practice and teachers reply via Telegram while triaging through a Mini App.

**Architecture:** A single Next.js 14 app (App Router) deployed to Vercel that hosts the Mini App UI, the Telegram webhook (`/api/webhook`), the cron endpoint (`/api/cron/expire-claims`), and the media-redirect endpoint (`/api/media/[messageId]`). Supabase (Postgres) is the source of truth; teachers' browsers subscribe to it via Supabase Realtime under RLS. Telegram is the media CDN — we only ever store `file_id` references.

**Tech stack:**
- Next.js 14 (App Router), React 18, TypeScript (strict)
- grammY 1.x for the Telegram bot (webhook mode via `webhookCallback`)
- Supabase JS v2 (`@supabase/supabase-js`); separate `service_role` client for the bot, anon-key client for the browser
- Tailwind CSS for Mini App styling (Telegram theme variables)
- Vitest for unit/integration tests
- pnpm as the package manager
- Vercel for hosting + Cron
- Supabase CLI for migrations

---

## Decisions made up front (flag for confirmation, but proceeding)

1. **Single Vercel project, single Next.js app.** Webhook, cron, mini-app UI, and API routes all in one deployment. Simpler and cheaper for a PoC than splitting bot vs. mini-app.
2. **App Router (Next.js 14+)**, not Pages Router. Modern default; Server Components keep the bundle small.
3. **pnpm**, not npm/yarn — fast and consistent. (Trivial to swap if you prefer.)
4. **Hosted Supabase project** for dev (not local Supabase stack). Faster setup, real Postgres, and we get realtime/RLS for free in dev.
5. **`@supabase/supabase-js` v2** with two clients: `service_role` for bot/server (bypasses RLS), `anon` for browser (subject to RLS, scoped by initData).
6. **No browser-side Supabase auth.** The mini app authenticates each API call by sending `initData` as a header; the server validates HMAC and creates a short-lived JWT minted with `SUPABASE_JWT_SECRET` so the browser's Supabase client (and Realtime) inherit per-teacher RLS. ⚠ Load-bearing — covered in Phase 2.
7. **Tailwind**, no UI library. PoC components are hand-rolled.
8. **Vitest** for tests. Integration tests for HMAC, quota math, claim state transitions, and the teacher-reply routing function. UI is verified manually phase-by-phase.
9. **Russian copy** centralized in `src/lib/i18n.ts` as a flat object — no i18next.
10. **`Asia/Jerusalem` timezone** handled with `date-fns-tz` for quota-day boundaries.
11. **TG file URL exposes the bot token** in the PoC `/api/media` 302 redirect — flagged in code with a `// PoC-SHORTCUT:` comment, per the spec.
12. **`pending`-user inbound messages** are stored with `status='orphaned'` and skipped from notification fan-out. When promoted, orphaned messages stay archived (not surfaced to teachers) — matches the spec's default.
13. **Claim TTL** is configurable via env (`CLAIM_TTL_MINUTES`, default 15).
14. **Daily quota** configurable via env (`DAILY_QUOTA_SECONDS`, default 300 = 5 min).

If any of these is wrong, flag now — they're cheap to change in Phase 0/1, painful later.

---

## File structure (target)

```
hebtutbot/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── vercel.json                       # cron config
├── .env.example
├── .env.local                        # gitignored
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── README.md
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 20260427000001_initial_schema.sql
│       └── 20260427000002_rls_policies.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  # /  → redirects to /inbox or /pending or /admin
│   │   ├── pending/page.tsx          # "Wait for admin" landing
│   │   ├── inbox/page.tsx            # Teacher inbox (default after login)
│   │   ├── students/page.tsx         # My students roster
│   │   ├── students/[id]/page.tsx    # Per-student thread
│   │   ├── admin/page.tsx            # Admin home (tabs: Users / Links)
│   │   └── api/
│   │       ├── webhook/route.ts                 # POST — Telegram webhook
│   │       ├── cron/expire-claims/route.ts      # GET — Vercel Cron
│   │       ├── auth/session/route.ts            # POST — exchange initData → JWT
│   │       ├── me/route.ts                      # GET — current user info
│   │       ├── inbox/route.ts                   # GET — pending+claimed for me
│   │       ├── threads/[studentId]/route.ts     # GET — full thread for one student
│   │       ├── students/route.ts                # GET — my linked students
│   │       ├── claim/route.ts                   # POST — claim a message
│   │       ├── unclaim/route.ts                 # POST — release a claim (manual cancel)
│   │       ├── media/[messageId]/route.ts       # GET — 302 to Telegram CDN
│   │       └── admin/
│   │           ├── users/route.ts               # GET — list all users
│   │           ├── users/[id]/role/route.ts     # PATCH — change role
│   │           └── links/route.ts               # POST/DELETE — link/unlink
│   ├── lib/
│   │   ├── env.ts                    # zod-validated env
│   │   ├── i18n.ts                   # Russian strings
│   │   ├── time.ts                   # Asia/Jerusalem helpers
│   │   ├── auth.ts                   # initData HMAC validation, JWT mint
│   │   ├── supabase-server.ts        # service_role client
│   │   ├── supabase-browser.ts       # anon client factory (with JWT)
│   │   └── tg.ts                     # grammY bot instance
│   ├── server/
│   │   ├── handlers/
│   │   │   ├── start.ts              # /start
│   │   │   ├── student-message.ts    # voice/video_note from student
│   │   │   ├── teacher-reply.ts      # voice/video_note as reply_to prompt
│   │   │   └── unknown.ts            # other update types
│   │   ├── notifications.ts          # fan-out, edit, dedupe
│   │   ├── claim.ts                  # claim/release/expire
│   │   ├── quota.ts                  # check + commit per-day budget
│   │   └── bootstrap.ts              # ensure first admin from env
│   ├── components/
│   │   ├── AppShell.tsx
│   │   ├── InboxList.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ClaimButton.tsx
│   │   ├── ThreadView.tsx
│   │   ├── StudentRow.tsx
│   │   ├── AdminUsersTable.tsx
│   │   ├── AdminLinksPanel.tsx
│   │   └── ConfirmDialog.tsx
│   └── hooks/
│       ├── useInitDataAuth.ts        # exchanges initData → JWT, stores it
│       └── useRealtimeMessages.ts    # supabase realtime subscription
└── tests/
    ├── auth.test.ts
    ├── quota.test.ts
    ├── claim.test.ts
    └── reply-routing.test.ts
```

---

## Phase 0 — Bootstrap & deploy hello-world

**Goal:** Empty Next.js TS app deployed to Vercel that returns "ok" at `/api/ping`. No bot, no DB. Proves the deploy pipeline works.

### Task 0.1 — Initialize repo and Next.js project

**Files:**
- Create: everything

- [ ] **Step 1: Init git and pnpm**

```bash
cd /Users/razielgershoni/development/hebtutbot
git init -b main
corepack enable pnpm || npm i -g pnpm
```

- [ ] **Step 2: Scaffold Next.js**

```bash
pnpm create next-app@latest . --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --no-turbopack
```

When prompted to overwrite/install, accept. Skip Vercel-specific prompts.

- [ ] **Step 3: Replace the homepage with a placeholder**

Edit `src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Hebtutbot Mini App</h1>
      <p>PoC — bootstrap phase.</p>
    </main>
  );
}
```

- [ ] **Step 4: Add `/api/ping` route**

Create `src/app/api/ping/route.ts`:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
```

- [ ] **Step 5: Verify locally**

```bash
pnpm dev
```

In a second terminal: `curl http://localhost:3000/api/ping` → `{"ok":true,"ts":...}`. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Next.js app with /api/ping"
```

### Task 0.2 — TypeScript strictness, prettier, vitest

**Files:**
- Modify: `tsconfig.json`
- Create: `.prettierrc`, `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Tighten `tsconfig.json`**

Ensure these flags are set (merge with existing):

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 2: Add prettier config**

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 3: Install vitest**

```bash
pnpm add -D vitest @vitest/ui
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Add scripts**

In `package.json` `"scripts"`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Sanity test**

Create `tests/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm test` → passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: strict TS, prettier, vitest"
```

### Task 0.3 — Env validation & `.env.example`

**Files:**
- Create: `.env.example`, `src/lib/env.ts`

- [ ] **Step 1: Install zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Write `.env.example`**

```dotenv
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=          # random string used as ?secret=… on the webhook URL
TELEGRAM_BOT_USERNAME=            # without the leading @, e.g. hebtut_bot

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=              # from Supabase project settings (used to mint per-teacher JWTs)

# App
APP_BASE_URL=http://localhost:3000
BOOTSTRAP_ADMIN_TG_USER_ID=
DAILY_QUOTA_SECONDS=300
CLAIM_TTL_MINUTES=15
DEFAULT_TZ=Asia/Jerusalem

# Cron
CRON_SECRET=                      # required for /api/cron/* — Vercel Cron sends Authorization: Bearer <CRON_SECRET>
```

- [ ] **Step 3: Implement env loader**

Create `src/lib/env.ts`:

```ts
import { z } from "zod";

const Server = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20),
  APP_BASE_URL: z.string().url(),
  BOOTSTRAP_ADMIN_TG_USER_ID: z.coerce.number().int().positive(),
  DAILY_QUOTA_SECONDS: z.coerce.number().int().positive().default(300),
  CLAIM_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  DEFAULT_TZ: z.string().default("Asia/Jerusalem"),
  CRON_SECRET: z.string().min(8),
});

const Public = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export const serverEnv = Server.parse(process.env);
export const publicEnv = Public.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
```

- [ ] **Step 4: Add `.gitignore` entry**

Verify `.env*.local` is in `.gitignore` (Next.js scaffolds it). Add `.env.local` if missing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: env validation with zod"
```

### Task 0.4 — Vercel deploy

- [ ] **Step 1: Push to GitHub**

Create a private repo `hebtutbot` on GitHub, then:

```bash
git remote add origin git@github.com:<you>/hebtutbot.git
git push -u origin main
```

- [ ] **Step 2: Import to Vercel**

In the Vercel dashboard: New Project → Import the repo → Framework: Next.js → leave defaults.

- [ ] **Step 3: Configure env vars on Vercel**

Paste every variable from `.env.example`. For now you can use placeholder values for Telegram/Supabase secrets — they're not yet validated at build time (env is read at runtime). `BOOTSTRAP_ADMIN_TG_USER_ID` and `TELEGRAM_BOT_TOKEN` are needed before Phase 3.

- [ ] **Step 4: Verify deploy**

Wait for the deploy to succeed. Visit `https://<deploy>.vercel.app/api/ping` → `{"ok":true}`. Note the production URL — you'll use it for the webhook.

> **Phase 0 done.** Show: a working deployment URL responding to `/api/ping`.

---

## Phase 1 — Database schema & RLS

**Goal:** Supabase project with the full schema, RLS policies, and types generated for TS.

### Task 1.1 — Create Supabase project & local CLI setup

- [ ] **Step 1: Create a Supabase project** at supabase.com → name `hebtutbot-dev`. Copy the URL, anon key, service_role key, and JWT secret into `.env.local` and Vercel.

- [ ] **Step 2: Install Supabase CLI locally** (if not already): `brew install supabase/tap/supabase`.

- [ ] **Step 3: Link the project**

```bash
cd /Users/razielgershoni/development/hebtutbot
supabase init
supabase link --project-ref <YOUR_PROJECT_REF>
```

(Project ref is the subdomain part of the Supabase URL.)

- [ ] **Step 4: Commit** the `supabase/` scaffolding.

```bash
git add supabase/
git commit -m "chore: link supabase project"
```

### Task 1.2 — Initial schema migration

**Files:**
- Create: `supabase/migrations/20260427000001_initial_schema.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260427000001_initial_schema.sql`:

```sql
-- Users: TG users in a single table with role-based access.
create table public.users (
  id              bigserial primary key,
  tg_user_id      bigint unique not null,
  tg_chat_id      bigint not null,
  name            text,
  role            text not null default 'pending'
                  check (role in ('pending','student','teacher','admin')),
  status          text not null default 'active'
                  check (status in ('active','paused')),
  tz              text not null default 'Asia/Jerusalem',
  created_at      timestamptz not null default now(),
  role_changed_at timestamptz
);

create index users_role_idx on public.users (role);

-- Many-to-many student↔teacher links. Role correctness enforced by trigger.
create table public.student_teachers (
  student_id bigint not null references public.users(id) on delete cascade,
  teacher_id bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, teacher_id)
);

create or replace function public.enforce_link_roles()
returns trigger
language plpgsql
as $$
declare
  s_role text;
  t_role text;
begin
  select role into s_role from public.users where id = new.student_id;
  select role into t_role from public.users where id = new.teacher_id;
  if s_role is null then raise exception 'student % not found', new.student_id; end if;
  if t_role is null then raise exception 'teacher % not found', new.teacher_id; end if;
  if s_role <> 'student' then raise exception 'user % is not a student (role=%)', new.student_id, s_role; end if;
  if t_role <> 'teacher' then raise exception 'user % is not a teacher (role=%)', new.teacher_id, t_role; end if;
  return new;
end;
$$;

create trigger student_teachers_role_check
before insert or update on public.student_teachers
for each row execute function public.enforce_link_roles();

-- Messages: both directions.
create table public.messages (
  id                              bigserial primary key,
  student_id                      bigint not null references public.users(id),
  direction                       text not null check (direction in ('in','out')),
  teacher_id                      bigint references public.users(id),
  kind                            text not null check (kind in ('voice','video_note')),
  file_id                         text not null,
  file_unique_id                  text,
  duration                        int  not null check (duration >= 0),
  status                          text not null check (status in ('pending','claimed','answered','expired','orphaned')),
  claimed_by_teacher_id           bigint references public.users(id),
  claimed_at                      timestamptz,
  answered_at                     timestamptz,
  reply_to_id                     bigint references public.messages(id),
  tg_message_id_in_student_chat   bigint,
  created_at                      timestamptz not null default now()
);

create index messages_student_idx     on public.messages (student_id, created_at desc);
create index messages_status_idx      on public.messages (status) where status in ('pending','claimed');
create index messages_claimed_by_idx  on public.messages (claimed_by_teacher_id) where claimed_by_teacher_id is not null;

-- One row per teacher TG notification for an inbound student message.
create table public.notifications (
  id                          bigserial primary key,
  message_id                  bigint not null references public.messages(id) on delete cascade,
  teacher_id                  bigint not null references public.users(id),
  tg_chat_id                  bigint not null,
  tg_notification_message_id  bigint not null,
  created_at                  timestamptz not null default now()
);

create unique index notifications_unique_idx
  on public.notifications (message_id, teacher_id);

-- One row per "📩 reply to X" prompt sent to a teacher upon claim.
create table public.prompts (
  id                       bigserial primary key,
  teacher_id               bigint not null references public.users(id),
  student_message_id       bigint not null references public.messages(id) on delete cascade,
  tg_chat_id               bigint not null,
  tg_prompt_message_id     bigint not null,
  created_at               timestamptz not null default now()
);

create unique index prompts_unique_idx
  on public.prompts (teacher_id, tg_prompt_message_id);

-- Daily quota usage per student, day in Asia/Jerusalem.
create table public.quota_usage (
  student_id    bigint not null references public.users(id) on delete cascade,
  date          date   not null,
  seconds_used  int    not null default 0,
  primary key (student_id, date)
);
```

- [ ] **Step 2: Push the migration**

```bash
supabase db push
```

Inspect: in the Supabase Dashboard → Table Editor — confirm all six tables exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat(db): initial schema"
```

### Task 1.3 — RLS policies

**Files:**
- Create: `supabase/migrations/20260427000002_rls_policies.sql`

The pattern: every API call from the browser carries a JWT we mint server-side after validating initData. The JWT's `sub` claim is set to the user's TG `tg_user_id` (string). RLS policies use `auth.jwt() ->> 'sub'` to scope reads.

- [ ] **Step 1: Write the policies**

Create `supabase/migrations/20260427000002_rls_policies.sql`:

```sql
-- Helper: resolve current user's row from the JWT's 'sub' claim (= tg_user_id as string).
create or replace function public.current_app_user()
returns public.users
language sql
stable
security definer
set search_path = public
as $$
  select u.* from public.users u
  where u.tg_user_id = (nullif(auth.jwt() ->> 'sub', ''))::bigint
$$;

revoke all on function public.current_app_user() from public;
grant execute on function public.current_app_user() to anon, authenticated;

-- Enable RLS everywhere.
alter table public.users             enable row level security;
alter table public.student_teachers  enable row level security;
alter table public.messages          enable row level security;
alter table public.notifications     enable row level security;
alter table public.prompts           enable row level security;
alter table public.quota_usage       enable row level security;

-- USERS:
--   * Self read.
--   * Admins read everyone.
create policy users_self_read on public.users
  for select to authenticated
  using (id = (select id from public.current_app_user()));

create policy users_admin_read_all on public.users
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- STUDENT_TEACHERS:
--   * Teacher reads links they appear in.
--   * Admin reads all.
create policy st_teacher_read on public.student_teachers
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy st_admin_read on public.student_teachers
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- MESSAGES:
--   Teacher reads messages from their linked students (any direction).
--   Admin reads all.
create policy messages_teacher_read on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.student_teachers st
      where st.student_id = public.messages.student_id
        and st.teacher_id = (select id from public.current_app_user())
    )
  );

create policy messages_admin_read on public.messages
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- NOTIFICATIONS / PROMPTS: teacher reads their own; admin reads all.
create policy notifications_teacher_read on public.notifications
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy notifications_admin_read on public.notifications
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

create policy prompts_teacher_read on public.prompts
  for select to authenticated
  using (teacher_id = (select id from public.current_app_user()));

create policy prompts_admin_read on public.prompts
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- QUOTA_USAGE: teacher reads quota of their linked students; admin reads all.
create policy quota_teacher_read on public.quota_usage
  for select to authenticated
  using (
    exists (
      select 1 from public.student_teachers st
      where st.student_id = public.quota_usage.student_id
        and st.teacher_id = (select id from public.current_app_user())
    )
  );

create policy quota_admin_read on public.quota_usage
  for select to authenticated
  using ((select role from public.current_app_user()) = 'admin');

-- No INSERT/UPDATE/DELETE policies for browser/anon: all writes go through service_role on the server.
```

- [ ] **Step 2: Push and inspect**

```bash
supabase db push
```

Dashboard → Authentication → Policies → confirm policies exist on each table. RLS enabled icon should be green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): RLS policies for teachers and admins"
```

### Task 1.4 — Generate TS types from the schema

**Files:**
- Create: `src/types/database.ts`
- Modify: `package.json`

- [ ] **Step 1: Generate types**

```bash
supabase gen types typescript --linked --schema public > src/types/database.ts
```

- [ ] **Step 2: Add a regen script**

Add to `package.json`:

```json
{
  "scripts": {
    "db:types": "supabase gen types typescript --linked --schema public > src/types/database.ts"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(db): generated TS types"
```

> **Phase 1 done.** Show: tables in Supabase + types file in repo.

---

## Phase 2 — initData auth & Supabase clients

**Goal:** A teacher's browser can hit `POST /api/auth/session` with Telegram `initData`, receive a Supabase-compatible JWT scoped to their TG id, and use it for both API calls and Realtime. HMAC validation is rock-solid and tested.

### Task 2.1 — Install client libs and write supabase clients

**Files:**
- Create: `src/lib/supabase-server.ts`, `src/lib/supabase-browser.ts`

- [ ] **Step 1: Install**

```bash
pnpm add @supabase/supabase-js jose date-fns date-fns-tz
```

- [ ] **Step 2: Server client (service_role)**

Create `src/lib/supabase-server.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv, publicEnv } from "./env";
import type { Database } from "@/types/database";

let cached: SupabaseClient<Database> | null = null;

export function getServiceRoleClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
```

- [ ] **Step 3: Browser client factory**

Create `src/lib/supabase-browser.ts`:

```ts
"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createBrowserClient(jwt: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      realtime: { params: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
    },
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: supabase clients (service_role + browser factory)"
```

### Task 2.2 — initData HMAC validation (TDD)

**Files:**
- Create: `src/lib/auth.ts`, `tests/auth.test.ts`

The reference Telegram algorithm: build `data_check_string` = sorted `key=value` pairs joined by `\n` (excluding `hash`); compute `secret_key = HMAC_SHA256(bot_token, "WebAppData")`; compute `HMAC_SHA256(data_check_string, secret_key)`; compare to `hash`.

- [ ] **Step 1: Write the failing tests**

Create `tests/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyInitData, parseInitData } from "@/lib/auth";

const BOT_TOKEN = "12345:fake-bot-token-for-tests";

function signInitData(params: Record<string, string>, token: string): string {
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const url = new URLSearchParams({ ...params, hash });
  return url.toString();
}

describe("verifyInitData", () => {
  it("accepts a correctly signed payload", () => {
    const user = JSON.stringify({ id: 12345, first_name: "Maria" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)), query_id: "abc" },
      BOT_TOKEN,
    );
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const user = JSON.stringify({ id: 12345, first_name: "Maria" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    const tampered = initData.replace("Maria", "Admin");
    expect(verifyInitData(tampered, BOT_TOKEN).ok).toBe(false);
  });

  it("rejects payload older than the freshness window", () => {
    const user = JSON.stringify({ id: 12345 });
    const oldDate = Math.floor(Date.now() / 1000) - 60 * 60 * 25; // 25h old
    const initData = signInitData({ user, auth_date: String(oldDate) }, BOT_TOKEN);
    expect(verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 }).ok).toBe(false);
  });

  it("parses user from a valid payload", () => {
    const user = JSON.stringify({ id: 99, first_name: "X", username: "xx" });
    const initData = signInitData(
      { user, auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    const r = verifyInitData(initData, BOT_TOKEN);
    if (!r.ok) throw new Error("expected ok");
    const parsed = parseInitData(r.data);
    expect(parsed.user.id).toBe(99);
    expect(parsed.user.username).toBe("xx");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm test
```

Expected: 4 failing (module not found / functions not exported).

- [ ] **Step 3: Implement `src/lib/auth.ts`**

```ts
import crypto from "node:crypto";
import { SignJWT } from "jose";
import { serverEnv } from "./env";

export type InitDataMap = Map<string, string>;

export type VerifyResult =
  | { ok: true; data: InitDataMap }
  | { ok: false; reason: string };

export interface VerifyOptions {
  maxAgeSeconds?: number; // default 24h
}

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions = {},
): VerifyResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(computed, hash)) {
    return { ok: false, reason: "bad hash" };
  }

  const authDate = Number(params.get("auth_date") ?? "0");
  const maxAge = opts.maxAgeSeconds ?? 86400;
  if (!authDate || Date.now() / 1000 - authDate > maxAge) {
    return { ok: false, reason: "stale" };
  }

  return { ok: true, data: new Map(entries) };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  user: TelegramUser;
  authDate: number;
  queryId?: string;
}

export function parseInitData(data: InitDataMap): ParsedInitData {
  const userRaw = data.get("user");
  if (!userRaw) throw new Error("user missing in initData");
  const user = JSON.parse(userRaw) as TelegramUser;
  return {
    user,
    authDate: Number(data.get("auth_date") ?? "0"),
    queryId: data.get("query_id") ?? undefined,
  };
}

export async function mintSupabaseJwt(tgUserId: number, role: string): Promise<string> {
  const secret = new TextEncoder().encode(serverEnv.SUPABASE_JWT_SECRET);
  return await new SignJWT({ role: "authenticated", app_role: role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(tgUserId))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}
```

- [ ] **Step 4: Run tests — they pass**

```bash
pnpm test
```

Expected: 4 passing (plus the sanity test).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): initData HMAC validation + Supabase JWT mint"
```

### Task 2.3 — `/api/auth/session` endpoint

**Files:**
- Create: `src/app/api/auth/session/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { verifyInitData, parseInitData, mintSupabaseJwt } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { initData?: string };
  const initData = body.initData ?? "";
  const v = verifyInitData(initData, serverEnv.TELEGRAM_BOT_TOKEN);
  if (!v.ok) return Response.json({ error: v.reason }, { status: 401 });

  const parsed = parseInitData(v.data);
  const sb = getServiceRoleClient();

  // Self-register on first sight via the mini app — same path as /start in the bot.
  const { data: existing } = await sb
    .from("users")
    .select("*")
    .eq("tg_user_id", parsed.user.id)
    .maybeSingle();

  let userRow = existing;
  if (!userRow) {
    const display = [parsed.user.first_name, parsed.user.last_name].filter(Boolean).join(" ").trim() ||
      parsed.user.username || `user ${parsed.user.id}`;
    const { data, error } = await sb
      .from("users")
      .insert({
        tg_user_id: parsed.user.id,
        tg_chat_id: parsed.user.id, // best-effort; real chat_id comes from the webhook
        name: display,
        role: "pending",
      })
      .select("*")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    userRow = data;
  }

  const jwt = await mintSupabaseJwt(parsed.user.id, userRow.role);

  return Response.json({
    jwt,
    user: { id: userRow.id, role: userRow.role, name: userRow.name },
  });
}
```

- [ ] **Step 2: Manual smoke test**

This is hard to test without a real TG initData. Skip until Phase 3 lands a real bot. Move on.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(auth): POST /api/auth/session"
```

> **Phase 2 done.** Show: passing auth tests; endpoint exists.

---

## Phase 3 — Bot core: webhook, /start, role=pending, admin bootstrap

**Goal:** Hitting the deployed webhook with a fake `/start` from a new user creates a `users` row with `role=pending`. Bootstrap admin ensures the env-configured TG user becomes admin on cold start. Storage of inbound voice/video_note messages **for pending users only** lands as `status='orphaned'` (full quota/fan-out comes in Phase 5).

### Task 3.1 — grammY install + bot singleton

**Files:**
- Create: `src/lib/tg.ts`, `src/server/bootstrap.ts`

- [ ] **Step 1: Install grammY**

```bash
pnpm add grammy
```

- [ ] **Step 2: Bot singleton**

Create `src/lib/tg.ts`:

```ts
import { Bot } from "grammy";
import { serverEnv } from "./env";

let bot: Bot | null = null;
export function getBot(): Bot {
  if (bot) return bot;
  bot = new Bot(serverEnv.TELEGRAM_BOT_TOKEN);
  return bot;
}
```

- [ ] **Step 3: Bootstrap admin helper**

Create `src/server/bootstrap.ts`:

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverEnv } from "@/lib/env";

let bootstrapped = false;
export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapped) return;
  const sb = getServiceRoleClient();
  const tgId = serverEnv.BOOTSTRAP_ADMIN_TG_USER_ID;

  const { data } = await sb.from("users").select("id, role").eq("tg_user_id", tgId).maybeSingle();
  if (!data) {
    await sb.from("users").insert({
      tg_user_id: tgId,
      tg_chat_id: tgId,
      role: "admin",
      name: "bootstrap admin",
      role_changed_at: new Date().toISOString(),
    });
  } else if (data.role !== "admin") {
    await sb.from("users").update({ role: "admin", role_changed_at: new Date().toISOString() }).eq("id", data.id);
  }
  bootstrapped = true;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(bot): grammY singleton + admin bootstrap"
```

### Task 3.2 — i18n strings (Russian)

**Files:**
- Create: `src/lib/i18n.ts`

- [ ] **Step 1: Implement**

```ts
export const ru = {
  greetingRegistered: "Привет! Зарегистрировался. Жди — администратор подключит тебя.",
  greetingTeacher: "Привет, преподаватель! Открой мини-приложение, чтобы видеть входящие.",
  greetingStudent: (remaining: string) =>
    `Привет! Я готов слушать. На сегодня у тебя осталось ${remaining}.`,
  unknownInput: "Я понимаю только голосовые и круглые видео. Попробуй ещё раз.",
  pendingNotice: "Сообщение сохранено. Жди — администратор подключит тебя к преподавателю.",
  overQuota: (remaining: string) =>
    `На сегодня лимит почти исчерпан — осталось ${remaining}. Попробуй завтра или сократи запись.`,
  acceptedStudent: (remaining: string) => `✅ Отправлено! Осталось ${remaining} на сегодня.`,
  teacherReplyMissingContext:
    "Чтобы ответить ученику, открой мини-приложение, нажми «Ответить» рядом с его сообщением, и потом свайпни по подсказке.",
  teacherReplyDelivered: "✅ Ответ отправлен ученику.",
  teacherReplyFailed: "Не удалось отправить ответ. Попробуй ещё раз через мини-приложение.",
  teacherClaimPrompt: (studentName: string, secondsAgo: string) =>
    `📩 Ответь ${studentName} — голосовое ${secondsAgo}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherNotificationActionable: (studentName: string, kindLabel: string, durationLabel: string) =>
    `🔔 ${studentName} прислал(а) ${kindLabel} ${durationLabel}. Открой мини-приложение, чтобы взять в работу.`,
  teacherNotificationTaken: (handler: string) => `✓ ${handler} взял(а) сообщение в работу.`,
  teacherNotificationExpired: "⚠️ Время на ответ истекло, сообщение снова доступно.",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(i18n): Russian copy"
```

### Task 3.3 — `/start` handler

**Files:**
- Create: `src/server/handlers/start.ts`

- [ ] **Step 1: Implement**

```ts
import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru } from "@/lib/i18n";

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) return;

  const sb = getServiceRoleClient();
  const display = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
    from.username || `user ${from.id}`;

  const { data: existing } = await sb
    .from("users")
    .select("id, role")
    .eq("tg_user_id", from.id)
    .maybeSingle();

  if (!existing) {
    await sb.from("users").insert({
      tg_user_id: from.id,
      tg_chat_id: chat.id,
      name: display,
      role: "pending",
    });
    await ctx.reply(ru.greetingRegistered);
    return;
  }

  // Update chat_id (in case the user blocked & restarted, etc.).
  await sb.from("users").update({ tg_chat_id: chat.id, name: display }).eq("id", existing.id);

  switch (existing.role) {
    case "pending":
      await ctx.reply(ru.greetingRegistered);
      return;
    case "teacher":
    case "admin":
      await ctx.reply(ru.greetingTeacher);
      return;
    case "student":
      // remaining quota will be filled in Phase 5; for now show a placeholder.
      await ctx.reply(ru.greetingStudent("5:00"));
      return;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(bot): /start handler with self-registration"
```

### Task 3.4 — Webhook route

**Files:**
- Create: `src/app/api/webhook/route.ts`, `src/server/handlers/unknown.ts`

- [ ] **Step 1: Unknown handler**

Create `src/server/handlers/unknown.ts`:

```ts
import type { Context } from "grammy";
import { ru } from "@/lib/i18n";

export async function handleUnknown(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) return;
  if (ctx.message?.text?.startsWith("/")) {
    await ctx.reply(ru.unknownInput);
    return;
  }
  await ctx.reply(ru.unknownInput);
}
```

- [ ] **Step 2: Webhook route**

Create `src/app/api/webhook/route.ts`:

```ts
import { NextRequest } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";
import { ensureBootstrapAdmin } from "@/server/bootstrap";
import { handleStart } from "@/server/handlers/start";
import { handleUnknown } from "@/server/handlers/unknown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bot = getBot();
let installed = false;
function installHandlers() {
  if (installed) return;
  bot.command("start", handleStart);
  bot.on("message", handleUnknown);
  installed = true;
}

const handler = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  // Secret-token check: Telegram sends X-Telegram-Bot-Api-Secret-Token if configured.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== serverEnv.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  installHandlers();
  await ensureBootstrapAdmin();
  return handler(req);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(bot): /api/webhook with /start"
```

### Task 3.5 — Wire up the webhook with Telegram

- [ ] **Step 1: Create the bot in BotFather**

Talk to @BotFather → `/newbot` → choose name + username → save the token into `.env.local` and Vercel as `TELEGRAM_BOT_TOKEN` and the username (without `@`) as `TELEGRAM_BOT_USERNAME`.

- [ ] **Step 2: Generate webhook secret**

```bash
openssl rand -hex 32
```

Set as `TELEGRAM_WEBHOOK_SECRET` locally and on Vercel.

- [ ] **Step 3: Set the webhook**

After Vercel redeploy:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-vercel-domain>/api/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message","callback_query"]
  }'
```

Confirm with: `curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"` → `url` is set, `last_error_message` is null.

- [ ] **Step 4: Smoke test in Telegram**

Send `/start` to the bot from your own TG account.
- Expected reply: `Привет! Зарегистрировался. Жди — администратор подключит тебя.`
- In Supabase: `users` table has a row with `role='pending'`.
- If your TG id matches `BOOTSTRAP_ADMIN_TG_USER_ID`, you should see `role='admin'` instead (or after the webhook hits the bootstrap once).

- [ ] **Step 5: Commit any tweaks**

If you change anything to make the smoke test pass, commit it:

```bash
git add -A
git commit -m "fix: webhook smoke-test tweaks"
```

> **Phase 3 done.** Show: a real `/start` in Telegram producing a `pending` row in DB and the correct Russian reply.

---

## Phase 4 — Admin section in mini-app

**Goal:** As admin, open the mini-app and (a) see all users, (b) change a user's role, (c) link/unlink students↔teachers. Without this, we can't promote anyone to test student/teacher flows.

### Task 4.1 — initData hook + session bootstrap on the client

**Files:**
- Create: `src/hooks/useInitDataAuth.ts`, `src/components/AppShell.tsx`

- [ ] **Step 1: Hook**

Create `src/hooks/useInitDataAuth.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

type Status =
  | { state: "loading" }
  | { state: "no-tg" }
  | { state: "error"; message: string }
  | { state: "ok"; jwt: string; user: { id: number; role: string; name: string } };

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready: () => void; expand: () => void } };
  }
}

export function useInitDataAuth(): Status {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      setStatus({ state: "no-tg" });
      return;
    }
    tg.ready();
    tg.expand();
    const initData = tg.initData ?? "";
    if (!initData) {
      setStatus({ state: "error", message: "missing initData" });
      return;
    }
    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { jwt: string; user: { id: number; role: string; name: string } }) =>
        setStatus({ state: "ok", jwt: d.jwt, user: d.user }),
      )
      .catch((e: Error) => setStatus({ state: "error", message: e.message }));
  }, []);

  return status;
}
```

- [ ] **Step 2: AppShell**

Create `src/components/AppShell.tsx`:

```tsx
"use client";
import { useInitDataAuth } from "@/hooks/useInitDataAuth";
import Script from "next/script";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: (ctx: { jwt: string; role: string; userId: number; name: string }) => ReactNode }) {
  const status = useInitDataAuth();

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <main className="min-h-screen p-4 bg-[var(--tg-theme-bg-color,#fff)] text-[var(--tg-theme-text-color,#000)]">
        {status.state === "loading" && <p>Загрузка…</p>}
        {status.state === "no-tg" && <p>Открой эту страницу через Telegram.</p>}
        {status.state === "error" && <p className="text-red-600">Ошибка авторизации: {status.message}</p>}
        {status.state === "ok" &&
          children({ jwt: status.jwt, role: status.user.role, userId: status.user.id, name: status.user.name })}
      </main>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(miniapp): initData auth hook + AppShell"
```

### Task 4.2 — Server helper for verifying JWT on API requests

**Files:**
- Create: `src/lib/auth-server.ts`

- [ ] **Step 1: Implement**

```ts
import { jwtVerify } from "jose";
import { serverEnv } from "./env";
import { getServiceRoleClient } from "./supabase-server";

export interface AuthedUser {
  id: number;
  tgUserId: number;
  role: "pending" | "student" | "teacher" | "admin";
  name: string | null;
}

export async function authFromRequest(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return null;
  const token = m[1];

  const secret = new TextEncoder().encode(serverEnv.SUPABASE_JWT_SECRET);
  let payload: { sub?: string };
  try {
    const v = await jwtVerify(token, secret);
    payload = v.payload as { sub?: string };
  } catch {
    return null;
  }
  if (!payload.sub) return null;
  const tgUserId = Number(payload.sub);

  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("users")
    .select("id, tg_user_id, role, name")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tgUserId: Number(data.tg_user_id),
    role: data.role as AuthedUser["role"],
    name: data.name,
  };
}

export function requireRole(user: AuthedUser | null, roles: AuthedUser["role"][]): user is AuthedUser {
  return !!user && roles.includes(user.role);
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(auth): server-side JWT verification + role guard"
```

### Task 4.3 — Admin API: list users, change role, link/unlink

**Files:**
- Create: `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/role/route.ts`, `src/app/api/admin/links/route.ts`

- [ ] **Step 1: GET /api/admin/users**

```ts
// src/app/api/admin/users/route.ts
import { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users")
    .select("id, tg_user_id, name, role, status, created_at, role_changed_at")
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ users: data });
}
```

- [ ] **Step 2: PATCH role**

```ts
// src/app/api/admin/users/[id]/role/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ role: z.enum(["pending", "student", "teacher", "admin"]) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  // Demoting a student/teacher: cascade-clean the student_teachers link.
  const { data: target } = await sb.from("users").select("role").eq("id", targetId).single();
  if (target && target.role !== parsed.data.role) {
    if (target.role === "student" || parsed.data.role !== target.role) {
      await sb.from("student_teachers").delete().eq("student_id", targetId);
    }
    if (target.role === "teacher" || parsed.data.role !== target.role) {
      await sb.from("student_teachers").delete().eq("teacher_id", targetId);
    }
  }

  const { error } = await sb
    .from("users")
    .update({ role: parsed.data.role, role_changed_at: new Date().toISOString() })
    .eq("id", targetId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: POST/DELETE links**

```ts
// src/app/api/admin/links/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ studentId: z.coerce.number().int(), teacherId: z.coerce.number().int() });

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const sb = getServiceRoleClient();
  const { error } = await sb.from("student_teachers").insert({
    student_id: parsed.data.studentId,
    teacher_id: parsed.data.teacherId,
  });
  if (error) return new Response(error.message, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["admin"])) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response("bad body", { status: 400 });
  const sb = getServiceRoleClient();
  const { error } = await sb.from("student_teachers").delete()
    .eq("student_id", parsed.data.studentId)
    .eq("teacher_id", parsed.data.teacherId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): users + roles + links API"
```

### Task 4.4 — Admin UI

**Files:**
- Create: `src/app/admin/page.tsx`, `src/components/AdminUsersTable.tsx`, `src/components/AdminLinksPanel.tsx`, `src/components/ConfirmDialog.tsx`

- [ ] **Step 1: ConfirmDialog**

```tsx
// src/components/ConfirmDialog.tsx
"use client";
import { type ReactNode } from "react";

export function ConfirmDialog({
  open, title, body, onCancel, onConfirm,
}: {
  open: boolean; title: string; body: ReactNode;
  onCancel: () => void; onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 shadow-xl">
        <h2 className="font-semibold mb-2">{title}</h2>
        <div className="text-sm mb-4">{body}</div>
        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded bg-gray-100" onClick={onCancel}>Отмена</button>
          <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={onConfirm}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AdminUsersTable**

```tsx
// src/components/AdminUsersTable.tsx
"use client";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type User = { id: number; tg_user_id: number; name: string | null; role: string; status: string; created_at: string; role_changed_at: string | null };

export function AdminUsersTable({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [pending, setPending] = useState<{ id: number; role: string } | null>(null);

  async function load() {
    const r = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } });
    const d = (await r.json()) as { users: User[] };
    setUsers(d.users);
  }
  useEffect(() => { void load(); }, []);

  async function changeRole(id: number, role: string) {
    await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Пользователи</h2>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th>Имя</th><th>TG id</th><th>Роль</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="py-2">{u.name ?? "—"}</td>
              <td className="py-2">{u.tg_user_id}</td>
              <td className="py-2">{u.role}</td>
              <td className="py-2">
                <select
                  value={u.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    if (u.role === "admin" || (u.role === "teacher" && role === "pending")) {
                      setPending({ id: u.id, role });
                    } else {
                      void changeRole(u.id, role);
                    }
                  }}
                >
                  <option value="pending">pending</option>
                  <option value="student">student</option>
                  <option value="teacher">teacher</option>
                  <option value="admin">admin</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!pending}
        title="Подтвердить смену роли"
        body="Это действие может разорвать текущие связи. Продолжить?"
        onCancel={() => setPending(null)}
        onConfirm={async () => { if (pending) await changeRole(pending.id, pending.role); setPending(null); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: AdminLinksPanel**

```tsx
// src/components/AdminLinksPanel.tsx
"use client";
import { useEffect, useState } from "react";

type User = { id: number; name: string | null; role: string };

export function AdminLinksPanel({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);

  useEffect(() => {
    void fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json())
      .then((d: { users: User[] }) => setUsers(d.users));
  }, [jwt]);

  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  async function link(action: "POST" | "DELETE") {
    if (!studentId || !teacherId) return;
    await fetch("/api/admin/links", {
      method: action,
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, teacherId }),
    });
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold mb-2">Связи студент ↔ преподаватель</h2>
      <div className="flex gap-2 items-center">
        <select onChange={(e) => setStudentId(Number(e.target.value))} value={studentId ?? ""}>
          <option value="">— студент —</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}
        </select>
        <span>↔</span>
        <select onChange={(e) => setTeacherId(Number(e.target.value))} value={teacherId ?? ""}>
          <option value="">— преподаватель —</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
        </select>
        <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={() => link("POST")}>Привязать</button>
        <button className="px-3 py-2 rounded bg-gray-200" onClick={() => link("DELETE")}>Отвязать</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Admin page**

```tsx
// src/app/admin/page.tsx
"use client";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable } from "@/components/AdminUsersTable";
import { AdminLinksPanel } from "@/components/AdminLinksPanel";

export default function AdminPage() {
  return (
    <AppShell>
      {({ jwt, role }) => {
        if (role !== "admin") return <p>Только для администраторов.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Админка</h1>
            <AdminUsersTable jwt={jwt} />
            <AdminLinksPanel jwt={jwt} />
          </>
        );
      }}
    </AppShell>
  );
}
```

- [ ] **Step 5: Update home page to route by role**

```tsx
// src/app/page.tsx
"use client";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";

export default function Home() {
  return (
    <AppShell>
      {({ role, name }) => (
        <>
          <h1 className="text-lg font-semibold">Привет, {name}!</h1>
          <p className="text-sm text-gray-500 mt-1">Роль: {role}</p>
          {role === "admin" && <Link className="block mt-4 underline" href="/admin">Админка</Link>}
          {(role === "teacher" || role === "admin") && <Link className="block mt-2 underline" href="/inbox">Входящие</Link>}
          {role === "pending" && <p className="mt-4">Жди — администратор подключит тебя.</p>}
          {role === "student" && <p className="mt-4">Запиши голосовое или круглое видео в чат с ботом.</p>}
        </>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 6: Configure the Mini App in BotFather**

`/setmenubutton` for your bot → set the URL to `https://<vercel-domain>/`. After this, the bot's chat shows a "Open" button that launches the Mini App.

- [ ] **Step 7: Smoke test**

Open the bot in Telegram → tap menu button. As bootstrap admin you should see "Админка" link. Open it → list of users. Promote your second TG user (a friend, or yourself from another account) to `student`, a third to `teacher`. Link them. Confirm DB rows.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(miniapp): admin tab — users, role change, linking"
```

> **Phase 4 done.** Show: an admin promoting users and linking them, end-to-end.

---

## Phase 5 — Student message handling: quota, fan-out

**Goal:** A student sends a voice/video_note. The bot validates duration ≤ remaining daily quota (in `Asia/Jerusalem`), stores the message, and fans out a notification to every linked teacher. `pending` users get the orphaned-storage path.

### Task 5.1 — Quota module (TDD)

**Files:**
- Create: `src/server/quota.ts`, `src/lib/time.ts`, `tests/quota.test.ts`

- [ ] **Step 1: Time helper**

```ts
// src/lib/time.ts
import { formatInTimeZone } from "date-fns-tz";
export function localDateInTz(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}
```

- [ ] **Step 2: Failing tests**

```ts
// tests/quota.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeRemaining } from "@/server/quota";

describe("computeRemaining", () => {
  it("returns full budget when no usage", () => {
    expect(computeRemaining(0, 300)).toBe(300);
  });
  it("subtracts used seconds", () => {
    expect(computeRemaining(120, 300)).toBe(180);
  });
  it("clamps at zero", () => {
    expect(computeRemaining(400, 300)).toBe(0);
  });
});
```

Run `pnpm test` — fails (module not found).

- [ ] **Step 3: Implement quota**

```ts
// src/server/quota.ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";
import { serverEnv } from "@/lib/env";

export function computeRemaining(used: number, budget: number): number {
  return Math.max(0, budget - used);
}

export async function getRemainingForToday(studentId: number, tz: string): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  const { data } = await sb
    .from("quota_usage")
    .select("seconds_used")
    .eq("student_id", studentId)
    .eq("date", today)
    .maybeSingle();
  const used = data?.seconds_used ?? 0;
  return computeRemaining(used, serverEnv.DAILY_QUOTA_SECONDS);
}

export async function commitUsage(studentId: number, tz: string, seconds: number): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  // upsert with addition
  const { data: existing } = await sb
    .from("quota_usage")
    .select("seconds_used")
    .eq("student_id", studentId)
    .eq("date", today)
    .maybeSingle();
  const newUsed = (existing?.seconds_used ?? 0) + seconds;
  await sb
    .from("quota_usage")
    .upsert({ student_id: studentId, date: today, seconds_used: newUsed }, { onConflict: "student_id,date" });
  return computeRemaining(newUsed, serverEnv.DAILY_QUOTA_SECONDS);
}
```

- [ ] **Step 4: Tests pass**

`pnpm test` → green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(quota): per-student daily budget with TZ-aware date"
```

### Task 5.2 — Notifications fan-out module

**Files:**
- Create: `src/server/notifications.ts`

- [ ] **Step 1: Implement**

```ts
// src/server/notifications.ts
import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";

export async function fanOutToTeachers(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, kind, duration, student_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;

  const { data: student } = await sb.from("users").select("name").eq("id", msg.student_id).single();
  const studentName = student?.name ?? `student ${msg.student_id}`;

  const { data: links } = await sb
    .from("student_teachers")
    .select("teacher_id, users:teacher_id(tg_chat_id, name)")
    .eq("student_id", msg.student_id);
  if (!links?.length) return;

  const bot = getBot();
  const kindLabel = msg.kind === "voice" ? "голосовое" : "круглое видео";
  const durationLabel = formatDuration(msg.duration);
  const text = ru.teacherNotificationActionable(studentName, kindLabel, durationLabel);

  const rows: { teacher_id: number; tg_chat_id: number; tg_notification_message_id: number; message_id: number }[] = [];
  for (const link of links) {
    const teacher = link.users as unknown as { tg_chat_id: number; name: string | null } | null;
    if (!teacher) continue;
    try {
      const sent = await bot.api.sendMessage(teacher.tg_chat_id, text);
      rows.push({
        teacher_id: link.teacher_id as number,
        tg_chat_id: teacher.tg_chat_id,
        tg_notification_message_id: sent.message_id,
        message_id: msg.id,
      });
    } catch (e) {
      console.error("fan-out error", e);
    }
  }
  if (rows.length) {
    await sb.from("notifications").insert(rows);
  }
}

export async function editAllNotificationsForMessage(messageId: number, text: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: notifs } = await sb
    .from("notifications")
    .select("id, tg_chat_id, tg_notification_message_id")
    .eq("message_id", messageId);
  if (!notifs) return;
  const bot = getBot();
  for (const n of notifs) {
    try {
      await bot.api.editMessageText(n.tg_chat_id, n.tg_notification_message_id, text);
    } catch (e) {
      // 400 'message is not modified' is fine
      console.warn("editMessageText", e);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(bot): notification fan-out + edit helpers"
```

### Task 5.3 — Student message handler

**Files:**
- Create: `src/server/handlers/student-message.ts`
- Modify: `src/app/api/webhook/route.ts`, `src/server/handlers/start.ts`

- [ ] **Step 1: Implement student-message handler**

```ts
// src/server/handlers/student-message.ts
import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { getRemainingForToday, commitUsage } from "@/server/quota";
import { fanOutToTeachers } from "@/server/notifications";

export async function handleStudentMedia(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from || !ctx.chat) return false;
  const voice = msg.voice;
  const note = msg.video_note;
  if (!voice && !note) return false;

  const sb = getServiceRoleClient();
  const { data: user } = await sb
    .from("users")
    .select("id, role, tz")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();

  if (!user) return false; // /start should have created them; fall through to unknown.

  const kind: "voice" | "video_note" = voice ? "voice" : "video_note";
  const fileId = (voice?.file_id ?? note?.file_id) as string;
  const fileUniqueId = (voice?.file_unique_id ?? note?.file_unique_id) as string;
  const duration = (voice?.duration ?? note?.duration ?? 0) as number;

  if (user.role === "pending") {
    await sb.from("messages").insert({
      student_id: user.id,
      direction: "in",
      kind,
      file_id: fileId,
      file_unique_id: fileUniqueId,
      duration,
      status: "orphaned",
      tg_message_id_in_student_chat: msg.message_id,
    });
    await ctx.reply(ru.pendingNotice);
    return true;
  }

  if (user.role !== "student") {
    // teacher/admin sending us media outside of a reply — ignore
    return false;
  }

  const remaining = await getRemainingForToday(user.id, user.tz);
  if (duration > remaining) {
    await ctx.reply(ru.overQuota(formatDuration(remaining)));
    return true;
  }

  const { data: inserted, error } = await sb
    .from("messages")
    .insert({
      student_id: user.id,
      direction: "in",
      kind,
      file_id: fileId,
      file_unique_id: fileUniqueId,
      duration,
      status: "pending",
      tg_message_id_in_student_chat: msg.message_id,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await ctx.reply(ru.unknownInput);
    return true;
  }

  const newRemaining = await commitUsage(user.id, user.tz, duration);
  await ctx.reply(ru.acceptedStudent(formatDuration(newRemaining)));
  await fanOutToTeachers(inserted.id);
  return true;
}
```

- [ ] **Step 2: Wire into webhook**

In `src/app/api/webhook/route.ts`, before the generic `bot.on("message", handleUnknown)` registration:

```ts
import { handleStudentMedia } from "@/server/handlers/student-message";
// ...
bot.on(["message:voice", "message:video_note"], async (ctx) => {
  const handled = await handleStudentMedia(ctx);
  if (!handled) await handleUnknown(ctx);
});
```

(Keep the order: register the more specific handler before the catch-all. With grammY, multiple `bot.on` registrations all fire, but `handleStudentMedia` returning `true` short-circuits the unknown reply by gating on whether `handleUnknown` runs — so we restructure to a single composite handler.)

Refactor the webhook handler installation:

```ts
function installHandlers() {
  if (installed) return;
  bot.command("start", handleStart);
  bot.on(["message:voice", "message:video_note"], async (ctx) => {
    await handleStudentMedia(ctx);
  });
  bot.on("message", handleUnknown);
  installed = true;
}
```

(grammY runs handlers in registration order and stops on the first that does not call `await next()`. Since we don't call `next` inside the voice handler, `handleUnknown` won't fire when the message is voice/video_note. Good.)

- [ ] **Step 3: Refresh /start greeting for students with real quota**

In `start.ts`, replace the `student` branch's placeholder:

```ts
case "student": {
  const remaining = await (await import("@/server/quota")).getRemainingForToday(existing.id, "Asia/Jerusalem");
  await ctx.reply(ru.greetingStudent(formatDuration(remaining)));
  return;
}
```

(Also add `import { formatDuration } from "@/lib/i18n";` at the top.)

- [ ] **Step 4: Smoke test in Telegram**

- As a `student`, send a voice message ≤ 5min. Expect: `✅ Отправлено! Осталось 4:50…`
- DB: a `messages` row with `direction='in'`, `status='pending'`.
- As a linked `teacher`, expect a TG message: `🔔 Maria прислала голосовое 0:10…`
- Send 6+ minutes of voice — second one should hit "лимит почти исчерпан".
- As a `pending` user, send a voice — expect "Сообщение сохранено. Жди…", DB row `status='orphaned'`, no notifications.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(bot): student voice/video_note ingest, quota, fan-out"
```

> **Phase 5 done.** Show: end-to-end student → teachers TG notification.

---

## Phase 6 — Teacher claim flow (Mini App → TG prompt)

**Goal:** From the inbox, the teacher taps "Ответить" on a pending student message. Backend transitions the message to `claimed`, edits all teachers' notifications to "✓ taken", and DMs the claiming teacher a prompt: `📩 Ответь Maria — голосовое 0:42`. Storing the prompt's `tg_prompt_message_id` is what enables Phase 7's reply routing.

### Task 6.1 — Claim module (TDD on the state machine)

**Files:**
- Create: `src/server/claim.ts`, `tests/claim.test.ts`

- [ ] **Step 1: Failing test for the pure logic**

```ts
// tests/claim.test.ts
import { describe, it, expect } from "vitest";
import { canClaim } from "@/server/claim";

describe("canClaim", () => {
  it("allows pending → claimed", () => {
    expect(canClaim({ status: "pending", claimed_by_teacher_id: null }, 7)).toBe(true);
  });
  it("rejects already claimed by another", () => {
    expect(canClaim({ status: "claimed", claimed_by_teacher_id: 9 }, 7)).toBe(false);
  });
  it("allows the same teacher reclaiming their own", () => {
    expect(canClaim({ status: "claimed", claimed_by_teacher_id: 7 }, 7)).toBe(true);
  });
  it("rejects answered/expired/orphaned", () => {
    expect(canClaim({ status: "answered", claimed_by_teacher_id: null }, 7)).toBe(false);
    expect(canClaim({ status: "expired", claimed_by_teacher_id: null }, 7)).toBe(false);
    expect(canClaim({ status: "orphaned", claimed_by_teacher_id: null }, 7)).toBe(false);
  });
});
```

`pnpm test` → fails.

- [ ] **Step 2: Implement claim module**

```ts
// src/server/claim.ts
import { getBot } from "@/lib/tg";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ru, formatDuration } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "./notifications";

type ClaimableMessage = { status: string; claimed_by_teacher_id: number | null };

export function canClaim(msg: ClaimableMessage, teacherId: number): boolean {
  if (msg.status === "pending") return true;
  if (msg.status === "claimed" && msg.claimed_by_teacher_id === teacherId) return true;
  return false;
}

export type ClaimResult =
  | { ok: true; promptMessageId: number }
  | { ok: false; reason: "not-found" | "not-allowed" | "race" | "fatal" };

export async function claimMessage(messageId: number, teacherId: number): Promise<ClaimResult> {
  const sb = getServiceRoleClient();

  // Atomic transition: only update if still pending OR already by us.
  const { data: updated, error } = await sb
    .from("messages")
    .update({
      status: "claimed",
      claimed_by_teacher_id: teacherId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .or(`status.eq.pending,and(status.eq.claimed,claimed_by_teacher_id.eq.${teacherId})`)
    .select("id, kind, duration, student_id, claimed_by_teacher_id")
    .maybeSingle();
  if (error) return { ok: false, reason: "fatal" };
  if (!updated) return { ok: false, reason: "race" };

  // Look up student name + teacher chat id.
  const [{ data: student }, { data: teacher }] = await Promise.all([
    sb.from("users").select("name").eq("id", updated.student_id).single(),
    sb.from("users").select("tg_chat_id").eq("id", teacherId).single(),
  ]);
  if (!teacher) return { ok: false, reason: "fatal" };

  const studentName = student?.name ?? `student ${updated.student_id}`;
  const dur = formatDuration(updated.duration);
  const promptText = ru.teacherClaimPrompt(studentName, dur);

  const bot = getBot();
  const sent = await bot.api.sendMessage(teacher.tg_chat_id, promptText);

  await sb.from("prompts").insert({
    teacher_id: teacherId,
    student_message_id: messageId,
    tg_chat_id: teacher.tg_chat_id,
    tg_prompt_message_id: sent.message_id,
  });

  // Edit other teachers' notifications: "✓ <name> taken"
  const claimedByName = (await sb.from("users").select("name").eq("id", teacherId).single()).data?.name ?? "Преподаватель";
  await editAllNotificationsForMessage(messageId, ru.teacherNotificationTaken(claimedByName));

  return { ok: true, promptMessageId: sent.message_id };
}

export async function releaseClaim(messageId: number): Promise<void> {
  const sb = getServiceRoleClient();
  await sb
    .from("messages")
    .update({ status: "pending", claimed_by_teacher_id: null, claimed_at: null })
    .eq("id", messageId);
  // Reset notifications back to actionable: needs original student name and duration; cheap re-query.
  const { data: msg } = await sb
    .from("messages")
    .select("kind, duration, student_id")
    .eq("id", messageId)
    .single();
  if (!msg) return;
  const { data: student } = await sb.from("users").select("name").eq("id", msg.student_id).single();
  const studentName = student?.name ?? "ученик";
  const kindLabel = msg.kind === "voice" ? "голосовое" : "круглое видео";
  await editAllNotificationsForMessage(
    messageId,
    ru.teacherNotificationActionable(studentName, kindLabel, formatDuration(msg.duration)),
  );
}
```

- [ ] **Step 3: Tests pass**

`pnpm test` → green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(bot): claim/release state machine"
```

### Task 6.2 — Claim API endpoint

**Files:**
- Create: `src/app/api/claim/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/claim/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { claimMessage } from "@/server/claim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ messageId: z.coerce.number().int() });

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) return new Response("forbidden", { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new Response("bad body", { status: 400 });

  const result = await claimMessage(parsed.data.messageId, user.id);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 409 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(api): POST /api/claim"
```

### Task 6.3 — Inbox API + UI claim button

**Files:**
- Create: `src/app/api/inbox/route.ts`, `src/components/InboxList.tsx`, `src/components/ClaimButton.tsx`, `src/app/inbox/page.tsx`

- [ ] **Step 1: Inbox API**

```ts
// src/app/api/inbox/route.ts
import { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) return new Response("forbidden", { status: 403 });
  const sb = getServiceRoleClient();

  // student ids linked to me (admins see all teachers' linked sets — for PoC, admin sees nothing here unless also linked)
  const { data: links } = await sb.from("student_teachers").select("student_id").eq("teacher_id", user.id);
  const studentIds = (links ?? []).map((l) => l.student_id as number);
  if (!studentIds.length) return Response.json({ messages: [] });

  const { data: messages, error } = await sb
    .from("messages")
    .select("id, student_id, direction, kind, duration, status, claimed_by_teacher_id, created_at, users:student_id(name)")
    .in("student_id", studentIds)
    .eq("direction", "in")
    .in("status", ["pending", "claimed", "answered"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ messages });
}
```

- [ ] **Step 2: ClaimButton**

```tsx
// src/components/ClaimButton.tsx
"use client";
import { useState } from "react";

export function ClaimButton({ jwt, messageId, onClaimed }: { jwt: string; messageId: number; onClaimed: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch("/api/claim", {
            method: "POST",
            headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messageId }),
          });
          if (r.ok) {
            onClaimed();
            const tg = window.Telegram?.WebApp;
            tg?.close?.(); // optional: close the mini-app so the user sees the prompt in the chat
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      Ответить
    </button>
  );
}
```

- [ ] **Step 3: InboxList**

```tsx
// src/components/InboxList.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { ClaimButton } from "./ClaimButton";

type Msg = { id: number; kind: string; duration: number; status: string; created_at: string; students?: { name: string | null } | null; users?: { name: string | null } | null };

export function InboxList({ jwt, myId }: { jwt: string; myId: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);

  const load = useCallback(async () => {
    const r = await fetch("/api/inbox", { headers: { Authorization: `Bearer ${jwt}` } });
    const d = (await r.json()) as { messages: Msg[] };
    setMessages(d.messages);
  }, [jwt]);

  useEffect(() => { void load(); }, [load]);

  return (
    <ul className="divide-y">
      {messages.map((m) => {
        const name = (m.users?.name) ?? "Ученик";
        const min = Math.floor(m.duration / 60);
        const sec = (m.duration % 60).toString().padStart(2, "0");
        return (
          <li key={m.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{name}</div>
              <div className="text-sm text-gray-500">
                {m.kind === "voice" ? "🎙️" : "🟢"} {min}:{sec} • {m.status}
              </div>
            </div>
            {m.status === "pending" && <ClaimButton jwt={jwt} messageId={m.id} onClaimed={load} />}
            {m.status === "claimed" && <span className="text-sm text-amber-600">Жду твой ответ в чате</span>}
            {m.status === "answered" && <span className="text-sm text-green-600">Отвечено</span>}
          </li>
        );
      })}
      {messages.length === 0 && <li className="py-6 text-center text-gray-500">Пока ничего нет.</li>}
    </ul>
  );
}
```

- [ ] **Step 4: Inbox page**

```tsx
// src/app/inbox/page.tsx
"use client";
import { AppShell } from "@/components/AppShell";
import { InboxList } from "@/components/InboxList";

export default function InboxPage() {
  return (
    <AppShell>
      {({ jwt, role, userId }) => {
        if (role !== "teacher" && role !== "admin") return <p>Только для преподавателей.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Входящие</h1>
            <InboxList jwt={jwt} myId={userId} />
          </>
        );
      }}
    </AppShell>
  );
}
```

- [ ] **Step 5: Smoke test**

- As linked teacher in mini-app → see the student's pending message → tap "Ответить" → mini-app closes → in TG, you receive `📩 Ответь Maria…`
- DB: message status `claimed`, `prompts` row exists.
- Reopen mini-app → message shows "Жду твой ответ в чате".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(miniapp+api): inbox + claim flow"
```

> **Phase 6 done.** Show: claim → prompt arrives in TG.

---

## Phase 7 — Teacher reply routing

**Goal:** Teacher swipe-replies to the prompt with a voice or video_note. The webhook routes that media to the student via `file_id`, marks the message `answered`, edits notifications.

### Task 7.1 — Reply routing handler (with TDD on the matcher)

**Files:**
- Create: `src/server/handlers/teacher-reply.ts`, `tests/reply-routing.test.ts`

The "matcher" is the pure function deciding which DB rows the inbound update corresponds to. Test that.

- [ ] **Step 1: Failing test**

```ts
// tests/reply-routing.test.ts
import { describe, it, expect } from "vitest";
import { matchesPrompt } from "@/server/handlers/teacher-reply";

describe("matchesPrompt", () => {
  it("returns true when reply_to_message_id matches the prompt and the sender matches teacher", () => {
    expect(matchesPrompt({ replyToMessageId: 100, teacherTgId: 7 }, { tg_prompt_message_id: 100, teacher_tg_id: 7 })).toBe(true);
  });
  it("returns false when message ids differ", () => {
    expect(matchesPrompt({ replyToMessageId: 100, teacherTgId: 7 }, { tg_prompt_message_id: 999, teacher_tg_id: 7 })).toBe(false);
  });
  it("returns false when teacher mismatch", () => {
    expect(matchesPrompt({ replyToMessageId: 100, teacherTgId: 7 }, { tg_prompt_message_id: 100, teacher_tg_id: 999 })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/handlers/teacher-reply.ts
import type { Context } from "grammy";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { editAllNotificationsForMessage } from "@/server/notifications";

export interface ReplyContext { replyToMessageId: number; teacherTgId: number }
export interface PromptCandidate { tg_prompt_message_id: number; teacher_tg_id: number }

export function matchesPrompt(reply: ReplyContext, prompt: PromptCandidate): boolean {
  return prompt.tg_prompt_message_id === reply.replyToMessageId && prompt.teacher_tg_id === reply.teacherTgId;
}

export async function handleTeacherReply(ctx: Context): Promise<boolean> {
  const msg = ctx.message;
  if (!msg || !ctx.from) return false;
  const replyTo = msg.reply_to_message;
  const voice = msg.voice;
  const note = msg.video_note;
  if (!voice && !note) return false;
  if (!replyTo) {
    await ctx.reply(ru.teacherReplyMissingContext);
    return true;
  }

  const sb = getServiceRoleClient();
  const { data: teacher } = await sb
    .from("users")
    .select("id, role")
    .eq("tg_user_id", ctx.from.id)
    .maybeSingle();
  if (!teacher || (teacher.role !== "teacher" && teacher.role !== "admin")) return false;

  // Find the prompt row matched by (teacher_id, tg_prompt_message_id).
  const { data: prompt } = await sb
    .from("prompts")
    .select("id, student_message_id")
    .eq("teacher_id", teacher.id)
    .eq("tg_prompt_message_id", replyTo.message_id)
    .maybeSingle();
  if (!prompt) {
    await ctx.reply(ru.teacherReplyMissingContext);
    return true;
  }

  // Verify the original message was claimed by this teacher.
  const { data: original } = await sb
    .from("messages")
    .select("id, student_id, claimed_by_teacher_id, status")
    .eq("id", prompt.student_message_id)
    .single();
  if (!original || original.claimed_by_teacher_id !== teacher.id) {
    await ctx.reply(ru.teacherReplyFailed);
    return true;
  }

  const { data: student } = await sb.from("users").select("tg_chat_id").eq("id", original.student_id).single();
  if (!student) {
    await ctx.reply(ru.teacherReplyFailed);
    return true;
  }

  const bot = getBot();
  const kind: "voice" | "video_note" = voice ? "voice" : "video_note";
  const fileId = (voice?.file_id ?? note?.file_id) as string;
  const duration = (voice?.duration ?? note?.duration ?? 0) as number;

  let sentToStudent;
  try {
    if (kind === "voice") {
      sentToStudent = await bot.api.sendVoice(student.tg_chat_id, fileId);
    } else {
      sentToStudent = await bot.api.sendVideoNote(student.tg_chat_id, fileId);
    }
  } catch (e) {
    console.error("relay failed", e);
    await ctx.reply(ru.teacherReplyFailed);
    return true;
  }

  // Insert outbound message row.
  const newFileId = (kind === "voice"
    ? sentToStudent.voice?.file_id
    : sentToStudent.video_note?.file_id) ?? fileId;
  const newFileUniqueId = (kind === "voice"
    ? sentToStudent.voice?.file_unique_id
    : sentToStudent.video_note?.file_unique_id) ?? null;

  const { data: outboundRow } = await sb
    .from("messages")
    .insert({
      student_id: original.student_id,
      direction: "out",
      teacher_id: teacher.id,
      kind,
      file_id: newFileId,
      file_unique_id: newFileUniqueId,
      duration,
      status: "answered",
      reply_to_id: original.id,
      tg_message_id_in_student_chat: sentToStudent.message_id,
    })
    .select("id")
    .single();

  await sb
    .from("messages")
    .update({ status: "answered", answered_at: new Date().toISOString() })
    .eq("id", original.id);

  const teacherName = (await sb.from("users").select("name").eq("id", teacher.id).single()).data?.name ?? "Преподаватель";
  await editAllNotificationsForMessage(original.id, ru.teacherNotificationTaken(teacherName));

  await ctx.reply(ru.teacherReplyDelivered);
  return true;
}
```

- [ ] **Step 3: Wire into webhook**

In `src/app/api/webhook/route.ts`, modify the voice/video_note registration to first try the teacher route:

```ts
import { handleTeacherReply } from "@/server/handlers/teacher-reply";

// inside installHandlers():
bot.on(["message:voice", "message:video_note"], async (ctx) => {
  const teacherHandled = await handleTeacherReply(ctx);
  if (teacherHandled) return;
  await handleStudentMedia(ctx);
});
```

- [ ] **Step 4: Smoke test**

End-to-end:
1. Student sends voice (Phase 5)
2. Teacher mini-app: claim (Phase 6) → TG prompt arrives
3. Teacher swipe-replies to that prompt with their own voice
4. Student receives the teacher's voice in their chat
5. DB: original message `status='answered'`; outbound row with `direction='out'`, `reply_to_id=<original>`
6. All other teachers see notification edited to "✓ X handled"

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(bot): teacher reply routing via reply_to_message"
```

> **Phase 7 done.** Show: full round-trip — student voice → teacher claim → teacher TG voice reply → student receives it.

---

## Phase 8 — Mini app polish: thread view, realtime, media playback

**Goal:** Each teacher can open `/students/[id]` to see the chronological thread and play any voice/video. Inbox updates live via Supabase Realtime when new messages arrive or claim status changes.

### Task 8.1 — Media redirect endpoint

**Files:**
- Create: `src/app/api/media/[messageId]/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/media/[messageId]/route.ts
//
// PoC-SHORTCUT: Returns a 302 to Telegram's CDN. The redirect URL contains the bot token.
// This is acceptable for trusted teachers + easy token rotation in BotFather. Replace before public release.

import { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) return new Response("forbidden", { status: 403 });

  const messageId = Number(params.messageId);
  if (!Number.isInteger(messageId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  const { data: msg } = await sb
    .from("messages")
    .select("id, student_id, file_id")
    .eq("id", messageId)
    .single();
  if (!msg) return new Response("not found", { status: 404 });

  // Authorization: this teacher must be linked to this student (or admin).
  if (user.role !== "admin") {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", msg.student_id)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403 });
  }

  const bot = getBot();
  const file = await bot.api.getFile(msg.file_id);
  if (!file.file_path) return new Response("no path", { status: 502 });

  const url = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  return Response.redirect(url, 302);
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(api): media redirect (PoC shortcut)"
```

### Task 8.2 — Thread API + view

**Files:**
- Create: `src/app/api/threads/[studentId]/route.ts`, `src/app/students/[id]/page.tsx`, `src/components/ThreadView.tsx`, `src/components/MessageBubble.tsx`

- [ ] **Step 1: Thread API**

```ts
// src/app/api/threads/[studentId]/route.ts
import { NextRequest } from "next/server";
import { authFromRequest, requireRole } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { studentId: string } }) {
  const user = await authFromRequest(req);
  if (!requireRole(user, ["teacher", "admin"])) return new Response("forbidden", { status: 403 });
  const studentId = Number(params.studentId);
  if (!Number.isInteger(studentId)) return new Response("bad id", { status: 400 });

  const sb = getServiceRoleClient();
  if (user.role !== "admin") {
    const { data: link } = await sb
      .from("student_teachers")
      .select("teacher_id")
      .eq("student_id", studentId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!link) return new Response("forbidden", { status: 403 });
  }

  const { data, error } = await sb
    .from("messages")
    .select("id, direction, kind, duration, status, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ messages: data });
}
```

- [ ] **Step 2: MessageBubble**

```tsx
// src/components/MessageBubble.tsx
"use client";
type Msg = { id: number; direction: "in" | "out"; kind: "voice" | "video_note"; duration: number; created_at: string };

export function MessageBubble({ msg, jwt }: { msg: Msg; jwt: string }) {
  const min = Math.floor(msg.duration / 60);
  const sec = (msg.duration % 60).toString().padStart(2, "0");
  const align = msg.direction === "in" ? "justify-start" : "justify-end";
  const bg = msg.direction === "in" ? "bg-gray-100" : "bg-blue-50";

  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[80%] rounded-2xl ${bg} p-3 m-1`}>
        <div className="text-xs text-gray-500 mb-1">{msg.direction === "in" ? "Ученик" : "Преподаватель"} • {min}:{sec}</div>
        {msg.kind === "voice" ? (
          <audio controls preload="none" src={`/api/media/${msg.id}`}>
            <source src={`/api/media/${msg.id}`} />
          </audio>
        ) : (
          <video controls preload="none" playsInline className="rounded-xl max-w-full" src={`/api/media/${msg.id}`} />
        )}
      </div>
    </div>
  );
}
```

⚠ Note: `<audio src="/api/media/x">` requires the browser to send the JWT, which a plain `src` cannot do. Workaround for the PoC: have the redirect endpoint accept the JWT via a `?token=` query param too. Update `media/[messageId]/route.ts`:

```ts
const url = new URL(req.url);
const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
// then validate manually if no Authorization header was set:
if (!token) return new Response("unauthorized", { status: 401 });
// ... reuse jwtVerify directly here
```

For brevity, refactor `authFromRequest` to also look at `?token=`:

```ts
// src/lib/auth-server.ts
const auth = req.headers.get("authorization") ?? "";
const m = /^Bearer (.+)$/.exec(auth);
const url = new URL(req.url);
const token = m?.[1] ?? url.searchParams.get("token") ?? "";
if (!token) return null;
// rest unchanged
```

Then in `MessageBubble`, append `?token=${jwt}` to the src.

- [ ] **Step 3: ThreadView**

```tsx
// src/components/ThreadView.tsx
"use client";
import { useEffect, useState } from "react";
import { MessageBubble } from "./MessageBubble";

type Msg = { id: number; direction: "in" | "out"; kind: "voice" | "video_note"; duration: number; created_at: string };

export function ThreadView({ jwt, studentId }: { jwt: string; studentId: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  useEffect(() => {
    void fetch(`/api/threads/${studentId}`, { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json())
      .then((d: { messages: Msg[] }) => setMessages(d.messages));
  }, [jwt, studentId]);
  return (
    <div className="flex flex-col">
      {messages.map((m) => <MessageBubble key={m.id} msg={m} jwt={jwt} />)}
      {messages.length === 0 && <p className="text-center text-gray-500 py-6">Сообщений ещё нет.</p>}
    </div>
  );
}
```

- [ ] **Step 4: Page**

```tsx
// src/app/students/[id]/page.tsx
"use client";
import { AppShell } from "@/components/AppShell";
import { ThreadView } from "@/components/ThreadView";

export default function StudentPage({ params }: { params: { id: string } }) {
  const studentId = Number(params.id);
  return (
    <AppShell>
      {({ jwt, role }) => {
        if (role !== "teacher" && role !== "admin") return <p>Только для преподавателей.</p>;
        return (
          <>
            <h1 className="text-xl font-semibold mb-4">Диалог</h1>
            <ThreadView jwt={jwt} studentId={studentId} />
          </>
        );
      }}
    </AppShell>
  );
}
```

- [ ] **Step 5: Link to thread from inbox**

In `InboxList.tsx`, wrap each row's name with `<Link href={`/students/${studentId}`}>` (need to include `student_id` in the inbox row payload — already there). Quick edit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(miniapp): per-student thread view with media playback"
```

### Task 8.3 — Realtime inbox updates

**Files:**
- Modify: `src/components/InboxList.tsx`
- Create: `src/hooks/useRealtimeMessages.ts`

- [ ] **Step 1: Hook**

```ts
// src/hooks/useRealtimeMessages.ts
"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

export function useRealtimeMessages(jwt: string, onChange: () => void) {
  useEffect(() => {
    const sb = createBrowserClient(jwt);
    const channel = sb
      .channel("messages-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => onChange())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, () => onChange())
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [jwt, onChange]);
}
```

(RLS scopes the events the teacher actually receives.)

- [ ] **Step 2: Wire into InboxList**

```tsx
// in InboxList.tsx, after the load callback:
useRealtimeMessages(jwt, load);
```

- [ ] **Step 3: Smoke test**

Open inbox in two browsers (or a 2nd account) → in account A claim a message → account B's inbox row updates live to "✓ taken".

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(miniapp): supabase realtime inbox updates"
```

> **Phase 8 done.** Show: thread view + live inbox updates.

---

## Phase 9 — Cron claim expiry

**Goal:** Every minute, claims older than `CLAIM_TTL_MINUTES` revert to `pending`, teacher notifications are reset to actionable, and the prompt message is amended to "Время истекло".

### Task 9.1 — Expiry endpoint

**Files:**
- Create: `src/app/api/cron/expire-claims/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/cron/expire-claims/route.ts
import { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { releaseClaim } from "@/server/claim";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) return new Response("forbidden", { status: 403 });

  const sb = getServiceRoleClient();
  const cutoff = new Date(Date.now() - serverEnv.CLAIM_TTL_MINUTES * 60_000).toISOString();

  const { data: stale } = await sb
    .from("messages")
    .select("id, claimed_by_teacher_id")
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);

  if (!stale?.length) return Response.json({ released: 0 });

  let released = 0;
  for (const row of stale) {
    await releaseClaim(row.id);
    // Edit prompt message to indicate expiry.
    const { data: prompt } = await sb
      .from("prompts")
      .select("tg_chat_id, tg_prompt_message_id")
      .eq("student_message_id", row.id)
      .eq("teacher_id", row.claimed_by_teacher_id!)
      .maybeSingle();
    if (prompt) {
      try {
        await getBot().api.editMessageText(prompt.tg_chat_id, prompt.tg_prompt_message_id, ru.teacherNotificationExpired);
      } catch (e) {
        console.warn(e);
      }
    }
    released++;
  }
  return Response.json({ released });
}
```

- [ ] **Step 2: Vercel cron config**

Create `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/expire-claims", "schedule": "* * * * *" }
  ]
}
```

⚠ Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` only when `CRON_SECRET` is configured in Vercel project settings as a Vercel Cron secret. Make sure the env var name in Vercel is `CRON_SECRET` and matches our env validation.

- [ ] **Step 3: Smoke test**

Set `CLAIM_TTL_MINUTES=1` in Vercel env temporarily. Claim a message → wait ~2 min → see prompt edit + inbox revert. Restore to 15.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cron): claim expiry every minute"
```

> **Phase 9 done.** Show: claim auto-expires after TTL.

---

## Phase 10 — README and final polish

### Task 10.1 — README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write**

```markdown
# Hebtutbot — Hebrew Tutoring Bot (PoC)

Voice/video-note Telegram tutoring loop for Russian-speaking students learning Hebrew. Students send media in TG; teachers triage in a Mini App and reply via TG swipe-replies. Telegram is the media CDN — no bytes are stored on our servers.

## Stack

- Next.js 14 (App Router), TypeScript strict
- grammY (Telegram bot, webhook mode)
- Supabase (Postgres + Realtime + RLS)
- Tailwind CSS
- Vercel (hosting + Cron)
- Vitest

## Local dev

1. `cp .env.example .env.local` and fill it in:
   - Telegram bot token from @BotFather
   - Supabase project URL, anon key, service role key, JWT secret
   - `BOOTSTRAP_ADMIN_TG_USER_ID` = your TG numeric id (use @userinfobot)
   - `TELEGRAM_WEBHOOK_SECRET` = `openssl rand -hex 32`
   - `CRON_SECRET` = `openssl rand -hex 32`
2. `pnpm install`
3. Apply DB migrations: `supabase link --project-ref <ref>` then `supabase db push`
4. Generate types: `pnpm db:types`
5. `pnpm dev`
6. Use `ngrok http 3000` (or Vercel preview deploy) for the webhook URL
7. Set the webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H 'Content-Type: application/json' \
     -d '{"url":"<PUBLIC_URL>/api/webhook","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
   ```
8. In @BotFather, `/setmenubutton` → URL `<PUBLIC_URL>/`
9. `/start` the bot to register, then promote yourself in the admin tab (or trust the bootstrap)

## Tests

```bash
pnpm test
```

## Deploy

Push to `main` — Vercel auto-deploys. Don't forget to update the webhook URL.

## Architecture quirks (read once)

- All users are in one `users` table with a role enum. Self-registration creates `pending` users; admins promote.
- Claim flow: tap "Reply" in mini-app → backend DMs you a prompt in TG → swipe-reply with voice → bot relays via `file_id`.
- We never download media. The mini-app `<audio>`/`<video>` tags hit `/api/media/[id]` which 302s to Telegram (PoC shortcut: redirect URL exposes the bot token; rotate in BotFather to invalidate).
- Browser auth: `initData` → server validates HMAC → mints a Supabase JWT (`sub` = TG user id) → browser uses it for both API calls and Realtime under RLS.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

### Task 10.2 — End-to-end manual run-through

- [ ] **Step 1: Walk the demo**

With three TG accounts (admin, student, teacher):

1. All three send `/start` → 3 pending rows.
2. Admin opens mini-app → admin tab → promotes one to `student`, one to `teacher`. Links them.
3. Student sends a voice → teacher gets a 🔔 notification.
4. Teacher opens mini-app → inbox shows pending → taps "Ответить" → mini-app closes, prompt arrives in TG.
5. Teacher swipe-replies with voice → student hears it.
6. Refresh inbox → message marked answered.
7. Set `CLAIM_TTL_MINUTES=1`, claim & ignore → see expiry & re-actionable notification.

- [ ] **Step 2: Commit any remaining tweaks**

```bash
git add -A
git commit -m "chore: final polish"
```

> **Plan complete.** Ship it phase by phase, demo each one, course-correct as we go.

---

## Self-review notes

- **Spec coverage:** every "Critical implementation detail" in the spec maps to a task — initData (Phase 2), duration-before-download (Phase 5: `duration` is read straight from `msg.voice/.video_note`), daily quota (Phase 5), accepted message types (Phase 5: only `voice` + `video_note` go to `handleStudentMedia`; everything else falls through to `handleUnknown`), DB-vs-TG message_id distinction (schema split: `messages.id` separate from `tg_message_id_in_*`), `file_id` reuse (Phase 7 + 8), teacher reply routing (Phase 7), notification fan-out + edits (Phase 5/6/7), realtime + RLS (Phase 1 + Phase 8), claim expiry (Phase 9). Russian copy centralized (Phase 3 Task 3.2). `pending`-user orphaned storage (Phase 5 Task 5.3).
- **Placeholder scan:** none. Every code block is either complete or marked as a deliberate PoC shortcut.
- **Type consistency:** `claimMessage` / `releaseClaim` types align with `canClaim` test signature. `handleStudentMedia` returns `boolean`. `editAllNotificationsForMessage` signature matches all call sites.
- **Single ambiguity worth flagging up front:** mini-app authentication token also used by `<audio src>`/`<video src>` requires `?token=` query support in `/api/media`. Documented in Phase 8 Task 8.2 Step 2 with the exact refactor.
