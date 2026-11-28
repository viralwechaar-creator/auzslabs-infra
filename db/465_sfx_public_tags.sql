-- Storefront: product tags in the public store, so shoppers can filter by tag (?tag=).
-- Rollback: drop function public_sfx_store(text); alter function public_sfx_store_pretags(text) rename to public_sfx_store;
alter function public_sfx_store(text) rename to public_sfx_store_pretags;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pretags(p_slug); tid uuid;
begin
  if r is null or jsonb_typeof(r->'styles') is distinct from 'array' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  return jsonb_set(r, '{styles}', coalesce((
    select jsonb_agg(case when pr.id is not null and cardinality(pr.tags) > 0 then s || jsonb_build_object('tags', to_jsonb(pr.tags)) else s end order by so)
    from jsonb_array_elements(r->'styles') with ordinality x(s, so)
    left join sfx_products pr on pr.tenant_id = tid and pr.id::text = x.s->>'id'), '[]'::jsonb));
end $$;
grant execute on function public_sfx_store(text) to app;
