-- =========================================================
-- Single-device session revocation. Until this, a JWT was valid for
-- its full 7-day life no matter what -- db/069's own comment already
-- flagged this as a known gap ("no way to revoke a single session
-- before its 7-day JWT naturally expires"). A lost/stolen phone, or a
-- staff member who left, meant either waiting out the week or
-- changing the password (which logs out EVERY device, not just the
-- one that matters).
--
-- auth_sessions is a thin row per issued token (one per
-- login/signup/Google/Apple/phone sign-in), not a full session
-- store -- verifyToken() in auth.js stays the stateless, no-DB-hit
-- operation it was deliberately built as (see db/069's comment on
-- why): it checks an in-memory Set of revoked jti's, loaded once at
-- boot and updated the instant a revoke happens, never a query per
-- request. This table is only ever written by server/src/auth.js via
-- the plain pool (no app.uid context at login time, same as
-- auth_users/phone_otps/password_resets) -- never exposed through the
-- generic /db/:table or /rpc/:fn allow-lists, only through the two
-- dedicated /auth/sessions routes in index.js, which check ownership
-- themselves.
-- =========================================================

create table auth_sessions (
  jti           uuid primary key,
  user_id       uuid not null references auth_users(id) on delete cascade,
  device_label  text,
  ip            text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create index idx_auth_sessions_user on auth_sessions (user_id, revoked_at);

grant select, insert, update, delete on auth_sessions to app;
