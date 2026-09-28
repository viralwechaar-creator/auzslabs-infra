-- =========================================================
-- "Demo login showing invalid credentials" -- new password requested:
-- Auzslab@Demo (was AuzslabDemo!2026). The emails stay as they were
-- (demo-cafe@auzslab.in / demo-retail@auzslab.in -- already a clear
-- "demo-<niche>@" pattern, and site/demo.html already resolves and
-- displays them dynamically per niche, so there's nothing to change
-- there).
--
-- Likely real cause of "invalid credentials", separate from the
-- password itself: 023_demo_tenants.sql only ever auto-runs on a
-- brand-new empty database (see CLAUDE.md's migration gotcha) -- on
-- this live database it has to be applied by hand with
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/023_demo_tenants.sql
-- and if that step was skipped after the PR merged, demo-cafe@auzslab.in
-- / demo-retail@auzslab.in don't exist as logins at all yet, which
-- also presents as "invalid credentials". Run 023 first (it's
-- idempotent -- guarded by "if not exists" checks), then this file,
-- in filename order.
-- =========================================================

update auth_users
set password_hash = '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK'
where email in ('demo-cafe@auzslab.in', 'demo-retail@auzslab.in');
