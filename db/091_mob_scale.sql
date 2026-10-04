-- =========================================================
-- AUZsMob scale fixes, found by the 60-shop launch load test (tests/suites/local/loadmob.mjs):
--
-- 1. mob_push_sale could deadlock. Two staff in the same shop selling the same items in a different order each
--    locked the item rows one at a time in cart order, so each held what the other wanted ("deadlock detected",
--    HTTP 500, and the sale was refused). Rows are now locked up front in one fixed order (units, then items, by
--    id), and with FOR NO KEY UPDATE so a purchase of the same item (which only needs a key-share lock for its
--    foreign key) no longer waits behind a sale.
-- 2. mob_sync_pull sent a shop's whole history on a first sync (88 MB / 17 s for one very busy year). A first
--    sync, or one from a phone that has been away more than 90 days, is now a "window": the last 90 days of
--    activity, plus everything still open (customer dues, vendor dues, unfinished repairs, units in stock), plus
--    ONE opening-balance stock row per item for everything older, so stock still adds up on the phone. The
--    answer carries "full": true so the phone knows to replace its old stock rows. Everyday catch-ups
--    (p_since inside the window) are unchanged.
-- 3. mob_report_ledger took 4 s for 9,000 rows: the totals were re-summed from the JSON it had just built. They
--    now come straight from the table, and the rows are capped (p_limit, default 2000, newest first) with a
--    "truncated" flag; the totals always cover every matching row.
-- =========================================================

-- ---- 1. mob_push_sale: lock in one order ----
create or replace function mob_push_sale(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; item jsonb; i int; bill text;
  unit mob_item_units; item_row mob_items; have numeric;
  subtotal numeric := 0; items_out jsonb := '[]'::jsonb;
begin
  tid := mob_guard('mob_sell');
  if exists (select 1 from mob_sales where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  if mob_day_locked(tid, coalesce((p->>'at')::timestamptz, now())) then raise exception 'That day is closed' using errcode = 'MB003'; end if;

  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'at least one item is required' using errcode = 'MB005';
  end if;

  -- take every row lock this sale needs first, in a fixed order, so two sales can never wait on each other in a circle
  perform 1 from mob_item_units where tenant_id = tid
    and id in (select (e->>'unitId')::uuid from jsonb_array_elements(p->'items') e where e ? 'unitId')
    order by id for no key update;
  perform 1 from mob_items where tenant_id = tid
    and id in (select (e->>'itemId')::uuid from jsonb_array_elements(p->'items') e where not (e ? 'unitId') and e ? 'itemId')
    order by id for no key update;

  for i in 0 .. jsonb_array_length(p->'items') - 1 loop
    item := p->'items'->i;
    if item ? 'unitId' then
      select * into unit from mob_item_units where id = (item->>'unitId')::uuid and tenant_id = tid;
      if unit.id is null then raise exception 'unit not found' using errcode = 'MB004'; end if;
      if unit.status <> 'in_stock' then raise exception '% is not available for sale (status: %)', coalesce(unit.imei, unit.id::text), unit.status using errcode = 'MB006'; end if;
      update mob_item_units set status = 'sold', updated_at = now() where id = unit.id;
      insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, unit.item_id, unit.id, -1, 'sale', p_id, app_uid());
      items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', unit.cost_price));
    else
      select * into item_row from mob_items where id = (item->>'itemId')::uuid and tenant_id = tid;
      if item_row.id is null then raise exception 'item not found' using errcode = 'MB004'; end if;
      select coalesce(sum(qty), 0) into have from mob_stock_movements where item_id = item_row.id and tenant_id = tid;
      if have < (item->>'qty')::numeric then raise exception 'not enough stock for %', item_row.name using errcode = 'MB007'; end if;
      insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, item_row.id, -(item->>'qty')::numeric, 'sale', p_id, app_uid());
      items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', item_row.cost_price));
    end if;
    subtotal := subtotal + (item->>'price')::numeric * coalesce((item->>'qty')::numeric, 1);
  end loop;

  bill := mob_next_bill_no(tid);

  insert into mob_sales (id, tenant_id, bill_no, customer_id, customer_name, customer_phone, items, subtotal, discount, total, paid, balance, payment_mode, staff_id)
    values (p_id, tid, bill, nullif(p->>'customerId','')::uuid, p->>'customerName', p->>'customerPhone', items_out,
            subtotal, coalesce((p->>'discount')::numeric, 0), subtotal - coalesce((p->>'discount')::numeric, 0),
            coalesce((p->>'paid')::numeric, subtotal - coalesce((p->>'discount')::numeric, 0)),
            greatest(0, (subtotal - coalesce((p->>'discount')::numeric, 0)) - coalesce((p->>'paid')::numeric, subtotal - coalesce((p->>'discount')::numeric, 0))),
            coalesce(p->>'paymentMode', 'cash'), app_uid());

  return jsonb_build_object('ok', true, 'id', p_id, 'billNo', bill, 'total', subtotal - coalesce((p->>'discount')::numeric, 0));
end $$;

-- ---- indexes the windowed pull and reports lean on ----
create index if not exists idx_mob_repair_events_tenant_at on mob_repair_events (tenant_id, created_at);
create index if not exists idx_mob_sales_open on mob_sales (tenant_id) where balance > 0 and not voided;
create index if not exists idx_mob_purchases_vendor on mob_purchases (tenant_id) where vendor_id is not null;
create index if not exists idx_mob_units_stock on mob_item_units (tenant_id) where status = 'in_stock';

-- ---- 2. mob_sync_pull: a windowed first sync ----
create or replace function mob_sync_pull(p_since timestamptz default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid; sees_all boolean; me uuid := app_uid();
  cutoff timestamptz := now() - interval '90 days';
  win boolean := p_since is null or p_since < now() - interval '90 days';
  since timestamptz := case when p_since is null or p_since < now() - interval '90 days' then cutoff else p_since end;
begin
  tid := mob_guard();
  sees_all := mob_perm('mob_reports');

  return jsonb_build_object(
    'full', win,
    'items', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_items where tenant_id = tid and (win or updated_at > p_since)) x), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from mob_item_units where tenant_id = tid
          and (case when win then (status = 'in_stock' or updated_at >= cutoff) else updated_at > p_since end)) x), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_vendors where tenant_id = tid and (win or updated_at > p_since)) x), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_customers where tenant_id = tid and (win or updated_at > p_since)) x), '[]'::jsonb),
    -- purchases: the window, plus (on a window pull) every vendor purchase, since vendor dues are summed from them
    'purchases', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from mob_purchases where tenant_id = tid and (sees_all or staff_id = me)
          and (created_at > since or (win and vendor_id is not null))) x), '[]'::jsonb),
    -- sales: the window, plus (on a window pull) every sale that still has money owing
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from mob_sales where tenant_id = tid and (sees_all or staff_id = me)
          and (created_at > since or (win and balance > 0 and not voided))) x), '[]'::jsonb),
    -- repairs: the window, plus (on a window pull) every job not yet delivered or cancelled
    'repairs', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select r.* from mob_repairs r where r.tenant_id = tid and (sees_all or r.staff_id = me)
          and (r.created_at > since or (win and not exists (
                select 1 from mob_repair_events e where e.repair_id = r.id and e.type = 'status' and e.status in ('delivered', 'cancelled'))))) x), '[]'::jsonb),
    'repair_events', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select re.* from mob_repair_events re join mob_repairs r on r.id = re.repair_id
        where re.tenant_id = tid and (sees_all or r.staff_id = me)
          and (re.created_at > since or (win and not exists (
                select 1 from mob_repair_events e where e.repair_id = r.id and e.type = 'status' and e.status in ('delivered', 'cancelled'))))
      ) x), '[]'::jsonb),
    -- payments: the window, plus (on a window pull) every vendor payment and every payment against a sale still owing
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from mob_payments p where tenant_id = tid and (sees_all or staff_id = me)
          and (created_at > since or (win and (kind = 'vendor_due' or exists (
                select 1 from mob_sales s where s.id = p.sale_id and s.balance > 0 and not s.voided))))) x), '[]'::jsonb),
    -- stock: the window as it happened, plus (on a window pull) ONE opening row per item for everything older
    'stock_movements', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from mob_stock_movements where tenant_id = tid and created_at > since
        union all
        select md5(m.tenant_id::text || m.item_id::text || 'opening')::uuid, m.tenant_id, m.item_id, null::uuid, sum(m.qty), 'adjustment', null::uuid,
               coalesce((select i.created_by from mob_items i where i.id = m.item_id), me), cutoff - interval '1 second'
          from mob_stock_movements m
          where win and m.tenant_id = tid and m.created_at <= cutoff and m.item_id is not null
          group by m.tenant_id, m.item_id
          having sum(m.qty) <> 0
      ) x), '[]'::jsonb),
    'server_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
  );
end $$;

-- ---- 3. mob_report_ledger: totals from the table, rows capped ----
drop function if exists mob_report_ledger(date, date, uuid);
create or replace function mob_report_ledger(p_from date default null, p_to date default null, p_staff_id uuid default null, p_limit int default 2000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz; res jsonb;
begin
  tid := mob_guard('mob_reports');
  from_ts := coalesce(p_from, current_date - 29)::timestamptz;
  to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';

  with lines as (
    select s.id sale_id, s.bill_no, s.created_at sold_at, it, s.customer_name, s.staff_id sold_by_id,
           u.imei, pu.created_at purchased_at, pu.staff_id purchased_by_id, v.name vendor_name,
           coalesce((it->>'qty')::numeric, 1) qty, (it->>'price')::numeric price, coalesce((it->>'costPrice')::numeric, 0) cost
    from mob_sales s
    cross join lateral jsonb_array_elements(s.items) it
    left join mob_item_units u on u.id = nullif(it->>'unitId', '')::uuid
    left join mob_purchases pu on pu.unit_id = u.id and pu.tenant_id = tid
    left join mob_vendors v on v.id = pu.vendor_id
    where s.tenant_id = tid and not s.voided
      and s.created_at >= from_ts and s.created_at < to_ts
      and (p_staff_id is null or s.staff_id = p_staff_id or pu.staff_id = p_staff_id)
  ), tot as (
    select count(*) n, coalesce(sum(round(price * qty, 2)), 0) sale, coalesce(sum(round(cost * qty, 2)), 0) cost,
           coalesce(sum(round((price - cost) * qty, 2)), 0) profit from lines
  ), top as (
    select * from lines order by sold_at desc limit greatest(coalesce(p_limit, 2000), 1)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'sale_id', t.sale_id, 'bill_no', t.bill_no, 'sold_at', t.sold_at, 'item_name', t.it->>'name', 'imei', t.imei,
        'qty', t.qty, 'sale_price', t.price, 'sale_total', round(t.price * t.qty, 2),
        'cost_price', (t.it->>'costPrice')::numeric, 'cost_total', round(t.cost * t.qty, 2),
        'profit', round((t.price - t.cost) * t.qty, 2),
        'customer_name', coalesce(nullif(t.customer_name, ''), 'Walk-in'),
        'sold_by_id', t.sold_by_id, 'sold_by', coalesce(nullif(sp.name, ''), sp.email),
        'vendor_name', t.vendor_name, 'purchased_at', t.purchased_at, 'purchased_by_id', t.purchased_by_id,
        'purchased_by', coalesce(nullif(pp.name, ''), pp.email)) order by t.sold_at desc)
      from top t left join profiles sp on sp.id = t.sold_by_id left join profiles pp on pp.id = t.purchased_by_id), '[]'::jsonb),
    'total_sale', (select sale from tot), 'total_cost', (select cost from tot), 'total_profit', (select profit from tot),
    'total_rows', (select n from tot), 'truncated', (select n from tot) > greatest(coalesce(p_limit, 2000), 1)
  ) into res;
  return res;
end $$;
