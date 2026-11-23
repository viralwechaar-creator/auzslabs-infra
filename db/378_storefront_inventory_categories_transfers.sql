-- =========================================================
-- Storefront phase 3, part 2: Inventory (stock ledger + manual adjust), Categories and tags, and Transfers
-- between stock locations. Same discipline as db/372/377: own sfx_* tables, RLS on with no policies, access
-- only through sfx_guard() SECURITY DEFINER functions, all registered in rpc-registry.js.
--
-- Stock model: sfx_variants.stock stays the ONLINE (sellable) stock the checkout reads. Other locations
-- (a shop, a warehouse) hold their own counts in sfx_location_stock; a transfer moves units between
-- "online" and a location, or between two locations. Every change is one row in sfx_stock_moves.
-- Also: cancelling an order now puts its units back (db/372 never restocked).
-- =========================================================
alter table sfx_products add column if not exists tags text[] not null default '{}';

create table sfx_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index idx_sfx_locations_name on sfx_locations (tenant_id, lower(name));
alter table sfx_locations enable row level security;

create table sfx_location_stock (
  location_id uuid not null references sfx_locations(id) on delete cascade,
  variant_id uuid not null references sfx_variants(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  qty int not null default 0 check (qty >= 0),
  primary key (location_id, variant_id)
);
alter table sfx_location_stock enable row level security;

create table sfx_stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  variant_id uuid not null references sfx_variants(id) on delete cascade,
  delta int not null,                 -- change to ONLINE stock (0 for a move between two off-site locations)
  reason text not null,               -- adjust | restock | cancel_return | transfer
  note text,
  from_loc text,                      -- 'online' or a location name, for transfers
  to_loc text,
  qty int,                            -- transfer quantity
  at timestamptz not null default now()
);
create index idx_sfx_stock_moves on sfx_stock_moves (tenant_id, variant_id, at desc);
alter table sfx_stock_moves enable row level security;

grant select, insert, update, delete on sfx_locations, sfx_location_stock, sfx_stock_moves to app;

-- ---------- inventory ----------
create function sfx_inventory_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('variantId', v.id, 'productId', p.id, 'product', p.name, 'variant', v.label, 'sku', v.sku,
      'online', v.stock, 'elsewhere', coalesce((select sum(ls.qty) from sfx_location_stock ls where ls.variant_id = v.id), 0),
      'status', p.status) order by p.name, v.position, v.label)
    from sfx_variants v join sfx_products p on p.id = v.product_id where v.tenant_id = tid
  ), '[]'::jsonb);
end $$;

-- delta adds/removes units from online stock; p_set (optional) sets online stock to an exact count instead.
create function sfx_stock_adjust(p_variant uuid, p_delta int, p_set int default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur int; d int; nw int;
begin
  select stock into cur from sfx_variants where id = p_variant and tenant_id = tid for update;
  if not found then raise exception 'Variant not found' using errcode = 'SF003'; end if;
  if p_set is not null then d := p_set - cur; else d := coalesce(p_delta, 0); end if;
  if d = 0 then raise exception 'No change to save' using errcode = 'SF002'; end if;
  nw := cur + d;
  if nw < 0 then raise exception 'Stock cannot go below zero (there are % in stock)', cur using errcode = 'SF002'; end if;
  update sfx_variants set stock = nw, updated_at = now() where id = p_variant;
  insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, p_variant, d, case when d > 0 then 'restock' else 'adjust' end, left(coalesce(p_note, ''), 500));
  return jsonb_build_object('variantId', p_variant, 'online', nw);
end $$;

create function sfx_stock_moves_list(p_variant uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', m.id, 'product', p.name, 'variant', v.label, 'delta', m.delta, 'reason', m.reason, 'note', m.note,
      'from', m.from_loc, 'to', m.to_loc, 'qty', m.qty, 'at', m.at) x
    from sfx_stock_moves m join sfx_variants v on v.id = m.variant_id join sfx_products p on p.id = v.product_id
    where m.tenant_id = tid and (p_variant is null or m.variant_id = p_variant) order by m.at desc limit 200) s), '[]'::jsonb);
end $$;

-- ---------- locations and transfers ----------
create function sfx_location_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
    'units', coalesce((select sum(qty) from sfx_location_stock s where s.location_id = l.id), 0)) order by l.name)
    from sfx_locations l where l.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_location_save(p_id uuid, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n text := trim(coalesce(p_name, '')); r sfx_locations;
begin
  if n = '' or lower(n) = 'online' then raise exception 'Enter a location name (not "Online", which is your storefront stock)' using errcode = 'SF002'; end if;
  begin
    if p_id is null then insert into sfx_locations (tenant_id, name) values (tid, left(n, 80)) returning * into r;
    else update sfx_locations set name = left(n, 80) where id = p_id and tenant_id = tid returning * into r;
      if not found then raise exception 'Location not found' using errcode = 'SF003'; end if;
    end if;
  exception when unique_violation then raise exception 'A location with this name already exists' using errcode = 'SF002';
  end;
  return jsonb_build_object('id', r.id, 'name', r.name, 'units', 0);
end $$;

create function sfx_location_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  if exists (select 1 from sfx_location_stock where location_id = p_id and tenant_id = tid and qty > 0) then
    raise exception 'Move the stock out of this location before deleting it' using errcode = 'SF002'; end if;
  delete from sfx_locations where id = p_id and tenant_id = tid;
end $$;

create function sfx_location_stock_list(p_location uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('variantId', v.id, 'product', p.name, 'variant', v.label, 'qty', s.qty) order by p.name, v.label)
    from sfx_location_stock s join sfx_variants v on v.id = s.variant_id join sfx_products p on p.id = v.product_id
    where s.location_id = p_location and s.tenant_id = tid and s.qty > 0), '[]'::jsonb);
end $$;

-- from/to: the text 'online' or a location id. Receiving into a location a variant has never been in creates the row.
create function sfx_transfer(p_variant uuid, p_from text, p_to text, p_qty int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); online int; fl uuid; tl uuid; fname text := 'Online'; tname text := 'Online'; have int;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many units to move' using errcode = 'SF002'; end if;
  if p_from = p_to then raise exception 'Choose two different locations' using errcode = 'SF002'; end if;
  select stock into online from sfx_variants where id = p_variant and tenant_id = tid for update;
  if not found then raise exception 'Variant not found' using errcode = 'SF003'; end if;
  if p_from <> 'online' then
    fl := p_from::uuid; select name into fname from sfx_locations where id = fl and tenant_id = tid;
    if not found then raise exception 'Source location not found' using errcode = 'SF003'; end if;
  end if;
  if p_to <> 'online' then
    tl := p_to::uuid; select name into tname from sfx_locations where id = tl and tenant_id = tid;
    if not found then raise exception 'Destination location not found' using errcode = 'SF003'; end if;
  end if;
  -- take from the source
  if fl is null then
    if online < p_qty then raise exception 'Only % in online stock', online using errcode = 'SF002'; end if;
    update sfx_variants set stock = stock - p_qty, updated_at = now() where id = p_variant;
  else
    select qty into have from sfx_location_stock where location_id = fl and variant_id = p_variant for update;
    if coalesce(have, 0) < p_qty then raise exception 'Only % at %', coalesce(have, 0), fname using errcode = 'SF002'; end if;
    update sfx_location_stock set qty = qty - p_qty where location_id = fl and variant_id = p_variant;
  end if;
  -- give to the destination
  if tl is null then update sfx_variants set stock = stock + p_qty, updated_at = now() where id = p_variant;
  else insert into sfx_location_stock (location_id, variant_id, tenant_id, qty) values (tl, p_variant, tid, p_qty)
    on conflict (location_id, variant_id) do update set qty = sfx_location_stock.qty + excluded.qty;
  end if;
  insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note, from_loc, to_loc, qty)
    values (tid, p_variant, case when fl is null then -p_qty when tl is null then p_qty else 0 end, 'transfer', left(coalesce(p_note, ''), 500), fname, tname, p_qty);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- categories and tags ----------
create function sfx_category_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c, 'count', n) order by c)
      from (select coalesce(nullif(trim(category), ''), '') c, count(*) n from sfx_products where tenant_id = tid group by 1 having coalesce(nullif(trim(category), ''), '') <> '') s), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('name', t, 'count', n) order by t)
      from (select unnest(tags) t, count(*) n from sfx_products where tenant_id = tid group by 1) s), '[]'::jsonb));
end $$;

-- Rename a category everywhere; renaming to an existing name merges the two.
create function sfx_category_rename(p_old text, p_new text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n int; nw text := trim(coalesce(p_new, ''));
begin
  if trim(coalesce(p_old, '')) = '' then raise exception 'Choose a category' using errcode = 'SF002'; end if;
  update sfx_products set category = nullif(nw, ''), updated_at = now() where tenant_id = tid and trim(category) = trim(p_old);
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $$;

create function sfx_product_set_tags(p_id uuid, p_tags text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); t text[];
begin
  select coalesce(array_agg(distinct x), '{}') into t from (select lower(trim(v)) x from unnest(string_to_array(coalesce(p_tags, ''), ',')) v) s where x <> '' and length(x) <= 40;
  update sfx_products set tags = t[1:20], updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('id', p_id, 'tags', to_jsonb(t[1:20]));
end $$;

create function sfx_product_tags() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_object_agg(id::text, tags) from sfx_products where tenant_id = tid and cardinality(tags) > 0), '{}'::jsonb);
end $$;

-- ---------- cancelling an order puts its units back (db/372 did not) ----------
create or replace function sfx_order_set_status(p_id uuid, p_status text, p_tracking text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; l jsonb; q int;
begin
  if p_status not in ('fulfilled', 'cancelled') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  select * into o from sfx_orders where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status in ('fulfilled', 'cancelled', 'returned') then raise exception 'This order can no longer be changed' using errcode = 'SF002'; end if;
  if p_status = 'cancelled' then
    for l in select * from jsonb_array_elements(o.lines) loop
      q := coalesce((l->>'qty')::int, 0);
      if q > 0 and (l->>'variantId') is not null then
        update sfx_variants set stock = stock + q, updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = tid;
        if found then insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, q, 'cancel_return', 'Order ' || o.number || ' cancelled'); end if;
      end if;
    end loop;
  end if;
  update sfx_orders set status = p_status, tracking = coalesce(p_tracking, tracking),
    timeline = sfx_order_timeline_add(o, case when p_status = 'fulfilled' then 'Order fulfilled' else 'Order cancelled' end), updated_at = now()
    where id = p_id returning * into o;
  return sfx_order_json(o, true);
end $$;

-- Rollback: drop functions sfx_inventory_list, sfx_stock_adjust, sfx_stock_moves_list, sfx_location_*, sfx_transfer,
-- sfx_category_*, sfx_product_set_tags, sfx_product_tags; drop tables sfx_stock_moves, sfx_location_stock, sfx_locations;
-- alter table sfx_products drop column tags; re-create sfx_order_set_status from db/372.
