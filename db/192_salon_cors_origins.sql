-- Fixes a real RLS bug found while testing the salon CORS allowlist (server/src/salon/storage.js's originAllowed()):
-- tenant_settings has RLS enabled with exactly two policies -- admin_all (is_platform_admin()) and owner_read_own
-- (tenant_id = me()->>'tenant_id', which needs a JWT-derived app.uid session context). The salon API's cookie
-- session never sets app.uid (same documented reason salon-engine.js needed its own authorize() bridge for RLS
-- reads elsewhere) -- a bare `pool.query(...)` against tenant_settings as the plain `app` role therefore sees
-- ZERO rows unconditionally, the same shape CLAUDE.md already documents multiple times (createOrder()'s RLS
-- read, storage.js's saveSiteUpload, the subscriptions table, /auth/2fa/setup, appicon.js's tenantForIconContext)
-- -- confirmed directly against a real scratch database: the data was correct and a superuser query matched it,
-- but the app-role query returned false every time until this function.
--
-- salon_cors_origin_allowed(tenant, origin) is SECURITY DEFINER (bypasses RLS, same as every other salon_* lookup
-- in db/053/054/170), restricted to niche='salon' tenants, and does an EXACT jsonb-array-element match against
-- tenant_settings.business_rules->'corsOrigins' -- never a substring/suffix comparison.
create or replace function salon_cors_origin_allowed(p_tenant uuid, p_origin text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (ts.business_rules -> 'corsOrigins') ? p_origin
     from tenant_settings ts join tenants t on t.id = ts.tenant_id
     where ts.tenant_id = p_tenant and t.niche = 'salon'),
    false)
$$;
