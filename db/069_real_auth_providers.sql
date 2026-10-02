-- =========================================================
-- Real auth, phase 1: Google / Apple / phone sign-in, self-service
-- password reset, and self-service account deletion (Apple App Store
-- Guideline 5.1.1(v) requires the last one before any App Store
-- submission can be considered).
--
-- Until now auth_users had exactly one way in (email + password) and
-- exactly one way to fix a forgotten password (a platform admin resets
-- it by hand and shares the new one over WhatsApp). This adds real
-- alternative identities without throwing any of that away: a user can
-- still have just a password, or add Google/Apple/phone on top of it,
-- or sign up with one of those directly and add a password later.
-- =========================================================

-- A password-only account no longer makes sense as the only shape --
-- someone who signs up via Google/Apple/phone has no password at all.
-- server/src/auth.js's login() is updated in this same change to treat
-- a null password_hash as "this account can't log in with a password",
-- not as a crash.
alter table auth_users alter column password_hash drop not null;

-- Soft delete: Apple requires in-app account deletion, but hard-deleting
-- a tenant OWNER's row would cascade-destroy their whole business's
-- data with no recovery window -- too risky to automate. deleted_at
-- blocks login immediately (both here and in app_uid() below, so
-- RLS-protected data stops being reachable the instant it's set, even
-- for an already-issued JWT that hasn't expired yet) while the actual
-- data purge stays a deliberate, separate admin action.
alter table auth_users add column if not exists deleted_at timestamptz;

-- app_uid() now also treats a soft-deleted account as having no
-- session at all -- every RLS policy in the system reads this function,
-- so this one change revokes data access everywhere at once, without
-- needing the API server to check deleted_at on every single request.
-- Must be security definer: auth_users itself has an RLS policy
-- (au_self_or_admin) that calls app_uid() -- without security definer,
-- this function's own lookup against auth_users would re-trigger that
-- same policy, which calls app_uid() again, forever ("stack depth limit
-- exceeded", caught while testing this migration locally before it ever
-- reached production). security definer runs the internal lookup as
-- the function's owner (POSTGRES_USER), which bypasses RLS entirely for
-- that one query, breaking the recursion.
create or replace function app_uid() returns uuid language sql stable security definer set search_path = public as $$
  select au.id from auth_users au
  where au.id = nullif(current_setting('app.uid', true), '')::uuid
    and au.deleted_at is null
$$;

-- One auth_users row, many ways in. provider_id is Google's/Apple's
-- 'sub' claim (a stable, provider-scoped id -- never the email, which
-- can change) or an E.164 phone number for the 'phone' provider.
-- Email/password isn't a row here; its presence is just
-- auth_users.password_hash being non-null.
create table auth_identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth_users(id) on delete cascade,
  provider      text not null check (provider in ('google', 'apple', 'phone')),
  provider_id   text not null,
  email         text,
  created_at    timestamptz not null default now(),
  unique (provider, provider_id)
);
create index auth_identities_user_id_idx on auth_identities (user_id);
grant select, insert, update, delete on auth_identities to app;

-- Self-service "forgot password" links. Same unguessable-secret trust
-- model as staff_invites.token (044) -- a 64-char random string needs
-- no rate limit itself, only the /auth/forgot endpoint that creates one
-- does (so an attacker can't spam-generate reset emails at a victim).
create table password_resets (
  token       text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  user_id     uuid not null references auth_users(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '1 hour',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_resets_user_id_idx on password_resets (user_id);
grant select, insert, update on password_resets to app;

-- Phone/OTP codes. The code itself is bcrypt-hashed, same discipline as
-- a password -- a leaked database row should never hand over a usable
-- code. attempts caps guesses against one sent code (checked by the API
-- server alongside the normal per-IP rate limit on /auth/phone/verify).
create table phone_otps (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  attempts    int not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index phone_otps_phone_idx on phone_otps (phone, created_at desc);
grant select, insert, update on phone_otps to app;

-- Audit trail for self-service deletions -- who asked, when, and what
-- tenant (if any) their account belonged to, so a platform admin can
-- follow up on the actual data purge/offboarding by hand. Never written
-- to except by the deletion endpoint; nothing reads it back through the
-- app, so no RLS policy is needed (API server queries it directly with
-- the pool, same as auth_users).
create table account_deletions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  email         text not null,
  tenant_id     uuid,
  role          text,
  requested_at  timestamptz not null default now()
);
grant select, insert on account_deletions to app;
