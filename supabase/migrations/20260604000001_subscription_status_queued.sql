-- New students land in a 'queued' state until they are linked to their
-- first tutor. At that point /api/admin/links flips them to 'trial' with
-- a fresh 2-day clock. Existing students stay where they are.
--
-- Postgres forbids ADD VALUE + USE-OF-NEW-VALUE in the same transaction
-- (the migration runner wraps each file in sql.begin), so the matching
-- `alter table … set default 'queued'` lives in the next migration file.
alter type public.subscription_status add value if not exists 'queued' before 'trial';
