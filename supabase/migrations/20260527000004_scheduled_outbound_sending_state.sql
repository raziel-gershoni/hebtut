-- Add a `sending` intermediate state so the deliver-scheduled cron can
-- atomically claim a row (queued → sending) BEFORE invoking the TG send.
-- Without the claim step, concurrent cron ticks (or a failed status
-- writeback after a successful TG send) re-pick the same row and the
-- student receives the same video on every cron tick.

alter table public.scheduled_outbound
  drop constraint if exists scheduled_outbound_status_check;

alter table public.scheduled_outbound
  add constraint scheduled_outbound_status_check
  check (status in ('queued', 'sending', 'delivered', 'failed', 'cancelled'));
