-- Per-source student invite links for advertisers / external campaigns.
-- Unlike teacher_invites (one-shot, per-person), these are multi-use and
-- track "where did this student come from". A signup that opens
-- t.me/<bot>?start=src_<slug> writes subscriptions.acquisition_source_id
-- on the new row.

create table public.acquisition_sources (
  id                  bigserial primary key,
  slug                text unique not null,
  label               text not null,
  created_by_user_id  bigint not null references public.users(id) on delete restrict,
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz
);

create index acquisition_sources_active_slug_idx
  on public.acquisition_sources (slug)
  where revoked_at is null;

alter table public.subscriptions
  add column acquisition_source_id bigint references public.acquisition_sources(id) on delete set null;

create index subscriptions_acq_source_idx
  on public.subscriptions (acquisition_source_id)
  where acquisition_source_id is not null;
