# Referrals master switch — design

**Date:** 2026-06-11
**Status:** approved (brainstormed interactively)

## Problem

The referral program (share-link → attribution → +30-day bonus to both
sides on first payment) needs to be turned off for now, with an admin
switch to bring it back without a redeploy.

## Decision

Add a global `referrals_enabled` setting in `app_settings`, surfaced as
a switch in the admin **Настройки** panel — the exact pattern used by
`transcripts_enabled` / `billing_stars_enabled`. **Default off**, so
shipping it disables referrals immediately; flipping it on restores the
prior behavior in full. Existing data (`users.referral_token`,
`subscriptions.referred_by_user_id`) is left untouched — dormant while
off, resumes cleanly when on.

**Scope = full freeze.** When off, nothing referral-related happens.

## Surfaces gated by the switch

| Surface | File | When OFF |
|---|---|---|
| Student menu item | `MiniAppMenu.tsx` | «Пригласить» hidden (master override on top of the existing trial-ended rule) |
| Referrals page | `student/referrals/page.tsx` | shows a short "недоступно" state |
| Referrals API | `api/student/referrals/route.ts` | returns `{ enabled: false }`, no token mint, no counts |
| Signup attribution | `server/handlers/start.ts` | a `ref_<token>` start is ignored — no `referred_by_user_id` written, no `referral.attributed` audit |
| Money path | `server/subscriptions.ts` `applySuccessfulPayment` | one gate on `refereeWillGetReferralBonus` short-circuits BOTH the referee +30 and the referrer credit |

## Plumbing (established pattern)

- `server/settings.ts` → `getReferralsEnabled()` (`getBoolSetting("referrals_enabled")`).
- `api/admin/settings/route.ts` → add `referrals_enabled: z.boolean()` to
  `KEYS`, to `SettingsResponse`, to the GET defaults map, and to the GET
  row-mapping `if/else` chain.
- `AdminSettingsPanel.tsx` → add `referrals_enabled` to the `Settings`
  interface and a `TOGGLES` row.
- `ru.admin.settings.toggles.referrals` → `{ title, on, off }`.
- `api/student/summary/route.ts` → add `referrals_enabled` to the JSON
  (alongside the existing `getBillingStarsEnabled()` read) so the menu
  can gate without a second fetch.

## Data flow when OFF

1. Student opens Mini App → `/api/student/summary` returns
   `referrals_enabled: false` → `MiniAppMenu` hides the item.
2. Direct nav to `/student/referrals` → `/api/student/referrals`
   returns `{ enabled: false }` → page shows the unavailable state.
3. New user starts via `ref_<token>` → `start.ts` skips attribution.
4. Any referee pays → `applySuccessfulPayment` grants the normal period
   only; no referral bonus to either side.

## Testing

- Unit: extend/guard `applySuccessfulPayment` — assert that with the
  toggle OFF a first-paid referee with a non-null `referred_by_user_id`
  gets the base period only and the referrer is not credited; with ON
  the bonus still applies. (The money path is the one with regression
  risk; gate it behind a pure-enough seam or a stubbed
  `getReferralsEnabled`.)
- Manual matrix (toggle both directions): menu item hides/shows;
  referrals page open vs "недоступно"; `ref_` signup attributed vs
  ignored (check `referral.attributed` audit); paid referee bonus
  applied vs not.

## Out of scope

- Deleting or migrating existing referral tokens / attributions.
- Per-user referral controls.
- Changing the existing "referrals open only after trial ends" rule
  (it stays; the switch is a master override layered above it).
- Acquisition-source (advertiser) links — separate feature, unaffected.
