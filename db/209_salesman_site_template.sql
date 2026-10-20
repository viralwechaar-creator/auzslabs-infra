-- Website design choice (QR / ordering website): settings.siteTemplate = 'classic' (site.html) or 'kiln' (site-kiln.html).
-- A team member sets it for a prospect's trial through the same branding functions (db/137, db/141): one more allowed field, validated.
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
    'siteHero', d->>'siteHero', 'siteGallery', d->>'siteGallery',
    'siteTemplate', coalesce(d->>'siteTemplate', 'classic')
  );
end $$;

create or replace function salesman_branding_save(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare allowed jsonb := '{}'::jsonb; k text;
  keys text[] := array['name', 'logo', 'addr', 'phone', 'gstin', 'siteHours', 'prefix', 'ftr', 'col', 'brand',
                        'siteKicker', 'siteTag', 'siteSub', 'siteAbout', 'siteInsta', 'siteHero', 'siteGallery', 'siteTemplate'];
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;
  foreach k in array keys loop
    if p_patch ? k then allowed := allowed || jsonb_build_object(k, p_patch -> k); end if;
  end loop;
  if allowed ? 'siteTemplate' and (allowed->>'siteTemplate') not in ('classic', 'kiln') then raise exception 'unknown website design'; end if;
  if allowed ? 'brand' and (allowed -> 'brand' ->> 'plum') is not null then
    allowed := allowed || jsonb_build_object('col', allowed -> 'brand' ->> 'plum');
  end if;
  update records set data = data || allowed, updated_at = now()
    where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';
  return salesman_branding_get(p_tenant_id);
end $$;
