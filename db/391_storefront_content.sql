-- Storefront Content: Pages, Files, Custom data and Markets live as lists inside the store's own config (no new tables).
-- sfx_store_save now accepts those lists (size-capped); the public store shows Visible pages through its existing "page/<handle>" route.
create or replace function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages', 'pages', 'files', 'customFields', 'markets'];
  list_keys text[] := array['pages', 'files', 'customFields', 'markets'];
  k text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'SF002'; end if;
  theme_ := coalesce(p->>'theme', (select theme from sfx_stores where tenant_id = tid), 'minimal');
  if theme_ not in ('minimal', 'classic') then raise exception 'Choose Minimal or Classic' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(list_keys) then
      if jsonb_typeof(p->k) <> 'array' then raise exception '% must be a list', k using errcode = 'SF002'; end if;
      if jsonb_array_length(p->k) > 200 then raise exception 'Too many items in %', k using errcode = 'SF002'; end if;
      if length((p->k)::text) > 300000 then raise exception 'That list is too large. Remove some items.' using errcode = 'SF002'; end if;
    end if;
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sfx_stores (tenant_id, theme, published, config) values (tid, theme_, coalesce((p->>'published')::boolean, (select published from sfx_stores where tenant_id = tid), false), cur)
    on conflict (tenant_id) do update set theme = excluded.theme, published = excluded.published, config = excluded.config, updated_at = now();
  return sfx_context();
end $$;

alter function public_sfx_store(text) rename to public_sfx_store_nocontent;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; tid uuid := sfx_public_tenant(p_slug); c jsonb; pages jsonb;
begin
  r := public_sfx_store_nocontent(p_slug);
  if r is null or tid is null or r->'config' is null then return r; end if;
  select config into c from sfx_stores where tenant_id = tid;
  select coalesce(jsonb_agg(jsonb_build_object('title', e->>'name', 'slug', e->>'slug', 'body', coalesce(e->>'content', ''), 'image', nullif(e->>'image', ''))), '[]'::jsonb) into pages
    from jsonb_array_elements(case when jsonb_typeof(c->'pages') = 'array' then c->'pages' else '[]'::jsonb end) e
    where coalesce(e->>'slug', '') <> '' and coalesce(e->>'name', '') <> ''
      and (e->>'status' = 'Visible' or (e->>'status' = 'Scheduled' and nullif(e->>'publishAt', '') is not null and (e->>'publishAt')::timestamptz <= now()));
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('minimalPages', pages));
end $$;
