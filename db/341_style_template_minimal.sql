-- Gate Minimal through the tenant's storefront template entitlement.
create or replace function sty_store_save_core(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; k text; required_feature text; ok_keys text[] := array['on', 'tagline', 'announce', 'heroImages', 'heroTitle', 'heroCta', 'about', 'founders',
    'stores', 'faqs', 'policies', 'shipping', 'pay', 'social', 'email', 'phone', 'brandName', 'showSale', 'sizeGuide', 'waOrder', 'abandonWa',
    'blogs', 'media', 'jobs', 'hiring', 'template', 'minimalStories', 'minimalNotices', 'minimalPages'];
begin
  tid := sty_guard('sty_manage');
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'ST002'; end if;
  if length(p::text) > 240000 then raise exception 'store settings are too large' using errcode = 'ST002'; end if;
  select config into cur from sty_store where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  required_feature := case cur->>'template' when '2' then 'style_template_two' when 'minimal' then 'style_template_minimal' end;
  if required_feature is not null and not exists (
    select 1 from tenant_settings ts where ts.tenant_id = tid
      and (ts.features->>required_feature)::boolean is true
      and coalesce((ts.enabled_features->>required_feature)::boolean, true) is true
  ) then
    cur := cur || jsonb_build_object('template', '1');
  end if;
  foreach k in array array['minimalStories', 'minimalNotices', 'minimalPages'] loop
    if cur ? k and jsonb_typeof(cur->k) is distinct from 'array' then
      raise exception 'Minimal content must be a list' using errcode = 'ST002';
    end if;
  end loop;
  insert into sty_store (tenant_id, config) values (tid, cur)
    on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  perform sty_audit_log(tid, 'store.save', null, null);
  return sty_store_get();
end $$;

create or replace function public_sty_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; storefront jsonb;
begin
  tid := sty_public_tenant(p_slug);
  if tid is not null and not tenant_cap(tid, 'online_store') then
    return jsonb_build_object('closed', true, 'name', coalesce((select name from tenants where id = tid), 'Shop'));
  end if;
  storefront := public_sty_store_core(p_slug);
  if storefront #>> '{config,template}' = 'minimal' and not exists (
    select 1 from tenant_settings ts where ts.tenant_id = tid
      and (ts.features->>'style_template_minimal')::boolean is true
      and coalesce((ts.enabled_features->>'style_template_minimal')::boolean, true) is true
  ) then
    storefront := jsonb_set(storefront, '{config,template}', '"1"'::jsonb);
  end if;
  return storefront;
end $$;
