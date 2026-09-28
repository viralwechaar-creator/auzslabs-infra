-- =========================================================
-- Turning off "Self-order (QR)" in the client dashboard's Services
-- tab (update_my_features) only ever hid the guest-order inbox from
-- staff (getG() in index.html) -- the actual customer-facing entry
-- point never checked the flag at all:
--   * place_order() accepted an order regardless of the feature
--     being off, so a customer scanning an already-printed table QR
--     code could keep ordering even after the owner turned it off.
--   * public_menu()'s cfg only ever merged `features` (what the
--     tenant is entitled to), never `enabled_features` (the owner's
--     own live on/off toggle), so site.html had no way to know the
--     owner had switched it off even if it tried to check.
--   * The "Print all QR" / per-table "QR" buttons in the dashboard's
--     Settings > Tables tab rendered unconditionally.
-- This migration closes the first two (server-side, so it can't be
-- bypassed by calling the RPC directly); the dashboard buttons are
-- gated client-side in the same deploy as this migration.
-- =========================================================

create or replace function public_menu(tenant_slug text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'items',  coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'item'  and not r.deleted), '[]'::jsonb),
    'cats',   coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'cat'   and not r.deleted), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'table' and not r.deleted), '[]'::jsonb),
    'cfg',    coalesce((
                select r.data || jsonb_build_object(
                  '_features', coalesce(ts.features, '{}'::jsonb),
                  '_enabled_features', coalesce(ts.enabled_features, '{}'::jsonb)
                )
                from records r
                join tenants t on t.id = r.tenant_id
                left join tenant_settings ts on ts.tenant_id = t.id
                where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'
              ), '{}'::jsonb)
  )
$$;

create or replace function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cnt int; tid uuid; on_ boolean;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  -- same effective on/off logic as featureOn() in index.html: entitled
  -- (features) AND not explicitly disabled (enabled_features).
  select coalesce(ts.features->>'self_order','false')::boolean
     and coalesce(ts.enabled_features->>'self_order','true')::boolean
    into on_ from tenant_settings ts where ts.tenant_id = tid;
  if not coalesce(on_, false) then
    raise exception 'self-order is currently turned off for this business';
  end if;

  select count(*) into cnt from guest_orders where tenant_id = tid and tbl = t and status = 'new' and created_at > now() - interval '30 minutes';
  if cnt >= 5 then raise exception 'busy: too many pending orders for this table'; end if;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items) values (tid, t, n, p, nt, its);
end;
$$;
