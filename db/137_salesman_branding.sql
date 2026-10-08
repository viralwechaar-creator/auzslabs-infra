-- Salesmen: a limited platform role (NOT a platform admin, NOT a tenant
-- owner/staff) that can provision a real trial tenant for a sales pitch
-- and brand ONLY that one tenant from a single screen: logo, address,
-- GST number, opening hours, invoice wording, and a full multi-colour
-- palette (reusing the exact `settings.brand` object app/public/i.html
-- and the salon niche already know how to render -- see its own comment
-- there: {plum, tint, muted, line, font, fontUrl}). Every field is saved
-- straight into the tenant's normal settings record (kind='settings',
-- id='settings'), the one every other app/page already reads, so a save
-- here shows up on the tenant's own website, its invoice page and (once
-- an owner logs in) the POS itself instantly -- there is no separate
-- "salesman copy" of any of this to keep in sync.

create table if not exists platform_salesmen (
  id uuid primary key references auth_users(id) on delete cascade,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table platform_salesmen enable row level security;
drop policy if exists sm_self on platform_salesmen;
create policy sm_self on platform_salesmen for select using (id = app_uid());
-- no grant to app: every read/write goes through the security-definer
-- functions below, same precedent as platform_admins (db/004) -- "gated
-- by the is_platform_admin() check inside the function body, not a
-- Postgres role grant."

create or replace function is_salesman(p_uid uuid default app_uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_salesmen where id = p_uid and active)
$$;

alter table tenants add column if not exists is_trial boolean not null default false;
alter table tenants add column if not exists created_by_salesman uuid references auth_users(id);

-- lets a salesman's own session read (never write) the tenants they
-- personally created -- this is what makes storage.js's existing
-- saveSiteUpload() (its own tenant-slug lookup already goes through
-- withAuth(uid,...), see its comment) work for a salesman's uid too,
-- with no change needed to that function at all.
drop policy if exists t_salesman_read on tenants;
create policy t_salesman_read on tenants for select using (created_by_salesman = app_uid());

-- Same shape as provision_tenant (db/004/037/125) but gated on
-- is_salesman(), never is_platform_admin() -- and, unlike provision_tenant,
-- a salesman may ONLY ever create a brand-new tenant: no update-in-place
-- branch, so a salesman can never "take over" an address someone already
-- owns by retrying with the same slug.
create or replace function salesman_provision_trial(p_business_name text, p_slug text, p_niche text default 'cafe')
returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; preset niche_presets%rowtype; slug2 text := lower(btrim(coalesce(p_slug, '')));
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p_business_name, '')), '') is null then raise exception 'a business name is required'; end if;
  if slug2 !~ '^[a-z0-9][a-z0-9-]{1,30}$' then raise exception 'the address can only use lowercase letters, numbers and hyphens'; end if;
  if p_niche not in ('cafe', 'salon', 'gym', 'retail', 'general', 'mobile') then
    raise exception 'unknown niche: %', p_niche;
  end if;
  if exists(select 1 from tenants where slug = slug2) then
    raise exception 'that address is already taken -- pick a different one';
  end if;

  select * into preset from niche_presets where niche = p_niche;
  if not found then raise exception 'unknown niche: %', p_niche; end if;

  insert into tenants (name, slug, niche, is_trial, created_by_salesman)
    values (btrim(p_business_name), slug2, p_niche, true, app_uid())
    returning id into tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
    values (tid, preset.default_features, preset.default_labels, preset.default_business_rules);

  insert into records (id, tenant_id, kind, data)
    values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', btrim(p_business_name)));

  return tid;
end $$;

create or replace function salesman_my_trials() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche,
      'created_at', t.created_at,
      'has_owner', exists(select 1 from profiles p where p.tenant_id = t.id and p.role = 'owner'),
      'logo', r.data->>'logo', 'col', r.data->>'col'
    ) order by t.created_at desc)
    from tenants t
    left join records r on r.tenant_id = t.id and r.kind = 'settings' and r.id = 'settings'
    where t.created_by_salesman = app_uid()
  ), '[]'::jsonb);
end $$;

-- the exact, fixed list of settings fields a salesman is ever allowed to
-- touch -- never pricing/features/plan/anything else a tenant's own
-- settings record might hold
create or replace function salesman_branding_get(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;
  select data into d from records where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';
  d := coalesce(d, '{}'::jsonb);
  return jsonb_build_object(
    'name', d->>'name', 'logo', d->>'logo', 'addr', d->>'addr', 'phone', d->>'phone',
    'gstin', d->>'gstin', 'siteHours', d->>'siteHours', 'prefix', d->>'prefix', 'ftr', d->>'ftr',
    'col', d->>'col', 'brand', coalesce(d->'brand', '{}'::jsonb),
    'siteKicker', d->>'siteKicker', 'siteTag', d->>'siteTag', 'siteSub', d->>'siteSub',
    'siteAbout', d->>'siteAbout', 'siteInsta', d->>'siteInsta'
  );
end $$;

create or replace function salesman_branding_save(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare allowed jsonb := '{}'::jsonb; k text;
  keys text[] := array['name', 'logo', 'addr', 'phone', 'gstin', 'siteHours', 'prefix', 'ftr', 'col', 'brand',
                        'siteKicker', 'siteTag', 'siteSub', 'siteAbout', 'siteInsta'];
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;
  foreach k in array keys loop
    if p_patch ? k then allowed := allowed || jsonb_build_object(k, p_patch -> k); end if;
  end loop;
  -- brand.plum, if set, also mirrors into the plain "col" every app
  -- (POS, console, Payroll, Accounting, AUZsMob, the staff home-screen
  -- icon below) already reads -- so a multi-colour palette still lights
  -- up every app that only ever knew a single accent colour.
  if allowed ? 'brand' and (allowed -> 'brand' ->> 'plum') is not null then
    allowed := allowed || jsonb_build_object('col', allowed -> 'brand' ->> 'plum');
  end if;
  update records set data = data || allowed, updated_at = now()
    where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';
  return salesman_branding_get(p_tenant_id);
end $$;

-- platform-admin side: turn an existing login into a salesman, list them,
-- switch one off. A salesman needs a real auth_users row first (sign up
-- normally, or be given a login the usual way) -- this only promotes it.
create or replace function admin_add_salesman(p_email text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select id into uid from auth_users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if not found then raise exception 'no account with that email yet -- the salesman signs up (or is given a login) first, then you add them here'; end if;
  insert into platform_salesmen (id, name) values (uid, nullif(btrim(coalesce(p_name, '')), ''))
    on conflict (id) do update set name = coalesce(excluded.name, platform_salesmen.name), active = true;
  return jsonb_build_object('id', uid);
end $$;

create or replace function admin_list_salesmen() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'email', u.email, 'active', s.active, 'created_at', s.created_at,
      'trial_count', (select count(*) from tenants t where t.created_by_salesman = s.id)
    ) order by s.created_at desc)
    from platform_salesmen s join auth_users u on u.id = s.id
  ), '[]'::jsonb);
end $$;

create or replace function admin_set_salesman_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  update platform_salesmen set active = p_active where id = p_id;
end $$;
