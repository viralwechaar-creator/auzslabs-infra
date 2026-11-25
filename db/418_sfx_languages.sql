-- Round 6 (storefront gaps): optional Hindi for the shop's own interface labels (bag, checkout, buttons).
-- config.languages = {hindi: bool}. Product names, descriptions and pages stay as the owner wrote them.
-- Rollback: drop function sfx_languages_save(jsonb); drop function public_sfx_store(text); alter function public_sfx_store_prelang(text) rename to public_sfx_store;
create function sfx_languages_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; on_ boolean := coalesce((p->>'hindi')::boolean, false);
begin
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('languages', jsonb_build_object('hindi', on_));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return jsonb_build_object('hindi', on_);
end $$;
grant execute on function sfx_languages_save(jsonb) to app;

create function sfx_languages_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'languages' into c from sfx_stores where tenant_id = tid;
  return jsonb_build_object('hindi', coalesce((c->>'hindi')::boolean, false));
end $$;
grant execute on function sfx_languages_get() to app;

alter function public_sfx_store(text) rename to public_sfx_store_prelang;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_prelang(p_slug); tid uuid; c jsonb;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select config->'languages' into c from sfx_stores where tenant_id = tid;
  if coalesce((c->>'hindi')::boolean, false) is not true then return r; end if;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('languages', jsonb_build_object('hindi', true)));
end $$;
grant execute on function public_sfx_store(text) to app;
