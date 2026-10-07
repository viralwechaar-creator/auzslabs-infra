-- Two kinds of client: 'standard' (picks from the standard products) and 'custom' (a specially designed system built to
-- their demand, which does not use the standard products). A custom client still gets its own address, private workspace
-- and owner login, but starts with NO standard product switched on.

alter table tenants add column if not exists build_type text not null default 'standard' check (build_type in ('standard', 'custom'));

alter table tenants drop constraint if exists tenants_niche_check;
alter table tenants add constraint tenants_niche_check check (niche in ('cafe', 'salon', 'gym', 'retail', 'general', 'mobile', 'custom'));

insert into niche_presets (niche, default_features, default_labels, default_business_rules) values
  ('custom', '{}'::jsonb, '{}'::jsonb, '{"currency": "INR", "bizType": "custom"}'::jsonb)
on conflict (niche) do nothing;

-- same as db/037 plus build_type
create or replace function provision_tenant(p_name text, p_slug text, p_niche text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  preset niche_presets%rowtype;
  has_owner boolean;
  bt text := case when p_niche = 'custom' then 'custom' else 'standard' end;
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

    update tenants set name = p_name, niche = p_niche, build_type = bt where id = tid;
    update tenant_settings set features = preset.default_features, labels = preset.default_labels, business_rules = preset.default_business_rules where tenant_id = tid;
    update records set data = preset.default_business_rules || jsonb_build_object('name', p_name)
      where tenant_id = tid and kind = 'settings' and id = 'settings';
    return tid;
  end if;

  insert into tenants (name, slug, niche, build_type) values (p_name, p_slug, p_niche, bt)
    returning id into tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
  values (tid, preset.default_features, preset.default_labels, preset.default_business_rules);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', p_name));

  return tid;
end $$;

-- a custom client: no standard products, the brief is kept in the client's notes
create or replace function provision_custom_tenant(p_name text, p_slug text, p_brief text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  tid := provision_tenant(p_name, p_slug, 'custom');
  if nullif(btrim(coalesce(p_brief, '')), '') is not null then
    update tenants set notes = left(btrim(p_brief), 4000) where id = tid;
  end if;
  return tid;
end $$;

-- list_clients (db/038) plus build_type
create or replace function list_clients()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche, 'build_type', t.build_type,
      'plan', t.plan, 'status', t.status,
      'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date, 'notes', t.notes,
      'features', coalesce(ts.features, '{}'::jsonb), 'created_at', t.created_at,
      'delivered_at', t.delivered_at
    ) order by t.created_at desc)
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
  ), '[]'::jsonb);
end;
$$;
