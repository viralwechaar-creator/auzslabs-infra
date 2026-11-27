-- A business that has the AUZslab storefront takes online orders ONLY through the storefront.
-- The old AUZsStyle store functions answer "no store here" (so store.html falls through to the storefront) and refuse orders.
-- Rollback: drop both new functions, then
--   alter function public_sty_store_pre444(text) rename to public_sty_store;
--   alter function public_sty_place_order_pre444(text, jsonb) rename to public_sty_place_order;
create or replace function sfx_storefront_on(tid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(features->>'storefront', 'false') = 'true' and coalesce(enabled_features->>'storefront', 'true') <> 'false'
                   from tenant_settings where tenant_id = tid), false)
$$;

alter function public_sty_store(text) rename to public_sty_store_pre444;
create function public_sty_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug);
begin
  if tid is not null and sfx_storefront_on(tid) then return null; end if;
  return public_sty_store_pre444(p_slug);
end $$;

alter function public_sty_place_order(text, jsonb) rename to public_sty_place_order_pre444;
create function public_sty_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug);
begin
  if tid is not null and sfx_storefront_on(tid) then raise exception 'Online orders for this shop are taken on its storefront.' using errcode = 'P0001'; end if;
  return public_sty_place_order_pre444(p_slug, p);
end $$;
grant execute on function public_sty_store(text), public_sty_place_order(text, jsonb) to app;
