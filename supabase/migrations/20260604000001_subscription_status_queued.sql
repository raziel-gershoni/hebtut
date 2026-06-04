-- New students land in a 'queued' state until they are linked to their
-- first tutor. At that point /api/admin/links flips them to 'trial' with
-- a fresh 3-day clock. Existing students stay where they are; only
-- subscriptions.status default changes for new rows.
alter type public.subscription_status add value if not exists 'queued' before 'trial';

alter table public.subscriptions alter column status set default 'queued';
