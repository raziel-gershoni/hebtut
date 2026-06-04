-- Backfill: every student currently in 'trial' who has never been
-- linked to a tutor predates the queued-status migration (status was
-- the default 'trial'). They are semantically queued — bring the
-- column in line so the admin badge + access gate behave consistently.
-- One-way: students who already have a tutor link stay in their
-- current status.
update public.subscriptions s
set status = 'queued', updated_at = now()
where s.status = 'trial'
  and not exists (
    select 1 from public.student_teachers st where st.student_id = s.user_id
  );
