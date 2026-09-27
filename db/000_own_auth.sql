-- =========================================================
-- Own auth, replacing Supabase Auth's auth.users/auth.uid().
-- No Supabase software anywhere in this stack -- the app's own
-- API server (server/) hashes passwords, issues sessions, and
-- sets app.uid as a Postgres session variable per request so
-- every RLS policy below keeps working unchanged in spirit,
-- just reading app_uid() instead of auth.uid().
-- =========================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid(), used throughout

create table auth_users (
  id             uuid primary key default gen_random_uuid(),
  email          text unique not null,
  password_hash  text not null,       -- bcrypt, hashed by the API server
  -- same shape Supabase's raw_app_meta_data had: {tenant_id, role} staged
  -- here at creation time, read by the API server on login to embed in
  -- the session token -- never client-writable.
  app_metadata   jsonb not null default '{}',
  user_metadata  jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

-- app_uid(): the RLS-facing replacement for auth.uid(). The API server
-- runs `select set_config('app.uid', '<uuid>', true)` at the start of
-- every authenticated request's transaction (true = transaction-local,
-- cleared automatically after) -- current_setting(..., true) returns
-- null instead of erroring when it's unset (an anonymous request).
create function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;
