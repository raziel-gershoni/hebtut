-- Track whether we've already DM'd the student the "got it, hooking a
-- coach up" ack. Sent exactly once per student; subsequent inbound
-- messages from an unassigned student do not retrigger it (admin
-- fan-out still fires every time so admins keep seeing each new note).

alter table public.subscriptions
  add column unassigned_ack_sent_at timestamptz;
