-- Second half of the queued-status rollout: now that the 'queued' enum
-- value has been committed in 20260604000001, we can use it as the
-- column default. Splitting into two migrations is required by
-- Postgres's "unsafe use of new value of enum type" rule — the new
-- enum label is only usable in transactions that start AFTER the
-- ADD VALUE transaction commits.
alter table public.subscriptions alter column status set default 'queued';
