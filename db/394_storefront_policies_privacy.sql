-- Store policies (shipping, returns, privacy, terms) and a customer-privacy contact, saved in the store config and shown on the public store.
create or replace function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages', 'pages', 'files', 'customFields', 'markets', 'policies', 'privacy'];
  list_keys text[] := array['pages', 'files', 'customFields', 'markets']; obj_keys text[] := array['policies', 'privacy'];
  k text; pk text;
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
    if k = any(obj_keys) then
      if jsonb_typeof(p->k) <> 'object' then raise exception '% must be an object', k using errcode = 'SF002'; end if;
      for pk in select jsonb_object_keys(p->k) loop
        if pk not in ('shipping', 'returns', 'privacy', 'terms', 'contactEmail', 'retention') then raise exception 'Unknown field %', pk using errcode = 'SF002'; end if;
        if jsonb_typeof(p->k->pk) <> 'string' or length(p->k->>pk) > 8000 then raise exception 'Each policy must be text up to 8000 characters' using errcode = 'SF002'; end if;
      end loop;
    end if;
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sfx_stores (tenant_id, theme, published, config) values (tid, theme_, coalesce((p->>'published')::boolean, (select published from sfx_stores where tenant_id = tid), false), cur)
    on conflict (tenant_id) do update set theme = excluded.theme, published = excluded.published, config = excluded.config, updated_at = now();
  return sfx_context();
end $$;

alter function public_sfx_store(text) rename to public_sfx_store_nopolicy;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; tid uuid := sfx_public_tenant(p_slug); c jsonb;
begin
  r := public_sfx_store_nopolicy(p_slug);
  if r is null or tid is null or r->'config' is null then return r; end if;
  select config into c from sfx_stores where tenant_id = tid;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('policies', coalesce(c->'policies', '{}'::jsonb), 'privacyContact', coalesce(c->'privacy'->>'contactEmail', '')));
end $$;
