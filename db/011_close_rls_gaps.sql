-- =========================================================
-- Closes the two tables that were missing `enable row level
-- security`: auth_users and invoice_counters. Neither is reachable
-- through the generic /db/:table route today (both are absent from
-- TABLES in server/src/index.js), so this isn't fixing an active
-- exploit -- it's adding the same defense-in-depth backstop every
-- other table in this schema already has, in case a future code
-- path (a new RPC, a debug endpoint, a dev mistake) ever touches
-- them directly.
--
-- Both policies are designed around the ACTUAL access pattern in
-- server/src/auth.js and db/002_core_engine.sql, not a fresh guess:
--   - login()/createUser()/resetToRandomPassword() in auth.js run
--     raw pool.query() calls with app.uid never set at all -- by
--     design, since login happens before there's an authenticated
--     caller to set it for. app_uid() is null in that case.
--   - next_invoice_no() (002_core_engine.sql) is `security definer`,
--     so it runs as the function owner (the migration-running
--     superuser) and bypasses RLS entirely regardless of policy --
--     this policy has zero effect on that function; it only guards
--     against some other, non-security-definer path touching the
--     table directly as the "app" role.
-- =========================================================

alter table auth_users enable row level security;

create policy au_self_or_admin on auth_users
  for all
  using (app_uid() is null or id = app_uid() or is_platform_admin())
  with check (app_uid() is null or id = app_uid() or is_platform_admin());

alter table invoice_counters enable row level security;

create policy ic_tenant_only on invoice_counters
  for all
  using (tenant_id = (me()->>'tenant_id')::uuid)
  with check (tenant_id = (me()->>'tenant_id')::uuid);
