# Referrals Master Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `referrals_enabled` admin switch (default off) that fully freezes the referral program — UI, attribution, and the payment bonus — when off.

**Architecture:** New `app_settings` key `referrals_enabled`, read via `getReferralsEnabled()`, following the exact pattern of `transcripts_enabled`/`billing_stars_enabled`. The switch gates five surfaces; existing referral data is left dormant. Spec: `docs/superpowers/specs/2026-06-11-referrals-toggle-design.md`.

**Tech Stack:** Next.js 14 route handlers + client components, Supabase (`app_settings`), zod, Tailwind tg-* tokens, `ru.*` i18n. Tests: vitest.

**Binding conventions:**
- User-visible Russian strings live in `src/lib/i18n/` (CLAUDE.md). New strings go in the matching surface module.
- Default for the new key is `false` everywhere (= referrals disabled now), matching every other `*_enabled` default in the settings GET.
- After each task: `npx tsc --noEmit` clean and `npx vitest run` green. Lint touched files with `npx eslint <files>`.
- No DB migration is required — `app_settings` rows are created on first PATCH; absent key reads as `false` via `getBoolSetting`.

---

### Task 1: Server settings helper + admin settings API

**Files:**
- Modify: `src/server/settings.ts`
- Modify: `src/app/api/admin/settings/route.ts`

- [ ] **Step 1: Add the `getReferralsEnabled` helper**

In `src/server/settings.ts`, directly before `export function invalidateSettingsCache()`, add:

```ts
/**
 * Referral program master switch. Default OFF (absent key reads false).
 * When off, the whole referral flow is frozen — student UI hidden, ref_
 * signups not attributed, and the first-payment bonus not granted to
 * either side. Existing tokens / attributions stay in the DB, dormant.
 */
export function getReferralsEnabled(): Promise<boolean> {
  return getBoolSetting("referrals_enabled");
}
```

- [ ] **Step 2: Add the key to the admin settings whitelist + response**

In `src/app/api/admin/settings/route.ts`:

In `KEYS` (after `translation_enabled: z.boolean(),`):
```ts
  referrals_enabled: z.boolean(),
```

In `interface SettingsResponse` (after `translation_enabled: boolean;`):
```ts
  referrals_enabled: boolean;
```

In the GET `out` defaults object (after `translation_enabled: false,`):
```ts
    referrals_enabled: false,
```

In the GET row-mapping chain, add a final `else if` after the `translation_enabled` branch:
```ts
    } else if (row.key === "referrals_enabled") {
      out.referrals_enabled = row.value === true;
    }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/settings.ts src/app/api/admin/settings/route.ts
git commit -m "feat(referrals): referrals_enabled setting + getReferralsEnabled helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Admin settings panel toggle + i18n

**Files:**
- Modify: `src/lib/i18n/admin.ts`
- Modify: `src/components/AdminSettingsPanel.tsx`

- [ ] **Step 1: Add the i18n toggle copy**

In `src/lib/i18n/admin.ts`, inside `settings.toggles` (after the `translation: { … }` block, before the closing `},` of `toggles`), add:

```ts
    referrals: {
      title: "Реферальная программа",
      on: "Пользователи могут приглашать друзей по ссылке. За первую оплату приглашённого оба получают бонусные дни.",
      off: "Приглашения отключены: раздел в мини-приложении скрыт, новые переходы по ссылкам не засчитываются, бонусы за оплату не начисляются.",
    },
```

- [ ] **Step 2: Add the toggle to the panel**

In `src/components/AdminSettingsPanel.tsx`:

In the `Settings` interface (after `translation_enabled: boolean;`):
```ts
  referrals_enabled: boolean;
```

In the `TOGGLES` array (after the `translation` row):
```ts
  { key: "referrals_enabled", ...ru.admin.settings.toggles.referrals },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx eslint src/components/AdminSettingsPanel.tsx src/lib/i18n/admin.ts` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/admin.ts src/components/AdminSettingsPanel.tsx
git commit -m "feat(referrals): admin Settings switch for the referral program

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Gate signup attribution

**Files:**
- Modify: `src/server/handlers/start.ts`

- [ ] **Step 1: Import the helper**

In `src/server/handlers/start.ts`, confirm `@/server/settings` is imported; add `getReferralsEnabled` to that import (or add a new import line):
```ts
import { getReferralsEnabled } from "@/server/settings";
```
(If an existing `import { … } from "@/server/settings";` line is present, add `getReferralsEnabled` to its named list instead of duplicating.)

- [ ] **Step 2: Gate the attribution block**

Change the attribution guard from:
```ts
    if (refToken) {
```
to:
```ts
    if (refToken && (await getReferralsEnabled())) {
```

This skips the referrer lookup, the `subscriptions` upsert of `referred_by_user_id`, and the `referral.attributed` audit when referrals are off. (The acquisition-source block below it is unaffected.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/handlers/start.ts
git commit -m "feat(referrals): ignore ref_ signup attribution when referrals are off

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Gate the payment bonus (money path) + test

**Files:**
- Modify: `src/server/subscriptions.ts`
- Test: `tests/referral-bonus-gate.test.ts` (new)

The bonus is computed in `applySuccessfulPayment` via:
```ts
const refereeWillGetReferralBonus = wasFirstPaid && row.referred_by_user_id != null;
```
Gating this single boolean short-circuits both the referee +30 (`refereeFinalEnd`) and the referrer credit block (which is `if (refereeWillGetReferralBonus && …)`).

Because `applySuccessfulPayment` is a large Supabase-coupled function, the test targets a small extracted pure helper rather than mocking Supabase.

- [ ] **Step 1: Write the failing test**

Create `tests/referral-bonus-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldApplyReferralBonus } from "@/server/subscriptions";

describe("shouldApplyReferralBonus", () => {
  it("applies when enabled, first paid period, and a referrer exists", () => {
    expect(shouldApplyReferralBonus(true, true, 42)).toBe(true);
  });

  it("does NOT apply when referrals are disabled", () => {
    expect(shouldApplyReferralBonus(false, true, 42)).toBe(false);
  });

  it("does NOT apply when it is not the first paid period", () => {
    expect(shouldApplyReferralBonus(true, false, 42)).toBe(false);
  });

  it("does NOT apply when there is no referrer", () => {
    expect(shouldApplyReferralBonus(true, true, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/referral-bonus-gate.test.ts`
Expected: FAIL — `shouldApplyReferralBonus` is not exported.

- [ ] **Step 3: Add the pure helper**

In `src/server/subscriptions.ts`, add (near the other top-level helpers, e.g. just below the `REFERRAL_BONUS_PER_SIDE_DAYS` constant):

```ts
/**
 * Whether a successful payment should grant the referral bonus. All three
 * must hold: the program is enabled, this is the referee's first paid
 * period, and they were attributed to a referrer. Gating this one value
 * short-circuits BOTH the referee bonus and the referrer credit.
 */
export function shouldApplyReferralBonus(
  referralsEnabled: boolean,
  wasFirstPaid: boolean,
  referredByUserId: number | null,
): boolean {
  return referralsEnabled && wasFirstPaid && referredByUserId != null;
}
```

- [ ] **Step 4: Use the helper inside `applySuccessfulPayment`**

Add the import of the settings helper at the top of `src/server/subscriptions.ts` (add to the existing `@/server/settings` import if present, else a new line):
```ts
import { getReferralsEnabled } from "@/server/settings";
```

Replace:
```ts
  const refereeWillGetReferralBonus = wasFirstPaid && row.referred_by_user_id != null;
```
with:
```ts
  const referralsEnabled = await getReferralsEnabled();
  const refereeWillGetReferralBonus = shouldApplyReferralBonus(
    referralsEnabled,
    wasFirstPaid,
    row.referred_by_user_id,
  );
```

Leave everything downstream (`refereeFinalEnd`, the referrer-credit `if` block, the audit `referral_bonus_applied` meta) unchanged — they already key off `refereeWillGetReferralBonus`.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/referral-bonus-gate.test.ts` → PASS (4/4).

- [ ] **Step 6: Verify the whole suite + types**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/subscriptions.ts tests/referral-bonus-gate.test.ts
git commit -m "feat(referrals): no payment bonus to either side when referrals are off

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Gate the student referrals API

**Files:**
- Modify: `src/app/api/student/referrals/route.ts`

- [ ] **Step 1: Short-circuit when disabled**

In `src/app/api/student/referrals/route.ts`, add the import:
```ts
import { getReferralsEnabled } from "@/server/settings";
```

Immediately after the role check (after the `if (!hasRole(user, ["student"])) { … }` block, before `const sb = getServiceRoleClient();`), add:
```ts
  if (!(await getReferralsEnabled())) {
    return Response.json({ enabled: false }, { headers: noStoreHeaders });
  }
```

No token is minted and no counts are read when off. (The success response keeps its existing shape — the client treats a missing `enabled` field as enabled, see Task 7.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/student/referrals/route.ts
git commit -m "feat(referrals): student referrals API returns enabled:false when off

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Surface the flag in the student summary

**Files:**
- Modify: `src/app/api/student/summary/route.ts`

- [ ] **Step 1: Read and return the flag**

In `src/app/api/student/summary/route.ts`, the GET already computes
`const starsEnabled = await getBillingStarsEnabled();`. Add the
referrals read next to it; update the import from `@/server/settings`
to include `getReferralsEnabled` (add to the existing named import):

```ts
  const starsEnabled = await getBillingStarsEnabled();
  const referralsEnabled = await getReferralsEnabled();
```

In the `Response.json({ … })` object, add a top-level field (after the
`billing: { stars_enabled: starsEnabled },` line):

```ts
      referrals_enabled: referralsEnabled,
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/student/summary/route.ts
git commit -m "feat(referrals): expose referrals_enabled in student summary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Hide the menu item + page unavailable state

**Files:**
- Modify: `src/components/MiniAppMenu.tsx`
- Modify: `src/app/student/referrals/page.tsx`
- Modify: `src/lib/i18n/student.ts`

- [ ] **Step 1: i18n — unavailable copy**

In `src/lib/i18n/student.ts`, inside the `referrals` group (the `const referrals = { … }` block), add two keys (place them near `lockedHeader`/`lockedBody`):

```ts
  unavailableHeader: "Недоступно",
  unavailableBody: "Реферальная программа сейчас отключена.",
```

- [ ] **Step 2: MiniAppMenu — thread the flag and gate the item**

In `src/components/MiniAppMenu.tsx`:

Add a state for the flag alongside `kind`:
```ts
  const [referralsEnabled, setReferralsEnabled] = useState(false);
```

Extend the summary fetch's `.then` to read the new field. Change:
```ts
      .then((d: { status?: { kind?: StatusKind } } | null) => {
        if (!cancelled && d?.status?.kind) setKind(d.status.kind);
      })
```
to:
```ts
      .then(
        (
          d: { status?: { kind?: StatusKind }; referrals_enabled?: boolean } | null,
        ) => {
          if (cancelled) return;
          if (d?.status?.kind) setKind(d.status.kind);
          setReferralsEnabled(d?.referrals_enabled === true);
        },
      )
```

Change `isItemVisible` to take the flag and gate referrals on it:
```ts
function isItemVisible(
  href: string,
  kind: StatusKind | null,
  referralsEnabled: boolean,
): boolean {
  switch (href) {
    case "/student/freeze":
      return kind === "active";
    case "/student/referrals":
      return (
        referralsEnabled && kind != null && kind !== "trial" && kind !== "trial_ending"
      );
    default:
      return true;
  }
}
```

Update the call site:
```ts
  const visibleItems = ITEMS.filter((it) => isItemVisible(it.href, kind, referralsEnabled));
```

- [ ] **Step 3: Referrals page — unavailable state**

In `src/app/student/referrals/page.tsx`, the `Body` component's `load()`
fetches `/api/student/referrals`. When off, the API returns
`{ enabled: false }` (no `url`). Add a `"disabled"` gate state.

Change the gate type:
```ts
  const [gate, setGate] = useState<"loading" | "locked" | "open" | "disabled">("loading");
```

In `load()`, branch on the response shape. Replace:
```ts
    if (!r.ok) return;
    setData((await r.json()) as ReferralsData);
```
with:
```ts
    if (!r.ok) return;
    const json = (await r.json()) as ReferralsData | { enabled: false };
    if ("enabled" in json && json.enabled === false) {
      setGate("disabled");
      return;
    }
    setData(json as ReferralsData);
```

Add the unavailable render branch — place it directly before the
`if (gate === "locked")` block:
```ts
  if (gate === "disabled") {
    return (
      <div className="rounded-2xl bg-tg-bg-section p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          {ru.student.referrals.unavailableHeader}
        </p>
        <p className="text-sm text-tg-text-subtitle">
          {ru.student.referrals.unavailableBody}
        </p>
      </div>
    );
  }
```

Note: the page's gate is driven by the summary fetch (trial rule); the
`load()` runs only when `gate === "open"`. So when referrals are off but
the trial has ended, the summary sets `gate="open"`, `load()` runs, sees
`enabled:false`, and flips `gate="disabled"`. When the trial hasn't
ended, the existing `"locked"` panel shows (load never runs) — also a
correct "not available" outcome. Both paths avoid leaking a link.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean. Run: `npx eslint src/components/MiniAppMenu.tsx src/app/student/referrals/page.tsx src/lib/i18n/student.ts` → clean. Run: `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MiniAppMenu.tsx src/app/student/referrals/page.tsx src/lib/i18n/student.ts
git commit -m "feat(referrals): hide student menu item + page when referrals are off

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- `npx tsc --noEmit` clean; `npx vitest run` green (4 new tests).
- Manual matrix (admin flips the switch both ways):
  1. OFF → student menu has no «Пригласить»; direct nav to
     `/student/referrals` shows «Недоступно».
  2. OFF → a `ref_<token>` signup creates no `referred_by_user_id` and
     no `referral.attributed` audit.
  3. OFF → an attributed referee paying gets the base period only;
     neither side credited; `referral_bonus_applied:false` in the audit.
  4. ON → all four behaviors return to the prior state (menu item shows
     after trial ends, attribution fires, bonus applies).
  5. Журнал shows `settings.update` for `referrals_enabled` on each flip.
