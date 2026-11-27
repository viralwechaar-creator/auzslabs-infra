-- The public storefront never told the store page that card payments are set up, so the "Card, UPI or net banking" option never showed.
-- Rollback: drop function public_sfx_store(text); alter function public_sfx_store_pre447(text) rename to public_sfx_store;
alter function public_sfx_store(text) rename to public_sfx_store_pre447;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pre447(p_slug); tid uuid;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  if tid is not null and exists (select 1 from sfx_store_secrets where tenant_id = tid) then
    r := jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('payOnline', true));
  end if;
  return r;
end $$;
grant execute on function public_sfx_store(text) to app;
