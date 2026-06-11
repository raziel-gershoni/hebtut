# Admins Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move admin grant/revoke out of the per-row users-table toggle into a dedicated «Админы» panel where both actions require deliberate, confirmed steps.

**Architecture:** Pure client-side reshuffle — zero API changes. A new `AdminAdminsPanel` component receives the already-fetched `users` list from the admin page (same pattern as `AdminConnectionsPanel`), renders current admins with confirmed revoke, and a search-picker dialog with confirmed grant. The users table loses every admin control/indicator. Spec: `docs/superpowers/specs/2026-06-11-admins-panel-design.md`.

**Tech Stack:** Next.js 14 client components, Tailwind (tg-* theme tokens), existing `ConfirmDialog`/`Avatar` components, `ru.*` i18n modules.

**Conventions that bind every task:**
- All user-visible strings live in `src/lib/i18n/admin.ts` (CLAUDE.md rule) — never inline Russian in components.
- Existing endpoint `PATCH /api/admin/users/[id]/role` with body `{ is_admin: boolean }` performs the mutation and records the `admin.is_admin_change` audit event. Do NOT touch the API.
- After each task: `npx tsc --noEmit` must be clean and `npx vitest run` must pass (151 tests at time of writing; no new tests in this plan — no server logic changes).

---

### Task 1: i18n — new `admins` group

**Files:**
- Modify: `src/lib/i18n/admin.ts`

- [ ] **Step 1: Add the `admins` group**

In `src/lib/i18n/admin.ts`, directly BEFORE the line `const users = {` (line ~128), insert:

```ts
const admins = {
  addButton: "Добавить админа",
  pickerTitle: "Новый админ",
  searchPlaceholder: "Поиск по имени или @username",
  pickerEmpty: "Никого не нашлось",
  emptyList: "Админов нет",
  confirmGrantTitle: "Сделать админом?",
  confirmGrantBody: (name: string) =>
    `${name || "Пользователь"} получит полный доступ к админке: пользователи, связи, настройки, рассылки.`,
  confirmRevokeTitle: "Снять права админа?",
  confirmRevokeBody: (name: string) =>
    `${name || "Пользователь"} больше не сможет управлять пользователями и связями.`,
  confirmRevokeSelfBody:
    "Это ваши собственные права. Вы потеряете доступ к админке сразу после подтверждения.",
  revokeAria: (name: string) => `Снять права админа у ${name}`,
  error: "Не удалось сохранить. Попробуй ещё раз.",
};
```

- [ ] **Step 2: Add the section title**

In the same file, inside `pages` → `sections` (line ~429), add after `users: "Пользователи",`:

```ts
    admins: "Админы",
```

- [ ] **Step 3: Register the group in the export**

At the bottom of the file, in `export const admin = { … }`, add `admins,` on the line after `users,`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/admin.ts
git commit -m "feat(i18n): strings for the admins panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `AdminAdminsPanel` component

**Files:**
- Create: `src/components/AdminAdminsPanel.tsx`

- [ ] **Step 1: Create the component with exactly this content**

```tsx
"use client";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import type { AdminUser } from "./AdminUsersTable";

interface AdminAdminsPanelProps {
  jwt: string;
  /** users.id of the admin viewing the panel — drives the self-revoke warning. */
  selfId: number;
  users: AdminUser[];
  loaded: boolean;
  /** Page-owned refetch so the users table and connections panel stay in sync. */
  refetch: () => Promise<void>;
}

type PendingChange =
  | { kind: "grant"; user: AdminUser }
  | { kind: "revoke"; user: AdminUser };

function avatarUrl(jwt: string, u: { id: number; has_avatar: boolean }): string | undefined {
  return u.has_avatar ? `/api/avatar/${u.id}?token=${encodeURIComponent(jwt)}` : undefined;
}

function displayName(u: AdminUser): string {
  return u.preferred_name ?? u.name ?? `#${u.tg_user_id}`;
}

/**
 * Dedicated grant/revoke surface for the is_admin flag. Replaces the old
 * per-row 👤/👑 toggle in AdminUsersTable, where granting fired on a single
 * unconfirmed tap (a misclick made a student an admin in prod). Both
 * directions now require opening this panel and passing a ConfirmDialog;
 * granting additionally requires picking the user from a search dialog.
 *
 * No API changes: PATCH /api/admin/users/[id]/role already mutates
 * is_admin and records the admin.is_admin_change audit event. Bootstrap
 * admins are intentionally NOT special-cased — revoking one is allowed
 * and ensureBootstrapAdmin silently re-grants on the next cold start.
 */
export function AdminAdminsPanel({ jwt, selfId, users, loaded, refetch }: AdminAdminsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const admins = useMemo(() => users.filter((u) => u.is_admin), [users]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !u.is_admin)
      .filter(
        (u) =>
          !q ||
          (u.preferred_name ?? "").toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.tg_username ?? "").toLowerCase().includes(q),
      );
  }, [users, query]);

  async function patchIsAdmin(id: number, is_admin: boolean): Promise<void> {
    setError(null);
    const r = await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_admin }),
    });
    if (!r.ok) {
      setError(ru.admin.admins.error);
      return;
    }
    await refetch();
  }

  return (
    <section>
      {error && (
        <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium mb-3">
          {error}
        </div>
      )}

      {!loaded && (
        <div className="text-center py-6">
          <Spinner />
        </div>
      )}

      {loaded && admins.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {ru.admin.admins.emptyList}
        </div>
      )}

      {loaded && admins.length > 0 && (
        <ul className="space-y-2">
          {admins.map((u) => (
            <li
              key={u.id}
              className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
            >
              <Avatar name={displayName(u)} isAdmin imageUrl={avatarUrl(jwt, u)} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-medium tracking-tight truncate">{displayName(u)}</div>
                <div className="mt-0.5 text-[11px] text-tg-text-hint truncate tabular-nums">
                  {u.tg_username ? `@${u.tg_username} · ` : ""}
                  {u.tg_user_id}
                </div>
              </div>
              <button
                type="button"
                aria-label={ru.admin.admins.revokeAria(displayName(u))}
                title={ru.admin.admins.revokeAria(displayName(u))}
                onClick={() => setPending({ kind: "revoke", user: u })}
                className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg bg-tg-bg-secondary text-tg-text-hint transition-transform active:scale-95"
              >
                <span aria-hidden>✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loaded && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setPickerOpen(true);
          }}
          className="mt-3 w-full min-h-10 h-10 rounded-full bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99]"
        >
          + {ru.admin.admins.addButton}
        </button>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-40 animate-fade-in">
          <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold tracking-tight">{ru.admin.admins.pickerTitle}</h2>
              <button
                type="button"
                aria-label={ru.common.close}
                onClick={() => setPickerOpen(false)}
                className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-tg-bg-secondary text-tg-text-hint"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ru.admin.admins.searchPlaceholder}
              className="w-full h-10 px-3 mb-3 rounded-xl bg-tg-bg-secondary text-tg-text text-sm outline-none focus:ring-2 focus:ring-tg-button/40"
            />
            <ul className="space-y-1 overflow-y-auto">
              {candidates.length === 0 && (
                <li className="p-4 text-center text-sm text-tg-text-hint">
                  {ru.admin.admins.pickerEmpty}
                </li>
              )}
              {candidates.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setPending({ kind: "grant", user: u })}
                    className="w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors active:bg-tg-bg-secondary/60"
                  >
                    <Avatar name={displayName(u)} imageUrl={avatarUrl(jwt, u)} size={32} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-sm font-medium truncate">{displayName(u)}</div>
                      <div className="text-[11px] text-tg-text-hint truncate tabular-nums">
                        {u.tg_username ? `@${u.tg_username} · ` : ""}
                        {u.tg_user_id}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "grant"
            ? ru.admin.admins.confirmGrantTitle
            : ru.admin.admins.confirmRevokeTitle
        }
        body={
          pending?.kind === "grant"
            ? ru.admin.admins.confirmGrantBody(displayName(pending.user))
            : pending
              ? pending.user.id === selfId
                ? ru.admin.admins.confirmRevokeSelfBody
                : ru.admin.admins.confirmRevokeBody(displayName(pending.user))
              : ""
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await patchIsAdmin(pending.user.id, pending.kind === "grant");
          setPending(null);
          setPickerOpen(false);
        }}
      />
    </section>
  );
}
```

Notes for the implementer:
- `ConfirmDialog` renders at `z-50`, the picker overlay at `z-40` — the confirm intentionally stacks on top of the open picker.
- `ru.common.close` already exists ("Закрыть").
- `Avatar` props (`name`, `imageUrl`, `size`, `isAdmin`) are defined in `src/components/Avatar.tsx:4-16`; 32 is a valid size.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx eslint src/components/AdminAdminsPanel.tsx` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/AdminAdminsPanel.tsx
git commit -m "feat(admins): dedicated panel — confirmed grant via search picker, confirmed revoke

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Mount the panel on /admin

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Thread `userId` from AppShell**

In `AdminPage` (line ~25), the AppShell render-prop ctx already exposes `userId` (`src/components/AppShell.tsx:72`). Change:

```tsx
      {({ jwt, isAdmin }) => {
```
to
```tsx
      {({ jwt, isAdmin, userId }) => {
```
and
```tsx
        return <AdminBody jwt={jwt} />;
```
to
```tsx
        return <AdminBody jwt={jwt} selfId={userId} />;
```

- [ ] **Step 2: Accept the prop in AdminBody**

Change the `AdminBody` signature (line ~43):

```tsx
function AdminBody({ jwt, selfId }: { jwt: string; selfId: number }) {
```

- [ ] **Step 3: Import and mount the panel**

Add to the imports:

```tsx
import { AdminAdminsPanel } from "@/components/AdminAdminsPanel";
```

Insert directly AFTER the closing `</CollapsibleSection>` of the `id="users"` section (line ~101):

```tsx
      <CollapsibleSection id="admins" title={ru.admin.pages.sections.admins}>
        <AdminAdminsPanel jwt={jwt} selfId={selfId} users={users} loaded={loaded} refetch={refetch} />
      </CollapsibleSection>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admins): mount admins panel on /admin after users section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Strip all admin traces from the users table

**Files:**
- Modify: `src/components/AdminUsersTable.tsx`
- Modify: `src/lib/i18n/admin.ts`

- [ ] **Step 1: Remove the `admin` pending variant**

In `src/components/AdminUsersTable.tsx` (line ~43), change `PendingChange` to:

```ts
type PendingChange =
  | { kind: "role"; id: number; role: AdminUser["role"] }
  | { kind: "delete"; id: number; name: string; ban: boolean }
  | { kind: "reset-onboarding"; id: number; name: string };
```

- [ ] **Step 2: Narrow `patchRole`**

(line ~114) — `is_admin` is no longer sent from this component:

```ts
  async function patchRole(id: number, body: { role?: AdminUser["role"] }) {
```

- [ ] **Step 3: Delete the 👤/👑 button**

Delete the whole button block at lines ~317-335 (starts `<button` with `title={u.is_admin ? ru.admin.users.adminTitleOn : …}`, ends `</button>` right before `<div className="relative shrink-0">`).

- [ ] **Step 4: Remove the crown from the avatar**

In the row's `Avatar` usage (line ~246-250), delete the `isAdmin={u.is_admin}` prop line. (Keep the `Avatar` component's `isAdmin` prop itself — AppShell and the new panel still use it.)

- [ ] **Step 5: Remove the admin branches from the ConfirmDialog**

In the `<ConfirmDialog>` at the bottom (line ~470-503):
- `title`: remove the `pending?.kind === "admin" ? ru.admin.users.confirmAdminOffTitle :` arm.
- `body`: remove the `pending?.kind === "admin" ? ru.admin.users.confirmAdminOffBody :` arm.
- `onConfirm`: remove the line `else if (pending.kind === "admin") await patchRole(pending.id, { is_admin: pending.is_admin });`.

Resulting dialog block:

```tsx
      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "delete"
            ? pending.ban
              ? ru.admin.users.confirmBanTitle
              : ru.admin.users.confirmDeleteTitle
            : pending?.kind === "reset-onboarding"
              ? ru.admin.users.confirmResetOnboardingTitle
              : ru.admin.users.confirmRoleTitle
        }
        body={
          pending?.kind === "delete"
            ? pending.ban
              ? ru.admin.users.confirmBanBody(pending.name)
              : ru.admin.users.confirmDeleteBody(pending.name)
            : pending?.kind === "reset-onboarding"
              ? ru.admin.users.confirmResetOnboardingBody(pending.name)
              : ru.admin.users.confirmRoleBody
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "role") await patchRole(pending.id, { role: pending.role });
          else if (pending.kind === "delete") await deleteUser(pending.id, pending.ban);
          else if (pending.kind === "reset-onboarding") await resetOnboarding(pending.id);
          setPending(null);
        }}
      />
```

- [ ] **Step 6: Delete the obsolete i18n keys**

In `src/lib/i18n/admin.ts`, inside `const users = { … }`, delete these four entries (and the `// Admin chip` comment above the first two):

```ts
  adminTitleOn: "Снять права админа",
  adminTitleOff: "Сделать админом",
  confirmAdminOffTitle: "Снять права админа?",
  confirmAdminOffBody:
    "Без прав админа этот пользователь больше не сможет управлять пользователями и связями.",
```

- [ ] **Step 7: Verify nothing references the removed keys**

Run: `grep -rn "adminTitleOn\|adminTitleOff\|confirmAdminOff" src/` → no matches.
Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass. Run: `npx eslint src/components/AdminUsersTable.tsx` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/AdminUsersTable.tsx src/lib/i18n/admin.ts
git commit -m "feat(admins): users table loses admin toggle, crown, and confirm branch

Granting admin used to fire on a single unconfirmed tap of a 28px
per-row button — the misclick that made a student an admin in prod.
All admin management now lives in the dedicated panel.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (manual, after all tasks)

1. `/admin` → «Админы» section lists current admins.
2. Add flow needs three deliberate acts: open picker → tap user → confirm.
3. Revoke confirmed; revoking yourself shows the harder warning; after confirming it, the Mini App drops to access-denied on next interaction.
4. Users table: no crown, no admin button anywhere.
5. Журнал shows `admin.is_admin_change` entries for both directions.
