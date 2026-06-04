-- Per-user tag assignments. Reuses the existing media_tags dictionary
-- (admin-managed flat catalog) — same tags now apply both to media
-- library items and to students. Tutors set these from inside the
-- student's chat card; admins set them from the admin panel.

create table public.user_tag_links (
  user_id             bigint not null references public.users(id) on delete cascade,
  tag_id              bigint not null references public.media_tags(id) on delete cascade,
  created_by_user_id  bigint not null references public.users(id) on delete restrict,
  created_at          timestamptz not null default now(),
  primary key (user_id, tag_id)
);

create index user_tag_links_user_idx on public.user_tag_links (user_id);
create index user_tag_links_tag_idx  on public.user_tag_links (tag_id);
