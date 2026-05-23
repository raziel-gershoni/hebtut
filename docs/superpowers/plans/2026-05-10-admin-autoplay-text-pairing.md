# Four follow-on features

**Goal:** Ship four small, independent features that came up after the onboarding tree landed: (1) admin sees every student's chat regardless of teacher-link status, (2) Telegram-style continuous autoplay in the Mini App thread, (3) teachers can send text messages to students from both the Mini App and via TG swipe-reply, (4) the admin teacher↔student pairing UI gets search + virtualization so it scales past a hundred users.

**Tech stack:** No new infra. Reuses the existing handlers, the `messages` table (with one schema additive), the ThreadView/MessageBubble React tree, and the AdminConnectionsPanel.

**Locked-in choices (your answers):**
- **Autoplay = "tap-to-start + auto-advance + fresh-arrival autoplay"** (option 3). The first play is intentional (no scroll-into-view surprises), then continuous within the thread, AND a teacher's brand-new reply that arrives while you're reading auto-plays.
- **Teacher → student text** via BOTH the Mini App (text input next to the Reply-with-voice affordance) AND TG swipe-reply (teacher swipes the prompt and types instead of recording). **One-way only — students still send voice/video only.** No `kind='text'` row ever has `direction='in'`; the webhook's `message:text` filter gates strictly by sender role + reply-to-prompt match.
- **Pairing UI revamp = bulk checklist M×N**. Two searchable lists (students + teachers) each with checkboxes. Pick any number on each side; the "Pair selected" button creates the cross-product of links (skipping already-existing ones). Above the button, a live preview shows exactly which pairs are about to be created. No more single-pick + Add loop.

---

## Feature 1 — Admin sees every student's chat

### Problem
`/api/inbox/route.ts:73–76` filters the inbox by `student_teachers.teacher_id = user.id`, so an admin who isn't a teacher sees an empty inbox. The threads route already has the right bypass (`if (!user.isAdmin)` at `/api/threads/[studentId]/route.ts:33`) — only the inbox needs to catch up.

### Approach

**Files:**
- Modify: `src/app/api/inbox/route.ts`

When `user.isAdmin === true`, skip the `student_teachers` filter and instead pull EVERY active student in one query. The rest of the inbox shape (last_message, unread_count, claim, etc.) reuses the existing reduce pass — admins just see a bigger list.

```ts
const studentIds = user.isAdmin
  ? // Admin: every active student row, no teacher filter.
    ((await sb.from("users").select("id").eq("role", "student")).data ?? []).map(
      (u) => u.id,
    )
  : // Teacher path: keep the existing student_teachers join.
    ((await sb.from("student_teachers").select("student_id").eq("teacher_id", user.id))
      .data ?? []).map((l) => l.student_id);
```

The threads route doesn't change (admin bypass already there). The audit (read access vs. teacher work) stays implicit — admin reads aren't actionable, just visibility.

**Note**: `unread_count` is computed from `inbox_reads` keyed on `(teacher_id, student_id)`. Admins reading admin-mode inbox won't have `inbox_reads` rows (they're not the teacher), so unread counts are inflated for admin viewers. That's fine — flag it in code with a comment, or count them as "read" since the admin doesn't have a personal read-state in this context. Default to "show unread count = 0 for admins not linked" because that matches what admins actually want: a read-only oversight view.

### Verification
- Demote your account to admin-only (no teacher role). Hit `/inbox` — you see every student in the system.
- Click into a thread — full message history loads.
- Demote a different account that's a teacher — still sees only their linked students.

---

## Feature 2 — Telegram-style autoplay in the thread

### Problem
Each `VoicePlayer` / `VideoNote` in `MessageBubble.tsx` (lines 185–392) owns its own `playing` state. There's no cross-bubble coordination — when one ends, the next doesn't know it should start.

### Approach

**Three changes:**

1. **Lift "currently playing" state into a React context** rooted at `ThreadView`. Players read/write through the context, so:
   - Tapping a voice → context records `{ messageId, kind }`.
   - When that player's `onEnded` fires → context picks the NEXT message in the thread that's a voice or video-note and emits a "play this one" signal.
   - Other players watching the context see "I'm not the active one anymore" and stop.

2. **Auto-advance order**: chronological by `created_at`. The thread is already chronological in `ThreadView.tsx:251` (the `messages.map`). Context has access to the message list, so picking "next playable after current" is one filter.

3. **Fresh-arrival autoplay**: when a new outbound (teacher reply) arrives via the existing realtime/refresh path in `ThreadView.tsx`, AND the user has been actively listening within the last ~30s (i.e. `playing` is or recently was true), AND the thread is the user's foreground tab, autoplay the new message. Otherwise, leave it silent (don't surprise a user who's idle on the thread).

**Files:**
- Modify: `src/components/ThreadView.tsx` — wrap children in a `<PlaybackProvider>`.
- Modify: `src/components/MessageBubble.tsx` — both players consume the context: read `isMyTurn(messageId)` to know whether to auto-start, write `markPlaying(messageId)` on `onPlay`, write `markEnded(messageId)` on `onEnded` so the provider can pick the next.
- New: `src/components/PlaybackProvider.tsx` — context + hook. Owns the "current" message id, the "ended-recently" flag (TTL ~30s) for the fresh-arrival branch, and the queue of upcoming-playable messages.

**Behavior matrix:**

| User action | Result |
|---|---|
| Tap voice X (idle thread) | X plays. When X ends, next playable Y starts automatically. |
| Tap pause mid-X | X pauses. Auto-advance breaks. |
| Tap voice X, scroll far away | X keeps playing (TG behavior). |
| Voice arrives while X is playing | New message appended to queue. Plays AFTER X (not in the middle). |
| Voice arrives while idle (no recent playback) | Stays silent. User taps to play if they want. |
| Voice arrives within 30s of a recent end | Auto-plays the new one (user was clearly engaged). |
| User toggles their playback-speed pill | New rate applies to the currently playing element AND inherited by the next auto-advance. |

**Files to change:**
```
src/components/ThreadView.tsx           # wrap with PlaybackProvider, pass messages
src/components/MessageBubble.tsx        # consume context in both players
src/components/PlaybackProvider.tsx     # NEW (~80 lines)
```

### Verification
- Open a thread with 4+ voices. Tap the first → it plays → ends → second auto-starts → ... etc.
- Tap pause mid-second voice → no auto-advance.
- Have a teacher reply WHILE you're listening to message 3 → reply appended to queue, plays after current ends.
- Have a teacher reply while you're idle (haven't tapped in 60+ seconds) → message appears, no autoplay; tap to start.
- Confirm the playback-speed pill (already in `MessageBubble`) still works — speed inherits across auto-advances.

---

## Feature 3 — Teachers send text messages

### Problem
`messages` table only allows `kind ∈ ('voice', 'video_note')`. The teacher-reply handler hardcodes the same. Teachers want a faster path for short clarifications ("слушаю", "+1 минута", etc.) without recording.

### Approach

**Schema additive** — `supabase/migrations/20260510000003_message_text.sql`:
```sql
alter table public.messages
  drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('voice', 'video_note', 'text'));
-- text_content lives next to file_id (which becomes nullable for text rows).
alter table public.messages
  alter column file_id drop not null,
  add column text_content text,
  add constraint messages_text_or_file check (
    (kind = 'text' and text_content is not null and file_id is null) or
    (kind in ('voice', 'video_note') and file_id is not null and text_content is null)
  );
```

**Type update** in `src/types/database.ts`: `MessageKind` adds `'text'`; the row gets `text_content: string | null`, `file_id: string | null`.

**Two send paths:**

#### Path A — TG swipe-reply text

Teacher swipes the bot's prompt message in TG and TYPES instead of recording. The webhook needs to register a third filter alongside the existing two:

```ts
// src/app/api/webhook/route.ts
bot.on(["message:voice", "message:video_note"], async (ctx) => { /* existing */ });
bot.on("message:text", async (ctx) => {
  // Only route as a teacher-reply IF reply_to_message exists AND the sender
  // is a teacher AND the replied-to message matches a prompt. Otherwise fall
  // through to handleUnknown (so non-teacher /start with garbage doesn't loop).
  const handled = await handleTeacherReplyText(ctx);
  if (handled) return;
  await handleUnknown(ctx);
});
```

New function `handleTeacherReplyText` in `src/server/handlers/teacher-reply.ts` (or a sibling file) — same prompt-resolution and access-check shape as the existing voice/video handler, but:
- No `bot.api.sendVoice` / `sendVideoNote` — instead `bot.api.sendMessage(student.tg_chat_id, msg.text)`.
- `messages` insert with `kind: 'text', text_content: msg.text, file_id: null`.

The handler can extract a shared `relayToStudent(...)` helper alongside the voice path, since 90% of the flow (claim refresh, audit, edit notification text) is identical.

#### Path B — Mini App text input

`ThreadView.tsx` gets a small composer at the bottom for teachers (not students):
- Text input + Send button.
- POST to a new route `src/app/api/replies/text/route.ts` with `{ messageId?, studentId, text }`.
- Route: validates teacher claim via the same logic the existing `replies/start` uses, calls `bot.api.sendMessage(student.tg_chat_id, text)`, inserts the messages row, audits.

If `messageId` is provided (replying to a specific student message), the row's `reply_to_id` is set. If not (initiation-style text), it stays null.

**Render: text bubbles in MessageBubble.tsx**:
```tsx
if (msg.kind === "text") {
  return <TextBubble msg={msg} speaker={speaker} ... />;
}
```

`TextBubble` is a new sub-component: a chat bubble with `msg.text_content`, no player, no playback-speed pill. Uses the existing speaker-color scheme + reply-quote pattern. The student's TG chat shows the text natively (TG handles the rendering).

**Quota math**: text messages don't count against the daily 5-minute quota. They're cheap. Skip `decideQuota` / `commitUsageSplit` for `kind === 'text'`.

**Notifications fan-out**: when a student inbound is text-relayed back, the teacher's prompt copy in `notifications.ts` works as-is (it talks about kind ∈ voice/video). For text-only outbound from teacher, no fan-out — it's a teacher→student message, not student→teacher.

**Files:**
```
supabase/migrations/20260510000003_message_text.sql      # NEW
src/types/database.ts                                     # MessageKind, file_id nullable, text_content
src/server/handlers/teacher-reply.ts                      # text handler + relayToStudent shared helper
src/app/api/webhook/route.ts                              # register message:text filter
src/app/api/replies/text/route.ts                         # NEW (Mini App POST)
src/components/MessageBubble.tsx                          # TextBubble subcomponent + kind branch
src/components/ThreadView.tsx                             # text composer for teachers
src/lib/i18n.ts                                           # placeholder: "Напиши ответ..."
```

### Verification
1. Teacher swipe-replies a prompt in TG with text → student receives it as a normal TG text message; thread view shows it as a text bubble.
2. Teacher uses the Mini App composer → same outcome.
3. Student tries to reply with text in TG → bot stays silent / falls back to `unknownInput` (no kind=text from student).
4. Daily quota unaffected by text messages.
5. The text message appears in the audit log as `message.out` with `kind=text`.
6. Existing voice/video flow unchanged — confirm by sending a voice.

---

## Feature 4 — Admin pairing UI revamp

### Problem
`AdminConnectionsPanel.tsx:164–175` uses two `<select>` elements with the entire user list inlined. Past ~100 users the dropdown becomes unscrollable in TG's WebView. The existing search input at lines 204–210 only filters the EXISTING-LINKS view, not the pickers.

### Approach

**Replace `<select>` with a combobox-typeahead component.** Both pickers (student + teacher) get:
- A text input that filters the candidates by name / handle / tg_user_id substring as you type.
- A dropdown list rendered ONLY when focused, virtualized via a simple windowing pattern (slice the filtered list to the first ~50 items; "show more" reveals 50 more) — no react-window dependency, ~30-line in-component implementation.
- Keyboard nav: `↑/↓` to highlight, `Enter` to pick. Plus the existing tap-to-pick on mobile.

**Recently-linked surfacing**: above the picker, show the 5 most recent links the admin created (from `audit_events.action='admin.link_create'` if it exists, or just from `student_teachers.created_at` desc). Tap a recent link → un-link affordance. Helps when admins are doing many links in one session.

**Existing-links view** stays. Already has filter + group-by-student/teacher toggle. Just bumps when the underlying data grows.

**Sort + initial limit**:
- `/api/admin/users/route.ts:28` already sorts by `created_at DESC`. Keep.
- `/api/admin/links/route.ts:32` adds `.order("created_at", { ascending: false })` so recency-grouping works.

**Files:**
```
src/components/AdminConnectionsPanel.tsx      # rewrite the PickerRow; same panel shape
src/components/SearchableUserPicker.tsx       # NEW (~150 lines: typeahead + keyboard nav + virtualization)
src/app/api/admin/links/route.ts              # add ORDER BY created_at desc
```

No schema, no new API.

### Verification
- Seed Supabase with 200 users (or use `pnpm db:push` after temporarily duplicating rows).
- Open `/admin`, scroll to the connections panel.
- Type "skr" — only matching students appear.
- Tap one, then a teacher, tap "Привязать". Link appears at the top of "По ученикам" list immediately.
- Hit ↑/↓ in the input to navigate without tapping.
- Existing-links search at the bottom still works.

---

## Files to change (combined)

```
# Feature 1
src/app/api/inbox/route.ts                              # admin bypass branch

# Feature 2
src/components/PlaybackProvider.tsx                     # NEW
src/components/ThreadView.tsx                           # wrap with provider
src/components/MessageBubble.tsx                        # consume context in both players

# Feature 3
supabase/migrations/20260510000003_message_text.sql     # NEW (kind='text' + nullable file_id)
src/types/database.ts                                   # MessageKind union + nullable file_id
src/server/handlers/teacher-reply.ts                    # text branch + shared relay helper
src/app/api/webhook/route.ts                            # register message:text
src/app/api/replies/text/route.ts                       # NEW (Mini App POST)
src/components/MessageBubble.tsx                        # TextBubble subcomponent
src/components/ThreadView.tsx                           # composer (teacher-only)
src/lib/i18n.ts                                         # composer placeholder

# Feature 4
src/components/AdminConnectionsPanel.tsx                # picker rewrite
src/components/SearchableUserPicker.tsx                 # NEW
src/app/api/admin/links/route.ts                        # order by created_at desc
```

13 files (4 new, 9 modified). One migration.

---

## Commit plan

Four commits, one per feature, each independently shippable:

1. `feat(admin): admin sees every student's chat in the inbox` — Feature 1. ~10 lines, smallest blast radius. First.
2. `feat(player): TG-style continuous autoplay + fresh-arrival autoplay` — Feature 2. Cleanest UI win, no schema risk.
3. `feat(messages): teachers can send text from Mini App and TG swipe-reply` — Feature 3. Schema migration + handler + UI; biggest of the four.
4. `feat(admin): pairing panel — search + virtualize for scale` — Feature 4. UI-only, no schema, no API change beyond ORDER BY.

Estimated: 13 files, ~600 lines across all four. Ship in any order — none blocks the others.
