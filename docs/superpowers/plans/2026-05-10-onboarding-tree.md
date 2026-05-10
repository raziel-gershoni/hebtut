# Onboarding decision tree

**Goal:** Implement the 14-step decision tree that guides a new student from `/start` through the first message, the first teacher reply, the daily-limit experience, the conversion prompt at end of trial, and a churn-survey branch — per the spec at https://docs.google.com/document/d/1EIXns6lre5fNVE3O7U7yLM-gnFqnHzdIaGbnH2axEds.

**Architecture:** A per-student state machine column on `subscriptions`, plus a generic `onboarding_timers` table for time-based fires (2h nudge, 24h nudge, meta-explainer at +5min, day-2 conversion CTA at +5min, survey at +1d, churn-followup at +5d). One new minute-cadence cron drains due timers; existing handlers (`/start`, student voice, teacher reply, payment confirmation, admin grant) push the state forward at the right edges.

**Tech stack:** grammY callback_query handlers for the inline-keyboard buttons, the same `bot.api.sendMessage` + `editMessageText` pattern we already use for renewal reminders, the same QStash schedule plumbing in `scripts/sync-qstash.mjs`. No new external infra.

**Locked-in choices (your answers):**
- **Trial drops from 3 days to 2** (matches the doc). Migration changes the column default; in-flight 3-day trials keep their original `trial_ends_at` so users mid-trial aren't cut short.
- **Step 8 ("after student listened to coach reply")** fires on a 5-minute timer after the teacher's first outbound to that student. Best proxy we have without TG read receipts.
- **Quiet hours** reuse the per-student `response_window` columns (already shipped in W3.T13). If a nudge is due outside the student's window, defer to the next window opening. If the student hasn't set a window, fall back to `08:00–22:00` in their tz so we never DM at 03:00.

**Out of scope (deliberately):**
- Real videos. The three video placeholders are text-only "preview coming soon" stubs with one-line summaries; swap in real media once recorded — single i18n string per video, no schema.
- Channel-of-entry attribution beyond what `/start <token>` already does (the doc's list of channels — direct link, ads, social, referral — doesn't change the onboarding flow itself).
- Step 14 ("Готово. Подписка оформлена…") is essentially what `applySuccessfulPayment` + admin-grant already DM today; we just normalize the copy to match the doc and have onboarding mark itself done.

---

## Schema

`supabase/migrations/20260510000002_onboarding_tree.sql` (new):

```sql
-- Trial drops from 3 to 2 days. Existing rows keep their trial_ends_at —
-- only NEW students get the 2-day default.
alter table public.subscriptions
  alter column trial_ends_at set default (now() + interval '2 days');

-- State machine column. Linear-ish path: welcome → video1 → video2 →
-- cta_record → (first voice OR nudge) → awaiting_first_reply →
-- meta_explainer_pending → day1_active → day2_active →
-- day2_conversion_pending → awaiting_survey → survey_{yes,later,no} →
-- {churn_followup_pending,} → {done_paid,done_churned,done_skipped}.
create type public.onboarding_state as enum (
  'welcome',
  'video1',
  'video2',
  'cta_record',
  'awaiting_first_reply',
  'meta_explainer_pending',
  'day1_active',
  'day2_active',
  'day2_conversion_pending',
  'awaiting_survey',
  'survey_yes',
  'survey_later',
  'survey_no',
  'churn_followup_pending',
  'done_paid',
  'done_churned',
  -- For existing students who pre-date this feature; never sees onboarding.
  'done_skipped'
);

alter table public.subscriptions
  add column onboarding_state public.onboarding_state not null default 'welcome',
  add column onboarding_state_entered_at timestamptz not null default now(),
  -- Anchor times we reference from cron sweeps + state checks.
  add column onboarding_first_msg_at  timestamptz,
  add column onboarding_first_reply_at timestamptz,
  add column onboarding_last_active_at timestamptz,
  -- Day-1 limit message dedupe (it fires once per trial).
  add column onboarding_day1_limit_msg_sent_at timestamptz,
  -- Day-2+ pause-nudge dedupe (once per calendar day in user tz).
  add column onboarding_last_pause_nudge_at timestamptz;

create index subscriptions_onboarding_state_idx
  on public.subscriptions (onboarding_state)
  where onboarding_state not in ('done_paid', 'done_churned', 'done_skipped');

-- Time-based fires. State transitions schedule a row here; the cron drains
-- due+un-cancelled rows once a minute. Cancellation is soft (cancelled_at)
-- so we keep an audit trail of intended-but-superseded nudges.
create type public.onboarding_timer_kind as enum (
  'nudge_2h',           -- step 5: 2h after cta_record
  'nudge_24h',          -- step 6: 24h after cta_record (deferred for quiet hours)
  'meta_explainer',     -- step 8: 5min after first teacher reply
  'day2_conversion',    -- step 11: 5min after day-2 limit hit
  'survey',             -- step 12: 1d after trial ends without payment
  'churn_followup'      -- step 12.3: 5d after survey "Later"
);

create table public.onboarding_timers (
  student_id   bigint not null references public.users(id) on delete cascade,
  kind         public.onboarding_timer_kind not null,
  due_at       timestamptz not null,
  fired_at     timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (student_id, kind)
);

create index onboarding_timers_due_idx
  on public.onboarding_timers (due_at)
  where fired_at is null and cancelled_at is null;

-- Backfill: every existing student is `done_skipped` so they don't suddenly
-- get the welcome flow on their next /start. Fresh signups after the
-- migration get the default `welcome` and run the full tree.
update public.subscriptions
  set onboarding_state = 'done_skipped',
      onboarding_state_entered_at = now()
  where onboarding_state = 'welcome';

alter table public.onboarding_timers enable row level security;
```

**Type updates** in `src/types/database.ts`: add `OnboardingState`, `OnboardingTimerKind` unions and the two table definitions.

---

## Server modules

### `src/server/onboarding.ts` (new) — state-machine + side effects

```ts
// Pure helpers
export function computeOnboardingDay(
  trialStartedAt: string,
  now: Date,
  tz: string,
): number;                                  // 1, 2, 3+ (calendar-day delta in tz)

export function nextSafeFireTime(
  due: Date,
  windowStart: string | null,
  windowEnd: string | null,
  tz: string,
): Date;                                    // applies response_window OR
                                            // 08:00–22:00 fallback quiet hours.
                                            // Reuses `nextWindowOpen` from
                                            // src/server/response-window.ts.

// State transitions (DB writes)
export async function advanceOnboarding(
  studentId: number,
  next: OnboardingState,
): Promise<void>;

export async function scheduleTimer(
  studentId: number,
  kind: OnboardingTimerKind,
  dueAt: Date,
): Promise<void>;                           // upsert (student_id, kind);
                                            // overwriting an unfired one is OK
                                            // (rescheduling).

export async function cancelTimer(
  studentId: number,
  kind: OnboardingTimerKind,
): Promise<void>;                           // sets cancelled_at if unfired.

export async function markTimerFired(
  studentId: number,
  kind: OnboardingTimerKind,
): Promise<void>;

// Send-side. Each `send*` function: looks up tg_chat_id, builds the
// inline_keyboard with `callback_data: 'onb:<action>'`, sendMessage, audits.
export async function sendStep1Welcome(studentId: number): Promise<void>;
export async function sendStep2Video1(studentId: number): Promise<void>;
export async function sendStep3Video2(studentId: number): Promise<void>;
export async function sendStep4CtaRecord(studentId: number): Promise<void>;
export async function sendStep5Nudge2h(studentId: number): Promise<void>;
export async function sendStep6Nudge24h(studentId: number): Promise<void>;
export async function sendStep8MetaExplainer(studentId: number): Promise<void>;
export async function sendStep9Day1LimitDone(studentId: number): Promise<void>;
export async function sendStep10PauseNudge(studentId: number): Promise<void>;
export async function sendStep11Day2Conversion(studentId: number): Promise<void>;
export async function sendStep12Survey(studentId: number): Promise<void>;
export async function sendStep12_1OpenAccess(studentId: number): Promise<void>;
export async function sendStep12_2LaterAck(studentId: number): Promise<void>;
export async function sendStep12_3Video3(studentId: number): Promise<void>;

export async function markOnboardingDone(
  studentId: number,
  reason: 'paid' | 'churned' | 'admin_grant',
): Promise<void>;                            // flips state to done_paid /
                                            // done_churned, audits.
```

Audit each fire as `onboarding.step_N` so we have a clean log per student.

### `src/server/handlers/onboarding-callbacks.ts` (new)

Handles `bot.on('callback_query:data', ...)` matching `/^onb:/`:

| `callback_data` | Required state | Effect |
|---|---|---|
| `onb:start` | `welcome` | advance → `video1`, send Step 2, edit prior msg to remove button |
| `onb:continue` | `video1` | advance → `video2`, send Step 3, edit prior msg |
| `onb:next` | `video2` | advance → `cta_record`, send Step 4, schedule `nudge_2h` (+2h) and `nudge_24h` (+24h, quiet-hour-aware) |
| `onb:survey:yes` | `awaiting_survey` | advance → `survey_yes`, send Step 12.1 |
| `onb:survey:later` | `awaiting_survey` | advance → `survey_later`, send Step 12.2, schedule `churn_followup` (+5d) |
| `onb:survey:no` | `awaiting_survey` | advance → `survey_no`, send Step 12.3 (Video 3 + chat-support button), transition to `done_churned` after the message is delivered |
| `onb:open_access` | `survey_yes` | DM the student a link to `/feedback` (or open inline `t.me/<bot>?startapp=feedback`); transition stays `survey_yes` until they actually pay |
| `onb:reply_to_samuel` | `survey_no` or any | open `t.me/<bot>?startapp=feedback` (inline-button URL, not callback) |

Always answer the callback_query (`ctx.answerCallbackQuery()`); always edit the source message to remove the inline keyboard so a double-click doesn't double-fire (`bot.api.editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] })`).

If the state doesn't match (race / stale message), answer with a brief `text: 'Кнопка устарела'` and don't transition.

---

## Wire into existing handlers

### `src/server/handlers/start.ts`

Today, `welcomeNewStudent(ctx)` sends `ru.greetingStudentNew`. Replace:

- New student path → set `onboarding_state = 'welcome'` (default already), call `sendStep1Welcome(student.id)`.
- Existing student path → keep current `welcomeExistingUser` flow. Their `onboarding_state` is `done_skipped` from the backfill, or one of the in-progress states (in which case **resend the current step's message** so they can resume — idempotent, expected UX after closing/reopening the bot).

### `src/server/handlers/student-message.ts`

After the access gate + before the quota math:

- If `onboarding_state` ∈ `{welcome, video1, video2, cta_record}` (student bypassed the buttons by recording right away):
  - `advanceOnboarding(awaiting_first_reply)`
  - `cancelTimer('nudge_2h')`, `cancelTimer('nudge_24h')` (idempotent)
  - set `onboarding_first_msg_at = now()`
  - continue to quota path normally
- If state already `awaiting_first_reply` and they record again before teacher reply: no state change, just update `onboarding_last_active_at`.

After successful insert + fan-out (i.e. message was accepted):

- Set `onboarding_last_active_at = now()`.
- **Day-1 limit detection**: if `decision.newRemainingToday === 0` AND `computeOnboardingDay(trial_started_at, now, tz) === 1` AND `onboarding_day1_limit_msg_sent_at IS NULL`:
  - `sendStep9Day1LimitDone`
  - stamp `onboarding_day1_limit_msg_sent_at = now()`.
- **Day-2 limit detection**: if `decision.newRemainingToday === 0` AND `computeOnboardingDay === 2` AND state ∉ {`done_*`, `day2_conversion_pending`}:
  - `advanceOnboarding('day2_conversion_pending')`
  - `scheduleTimer('day2_conversion', now + 5min)`.

### `src/server/handlers/teacher-reply.ts`

After the message is successfully sent to the student's chat AND the messages row is inserted with `direction='out'`:

- If this is the student's FIRST outbound (check via `onboarding_first_reply_at IS NULL` AND state ∈ `{awaiting_first_reply, cta_record}`):
  - Set `onboarding_first_reply_at = now()`.
  - `advanceOnboarding('meta_explainer_pending')`.
  - `scheduleTimer('meta_explainer', now + 5min)`.

### `src/server/handlers/billing-events.ts` + `src/server/subscriptions.ts`

In `applySuccessfulPayment` and `grantSubscriptionDays`:

- After the row update, call `markOnboardingDone(userId, reason)` to flip state to `done_paid` and cancel any pending timers (survey, churn_followup). Existing payment-confirmation DM stays — Step 14's copy is essentially what we already send.

---

## Cron — `/api/cron/onboarding/route.ts` (new)

`*/1 * * * *` schedule. Auth via `Bearer ${CRON_SECRET}` like the others. One pass per tick:

1. **Drain `onboarding_timers`** where `fired_at IS NULL AND cancelled_at IS NULL AND due_at <= now()`. For each:
   - Look up the student's current state. If state mismatches the timer's intent (e.g., `nudge_2h` but the student already recorded → state ≠ `cta_record`), mark fired with no-op.
   - Otherwise call the matching `send*` function and `markTimerFired`.

2. **Day-2+ pause detection** (Step 10). For each student where:
   - `onboarding_state ∈ {day2_active, awaiting_first_reply, meta_explainer_pending}`,
   - `computeOnboardingDay(trial_started_at, now, tz) >= 2`,
   - `now - onboarding_last_active_at >= 6h`,
   - `onboarding_last_pause_nudge_at` is null OR not in today's date in the user's tz,
   - now is inside the student's response_window (or fallback 08–22),

   send Step 10 text and stamp `onboarding_last_pause_nudge_at = now()`.

3. **Trial-end → schedule survey** (Step 12 setup). When the existing `subscription` cron flips a row from `trial → trial_expired`, in the same pass: if `onboarding_state ∈ {day2_active, day2_conversion_pending, awaiting_first_reply, meta_explainer_pending}` (i.e. they were active in trial), `advanceOnboarding('awaiting_survey')` and `scheduleTimer('survey', now + 1d)`. Done in the existing `/api/cron/subscriptions/route.ts` to avoid two crons racing on the same flip.

Add the schedule entry to `scripts/sync-qstash.mjs`:
```js
{ path: "/api/cron/onboarding", cron: "*/1 * * * *" },
```

---

## i18n — `src/lib/i18n.ts` additions

All strings from the doc, plus the three video placeholders. Naming convention: `onbStep<N>` so the pattern matches the spec for grep-ability.

```ts
onbStep1Welcome:
  "Начни говорить на иврите уже сегодня.\n" +
  "И двигайся шаг за шагом через живую практику.\n" +
  "Без уроков и зубрёжки.",
onbStep1Button: "Начать",

onbVideo1Placeholder:
  "🎬 [Видео 1] Превью появится позже.\n\n" +
  "Самуэль рассказывает, как работает сервис: ты записываешь голосовое " +
  "или видео-кружок — живой тренер отвечает. Это пинг-понг: чтобы " +
  "заговорить, нужен живой ответ и продолжение диалога.",
onbStep2Button: "Продолжить",

onbVideo2Placeholder:
  "🎬 [Видео 2] Превью появится позже.\n\n" +
  "5 минут практики в день — не копятся, чтобы был ритм каждый день. " +
  "Ошибаться нормально. Тренер ведёт разговор, задаёт темп, не даёт " +
  "выпасть. Цель — постепенно переводить тебя в уверенную речь.",
onbStep3Button: "Дальше",

onbStep4CtaRecord:
  "Запиши голосовое или видео-кружок на иврите.\n" +
  "Расскажи о себе: чем занимаешься или как прошёл день.\n" +
  "Не думай долго — говори как получается.",

onbStep5Nudge2h:
  "Самое сложное — начать.\n" +
  "Скажи хоть что-то.\n" +
  "Даже одно слово, например «шалом».\n" +
  "Дальше станет проще.",

onbStep6Nudge24h:
  "Если ты сейчас не попробуешь — дальше не сдвинется.\n" +
  "Здесь всё работает только через практику.\n" +
  "Запиши короткое голосовое и попробуй.",

onbStep8MetaExplainer:
  "Вот так это и работает: ты говоришь → тренер отвечает → разговор " +
  "продолжается.\nПродолжай, именно в этом моменте появляется речь.",

onbStep9Day1LimitDone:
  "На сегодня практики более чем достаточно 👍.\nВажно просто вернуться " +
  "завтра и продолжить.",

onbStep10PauseNudge:
  "Не останавливайся.\nДаже короткие ответы дают результат, если делать " +
  "это каждый день.",

onbStep11Day2Conversion:
  "Пробные 2 дня завершены.\nФормат уже понятен: живой тренер, практика " +
  "каждый день, движение шаг за шагом.\nТеперь главное — не терять темп.",
onbStep11Button: "Оплатить и продолжить практику",

onbStep12Survey:
  "Привет, на связи Самуэль.\nВижу, ты уже попробовал формат.\n" +
  "Планируешь продолжить?",
onbSurveyYes: "Да",
onbSurveyLater: "Позже",
onbSurveyNo: "Нет",

onbStep12_1Yes:
  "Отлично.\nТогда можно открыть доступ и вернуться к практике.",
onbStep12_1Button: "Открыть доступ",

onbStep12_2Later:
  "Понял.\nТогда напомню позже, чтобы можно было спокойно вернуться.",

onbVideo3Placeholder:
  "🎬 [Видео 3] Превью появится позже.\n\n" +
  "Привет, на связи снова Самуэль. Если есть пара минут — скажи, что " +
  "именно не зашло или чего не хватило. Можно коротко: текстом или " +
  "голосом. Когда нажмёшь «Ответить Самуэлю», откроется отдельный чат. " +
  "Сообщения попадут только мне, никто больше их не видит.",
onbVideo3Button: "Ответить Самуэлю",
```

`Step 13` (locked-out reply) and `Step 14` (paid confirmation) already covered by existing copy (`lockedTemplateText` + `paymentSucceeded`); no new strings needed.

---

## Files to change

```
supabase/migrations/20260510000002_onboarding_tree.sql       # NEW
src/types/database.ts                                         # extend
src/server/onboarding.ts                                      # NEW (state engine + sends)
src/server/handlers/onboarding-callbacks.ts                   # NEW (callback_query handler)
src/server/handlers/start.ts                                  # branch on onboarding_state
src/server/handlers/student-message.ts                        # advance state, day-1/day-2 hooks
src/server/handlers/teacher-reply.ts                          # first-reply meta-explainer schedule
src/server/handlers/billing-events.ts                         # markOnboardingDone on payment
src/server/subscriptions.ts                                   # markOnboardingDone in grant path
src/app/api/webhook/route.ts                                  # register callback_query handler
src/app/api/cron/onboarding/route.ts                          # NEW (timer drain + pause sweep)
src/app/api/cron/subscriptions/route.ts                       # schedule survey on trial→expired
src/lib/i18n.ts                                               # all step copy + video placeholders
scripts/sync-qstash.mjs                                       # register the new */1-min schedule
tests/onboarding.test.ts                                      # NEW (computeOnboardingDay, nextSafeFireTime)
```

15 files (5 new, 10 modified).

---

## Verification

1. `pnpm typecheck && pnpm test && pnpm build` — clean. New tests cover `computeOnboardingDay` (boundary days in user tz, including DST) and `nextSafeFireTime` (defer-into-window, fallback 08–22).
2. **New signup flow**: fresh student `/start` → welcome text + Начать button. Tap Начать → Video 1 placeholder + Продолжить. Tap Продолжить → Video 2 placeholder + Дальше. Tap Дальше → Step 4 CTA. Wait 2h (or set `due_at` to now via psql) → cron sweep fires Step 5. Wait 24h → Step 6 (defer if outside response_window or 08–22 fallback).
3. **Bypass-buttons-by-voice**: at `cta_record`, send a voice instead of tapping → state advances to `awaiting_first_reply`, both nudges cancelled, voice flows through normal pipeline (fan-out, etc.).
4. **First teacher reply**: teacher replies → 5min later cron fires Step 8 meta-explainer.
5. **Day-1 limit hit**: send 5 minutes of voice → bot's "✅ Отправлено." reply is followed by Step 9 ("на сегодня достаточно"). Day-1 message fires once, dedupe via `onboarding_day1_limit_msg_sent_at`.
6. **Day-2 limit hit**: same on day 2 → 5min later, Step 11 conversion CTA + Оплатить button. Button (in current manual-billing mode) routes to `/feedback` per the gated PayCTA logic from W2.T7.
7. **Trial expires without payment**: cron flips trial→trial_expired AND, in the same tick, schedules the survey (+1d). 1d later → Step 12 survey arrives with three buttons.
8. **Survey "Yes"**: Step 12.1 + Открыть доступ button. Button DMs the student `/feedback` link.
9. **Survey "Later"**: Step 12.2 + churn_followup scheduled (+5d). 5d later → Video 3 placeholder + Ответить Самуэлю button. State → `done_churned`.
10. **Survey "No"**: immediate Video 3 placeholder. State → `done_churned`.
11. **Pay during onboarding**: tap Pay (manual or Stars-when-on) → `applySuccessfulPayment` flips state to `done_paid`, cancels all pending timers, payment-confirmation DM goes out as before.
12. **Admin grant during onboarding**: same — `grantSubscriptionDays` calls `markOnboardingDone('admin_grant')`, cancels timers, DM goes out.
13. **Existing students**: `done_skipped`. Their next `/start` shows the existing greeting, no welcome flow. Confirm by hitting `/start` from your account.
14. **Quiet hours**: artificially set `due_at = now` for a `nudge_24h` while inside the student's response_window OR within 08–22 fallback → fires immediately. Set it outside → fires at the next window opening (or at 08:00 in tz if no window set).

---

## Commit plan

Three commits:

1. `feat(schema): onboarding_state + onboarding_timers tables, trial drops to 2 days` — migration + types only. Idempotent, deployable independently. Existing students backfilled to `done_skipped`.
2. `feat(onboarding): state engine + bot send functions + callback handlers (linear path)` — Steps 1–8. New `src/server/onboarding.ts` + `onboarding-callbacks.ts` + i18n strings + handleStart/student-message/teacher-reply wiring + webhook registration. Cron not needed yet — the linear path is event-driven.
3. `feat(onboarding): time-based sweeps + survey + churn (cron tree)` — Steps 5/6/8/9/10/11/12/12.1/12.2/12.3, the new `/api/cron/onboarding` route, `markOnboardingDone` integration with billing + admin grant, sync-qstash entry. End of this commit ships the full tree.

Total ~15 files touched, two new tables, one new cron. Most of the line count is i18n + the 14-row state-machine table; the runtime logic is small.
