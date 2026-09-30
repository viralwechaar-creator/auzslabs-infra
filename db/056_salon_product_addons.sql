-- =========================================================
-- AUZslab Salon as a sellable product, with Payroll, Website Builder, POS
-- etc. as ordinary add-ons on top of it.
--
-- * 'salon' is now a feature key (the base product), like 'pos' is for a
--   cafe. New salon tenants get it from the niche preset, existing salon
--   tenants are backfilled, and a cart signup for a salon gets the salon
--   base features merged in (approve_signup_request used to store only
--   what was in the cart, so a salon that bought just Payroll would have
--   had no booking/CRM/billing at all).
-- * Add-ons themselves need no new mechanism: submit_addon_request /
--   approve_addon_request (db/027) are niche-agnostic. What was missing is
--   the salon console knowing whether the Payroll add-on is on, so staff
--   clock-ins only flow to Payroll for a salon that actually has it
--   (salon_features below; used by server/src/salon.js).
-- =========================================================
update niche_presets
  set default_features = default_features || '{"salon": true}'::jsonb
  where niche = 'salon' and not (default_features ? 'salon');

update tenant_settings ts
  set features = coalesce(ts.features, '{}'::jsonb) || '{"salon": true}'::jsonb
  from tenants t
  where t.id = ts.tenant_id and t.niche = 'salon' and not (coalesce(ts.features, '{}'::jsonb) ? 'salon');

create or replace function salon_features(p_tenant uuid) returns jsonb
  language sql security definer stable set search_path = public as $$
  select jsonb_build_object('features', coalesce(ts.features, '{}'::jsonb), 'enabled', coalesce(ts.enabled_features, '{}'::jsonb))
  from tenant_settings ts join tenants t on t.id = ts.tenant_id
  where ts.tenant_id = p_tenant and t.niche = 'salon'
$$;

create or replace function approve_signup_request(p_request_id uuid, p_niche text default 'general')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  req signup_requests%rowtype;
  tid uuid;
  feats jsonb;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into req from signup_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already handled';
  end if;

  feats := coalesce(req.features, '{}'::jsonb);
  if p_niche = 'salon' then
    feats := feats || '{"salon": true, "booking": true, "crm": true, "billing": true}'::jsonb;
  end if;

  insert into tenants (name, slug, niche, status)
  values (req.business_name, req.slug, p_niche, 'active')
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, feats);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', jsonb_build_object('name', req.business_name));

  insert into profiles (id, tenant_id, email, role)
  values (req.user_id, tid, (select email from auth_users where id = req.user_id), 'owner');

  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner')
    where id = req.user_id;

  update signup_requests set status = 'approved' where id = p_request_id;

  return tid;
end;
$$;
