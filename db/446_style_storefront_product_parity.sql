-- AUZsStyle product entry follows the storefront's product form. When the two are linked:
--  * search listing (title, URL handle, description), country of origin and draft/active live on the style and sync both ways
--  * vendor / type / weight follow brand / type / weight
--  * collection pictures sync both ways and the public storefront returns them (they were missing, so collection pictures vanished)
-- Rollback: drop sty_set_web; restore the *_pre446 functions by renaming them back (drop the new ones first); alter table sty_styles drop column web.
alter table sty_styles add column if not exists web jsonb not null default '{}'::jsonb;

-- ---- style json carries the web fields ----
alter function sty_style_json(uuid, uuid, uuid, boolean) rename to sty_style_json_pre446;
create function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select sty_style_json_pre446(tid, sid, b, see_cost) || jsonb_build_object('web', coalesce((select web from sty_styles where id = sid and tenant_id = tid), '{}'::jsonb))
$$;

create or replace function sty_set_web(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sty_guard('sty_manage'); cur jsonb; k text; v text; keys text[] := array['seoTitle', 'seoDescription', 'handle', 'origin', 'webStatus'];
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Invalid details' using errcode = 'ST002'; end if;
  select coalesce(web, '{}'::jsonb) into cur from sty_styles where id = p_id and tenant_id = tid;
  if not found then raise exception 'Style not found' using errcode = 'ST002'; end if;
  foreach k in array keys loop
    if p ? k then
      v := trim(coalesce(p->>k, ''));
      if length(v) > 320 then raise exception 'That value is too long' using errcode = 'ST002'; end if;
      if k = 'handle' then v := trim(both '-' from regexp_replace(lower(v), '[^a-z0-9]+', '-', 'g')); end if;
      if k = 'webStatus' and v not in ('', 'active', 'draft') then raise exception 'Status must be active or draft' using errcode = 'ST002'; end if;
      if v = '' or (k = 'webStatus' and v = 'active') then cur := cur - k; else cur := cur || jsonb_build_object(k, v); end if;
    end if;
  end loop;
  update sty_styles set web = cur, updated_at = now() where id = p_id and tenant_id = tid;
  return cur;
end $$;
grant execute on function sty_set_web(uuid, jsonb) to app;

-- ---- AUZsStyle -> storefront: add the extra fields after the existing copy ----
alter function sfx_link_push_style(uuid) rename to sfx_link_push_style_pre446;
create function sfx_link_push_style(p_style uuid) returns void language plpgsql security definer set search_path = public as $$
declare s sty_styles; pid uuid; w jsonb; h_ text;
begin
  perform sfx_link_push_style_pre446(p_style);
  select * into s from sty_styles where id = p_style;
  if s.id is null or not sfx_link_on(s.tenant_id) then return; end if;
  select id into pid from sfx_products where tenant_id = s.tenant_id and source_style_id = s.id;
  if pid is null then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  w := coalesce(s.web, '{}'::jsonb);
  update sfx_products set
    extra = coalesce(extra, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('vendor', nullif(s.brand, ''), 'type', nullif(s.subcategory, ''), 'weight', s.weight_g,
      'origin', nullif(w->>'origin', ''), 'seoTitle', nullif(w->>'seoTitle', ''), 'seoDescription', nullif(w->>'seoDescription', ''))),
    seo_title = coalesce(nullif(w->>'seoTitle', ''), seo_title), seo_description = coalesce(nullif(w->>'seoDescription', ''), seo_description),
    status = case when s.active and w->>'webStatus' = 'draft' then 'draft' else status end,
    updated_at = now()
    where id = pid;
  h_ := nullif(w->>'handle', '');
  if h_ is not null and not exists (select 1 from sfx_products where tenant_id = s.tenant_id and handle = h_ and id <> pid) then
    update sfx_products set handle = h_ where id = pid and handle is distinct from h_;
  end if;
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---- storefront -> AUZsStyle ----
alter function sfx_link_pull_product(uuid) rename to sfx_link_pull_product_pre446;
create function sfx_link_pull_product(p_product uuid) returns void language plpgsql security definer set search_path = public as $$
declare p sfx_products; sid uuid; web_ jsonb;
begin
  perform sfx_link_pull_product_pre446(p_product);
  select * into p from sfx_products where id = p_product;
  if p.id is null or not sfx_link_on(p.tenant_id) then return; end if;
  sid := p.source_style_id;
  if sid is null or not exists (select 1 from sty_styles where id = sid) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  web_ := jsonb_strip_nulls(jsonb_build_object('seoTitle', nullif(coalesce(p.extra->>'seoTitle', p.seo_title), ''), 'seoDescription', nullif(coalesce(p.extra->>'seoDescription', p.seo_description), ''),
    'handle', nullif(p.handle, ''), 'origin', nullif(p.extra->>'origin', ''), 'webStatus', case when p.status = 'draft' then 'draft' end));
  update sty_styles set web = web_,
    brand = coalesce(nullif(p.extra->>'vendor', ''), brand), subcategory = coalesce(nullif(p.extra->>'type', ''), subcategory),
    weight_g = case when coalesce(p.extra->>'weight', '') ~ '^[0-9.]+$' then (p.extra->>'weight')::numeric else weight_g end
    where id = sid;
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---- collection pictures sync (matched by name, like the rest of the collection sync) ----
alter function sfx_link_sync_collections(uuid, boolean) rename to sfx_link_sync_collections_pre446;
create function sfx_link_sync_collections(p_tenant uuid, p_from_style boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform sfx_link_sync_collections_pre446(p_tenant, p_from_style);
  if not sfx_link_on(p_tenant) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  if p_from_style then
    update sfx_collections c set image = s.image, updated_at = now() from sty_collections s
      where s.tenant_id = p_tenant and c.tenant_id = p_tenant and lower(c.name) = lower(s.name) and coalesce(s.image, '') <> '' and c.image is distinct from s.image;
  else
    update sty_collections s set image = c.image from sfx_collections c
      where s.tenant_id = p_tenant and c.tenant_id = p_tenant and lower(c.name) = lower(s.name) and coalesce(c.image, '') <> '' and s.image is distinct from c.image;
  end if;
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---- the public storefront answers collection pictures and handles ----
alter function public_sfx_store(text) rename to public_sfx_store_pre446;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pre446(p_slug); tid uuid; cols jsonb;
begin
  if r is null or jsonb_typeof(r->'collections') <> 'array' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select coalesce(jsonb_agg(e || jsonb_build_object('image', nullif(c.image, ''), 'handle', c.handle) order by ord), '[]'::jsonb) into cols
    from jsonb_array_elements(r->'collections') with ordinality as t(e, ord)
    left join sfx_collections c on c.tenant_id = tid and c.id::text = e->>'id';
  return jsonb_set(r, '{collections}', cols);
end $$;
grant execute on function public_sfx_store(text) to app;

-- ---- demo business: bring its linked data fully up to date (collection pictures, web fields) ----
do $$
declare tid uuid; s record;
begin
  select id into tid from tenants where slug = 'demo';
  if tid is null or not sfx_link_on(tid) then return; end if;
  for s in select id from sty_styles where tenant_id = tid loop perform sfx_link_push_style(s.id); end loop;
  perform sfx_link_sync_collections(tid, true);
exception when others then raise notice 'demo refresh skipped: %', sqlerrm;
end $$;
