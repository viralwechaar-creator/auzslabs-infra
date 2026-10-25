-- Installed (offline) AUZsStyle: the very first start creates the shop and its owner login on the computer itself.
-- Only works while there is no business in the database at all (the installer empties the sample data first), so it can
-- never add a second business or take over an existing one. Called by the local server only (not in the RPC list).
create or replace function offline_first_run(p_shop text, p_name text, p_email text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if exists (select 1 from tenants) then raise exception 'This computer is already set up.'; end if;
  if coalesce(btrim(p_shop), '') = '' or coalesce(btrim(p_email), '') = '' or coalesce(p_password_hash, '') = '' then raise exception 'Shop name, email and password are required.'; end if;
  insert into tenants (slug, name, niche, plan, status) values ('shop', btrim(p_shop), 'retail', 'pro', 'active') returning id into tid;
  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, '{"style":true}'::jsonb, p.default_labels, p.default_business_rules from niche_presets p where p.niche = 'retail';
  insert into records (id, tenant_id, kind, data)
    select 'settings', tid, 'settings', p.default_business_rules || jsonb_build_object('name', btrim(p_shop)) from niche_presets p where p.niche = 'retail';
  insert into auth_users (email, password_hash, app_metadata, user_metadata, email_verified_at)
    values (lower(btrim(p_email)), p_password_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'), jsonb_build_object('name', coalesce(nullif(btrim(p_name), ''), 'Owner')), now());
  return tid;
end $$;

-- tenants is hidden from the app role by row security, so "is a shop already set up" has to be asked through a function
create or replace function offline_setup_needed() returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from tenants)
$$;
