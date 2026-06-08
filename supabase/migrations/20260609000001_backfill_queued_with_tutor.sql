-- Students stuck in `queued` who already have at least one tutor link were
-- missed by the queued→trial flip — the single-pair POST /api/admin/links
-- flipped them, but the bulk endpoint (used by the pair UI) did not. Backfill
-- using the first link's timestamp as the canonical trial start so the clock
-- matches when they actually got a tutor. Rows whose 3-day window is already
-- past will deriveStatus as `trial_expired` on the next read — accurate.

with first_links as (
  select student_id, min(created_at) as first_linked_at
  from public.student_teachers
  group by student_id
)
update public.subscriptions s
set
  status = 'trial',
  trial_started_at = fl.first_linked_at,
  trial_ends_at = fl.first_linked_at + interval '3 days',
  updated_at = now()
from first_links fl
where s.user_id = fl.student_id
  and s.status = 'queued';
