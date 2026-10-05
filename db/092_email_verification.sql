-- =========================================================
-- Real email verification for self-serve owner signup, plus a runtime switch for it.
--
-- Until now /auth/signup accepted any address (a fake one worked everywhere). Now:
--   * auth_users.email_verified_at says when the address was proven (a link in the signup email was opened,
--     or Google/Apple vouched for it, or a phone code proved the phone). Every account that exists today is
--     grandfathered as verified, so nobody is locked out by this migration.
--   * email_verifications holds one-time links. Only a SHA-256 of the token is stored, never the token.
--   * platform_flags is a tiny on/off table the owner flips by hand (see docs/LAUNCH_DIGITAL.md), so
--     enforcement can be switched on AFTER the email sender is verified, with no redeploy:
--       update platform_flags set value = 'on' where key = 'require_email_verification';
--     While it is 'off' (the default), signup still sends the email when mail is configured, but an
--     unverified account can still use the cart. 'on' = an unverified account cannot submit a signup request,
--     an add-on request, or pay.
-- Like phone_otps and payments, none of these are in the generic /db/:table whitelist: only server/src/auth.js
-- (raw pool queries) touches them.
-- =========================================================
alter table auth_users add column if not exists email_verified_at timestamptz;
update auth_users set email_verified_at = coalesce(created_at, now()) where email_verified_at is null;

create table if not exists email_verifications (
  token_hash text primary key,
  user_id    uuid not null references auth_users(id) on delete cascade,
  email      text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_email_verifications_user on email_verifications (user_id, created_at desc);
grant select, insert, update, delete on email_verifications to app;

create table if not exists platform_flags (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
grant select on platform_flags to app;
insert into platform_flags (key, value) values ('require_email_verification', 'off') on conflict (key) do nothing;
