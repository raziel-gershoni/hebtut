-- Two additive changes for the names-vs-handles overhaul:
--
-- 1) Onboarding adds a new step `awaiting_name` between video2 and
--    cta_record. The flow becomes:
--      welcome → video1 → video2 → AWAITING_NAME → cta_record → ...
--    The bot asks 'Как мне к тебе обращаться?' after Дальше, captures
--    the student's typed reply into users.name, then continues with the
--    record-CTA. Existing students mid-flow stay in their current state;
--    only NEW progressions hit awaiting_name.
--
-- 2) Global runtime flag `display_anonymous_handles_enabled` (default
--    false → real names). When OFF (default), peer-facing surfaces
--    (inbox, threads, fan-out notifications) show students' real names +
--    avatars. When ON (legacy mode), the adjective+animal handles with
--    emoji circles come back. Toggled from AdminSettingsPanel.

alter type public.onboarding_state add value if not exists 'awaiting_name';

insert into public.app_settings (key, value)
values ('display_anonymous_handles_enabled', 'false'::jsonb)
on conflict (key) do nothing;
