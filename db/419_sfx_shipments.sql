-- Storefront round A: order lifecycle. Fulfilment and delivery become their own states, a shipment is its own record
-- (items, carrier, tracking, events), an order has a channel tag (online | in_store) and an oversold flag.
-- Payment, fulfilment and delivery are three separate lifecycles; the legacy `status` column is kept in step
-- ('fulfilled' once every item is in a shipment) so older screens keep working.

alter table sfx_orders add column if not exists channel text not null default 'online' check (channel in ('online', 'in_store'));
alter table sfx_orders add column if not exists fulfilment_status text not null default 'unfulfilled' check (fulfilment_status in ('unfulfilled', 'partial', 'fulfilled'));
alter table sfx_orders add column if not exists delivery_status text not null default 'none' check (delivery_status in ('none', 'in_transit', 'partly_delivered', 'delivered', 'failed'));
alter table sfx_orders add column if not exists oversold boolean not null default false;
update sfx_orders set fulfilment_status = 'fulfilled' where status = 'fulfilled' and fulfilment_status = 'unfulfilled';

create table if not exists sfx_shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null references sfx_orders(id) on delete cascade,
  seq int not null,
  items jsonb not null,                 -- [{variantId, name, label, qty}]
  carrier text,
  tracking text,
  tracking_url text,
  status text not null default 'shipped' check (status in ('packed', 'shipped', 'in_transit', 'delivered', 'failed', 'cancelled')),
  notify boolean not null default true,
  shipped_at timestamptz,
  delivered_at timestamptz,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, seq)
);
create index if not exists idx_sfx_shipments_order on sfx_shipments (order_id);
create index if not exists idx_sfx_shipments_tenant on sfx_shipments (tenant_id, status);
alter table sfx_shipments enable row level security;
grant select, insert, update, delete on sfx_shipments to app;

-- Backfill: an order already fulfilled gets one shipment holding all its lines.
insert into sfx_shipments (tenant_id, order_id, seq, items, tracking, status, shipped_at, notify)
select o.tenant_id, o.id, 1,
  (select coalesce(jsonb_agg(jsonb_build_object('variantId', l->>'variantId', 'name', l->>'name', 'label', l->>'label', 'qty', (l->>'qty')::int)), '[]'::jsonb) from jsonb_array_elements(o.lines) l),
  o.tracking, 'shipped', o.updated_at, false
from sfx_orders o where o.fulfilment_status = 'fulfilled' and not exists (select 1 from sfx_shipments s where s.order_id = o.id);

-- Quantity of one line still to be put in a shipment.
create or replace function sfx_order_remaining(o sfx_orders) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId', l->>'variantId', 'name', l->>'name', 'label', l->>'label',
    'qty', greatest(coalesce((l->>'qty')::int, 0) - coalesce((
      select sum((i->>'qty')::int) from sfx_shipments s, jsonb_array_elements(s.items) i
      where s.order_id = o.id and s.status <> 'cancelled' and i->>'variantId' = l->>'variantId'), 0), 0))), '[]'::jsonb)
  from jsonb_array_elements(o.lines) l
$$;

create or replace function sfx_order_shipments(o sfx_orders) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'items', s.items, 'carrier', s.carrier, 'tracking', s.tracking,
    'trackingUrl', s.tracking_url, 'status', s.status, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at, 'events', s.events) order by s.seq), '[]'::jsonb)
  from sfx_shipments s where s.order_id = o.id
$$;

create or replace function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'customerName', o.customer->>'name', 'total', o.total, 'createdAt', o.created_at,
    'channel', o.channel, 'fulfilmentStatus', o.fulfilment_status, 'deliveryStatus', o.delivery_status, 'oversold', o.oversold) ||
    case when detail then jsonb_build_object('customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax,
      'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
      'note', o.note, 'tracking', o.tracking, 'timeline', o.timeline, 'token', o.token,
      'shipments', sfx_order_shipments(o), 'remaining', sfx_order_remaining(o)) else '{}'::jsonb end
$$;

-- Recompute the order's fulfilment and delivery states from its shipments.
create or replace function sfx_order_sync_states(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o sfx_orders; rem int; shipped int; del int; fail int; live int;
begin
  select * into o from sfx_orders where id = p_order for update;
  if not found then return; end if;
  select coalesce(sum((x->>'qty')::int), 0) into rem from jsonb_array_elements(sfx_order_remaining(o)) x;
  select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'delivered'), count(*) filter (where status = 'failed')
    into live, del, fail from sfx_shipments where order_id = p_order;
  shipped := live;
  update sfx_orders set
    fulfilment_status = case when shipped = 0 then 'unfulfilled' when rem = 0 then 'fulfilled' else 'partial' end,
    delivery_status = case when live = 0 then 'none' when del = live then 'delivered' when del > 0 then 'partly_delivered' when fail > 0 and fail = live then 'failed' else 'in_transit' end,
    status = case when status in ('cancelled', 'returned') then status when shipped > 0 and rem = 0 then 'fulfilled' else status end,
    updated_at = now()
  where id = p_order;
end $$;

-- Put some or all remaining items in a shipment. p: {items:[{variantId, qty}], carrier, tracking, trackingUrl, notify}
-- With no items given, everything still unshipped goes in.
create or replace function sfx_shipment_create(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; rem jsonb; want jsonb; it jsonb; r jsonb; q int; items jsonb := '[]'::jsonb; n int; s sfx_shipments; tu text;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status in ('cancelled', 'returned') then raise exception 'This order can no longer be fulfilled' using errcode = 'SF002'; end if;
  rem := sfx_order_remaining(o);
  want := case when jsonb_typeof(p->'items') = 'array' and jsonb_array_length(p->'items') > 0 then p->'items' else null end;
  for r in select * from jsonb_array_elements(rem) loop
    if (r->>'qty')::int <= 0 then continue; end if;
    if want is null then q := (r->>'qty')::int;
    else
      select coalesce(sum(coalesce((w->>'qty')::int, 0)), 0) into q from jsonb_array_elements(want) w where w->>'variantId' = r->>'variantId';
      if q > (r->>'qty')::int then raise exception 'You can only ship % of %', (r->>'qty')::int, r->>'name' using errcode = 'SF002'; end if;
    end if;
    if q > 0 then items := items || jsonb_build_array(jsonb_build_object('variantId', r->>'variantId', 'name', r->>'name', 'label', r->>'label', 'qty', q)); end if;
  end loop;
  if want is not null and exists (select 1 from jsonb_array_elements(want) w where not exists (select 1 from jsonb_array_elements(rem) r2 where r2->>'variantId' = w->>'variantId')) then
    raise exception 'That item is not on this order' using errcode = 'SF002';
  end if;
  if jsonb_array_length(items) = 0 then raise exception 'Choose at least one item to ship' using errcode = 'SF002'; end if;
  tu := nullif(trim(coalesce(p->>'trackingUrl', '')), '');
  if tu is not null and tu !~ '^https://[^ ]+$' or length(tu) > 400 then raise exception 'The tracking link must start with https://' using errcode = 'SF002'; end if;
  select coalesce(max(seq), 0) + 1 into n from sfx_shipments where order_id = p_order;
  insert into sfx_shipments (tenant_id, order_id, seq, items, carrier, tracking, tracking_url, status, notify, shipped_at, events)
  values (tid, p_order, n, items, nullif(left(coalesce(p->>'carrier', ''), 80), ''), nullif(left(coalesce(p->>'tracking', ''), 100), ''), tu,
    'shipped', coalesce((p->>'notify')::boolean, true), now(), jsonb_build_array(jsonb_build_object('label', 'Shipped', 'at', now())))
  returning * into s;
  perform sfx_order_sync_states(p_order);
  select * into o from sfx_orders where id = p_order;
  update sfx_orders set tracking = coalesce(s.tracking, tracking),
    timeline = sfx_order_timeline_add(o, 'Shipment ' || n || ' created (' || (select sum((i->>'qty')::int) from jsonb_array_elements(items) i) || ' item(s))')
    where id = p_order;
  select * into o from sfx_orders where id = p_order;
  return sfx_order_json(o, true);
end $$;

-- Move a shipment along: shipped -> in_transit -> delivered (or failed); cancelling returns its items to "still to ship".
create or replace function sfx_shipment_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); s sfx_shipments; o sfx_orders; ns text := nullif(p->>'status', ''); tu text;
  ok boolean;
begin
  select * into s from sfx_shipments where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'Shipment not found' using errcode = 'SF003'; end if;
  if ns is not null and ns <> s.status then
    ok := (s.status, ns) in (('packed', 'shipped'), ('shipped', 'in_transit'), ('shipped', 'delivered'), ('shipped', 'failed'), ('in_transit', 'delivered'), ('in_transit', 'failed'),
      ('failed', 'in_transit'), ('packed', 'cancelled'), ('shipped', 'cancelled'));
    if not ok then raise exception 'A % shipment cannot become %', s.status, ns using errcode = 'SF002'; end if;
  elsif ns = s.status then ns := null;
  end if;
  tu := nullif(trim(coalesce(p->>'trackingUrl', coalesce(s.tracking_url, ''))), '');
  if tu is not null and tu !~ '^https://[^ ]+$' or length(tu) > 400 then raise exception 'The tracking link must start with https://' using errcode = 'SF002'; end if;
  update sfx_shipments set
    status = coalesce(ns, status),
    carrier = case when p ? 'carrier' then nullif(left(p->>'carrier', 80), '') else carrier end,
    tracking = case when p ? 'tracking' then nullif(left(p->>'tracking', 100), '') else tracking end,
    tracking_url = tu,
    delivered_at = case when ns = 'delivered' then now() else delivered_at end,
    events = case when ns is not null then events || jsonb_build_array(jsonb_build_object('label', initcap(replace(ns, '_', ' ')), 'at', now())) else events end,
    updated_at = now()
  where id = p_id returning * into s;
  perform sfx_order_sync_states(s.order_id);
  select * into o from sfx_orders where id = s.order_id;
  if ns is not null then
    update sfx_orders set timeline = sfx_order_timeline_add(o, 'Shipment ' || s.seq || ' ' || replace(ns, '_', ' ')) where id = o.id;
    select * into o from sfx_orders where id = s.order_id;
  end if;
  return sfx_order_json(o, true);
end $$;

-- The old one-step fulfil keeps working: it ships everything still unshipped as one shipment.
create or replace function sfx_order_set_status(p_id uuid, p_status text, p_tracking text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; l jsonb; q int;
begin
  if p_status not in ('fulfilled', 'cancelled') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  select * into o from sfx_orders where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status in ('fulfilled', 'cancelled', 'returned') then raise exception 'This order can no longer be changed' using errcode = 'SF002'; end if;
  if p_status = 'fulfilled' then
    return sfx_shipment_create(p_id, jsonb_build_object('tracking', p_tracking));
  end if;
  if o.fulfilment_status <> 'unfulfilled' then raise exception 'Shipped items cannot be cancelled. Start a return instead.' using errcode = 'SF002'; end if;
  for l in select * from jsonb_array_elements(o.lines) loop
    q := coalesce((l->>'qty')::int, 0);
    if q > 0 and (l->>'variantId') is not null then
      update sfx_variants set stock = stock + q, updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = tid;
      if found then insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, q, 'cancel_return', 'Order ' || o.number || ' cancelled'); end if;
    end if;
  end loop;
  update sfx_orders set status = 'cancelled', timeline = sfx_order_timeline_add(o, 'Order cancelled'), updated_at = now() where id = p_id returning * into o;
  return sfx_order_json(o, true);
end $$;

-- The customer's own order page shows the three states and each shipment (never the internal ids).
create or replace function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then return null; end if;
  return jsonb_build_object('number', o.number, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'fulfilmentStatus', o.fulfilment_status, 'deliveryStatus', o.delivery_status,
    'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax, 'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
    'lines', o.lines, 'note', o.note, 'tracking', o.tracking, 'createdAt', o.created_at,
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('seq', s.seq, 'items', s.items, 'carrier', s.carrier, 'tracking', s.tracking, 'trackingUrl', s.tracking_url,
      'status', s.status, 'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at) order by s.seq) from sfx_shipments s where s.order_id = o.id and s.status <> 'cancelled'), '[]'::jsonb));
end $$;

-- Rollback: drop functions sfx_shipment_create, sfx_shipment_update, sfx_order_sync_states, sfx_order_remaining, sfx_order_shipments;
-- drop table sfx_shipments; alter table sfx_orders drop columns channel, fulfilment_status, delivery_status, oversold;
-- restore sfx_order_json (db/415), sfx_order_set_status (db/378) and public_sfx_order (db/415).
