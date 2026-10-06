-- =========================================================
-- Two-factor authentication (TOTP: Google Authenticator / Authy /
-- 1Password, etc.) -- closes the "only a password protects an account"
-- gap from the limitations review. Unlike every other optional
-- integration in this file, this needs no external service, API key or
-- .env entry: TOTP is a self-contained standard (RFC 6238), verified
-- entirely on this server (server/src/totp.js).
--
-- Owner-only by design for now: setup is gated to owner/manager roles
-- in the server code (not here -- see server/src/auth.js's
-- generate2faSecret). Shop staff signing in with username + PIN
-- (db/096) are untouched; PIN logins never go through this table.
--
-- Raw-pool-only, same discipline as phone_otps/auth_sessions/payments:
-- never exposed through the generic /db/:table allow-list -- the only
-- real access control is that nothing routes a web request at this
-- table except server/src/auth.js's own functions.
--
-- Deliberately NOT "alter table ... enable row level security" with no
-- policies: that pattern (used elsewhere in this file's own comments
-- for phone_otps/auth_sessions/payments) does not actually describe
-- those tables -- none of them have RLS enabled either (checked
-- directly: relrowsecurity is false on all three). RLS with zero
-- policies blocks every statement for a non-owner, non-superuser role
-- including the api's own "app" role -- confirmed by hand against a
-- real scratch database: a plain insert as the app role fails with
-- "new row violates row-level security policy" the moment this table
-- has RLS turned on, which would have made every 2FA setup call 403
-- the instant this shipped. Caught only by actually running the new
-- endpoints against a real server + real app-role connection, not by
-- reading the migration -- same lesson CLAUDE.md already has twice over
-- (the Razorpay RLS bug, the payroll trigger grants) about a path that
-- looks right until something finally calls it for real. See
-- db/118_fix_subscriptions_rls.sql for the same bug already shipped in
-- db/116's subscriptions table.
-- =========================================================

create table auth_totp (
  user_id       uuid primary key references auth_users(id) on delete cascade,
  secret        text not null,              -- base32, RFC 4226 -- only ever read/written server-side
  enabled       boolean not null default false,
  backup_codes  text[] not null default '{}', -- bcrypt hashes, one consumed (removed) per use
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);
grant select, insert, update, delete on auth_totp to app; -- new table -- CLAUDE.md's own "the one gotcha that bit us"
