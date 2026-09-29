-- =========================================================
-- Real bug hit onboarding a live client: provision_tenant() inserts
-- the tenant row, THEN the admin app makes a second, separate call
-- to POST /admin/provision-owner to create the owner's login. If
-- that second step fails for any reason (network blip, admin closes
-- the tab, the server restarts between the two calls), the tenant
-- row is left behind with no owner login -- and admin/onboard.html's
-- own error message even says "you can retry just that step", but
-- gives no actual way to do that beyond a raw POST a non-technical
-- admin can't make. Resubmitting the whole form (the only real
-- option they have) re-runs provision_tenant with the same slug and
-- fails outright on tenants_slug_key -- exactly what happened.
--
-- Fix: provision_tenant becomes idempotent for exactly this
-- "orphaned tenant, no owner yet" case. If the slug already exists:
--   - and already has an owner profile, this is a genuine conflict
--     (someone else's subdomain, or a real duplicate attempt) --
--     raise a clear error instead of the raw constraint-violation
--     text.
--   - and has no owner yet, it's the retry-after-partial-failure
--     case -- refresh its name/niche/settings from this call's
--     inputs (in case the admin corrected something) and hand back
--     its existing id so admin/onboard.html's unchanged retry flow
--     (resubmit the form) just continues on to the owner-provisioning
--     step instead of erroring.
-- =========================================================

create or replace function provision_tenant(p_name text, p_slug text, p_niche text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  preset niche_presets%rowtype;
  has_owner boolean;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into preset from niche_presets where niche = p_niche;
  if not found then
    raise exception 'unknown niche: %', p_niche;
  end if;

  select id into tid from tenants where slug = p_slug;

  if tid is not null then
    select exists(select 1 from profiles where tenant_id = tid and role = 'owner') into has_owner;
    if has_owner then
      raise exception 'a tenant already exists at this subdomain (%.auzslab.in) with an owner login -- pick a different subdomain', p_slug;
    end if;

    update tenants set name = p_name, niche = p_niche where id = tid;
    update tenant_settings set features = preset.default_features, labels = preset.default_labels, business_rules = preset.default_business_rules where tenant_id = tid;
    update records set data = preset.default_business_rules || jsonb_build_object('name', p_name)
      where tenant_id = tid and kind = 'settings' and id = 'settings';
    return tid;
  end if;

  insert into tenants (name, slug, niche) values (p_name, p_slug, p_niche)
    returning id into tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
  values (tid, preset.default_features, preset.default_labels, preset.default_business_rules);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', p_name));

  return tid;
end $$;
