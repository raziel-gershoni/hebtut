-- Feedback chat: any non-admin user has a persistent text-only thread with
-- the admin pool. User side lives in the Mini App at /feedback; admin side
-- in /admin/feedback. The bot is the wake-up channel only — admin replies
-- trigger a DM to the user with a web_app button to jump back into the app.

create table public.feedback_messages (
  id            bigserial primary key,
  user_id       bigint not null references public.users(id) on delete cascade,
  -- 'in'  = from the user toward the admin pool
  -- 'out' = from an admin toward the user
  direction     text not null check (direction in ('in','out')),
  -- For 'in' rows this equals user_id. For 'out' rows it's the admin who
  -- replied (the pool can be multiple people; ON DELETE SET NULL preserves
  -- history if an admin user is later deleted).
  author_id     bigint references public.users(id) on delete set null,
  text_content  text not null,
  status        text not null default 'sent' check (status in ('sent','read')),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index feedback_messages_user_idx
  on public.feedback_messages (user_id, created_at desc);

-- Admin-side unread axis: every user-written message that no admin has
-- marked read yet. Powers the unread badge in the admin list.
create index feedback_messages_unread_in_idx
  on public.feedback_messages (created_at desc)
  where direction = 'in' and status = 'sent';

-- User-side unread axis: every admin-written message the user hasn't
-- marked read yet (per user_id, since each user only sees their own).
create index feedback_messages_unread_out_idx
  on public.feedback_messages (user_id, created_at desc)
  where direction = 'out' and status = 'sent';

-- Realtime publication so both /feedback and /admin/feedback can update
-- their views live without polling.
alter publication supabase_realtime add table public.feedback_messages;
