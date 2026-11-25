-- Round 6 (storefront gaps): a stores directory editable from the dashboard and shown on the public "Our stores" page.
-- config.directory = [{id, name, address, city, phone, hours, map, photo, featured}] (up to 30). Public config.stores is filled from it.
-- Rollback: drop function sfx_stores_get(); drop function sfx_stores_save(jsonb); drop function public_sfx_store(text); alter function public_sfx_store_predir(text) rename to public_sfx_store;
create function sfx_stores_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'directory' into c from sfx_stores where tenant_id = tid;
  return coalesce(c, '[]'::jsonb);
end $$;
grant execute on function sfx_stores_get() to app;

create function sfx_stores_clean(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare e jsonb; out_ jsonb := '[]'::jsonb; n int := 0; nm text; u text;
begin
  if jsonb_typeof(p) <> 'array' then raise exception 'Stores must be a list' using errcode = 'SF002'; end if;
  if jsonb_array_length(p) > 30 then raise exception 'Up to 30 stores' using errcode = 'SF002'; end if;
  for e in select * from jsonb_array_elements(p) loop
    n := n + 1; nm := left(trim(coalesce(e->>'name', '')), 80);
    if nm = '' then raise exception 'Store % needs a name', n using errcode = 'SF002'; end if;
    foreach u in array array[coalesce(e->>'map', ''), coalesce(e->>'photo', '')] loop
      if u <> '' and u !~* '^(https://|/uploads/)' then raise exception 'Links and photos must start with https:// or be uploaded here' using errcode = 'SF002'; end if;
    end loop;
    out_ := out_ || jsonb_build_array(jsonb_build_object('id', left(coalesce(nullif(regexp_replace(coalesce(e->>'id', ''), '[^-_a-zA-Z0-9]', '', 'g'), ''), 'st' || n || substr(md5(random()::text), 1, 4)), 40),
      'name', nm, 'address', left(coalesce(e->>'address', ''), 300), 'city', left(coalesce(e->>'city', ''), 80), 'phone', left(coalesce(e->>'phone', ''), 30),
      'hours', left(coalesce(e->>'hours', ''), 200), 'map', left(coalesce(e->>'map', ''), 500), 'photo', left(coalesce(e->>'photo', ''), 500), 'featured', coalesce((e->>'featured')::boolean, false)));
  end loop;
  return out_;
end $$;

create function sfx_stores_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; d jsonb := sfx_stores_clean(p);
begin
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('directory', d);
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return d;
end $$;
grant execute on function sfx_stores_save(jsonb) to app;

alter function public_sfx_store(text) rename to public_sfx_store_predir;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_predir(p_slug); tid uuid; d jsonb;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select config->'directory' into d from sfx_stores where tenant_id = tid;
  if d is null or jsonb_typeof(d) <> 'array' or jsonb_array_length(d) = 0 then return r; end if;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('stores', d));
end $$;
grant execute on function public_sfx_store(text) to app;
