-- =========================================================
-- A deleted account's email was permanently stuck: auth_users.email had a plain `unique` column
-- constraint (db/000), with no regard for deleted_at. Deleting an account only ever soft-deletes it
-- (db/069's own comment explains why -- a human reviews it before any real purge), so the row, and its
-- unique email, lived on forever. The result: sign up again with that same address and /auth/signup's
-- insert hits the old row and throws 23505 ("an account with that email already exists"), while /auth/login
-- correctly refuses the old, deleted row ("invalid credentials") -- a dead end with no way back in or out.
--
-- Fix: the email only needs to be unique among *active* (not deleted_at) rows. A deleted account's email
-- becomes free to sign up again, as a genuinely new account -- the old, deleted row (and its data) is
-- untouched, exactly as account deletion has always promised.
-- =========================================================
alter table auth_users drop constraint if exists auth_users_email_key;
create unique index if not exists auth_users_email_active_idx on auth_users (email) where deleted_at is null;
