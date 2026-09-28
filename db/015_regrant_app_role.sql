-- =========================================================
-- Fixes "permission denied for table roles" (and would have hit
-- notifications next): 999_app_grants.sql's `grant ... on all
-- tables in schema public to app` only covers tables that existed
-- the moment IT ran. On a fresh install that's fine (Postgres runs
-- every db/*.sql file in filename order on first boot, so 999
-- genuinely runs last, after every table exists). But this database
-- was already live and got each new migration applied one at a time
-- as features shipped -- 999 was never re-run after 013 added
-- roles/notifications, so the "app" role (what the API server
-- actually connects as) had zero SQL-level privilege on either
-- table, RLS policies aside. GRANT is idempotent, so this is safe
-- to run even where it changes nothing.
--
-- Going forward: any migration that CREATEs a new TABLE needs this
-- re-run alongside it (functions don't have this problem -- Postgres
-- grants EXECUTE to PUBLIC by default at creation time, which is
-- why every new RPC this session worked immediately with no grant
-- step, while roles/notifications, reached through the generic
-- /db/:table route, did not).
-- =========================================================

grant select, insert, update, delete on all tables in schema public to app;
grant execute on all functions in schema public to app;
grant usage, select on all sequences in schema public to app;
