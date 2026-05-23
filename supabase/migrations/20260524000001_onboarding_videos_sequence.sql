-- Sequence support: each onboarding video step (video1/video2/video3) can
-- now have up to 10 ordered clips. Bot sends clip 1 synchronously when the
-- step is reached; remaining clips are drip-sent via the existing onboarding
-- cron, one per ~minute tick, mimicking "videos recorded in real time".
--
-- Existing single-clip slots backfill to position=1 so today's behaviour is
-- preserved end-to-end.

alter table public.onboarding_videos drop constraint onboarding_videos_pkey;
alter table public.onboarding_videos add column id bigserial primary key;
alter table public.onboarding_videos add column position int not null default 1
  check (position >= 1 and position <= 10);

-- Deferrable unique so the admin "swap positions" RPC can do both updates
-- in one transaction without tripping the constraint mid-swap. INITIALLY
-- IMMEDIATE keeps normal inserts/updates checked at-statement-time.
alter table public.onboarding_videos
  add constraint onboarding_videos_step_position_unique
  unique (step, position) deferrable initially immediate;

-- Timer payload: lets the cron carry per-clip cursor (step, next_position)
-- without inventing a separate cursor table. Other timer kinds leave it null.
alter table public.onboarding_timers add column meta jsonb;

-- New kind for the drip dispatcher.
alter type public.onboarding_timer_kind add value if not exists 'video_sequence_next';

-- Atomic position swap for admin reorder. Defers the unique constraint
-- inside the transaction so both updates can land before the check fires.
create or replace function public.swap_onboarding_video_positions(
  id_a bigint,
  id_b bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  step_a text;
  pos_a int;
  step_b text;
  pos_b int;
begin
  select step, position into step_a, pos_a
    from public.onboarding_videos where id = id_a for update;
  select step, position into step_b, pos_b
    from public.onboarding_videos where id = id_b for update;
  if step_a is null or step_b is null then
    raise exception 'onboarding_videos row not found';
  end if;
  if step_a <> step_b then
    raise exception 'cannot swap positions across different steps';
  end if;
  set constraints onboarding_videos_step_position_unique deferred;
  update public.onboarding_videos set position = pos_b where id = id_a;
  update public.onboarding_videos set position = pos_a where id = id_b;
end;
$$;

grant execute on function public.swap_onboarding_video_positions(bigint, bigint) to service_role;
