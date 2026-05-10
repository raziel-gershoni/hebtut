-- Gate Telegram Stars billing behind a runtime flag. Default false so the
-- feature is invisible to users on first deploy of this migration —
-- avoids any path where someone could accidentally pay in Stars while the
-- ops team is on manual billing. Admin can flip it on later from
-- AdminSettingsPanel without redeploying.
--
-- See: src/server/settings.ts (getBillingStarsEnabled), every Stars
-- user-facing surface (PayCTA, locked-template inline keyboard, cron
-- renewal DMs), and the server-side gate at /api/billing/invoice.

insert into public.app_settings (key, value)
values ('billing_stars_enabled', 'false'::jsonb)
on conflict (key) do nothing;
