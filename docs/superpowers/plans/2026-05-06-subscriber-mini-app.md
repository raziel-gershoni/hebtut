# Subscriber Mini App: home-screen summary, billing, menu

**Goal:** Implement the spec at https://docs.google.com/document/d/1eKf0xxZh5tOyI2XUmYWHX9292N4FnEeCtq9jueVYcDs/ — a status-driven home-screen card for paying subscribers, the access-gate when payment lapses, Telegram Stars billing with a 3-day trial, and the menu items (support / referrals / freeze / response-window).

**Architecture:** Layered in three waves. Wave 1 ships the card + schema with manually-set subscription status — visible UX immediately, no billing needed. Wave 2 wires real Telegram Stars billing through a `BillingProvider` interface so we can swap providers later. Wave 3 adds the menu sub-features.

**Tech Stack:** Same as the rest of `hebtutbot` — Next.js 14 App Router, TypeScript strict, Tailwind, Supabase (Postgres + service-role key from API routes), grammY bot, Telegram Mini App.

---

## Locked-in choices

- **Trial**: 3 days from `/start` (first signup or first interaction with billing-aware code, whichever comes first).
- **Subscription**: monthly, Telegram Stars.
- **Payment provider**: Telegram Stars *behind a `BillingProvider` interface*. Stripe / TG Payments swap-in is one new file.
- **Response-time window**: holds only **teacher-initiated** messages until the window opens. Replies during an active claim deliver immediately (same conversational expectation as today).
- **Daily quota**: still 5 minutes for trial + active. Frozen / expired / payment-failed users can't send (server rejects).

## Open assumptions (call out, fix later if wrong)

- A **practice day** counts toward the streak when `quota_usage.seconds_used >= 30`. (30s ≈ "made an effort" without false positives from accidental hot-mics.) Freeze days are **neutral** — they don't break the streak, but don't extend it either.
- **Recurring billing**: Telegram Stars is one-shot — no native auto-renew. We send an invoice link 24h before the period ends + on the day of expiry; if the user doesn't pay, status flips to `trial_expired` (first time) or `payment_failed` (subsequent). No card-on-file, no auto-charge. This is the realistic limitation of Stars; if you later want true recurring, swap in TG Payments via `provider_token` or Stripe.
- **Referrals**: each user gets a personal `/start <ref_token>` link. When a new student signs up via that link AND completes their first paid period, both the referrer and referee get a +30 days credit applied to their next renewal. Credit caps at 90 days for the referrer to avoid abuse.
- **Freeze**: limited to 3 days/calendar-month (resets on day-of-month boundary, like the spec says "до 3 дней в месяц"). Cannot stack — 3 separate single-day freezes consume the budget the same as one 3-day block. Must be activated at least 1 day in advance ("со следующего дня").
- **URM section** in the spec is empty → out of scope this round. Easy to add later as scheduled outbound messages once response-window infra exists.
- **Payment-locked copy** is sent on the FIRST inbound voice/video-note after lock; subsequent locked messages within 24h are silent server-side rejections (don't spam the chat).

If any of these are wrong — flag and I'll adjust.

---

## Wave 1 — Subscriber summary card + access gate (no real billing yet)

User-visible win without integrating Stars. Admin manually sets `subscription.status` to demo every variant.

### Task 1: Schema — `subscriptions` table

**Files:**
- Create: `supabase/migrations/20260506000001_subscriptions.sql`
- Modify: `src/types/database.ts` (add `subscriptions` row/insert types)

**Schema design:**

```sql
create type public.subscription_status as enum (
  'trial',          -- in active trial, before trial_ends_at
  'active',         -- paid, before current_period_ends_at
  'trial_expired',  -- trial ran out, never paid
  'lapsed',         -- previously paid, current_period_ends_at passed without renewal
  'payment_failed', -- attempted payment failed (provider returned an error)
  'frozen'          -- subscription paused via the freeze feature
);

create table public.subscriptions (
  user_id                   bigint primary key references public.users(id) on delete cascade,
  status                    public.subscription_status not null default 'trial',
  trial_started_at          timestamptz not null default now(),
  trial_ends_at             timestamptz not null default (now() + interval '3 days'),
  current_period_starts_at  timestamptz,
  current_period_ends_at    timestamptz,
  -- Snapshots so we can show "продление через 2 дня" even if status briefly desyncs.
  next_renewal_at           timestamptz,
  freeze_days_used_in_period int not null default 0,
  freeze_period_started_at  timestamptz, -- when the rolling 3-day budget last reset
  response_window_start     time, -- nullable; null = no window (always allow)
  response_window_end       time, -- nullable; ditto
  response_window_tz        text not null default 'Asia/Jerusalem',
  -- Billing provider linkage — opaque IDs, populated by the provider adapter.
  provider                  text, -- 'tg_stars' | 'tg_payments' | 'stripe' | null
  provider_subscription_id  text,
  provider_customer_id      text,
  -- Referral linkage — populated at /start with ref_token.
  referred_by_user_id       bigint references public.users(id) on delete set null,
  -- Last-shown motivation key, used to enforce no-repeat-from-yesterday.
  last_motivation_key       text,
  last_motivation_shown_on  date,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_trial_ends_idx on public.subscriptions (trial_ends_at)
  where status = 'trial';
create index subscriptions_period_ends_idx on public.subscriptions (current_period_ends_at)
  where status in ('active', 'frozen');

-- Backfill existing users: everyone gets a FRESH 3-day trial from rollout, as
-- if they had just joined. Rationale: this feature is the first time the
-- trial / paywall concept is visible to users, so anchoring the clock to
-- their original signup date would silently lock out long-time users on day
-- one. Anchoring to migration-time gives them the same onboarding the spec
-- describes for new signups.
insert into public.subscriptions (user_id, status, trial_started_at, trial_ends_at)
select
  u.id,
  'trial'::public.subscription_status,
  now(),
  now() + interval '3 days'
from public.users u
where u.role = 'student'
on conflict (user_id) do nothing;

alter table public.subscriptions enable row level security;
```

**Steps:**
- [ ] Write the migration above.
- [ ] Add the `subscriptions` table types to `src/types/database.ts` mirroring the SQL.
- [ ] Add a `SubscriptionStatus` union type next to `UserStatus`.
- [ ] Run `pnpm typecheck` — should still pass.
- [ ] Commit: `feat(schema): subscriptions table with trial/active/expired/frozen states`

### Task 2: Status engine — `src/server/subscriptions.ts` (new)

**Files:**
- Create: `src/server/subscriptions.ts`

**Public API:**

```ts
export type DerivedStatus =
  | { kind: 'trial';            daysLeft: number; endsAt: Date }
  | { kind: 'trial_ending';     daysLeft: 1 | 0;  endsAt: Date } // 1 day or "today"
  | { kind: 'active';           renewsInDays: number; endsAt: Date }
  | { kind: 'renewing_soon';    renewsInDays: 0|1|2; endsAt: Date }
  | { kind: 'trial_expired' }
  | { kind: 'lapsed' }
  | { kind: 'payment_failed' }
  | { kind: 'frozen';           untilDate: Date };

/** True for trial + active + frozen (i.e. any status where we accept media). */
export function canSendMedia(s: DerivedStatus): boolean;

/**
 * Wraps a row read + classification. Pure once the row is fetched, so callers
 * can compose without re-querying. Renews `freeze_period_started_at` when the
 * calendar month rolls over (lazy, no cron needed).
 */
export async function getStatus(userId: number): Promise<{
  raw: SubscriptionRow;
  derived: DerivedStatus;
}>;

/**
 * Pure function over a row + clock — easy to unit-test status transitions
 * without hitting the database.
 */
export function deriveStatus(row: SubscriptionRow, now: Date): DerivedStatus;
```

**Steps:**
- [ ] Write `deriveStatus` first (pure). Cover transitions:
  - `trial` + now < trial_ends_at - 1d → `trial { daysLeft }`
  - `trial` + now ≥ trial_ends_at - 1d → `trial_ending { daysLeft: 1|0 }`
  - `trial` + now ≥ trial_ends_at → caller should flip the row to `trial_expired` (we don't write here)
  - `active` + now ≥ current_period_ends_at - 2d → `renewing_soon`
  - `frozen` + now ≥ frozen_until → caller should flip back to `active` and extend `current_period_ends_at` by the freeze duration.
- [ ] Write 8-10 unit tests in `tests/subscriptions.test.ts` covering each transition + boundary.
- [ ] Write `getStatus` (impure) — wraps the row fetch, calls `deriveStatus`, optionally writes back lazy state changes (trial→trial_expired, frozen→active).
- [ ] `pnpm test` — all tests including new ones pass.
- [ ] Commit: `feat(server): subscription status engine + tests`

### Task 3: API endpoint — `/api/student/summary`

**Files:**
- Create: `src/app/api/student/summary/route.ts`
- Optional rename: `/api/student/quota` → keep as-is; the new endpoint is a superset, but nothing's wrong with both existing during the transition. Delete `/api/student/quota` after Task 5 lands.

**Response shape:**

```ts
{
  name: string,                    // users.name, displayed in the header
  status: DerivedStatus,           // from getStatus()
  practice: {
    used_seconds: number,
    remaining_seconds: number,
    daily_quota_seconds: number,
    reset_at_iso: string,          // already implemented in /api/student/quota
  },
  streak_days: number,             // computed from quota_usage (Task 6)
  motivation: { key: string; text: string }, // chosen + persisted (Task 6)
  // Empty string / missing for now — will be a metric like "+12% speed" later.
  progress_metric: null,
}
```

**Steps:**
- [ ] Create the route. Auth: `hasRole(user, ["student"])` (same gate as `/api/student/quota`).
- [ ] Wire `getStatus(user.id)` into the response.
- [ ] Wire `getUsedForToday` / `getRemainingForToday` (existing in `src/server/quota.ts`).
- [ ] Stub `streak_days = 0` and `motivation = { key: 'noop', text: '' }` — fills come in Task 6.
- [ ] `pnpm typecheck && pnpm build`.
- [ ] Commit: `feat(api): /api/student/summary returns status + practice + stubs`

### Task 4: New `SubscriberSummary` card

**Files:**
- Create: `src/components/SubscriberSummary.tsx`
- Modify: `src/app/page.tsx` — replace `<StudentQuotaCard />` with `<SubscriberSummary />`.
- Delete (after Task 5): `src/components/StudentQuotaCard.tsx`, `src/app/api/student/quota/route.ts`.

**Layout:**

```
┌───────────────────────────────────────────┐
│ Пробный период • 1 день остался           │ ← top strip (status-driven)
│                                           │
│ Samuel                                    │ ← name
│ Осталось 4 минуты практики сегодня         │ ← main line
│ ████████░░░░░░░░░░  44%                   │ ← progress bar (used/quota)
│                                           │
│ 🔥 2 дня подряд                            │ ← streak chip (only if >0)
│ Отлично, ещё одно голосовое — и день закрыт│ ← motivation line
│                                           │
│ [   Оплатить — 30 дней   ]                │ ← CTA when status ∈ trial_ending|expired|payment_failed
└───────────────────────────────────────────┘
```

**Steps:**
- [ ] Build a `<StatusStrip>` subcomponent that maps `DerivedStatus` → top strip text + colour:
  - `trial` → tg-text-hint, "Пробный период • N дней осталось"
  - `trial_ending` → amber, "Пробный период заканчивается завтра" / "сегодня"
  - `active` → no strip (matches spec — strip is only "—" for active steady-state)
  - `renewing_soon` → tg-text-hint, "Продление через X дней"
  - `trial_expired` → red, "Пробный период закончился"
  - `lapsed` → red, "Доступ закрыт"
  - `payment_failed` → red, "Не удалось списать оплату"
  - `frozen` → tg-text-hint, "Заморозка до DD.MM"
- [ ] Build a `<MainLine>` subcomponent — same logic as `StudentQuotaCard` but routes through three buckets (0 / 1-4 / 5 minutes). Copy lifted verbatim from the spec's "Основная строка" table.
- [ ] Build a `<MotivationLine>` subcomponent — renders `motivation.text` (empty hides it).
- [ ] Build a `<StreakChip>` — only renders when `streak_days > 0`. Format `🔥 N дней подряд` (Russian pluralization: 1=день, 2-4=дня, 5+=дней).
- [ ] Build a `<PayCTA>` — visible when `status.kind ∈ {trial_ending, trial_expired, lapsed, payment_failed}`. For Wave 1: button is decorative or routes to a placeholder `/pay` page that says "soon". Wave 2 wires the real flow.
- [ ] Refresh on `visibilitychange` like `StudentQuotaCard` does today.
- [ ] `pnpm dev` — render every status by manually flipping `subscription.status` in Supabase. Confirm each variant looks right.
- [ ] Commit: `feat(ui): SubscriberSummary replaces StudentQuotaCard with status-driven header`

### Task 5: Access gate — student-message handler rejects locked users

**Files:**
- Modify: `src/server/handlers/student-message.ts`
- Modify: `src/lib/i18n.ts` — add the locked-template strings.

**Logic:**
- Read `subscription` row at the top of `handleStudentMedia` (alongside the existing user lookup).
- If `derived.kind ∈ {trial_expired, lapsed, payment_failed}`:
  - Check `subscriptions.last_lockout_replied_at` — if within last 24h, silently reject (don't insert message, don't reply).
  - Otherwise, reply with `ru.lockedTemplate` + an inline keyboard button "Оплатить" linking to `https://t.me/<bot>?startapp=pay` (Telegram Mini App deep-link).
  - Update `last_lockout_replied_at = now()`.
  - Return early — never call `decideQuota` / `commitUsageSplit`.
- If `derived.kind === 'frozen'`: same as locked, but copy is "Заморозка активна до DD.MM" (no payment CTA).

**Schema addition (combine into Task 1's migration if not yet shipped, otherwise new migration):**

```sql
alter table public.subscriptions add column last_lockout_replied_at timestamptz;
```

**i18n:**

```ts
lockedTemplateText:
  "Сейчас сообщение не дошло до тренера.\n" +
  "Доступ к практике закончился, поэтому новые сообщения не передаются.\n\n" +
  "Чтобы продолжить разговор, нужно получить доступ.",
lockedTemplateButton: "Оплатить",
frozenNotice: (until: string) => `Заморозка активна до ${until}. Сообщения снова начнут приходить тренеру после неё.`,
```

**Steps:**
- [ ] Write the migration column addition (or fold into Task 1).
- [ ] Branch in `handleStudentMedia` — read subscription, check derived, reply or pass through.
- [ ] Ship the inline keyboard with grammY (`{ reply_markup: { inline_keyboard: [[{ text, url }]] } }`).
- [ ] Manual smoke: flip a test user to `trial_expired`, send a voice → see the locked reply once, send another within 24h → silent.
- [ ] Add a unit test for the "silent within 24h" rule.
- [ ] Commit: `feat(quota): access gate rejects locked users with one-time payment CTA`

**At the end of Wave 1 you have:** A working subscriber summary card, status-driven copy, and a payment CTA that students see — but the CTA goes to a placeholder. All other parts of the bot continue to work for active/trial users. Admins can manually set status for QA.

---

## Wave 2 — Telegram Stars billing

Wires the actual money. Most of the change is in one new server file (`billing/tg-stars.ts`) and one new webhook route. The card and access gate from Wave 1 don't need to change — they read `subscriptions.status`, which billing now writes.

### Task 6: BillingProvider interface

**Files:**
- Create: `src/server/billing/types.ts` — the abstract interface every provider must implement.

```ts
export interface CheckoutLink {
  url: string;             // tg://payments/<...> or https://...
  invoice_payload: string; // stable ID we attach for webhook reconciliation
}

export interface BillingProvider {
  /** Create a one-time invoice for a 30-day period extension. */
  createPeriodInvoice(input: {
    userId: number;
    plan: 'monthly';
    /** Bonus days from a referral credit, applied once redemption succeeds. */
    bonusDays?: number;
  }): Promise<CheckoutLink>;

  /**
   * Provider-specific webhook verifier + payload reader. Returns a normalized
   * event the rest of the system can react to. Never throws — returns null
   * if the request isn't from this provider.
   */
  verifyAndParseWebhook(req: Request): Promise<
    | { kind: 'payment_succeeded'; userId: number; periodDays: number; providerPaymentId: string }
    | { kind: 'payment_failed';    userId: number; reason: string }
    | null
  >;
}
```

**Steps:**
- [ ] Write the file above.
- [ ] Commit: `feat(billing): BillingProvider interface — provider-agnostic billing seam`

### Task 7: Telegram Stars adapter

**Files:**
- Create: `src/server/billing/tg-stars.ts`
- Create: `src/app/api/billing/invoice/route.ts` — POST { userId } → { url } via `BillingProvider.createPeriodInvoice`.
- Create: `src/app/api/billing/webhook/route.ts` — receives Telegram bot updates with `pre_checkout_query` / `successful_payment`. Or, if cleaner, fold into the existing `/api/webhook` route.

**Telegram Stars specifics:**
- Invoices for digital goods can be paid in Stars via `sendInvoice` with `currency: 'XTR'` and `prices: [{ label, amount: <stars> }]`.
- `provider_token` is empty for Stars.
- The bot must answer `pre_checkout_query` within 10s with `ok: true`.
- After payment, the user receives a `successful_payment` field on the message; that's our webhook event.
- `invoice_payload` is our reconciliation key — encode `{ userId, planId, nonce }` as base64.

**Steps:**
- [ ] Implement `createPeriodInvoice` — calls `bot.api.createInvoiceLink({ title: 'Подписка на месяц', description: '30 дней практики с тренером', payload: <encoded>, currency: 'XTR', prices: [{ label: '30 дней', amount: <stars> }] })`. Return `{ url, invoice_payload }`.
- [ ] Wire the existing `/api/webhook` to dispatch `pre_checkout_query` (always answer ok) and `successful_payment` (decode payload → look up subscription → flip to `active`, extend `current_period_ends_at` by `30 + bonusDays`, clear `last_lockout_replied_at`).
- [ ] On `successful_payment`, also send the user `ru.paymentSucceeded` ("Спасибо! Подписка активна до DD.MM.") — single chat message, not a notification spam.
- [ ] If a referral was attached (`subscriptions.referred_by_user_id IS NOT NULL` AND this is the user's FIRST `successful_payment`):
  - Add 30 days to the referrer's `current_period_ends_at` (capped at +90 days).
  - Add 30 days to this user's `current_period_ends_at` (no cap — already paying for 30, so net 60).
  - DM both with `ru.referralCreditApplied`.
- [ ] Front-end: the `<PayCTA>` button calls `/api/billing/invoice`, gets `{ url }`, then opens it via `window.Telegram.WebApp.openInvoice(url, callback)` — Mini App native flow, no leaving Telegram.
- [ ] Manual test on TG: small invoice (e.g. 1 star) end-to-end. Confirm subscription row updates.
- [ ] Commit: `feat(billing): Telegram Stars adapter + invoice route + webhook reconciliation`

### Task 8: Renewal reminders + lapse cron

**Files:**
- Modify: `src/app/api/cron/expire-claims/route.ts` — extend to also process subscription transitions, OR
- Create: `src/app/api/cron/subscriptions/route.ts` — separate route, separate QStash schedule.

Recommend a separate cron — claim expiry runs every 5 min (cheap), subscription tick every 1h is enough.

**Logic each tick:**
1. Find users where `status = 'active'` AND `current_period_ends_at < now()`. Flip to `lapsed`.
2. Find users where `status = 'trial'` AND `trial_ends_at < now()`. Flip to `trial_expired`.
3. Find users where `status = 'frozen'` AND `frozen_until < now()`. Flip to `active`, extend `current_period_ends_at` by the freeze duration.
4. Find users 24h before period end (active or trial). Send a single reminder DM with the invoice link.
5. Find users at period end day-of (active or trial). Send a final reminder DM.

To avoid double-sending reminders, add `subscriptions.last_renewal_reminder_sent_at` and check `> last_period_started_at`.

**Steps:**
- [ ] Write the cron route handler.
- [ ] Add the `last_renewal_reminder_sent_at` column.
- [ ] Add a new QStash schedule via `scripts/sync-qstash.mjs` — extend the script to register a SECOND schedule (the path-based matcher from `e18b371` already supports multiple known paths).
- [ ] Test by setting a user's `trial_ends_at` to `now() - interval '1 minute'` and triggering the cron manually — confirm flip + DM.
- [ ] Commit: `feat(billing): hourly subscription cron — flip lapsed/trial_expired, send reminders`

**At the end of Wave 2 you have:** Real money flowing. Stars in → 30 days extended. Trial expires → user sees the locked card + can pay from inside the Mini App. Reminders go out 24h + day-of. Lapsed users hit the locked-template flow already built in Wave 1.

---

## Wave 3 — Menu + sub-features

Each independent. Build in order of business value, ship one at a time.

### Task 9: Menu shell

**Files:**
- Create: `src/components/MiniAppMenu.tsx` — renders four links: Поддержка / Рефералы / Заморозка / Время ответа.
- Modify: `src/app/page.tsx` — render `<MiniAppMenu />` below `<SubscriberSummary />` for students.

**Steps:**
- [ ] Build the menu (four `<Link>`-style cards, matching the existing `<ActionCard>` aesthetic in `page.tsx`).
- [ ] Each link routes to a placeholder route — content added in Tasks 10-13.
- [ ] Commit: `feat(ui): subscriber menu shell with 4 placeholder routes`

### Task 10: Support — deep link to existing feedback

**Files:**
- Modify: `src/components/MiniAppMenu.tsx` — Поддержка card routes to `/feedback` (already implemented).

**Steps:**
- [ ] Wire the link.
- [ ] Update copy: subtitle "Связаться с админом или ответить на видео-просьбу".
- [ ] Per the spec: when a non-paying user receives a "why didn't you pay" video from the bot, that video's reply chat is the same `/feedback` thread. No new infra. Just add a row in `INFRA.md` documenting the entry point.
- [ ] Commit: `feat(ui): support menu item routes to existing /feedback flow`

### Task 11: Referrals

**Files:**
- Create: `supabase/migrations/<date>_referral_tokens.sql`:
  ```sql
  alter table public.users add column referral_token text unique;
  -- Backfill: random 12-char tokens for existing students.
  update public.users set referral_token = encode(gen_random_bytes(9), 'base64')
    where role = 'student' and referral_token is null;
  ```
- Modify: `src/server/handlers/start.ts` — parse `start <ref_token>` payload alongside the existing teacher-invite parsing. If valid + this is a NEW signup, populate `subscriptions.referred_by_user_id`.
- Create: `src/app/student/referrals/page.tsx` — shows the user's link, share-button (`navigator.share` or copy-to-clipboard), and a counter "X друзей пришли по твоей ссылке".
- Create: `src/app/api/student/referrals/route.ts` — returns count of users with `subscriptions.referred_by_user_id = me`.

**Steps:**
- [ ] Write the migration.
- [ ] Extend `/start` parsing.
- [ ] Build the page.
- [ ] Build the API.
- [ ] Wire the credit logic in `tg-stars.ts` (Task 7) if not already done.
- [ ] Commit: `feat(referrals): personal links + +30d credit on first paid period (capped 90d)`

### Task 12: Freeze

**Files:**
- Create: `src/app/student/freeze/page.tsx`
- Create: `src/app/api/student/freeze/route.ts` — POST { days: 1|2|3 } → flip subscription to `frozen` with `frozen_until = tomorrow + days`, `current_period_ends_at += days`. Decrement `freeze_days_used_in_period`.
- Modify: `src/server/subscriptions.ts` — add `lazyResetFreezeBudget()` that resets `freeze_days_used_in_period` to 0 when the calendar month rolls over since `freeze_period_started_at`.

**Steps:**
- [ ] UI: page with the spec copy verbatim:
  > Можно заморозить доступ до 3 дней в месяц. Это продлит подписку на время паузы. Заморозка действует со следующего дня после активации.
- [ ] 1/2/3 day picker. Disable options that exceed `3 - freeze_days_used_in_period`.
- [ ] On activate → API call → bot sends DM "Заморозка включена на N дней. Подписка автоматически продлится."
- [ ] During frozen state, the access gate (Task 5) replies with `frozenNotice`.
- [ ] Commit: `feat(freeze): up to 3 days/month, advances current_period_ends_at`

### Task 13: Response window

**Files:**
- Modify: `src/server/notifications.ts` (the existing fan-out) — when sending a teacher-initiated message (i.e., the bot's "📩 reply to X" prompt or the new `/api/teacher/initiate` flow), check the student's response window. If outside the window, queue instead of send.
- Create: `supabase/migrations/<date>_scheduled_outbound.sql` — `scheduled_outbound (id, student_id, kind, payload jsonb, deliver_at, created_at, status)`.
- Create: `src/app/api/cron/deliver-scheduled/route.ts` — every minute, drain due scheduled rows.
- Modify: the existing `expire-claims` cron OR add another QStash schedule for delivery.
- Create: `src/app/student/response-window/page.tsx` — student picks start/end times.
- Create: `src/app/api/student/response-window/route.ts` — PATCH { start: 'HH:MM', end: 'HH:MM' } | { clear: true }.

**Behaviour:**
- On a teacher-initiated message: compute `next_window_open(student, now)`. If `now` is inside window → send immediately. Else → insert a `scheduled_outbound` row with `deliver_at = next_window_open`. The cron drains those.
- On a teacher REPLY during an active claim: deliver immediately (matches your locked-in answer).
- Reuse the existing TG send code; the difference is the `deliver_at` gate.

**Steps:**
- [ ] Migration.
- [ ] UI for picking the window.
- [ ] Server: branch in `notifications.ts`.
- [ ] Cron: drain due rows.
- [ ] Tests: pure helper `nextWindowOpen(now, start, end, tz)` with edge cases (overnight window crossing midnight, same-time start/end = always-on, no-window-set passthrough).
- [ ] Commit: `feat(response-window): hold teacher-initiated messages until student's window opens`

---

## Out of scope (this plan)

- **URM (User Reactivation Messages)** — section is empty in the spec. Trivial to add later: scheduled outbound rows from Task 13's infra, sent N days after `lapsed` flip.
- **Per-student progress metrics** ("+12% speed", "48 words"). Marked future in the spec. Needs a separate analysis pipeline; out of scope here.
- **Admin override of subscription status** beyond a SQL UPDATE. Add a button in `AdminUsersTable` later if it's a frequent action.
- **Card payments via Stripe** — `BillingProvider` interface makes this swap a single new file, but no implementation here.
- **Cancellation flow** — Stars are one-shot, so "cancel" just means "don't pay next time." When real card-on-file billing exists, add a `cancelSubscription` adapter call.

---

## Verification (per wave)

**After Wave 1:**
1. Manually flip every `subscription.status` value in Supabase. Reload `/` as a student → card variants render correctly.
2. Send a voice as a `trial_expired` user → bot replies once with locked-template + Pay button. Send another within 1 min → silent. Send another after 24h → reply again.
3. `pnpm typecheck && pnpm test && pnpm build` clean.

**After Wave 2:**
4. `trial_expired` user taps the Pay CTA → invoice opens → pays 1 star → returns to chat with success message → `subscription.status = 'active'` and `current_period_ends_at = now + 30d`.
5. Manually set a user's `current_period_ends_at` to 1h ago. Wait one cron tick → status = `lapsed` + reminder DM sent.
6. Two referred signups complete a paid period → both referrer + referees get credit applied; cap at 90 days.

**After Wave 3:**
7. Three menu items deep-link correctly. Support → /feedback. Referrals → personal-link page with share button. Freeze → 1-2-3 picker, advances period_ends_at. Response window → time picker, picks render correctly.
8. Set a window of 09:00-21:00. Have a teacher hit `Initiate` at 22:00 → message lands in `scheduled_outbound`, NOT delivered. At 09:00 next morning → cron drains it, student receives.
9. Reply during an active claim outside the window → delivered immediately (correct behaviour).

---

## Rough commit count + sequencing

- Wave 1: 5 commits, ~3-5 days of work depending on QA.
- Wave 2: 3 commits, ~2-3 days. Most of the work is the Stars sandbox testing.
- Wave 3: 5 commits (one per menu item + the menu shell), each ~half-day except response-window which is a full day.

Total ~13 commits. Wave 1 ships the visible win; Waves 2 + 3 can interleave with whatever else is happening in the project.
