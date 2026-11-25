-- Storefront round B: inventory states, cost snapshots, stock buffer, versioned product edits.
--  * A variant has stock that can be sold (available), stock held for unshipped orders (committed, derived) and stock that is
--    set aside as unavailable (damaged, quality hold). on hand = available + committed + unavailable.
--  * Cost is optional per variant. Unknown is NOT zero. Each order line snapshots the cost at the moment of the order.
--  * A shop can keep a stock buffer: online orders may not take a variant below it.
--  * Saving a product can carry the version the editor opened; if it moved on, the save is refused instead of overwriting.

alter table sfx_variants add column if not exists cost numeric(12,2) check (cost is null or cost >= 0);
alter table sfx_variants add column if not exists unavailable int not null default 0 check (unavailable >= 0);
alter table sfx_variants add column if not exists needs_shipping boolean not null default true;
alter table sfx_variants add column if not exists track_stock boolean not null default true;

-- Cost on each order line, frozen when the order is created. Missing stays null.
create or replace function sfx_orders_snapshot_cost() returns trigger language plpgsql security definer set search_path = public as $$
declare l jsonb; out jsonb := '[]'::jsonb; c numeric;
begin
  for l in select * from jsonb_array_elements(new.lines) loop
    c := null;
    if (l->>'variantId') is not null and not (l ? 'cost') then
      select v.cost into c from sfx_variants v where v.id = (l->>'variantId')::uuid and v.tenant_id = new.tenant_id;
    end if;
    out := out || jsonb_build_array(case when l ? 'cost' then l else l || jsonb_build_object('cost', c) end);
  end loop;
  new.lines := out;
  return new;
end $$;
drop trigger if exists sfx_orders_cost on sfx_orders;
create trigger sfx_orders_cost before insert on sfx_orders for each row execute function sfx_orders_snapshot_cost();

-- Stock buffer: an online order may not leave a variant below the shop's buffer. Runs after the stock was taken, so a refusal
-- rolls the whole order back. Orders from the shop's own till (in_store) are not held to it.
create or replace function sfx_orders_check_buffer() returns trigger language plpgsql security definer set search_path = public as $$
declare buf int; l jsonb; st int; nm text;
begin
  if new.channel <> 'online' then return new; end if;
  select coalesce(nullif(config->>'stockBuffer', '')::int, 0) into buf from sfx_stores where tenant_id = new.tenant_id;
  if coalesce(buf, 0) <= 0 then return new; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if (l->>'variantId') is null then continue; end if;
    select v.stock, p.name into st, nm from sfx_variants v join sfx_products p on p.id = v.product_id where v.id = (l->>'variantId')::uuid;
    if st is not null and st < buf then raise exception '% has only % left to order online', nm, greatest(st + coalesce((l->>'qty')::int, 0) - buf, 0) using errcode = 'SF002'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists sfx_orders_buffer on sfx_orders;
create trigger sfx_orders_buffer before insert on sfx_orders for each row execute function sfx_orders_check_buffer();

create or replace function sfx_stock_buffer_save(p_buffer int) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); b int := coalesce(p_buffer, 0);
begin
  if b < 0 or b > 1000 then raise exception 'The buffer must be between 0 and 1000' using errcode = 'SF002'; end if;
  insert into sfx_stores (tenant_id, config) values (tid, jsonb_build_object('stockBuffer', b))
  on conflict (tenant_id) do update set config = coalesce(sfx_stores.config, '{}'::jsonb) || jsonb_build_object('stockBuffer', b), updated_at = now();
  return jsonb_build_object('stockBuffer', b);
end $$;

-- Quantity of each variant held by orders that are not fully shipped yet.
create or replace function sfx_variant_committed(p_tenant uuid, p_variant uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum((r->>'qty')::int), 0)::int
  from sfx_orders o, jsonb_array_elements(sfx_order_remaining(o)) r
  where o.tenant_id = p_tenant and o.status not in ('cancelled', 'returned', 'fulfilled') and r->>'variantId' = p_variant::text
$$;

create or replace function sfx_inventory_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('variantId', v.id, 'productId', p.id, 'product', p.name, 'variant', v.label, 'sku', v.sku,
      'online', v.stock, 'available', v.stock, 'unavailable', v.unavailable, 'committed', sfx_variant_committed(tid, v.id),
      'onHand', v.stock + v.unavailable + sfx_variant_committed(tid, v.id),
      'cost', v.cost, 'needsShipping', v.needs_shipping, 'tracked', v.track_stock,
      'elsewhere', coalesce((select sum(ls.qty) from sfx_location_stock ls where ls.variant_id = v.id), 0),
      'status', p.status) order by p.name, v.position, v.label)
    from sfx_variants v join sfx_products p on p.id = v.product_id where v.tenant_id = tid
  ), '[]'::jsonb);
end $$;

-- Move units between available and unavailable (damaged, held for quality, found again). reason is required.
create or replace function sfx_stock_set_unavailable(p_variant uuid, p_delta int, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); v sfx_variants; d int := coalesce(p_delta, 0); r text := trim(coalesce(p_reason, ''));
begin
  if d = 0 then raise exception 'No change to save' using errcode = 'SF002'; end if;
  if r not in ('damaged', 'quality_hold', 'safety_stock', 'other', 'released') then raise exception 'Choose a reason' using errcode = 'SF002'; end if;
  select * into v from sfx_variants where id = p_variant and tenant_id = tid for update;
  if not found then raise exception 'Variant not found' using errcode = 'SF003'; end if;
  -- d > 0 moves units out of available into unavailable; d < 0 releases them back.
  if d > 0 and v.stock < d then raise exception 'Only % available to set aside', v.stock using errcode = 'SF002'; end if;
  if d < 0 and v.unavailable < -d then raise exception 'Only % unavailable to release', v.unavailable using errcode = 'SF002'; end if;
  update sfx_variants set stock = stock - d, unavailable = unavailable + d, updated_at = now() where id = p_variant;
  insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, p_variant, -d, 'unavailable_' || r, 'Moved ' || abs(d) || case when d > 0 then ' to unavailable' else ' back to available' end);
  return jsonb_build_object('variantId', p_variant, 'available', v.stock - d, 'unavailable', v.unavailable + d);
end $$;

-- Cost and shipping flags for one variant. Empty cost clears it back to unknown.
create or replace function sfx_variant_meta_save(p_variant uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); c numeric; v sfx_variants;
begin
  select * into v from sfx_variants where id = p_variant and tenant_id = tid for update;
  if not found then raise exception 'Variant not found' using errcode = 'SF003'; end if;
  if p ? 'cost' then
    c := case when nullif(trim(coalesce(p->>'cost', '')), '') is null then null else (p->>'cost')::numeric end;
    if c is not null and (c < 0 or c > 10000000) then raise exception 'Enter a valid cost' using errcode = 'SF002'; end if;
  else c := v.cost; end if;
  update sfx_variants set cost = c, needs_shipping = coalesce((p->>'needsShipping')::boolean, needs_shipping),
    track_stock = coalesce((p->>'tracked')::boolean, track_stock), updated_at = now() where id = p_variant;
  return jsonb_build_object('variantId', p_variant, 'cost', c);
end $$;

-- Versioned product edits: pass p.expectedUpdatedAt (the updatedAt the editor loaded). A mismatch refuses the save.
alter function sfx_product_save(uuid, jsonb) rename to sfx_product_save_unversioned;
create function sfx_product_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur timestamptz; exp timestamptz;
begin
  if p_id is not null and nullif(p->>'expectedUpdatedAt', '') is not null then
    exp := (p->>'expectedUpdatedAt')::timestamptz;
    select updated_at into cur from sfx_products where id = p_id and tenant_id = tid;
    if cur is not null and abs(extract(epoch from (cur - exp))) > 0.001 then
      raise exception 'This product was changed by someone else. Reload it and review their changes before saving.' using errcode = 'SF009';
    end if;
  end if;
  return sfx_product_save_unversioned(p_id, p);
end $$;

-- Cost coverage for reports: share of order-line revenue with a recorded cost.
create or replace function sfx_cost_coverage(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  select jsonb_build_object('sales', coalesce(sum(rev), 0), 'salesWithCost', coalesce(sum(rev) filter (where has_cost), 0),
    'cost', coalesce(sum(cst) filter (where has_cost), 0), 'lines', count(*), 'linesWithCost', count(*) filter (where has_cost),
    'coverage', case when coalesce(sum(rev), 0) = 0 then null else round(100 * coalesce(sum(rev) filter (where has_cost), 0) / sum(rev), 1) end)
  into r from (
    select (l->>'price')::numeric * coalesce((l->>'qty')::int, 1) rev, (l->>'cost') is not null and l->>'cost' <> 'null' has_cost,
      coalesce(nullif(l->>'cost', 'null')::numeric, 0) * coalesce((l->>'qty')::int, 1) cst
    from sfx_orders o, jsonb_array_elements(o.lines) l
    where o.tenant_id = tid and o.status not in ('cancelled') and o.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))) x;
  return r;
end $$;
-- Checkout settings also report the stock buffer so the inventory screen can show it.
alter function sfx_checkout_settings_get() rename to sfx_checkout_settings_get_prebuf;
create function sfx_checkout_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); b int;
begin
  select coalesce(nullif(config->>'stockBuffer', '')::int, 0) into b from sfx_stores where tenant_id = tid;
  return sfx_checkout_settings_get_prebuf() || jsonb_build_object('stockBuffer', coalesce(b, 0));
end $$;
grant execute on function sfx_checkout_settings_get() to app;

grant execute on function sfx_product_save(uuid, jsonb), sfx_inventory_list(), sfx_stock_set_unavailable(uuid, int, text), sfx_variant_meta_save(uuid, jsonb), sfx_stock_buffer_save(int), sfx_cost_coverage(int) to app;

-- Rollback: drop function sfx_checkout_settings_get(); alter function sfx_checkout_settings_get_prebuf() rename to sfx_checkout_settings_get; drop triggers sfx_orders_cost, sfx_orders_buffer and their functions; drop sfx_stock_buffer_save, sfx_variant_committed,
-- sfx_stock_set_unavailable, sfx_variant_meta_save, sfx_cost_coverage; drop function sfx_product_save(uuid,jsonb) and rename
-- sfx_product_save_unversioned back; restore sfx_inventory_list from db/378; drop the four sfx_variants columns.
