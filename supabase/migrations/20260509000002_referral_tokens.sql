-- Per-user referral tokens. The bot's /start <ref_token> handler attributes
-- the new signup to the token's owner via subscriptions.referred_by_user_id;
-- the +30 days credit is applied later in applySuccessfulPayment when that
-- referee completes their FIRST paid period (capped at +90d for the referrer).

alter table public.users
  add column referral_token text unique;

create index users_referral_token_idx on public.users (referral_token)
  where referral_token is not null;

-- Backfill: every existing student gets a 12-char base64url-ish token. We use
-- gen_random_bytes from pgcrypto (already available in modern Postgres);
-- replace any URL-unfriendly chars to keep the t.me/?start=ref_<token> URL
-- copy-pasteable.
create extension if not exists pgcrypto;

update public.users u
set referral_token =
  translate(encode(gen_random_bytes(9), 'base64'), '+/=', '_-')
where u.role in ('student', 'teacher')
  and u.referral_token is null;
