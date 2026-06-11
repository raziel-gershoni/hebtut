# Admins panel — design

**Date:** 2026-06-11
**Status:** approved (brainstormed interactively)

## Problem

Admin-granting today is a 28px 👤/👑 toggle button in every row of the
admin users table, packed between the role-switch button and the ⋯ menu.
Granting fires **immediately on tap with no confirmation** (only revoking
is confirmed — backwards, safety-wise). A misclick made a student an
admin in prod.

## Goal

Make granting/revoking admin a deliberate multi-step act that a stray
tap cannot trigger, and give admins an at-a-glance list of who holds
admin rights.

## Decisions (from brainstorm)

- **Separate panel**, not an in-table fix: new «Админы» collapsible
  section on `/admin`.
- **Picker scope: any user** (students and tutors both eligible) — the
  confirm step is the safeguard.
- **No bootstrap distinction:** bootstrap admins are listed and
  revocable like anyone else; `ensureBootstrapAdmin` silently re-grants
  them on the next cold start, and that is acceptable.
- **No last-admin guard:** a bootstrapped admin always exists, so the
  server keeps zero new guards. **Zero API changes** overall.
- **Self-revoke allowed**, with a harder warning in the confirm dialog
  («Вы потеряете доступ к админке сразу после подтверждения»). After
  confirming, the ex-admin's next API call 403s and the Mini App shows
  its standard access-denied state — no special handling.
- **Users table loses all admin traces:** the 👤/👑 button, the
  admin-revoke confirm branch, and the `isAdmin` crown on avatars all go.
  The table becomes purely student/tutor concerns.

## UI

```
▾ Админы ──────────────────────────────
│  (👑) Раз Гершони              [✕]  │
│       @raziel · 1121…                │
│  (👑) Лиза Селезнёва           [✕]  │
│       @liza · 8841…                  │
│                                      │
│  [ + Добавить админа ]               │
└──────────────────────────────────────┘
```

- **Revoke:** [✕] → confirm dialog «Убрать права админа у {имя}?» →
  `PATCH {is_admin: false}` → refetch. Self-revoke uses the harder
  warning copy.
- **Grant:** «+ Добавить админа» → dialog with a search input filtering
  all non-admin users by name/username, rows show avatar + name +
  @username. Tapping a row does NOT grant — it shows a confirm step
  «Сделать {имя} админом?» with explicit Да/Отмена →
  `PATCH {is_admin: true}` → refetch. Two deliberate taps + search.

## Components

- **New `src/components/AdminAdminsPanel.tsx`** — fetches
  `GET /api/admin/users` (`cache: no-store`), splits into admins
  (the list) and non-admins (picker candidates). Owns both dialogs.
  Mounted on `/admin` inside `CollapsibleSection`, right after
  Пользователи.
- **`src/components/AdminUsersTable.tsx`** — remove the 👤/👑 button,
  the `{ kind: "admin", … }` pending-confirm branch, `is_admin` from
  `patchRole` body types, and the `isAdmin` prop from `Avatar` usage.
- **API:** unchanged. `PATCH /api/admin/users/[id]/role` already
  handles `is_admin` and records the `admin.is_admin_change` audit
  event (which is how the incident was diagnosed).

## i18n

New `ru.admin.admins` group: section title, add button, search
placeholder, picker empty state, confirm-grant copy, confirm-revoke
copy, self-revoke warning, generic error. Obsolete keys removed:
`ru.admin.users.adminTitleOn`, `ru.admin.users.adminTitleOff`.

## Testing

No server logic changed → no new unit tests; typecheck + existing
suite must stay green. Manual verification matrix:

1. Grant: panel → add → search → tap user → confirm → user appears in
   admins list; audit shows `admin.is_admin_change` false→true.
2. Stray tap anywhere in the users table can no longer touch admin
   state (controls gone).
3. Revoke other admin: confirm dialog → removed from list.
4. Self-revoke: harder warning shown; after confirm, Mini App access
   drops (403 / access-denied state).
5. Revoked bootstrap admin reappears as admin after the next cold start.
6. Users table shows no crown indicators and no admin buttons.

## Out of scope

- Restricting picker to tutors (rejected — any user).
- Last-admin / self-revoke server guards (rejected — bootstrap admin
  always exists).
- Any change to `ensureBootstrapAdmin` semantics.
- Per-admin permission tiers.
