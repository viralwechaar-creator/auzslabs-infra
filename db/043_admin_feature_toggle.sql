-- =========================================================
-- Admin panel toggle for a tenant's feature entitlements, plus a
-- one-time backfill of the two ERP modules (039/042) that DID define
-- a niche default onto tenants provisioned before those migrations
-- existed.
--
-- Bug report this fixes: 039_memberships.sql/042_vendors_purchases.sql
-- only wrote their niche defaults into niche_presets.default_features
-- -- by design, per those migrations' own comments, that only affects
-- NEW tenants provisioned afterward, never retroactively touching a
-- tenant_settings row that already exists (same "app_grants only
-- covers what existed when it last ran" gotcha, just for entitlements
-- instead of table grants -- see CLAUDE.md). There was also no way to
-- grant/revoke a feature on an EXISTING tenant short of raw SQL --
-- admin.html's onboarding form only sets features once, at
-- provision_tenant time.
-- =========================================================

-- Admin: change any tenant's own entitlements directly, no addon
-- request/approval round-trip needed (that flow -- 027 -- is for a
-- client asking for something; this is AUZlab granting/revoking
-- directly). Merges the explicit true/false the admin panel sends
-- for each key it knows about (see FEATURE_LABEL in admin.html),
-- leaving any other key already in features untouched.
create function admin_set_tenant_features(p_tenant_id uuid, p_features jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update tenant_settings set features = coalesce(features, '{}'::jsonb) || coalesce(p_features, '{}'::jsonb)
  where tenant_id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;
end;
$$;

-- One-time backfill: apply the exact same niche defaults 039 and 042
-- wrote into niche_presets, directly onto every tenant that already
-- existed before those migrations ran. Deliberately NOT touching
-- 'helpdesk'/'tasks' here -- both are "off everywhere by default" by
-- design (040/041), true for old and new tenants alike; use the new
-- admin_set_tenant_features (or the admin panel toggle) per client
-- for those, same as an owner enabling any other off-by-default
-- feature themselves.
update tenant_settings ts set features = ts.features || '{"membership": true}'::jsonb
from tenants t where t.id = ts.tenant_id and t.niche in ('gym', 'salon');

update tenant_settings ts set features = ts.features || '{"purchases": true}'::jsonb
from tenants t where t.id = ts.tenant_id and t.niche in ('salon', 'gym', 'general');
