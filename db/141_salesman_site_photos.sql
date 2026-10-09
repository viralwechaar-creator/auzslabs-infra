-- Owner request: let a salesman upload real website photos (hero + gallery)
-- for a prospect too, not just the logo -- so the client's own site doesn't
-- show the generic drawn placeholder art everywhere. Adds siteHero/
-- siteGallery to salesman_branding_get/save's fixed field allow-list
-- (db/137) -- the exact same fields site.html already reads for every
-- other tenant, nothing new to render.

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
    'siteAbout', d->>'siteAbout', 'siteInsta', d->>'siteInsta',
    'siteHero', d->>'siteHero', 'siteGallery', d->>'siteGallery'
  );
end $$;

create or replace function salesman_branding_save(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare allowed jsonb := '{}'::jsonb; k text;
  keys text[] := array['name', 'logo', 'addr', 'phone', 'gstin', 'siteHours', 'prefix', 'ftr', 'col', 'brand',
                        'siteKicker', 'siteTag', 'siteSub', 'siteAbout', 'siteInsta', 'siteHero', 'siteGallery'];
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;
  foreach k in array keys loop
    if p_patch ? k then allowed := allowed || jsonb_build_object(k, p_patch -> k); end if;
  end loop;
  if allowed ? 'brand' and (allowed -> 'brand' ->> 'plum') is not null then
    allowed := allowed || jsonb_build_object('col', allowed -> 'brand' ->> 'plum');
  end if;
  update records set data = data || allowed, updated_at = now()
    where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';
  return salesman_branding_get(p_tenant_id);
end $$;
