-- =========================================================
-- Platform admins + tenant onboarding.
-- platform_admins is AUZlabs' own team (you + your brother) —
-- entirely separate from any client's staff/owner. Only these
-- accounts can create a new tenant.
-- =========================================================

create table platform_admins (
  id  uuid primary key references auth_users(id) on delete cascade
);
alter table platform_admins enable row level security;
create policy self_read on platform_admins for select using (id = app_uid());
-- add yourselves manually after creating your own logins:
--   insert into platform_admins (id) values ('<your-auth-user-uuid>');

create function is_platform_admin() returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from platform_admins where id = app_uid())
$$;

-- provision_tenant: the whole "add a new client" action in one call —
-- creates the tenant row, copies that niche's preset into
-- tenant_settings, and seeds the client's own editable settings record
-- (records kind='settings') with the preset's business_rules, so
-- index.html/site.html work immediately with sensible defaults.
create function provision_tenant(p_name text, p_slug text, p_niche text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  preset niche_presets%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into preset from niche_presets where niche = p_niche;
  if not found then
    raise exception 'unknown niche: %', p_niche;
  end if;

  insert into tenants (name, slug, niche) values (p_name, p_slug, p_niche)
    returning id into tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
  values (tid, preset.default_features, preset.default_labels, preset.default_business_rules);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', p_name));

  return tid;
end;
$$;
-- gated by the is_platform_admin() check inside the function body,
-- not a Postgres role grant.
