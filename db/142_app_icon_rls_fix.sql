-- Real bug, caught while testing the salesman's photo-upload feature end to
-- end rather than by inspection: server/src/appicon.js's tenantForIcon() and
-- tenantSettings() (PR #278, /app-manifest.json and /app-icon/*.png) both
-- did a bare pool.query() against `tenants` and `records` -- both RLS-
-- protected, and `pool` connects as the `app` role (db.js), never a
-- superuser -- with no app.uid set, app_uid() is null and every policy on
-- both tables evaluates false. The result: EVERY tenant's logo/colour icon
-- silently fell back to the static default, for every single call, since
-- the feature shipped -- confirmed by a real end-to-end test (curl with the
-- real tenant subdomain Host header still 302-redirected to the generic
-- icon) rather than assumed from inspection. Exactly the same bug shape this
-- project has already hit for createOrder(), saveSiteUpload() and the
-- subscriptions table -- a function only exercised by a real request (never
-- by every page load) can ship broken and nobody notices until something
-- actually calls it.
--
-- Fix, matching public_menu()/public_invoice()'s own precedent for "resolve
-- a tenant from its slug with no session at all": one SECURITY DEFINER
-- function bundling the tenant + its settings record in a single call, so
-- there is nothing left for appicon.js to read through the `app` role.

create or replace function public_app_icon_context(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name,
    'settings', coalesce((
      select r.data from records r where r.tenant_id = t.id and r.kind = 'settings' and r.id = 'settings'
    ), '{}'::jsonb)
  )
  from tenants t where t.slug = p_slug
$$;
