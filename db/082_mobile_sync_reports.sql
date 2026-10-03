-- =========================================================
-- AUZsMob: the offline sync pull, owner reports, the integrity check, and a demo seed.
-- =========================================================

-- mob_sync_pull: the one call a phone makes to catch up. Owner/manager (or mob_reports) get everything
-- changed since `p_since`; a plain staffer gets only their OWN purchases/sales/repairs/repair
-- events/payments, plus the shared catalog (items/units/vendors/customers) every staffer needs to sell
-- and buy against. This is the real enforcement point for "their phone must not even download other
-- people's records" -- the RLS-equivalent check lives here since these tables have no RLS policies at all
-- (every access is through a function, see 080's header).
create or replace function mob_sync_pull(p_since timestamptz default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sees_all boolean; since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
begin
  tid := mob_guard();
  sees_all := mob_perm('mob_reports');

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_items where tenant_id = tid and updated_at > since) x), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_item_units where tenant_id = tid and updated_at > since) x), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_vendors where tenant_id = tid and updated_at > since) x), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_customers where tenant_id = tid and updated_at > since) x), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_purchases where tenant_id = tid and created_at > since and (sees_all or staff_id = app_uid())) x), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_sales where tenant_id = tid and created_at > since and (sees_all or staff_id = app_uid())) x), '[]'::jsonb),
    'repairs', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_repairs where tenant_id = tid and created_at > since and (sees_all or staff_id = app_uid())) x), '[]'::jsonb),
    'repair_events', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select re.* from mob_repair_events re join mob_repairs r on r.id = re.repair_id
        where re.tenant_id = tid and re.created_at > since and (sees_all or r.staff_id = app_uid())
      ) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_payments where tenant_id = tid and created_at > since and (sees_all or staff_id = app_uid())) x), '[]'::jsonb),
    'stock_movements', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from mob_stock_movements where tenant_id = tid and created_at > since) x), '[]'::jsonb),
    'server_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
  );
end $$;

-- ---------- owner reports ----------
create or replace function mob_report_dashboard(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz;
begin
  tid := mob_guard('mob_reports');
  from_ts := coalesce(p_from, current_date)::timestamptz;
  to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';

  return jsonb_build_object(
    'sales_total', coalesce((select sum(total) from mob_sales where tenant_id = tid and not voided and created_at >= from_ts and created_at < to_ts), 0),
    'sales_count', coalesce((select count(*) from mob_sales where tenant_id = tid and not voided and created_at >= from_ts and created_at < to_ts), 0),
    'profit_total', coalesce((
      select sum((it->>'price')::numeric * (it->>'qty')::numeric - (it->>'costPrice')::numeric * (it->>'qty')::numeric)
      from mob_sales s, jsonb_array_elements(s.items) it
      where s.tenant_id = tid and not s.voided and s.created_at >= from_ts and s.created_at < to_ts
    ), 0),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', staff_id, 'sales', cnt, 'revenue', rev, 'profit', prof) order by rev desc) from (
        select s.staff_id, count(*) cnt, sum(s.total) rev,
          sum((select sum((it->>'price')::numeric * (it->>'qty')::numeric - (it->>'costPrice')::numeric * (it->>'qty')::numeric) from jsonb_array_elements(s.items) it)) prof
        from mob_sales s where s.tenant_id = tid and not s.voided and s.created_at >= from_ts and s.created_at < to_ts
        group by s.staff_id
      ) g
    ), '[]'::jsonb),
    'repairs_pending', coalesce((
      select count(*) from mob_repairs r where r.tenant_id = tid and (
        select re.status from mob_repair_events re where re.repair_id = r.id and re.type = 'status' order by re.created_at desc limit 1
      ) not in ('delivered', 'cancelled')
    ), 0),
    'customer_dues', coalesce((
      select sum(s.balance - coalesce((select sum(amount) from mob_payments mp where mp.tenant_id = tid and mp.kind = 'customer_due' and mp.sale_id = s.id), 0))
      from mob_sales s where s.tenant_id = tid and not s.voided and s.balance > 0
    ), 0),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'qty', q.qty)) from mob_items i
      join lateral (select coalesce(sum(qty), 0) qty from mob_stock_movements m where m.item_id = i.id) q on true
      where i.tenant_id = tid and not i.serialized and i.active and q.qty <= i.low_stock_at
    ), '[]'::jsonb)
  );
end $$;

create or replace function mob_report_activity(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz;
begin
  tid := mob_guard('mob_reports');
  from_ts := coalesce(p_from, current_date - 6)::timestamptz; to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';
  return coalesce((
    select jsonb_agg(x order by at desc) from (
      select 'sale' kind, id, staff_id, total amount, created_at at from mob_sales where tenant_id = tid and created_at >= from_ts and created_at < to_ts and not voided
      union all
      select 'purchase', id, staff_id, total, created_at from mob_purchases where tenant_id = tid and created_at >= from_ts and created_at < to_ts
      union all
      select 'repair', id, staff_id, coalesce(advance, 0), created_at from mob_repairs where tenant_id = tid and created_at >= from_ts and created_at < to_ts
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------- integrity check, shown in Settings (same spirit as pay_integrity_check/acc_integrity_check) ----------
create or replace function mob_integrity_check() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; checks jsonb := '[]'::jsonb; bad_units int; bad_sales int; dup_bills int; neg_stock int;
begin
  tid := mob_guard('mob_reports');

  -- every 'sold' unit has exactly one matching -1 sale movement, and vice versa (no sale without a movement)
  select count(*) into bad_units from mob_item_units u where u.tenant_id = tid and u.status = 'sold'
    and not exists (select 1 from mob_stock_movements m where m.unit_id = u.id and m.type = 'sale');
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Sold units have a matching stock movement', 'ok', bad_units = 0, 'detail', bad_units || ' mismatched'));

  -- every non-voided sale's total = subtotal - discount
  select count(*) into bad_sales from mob_sales where tenant_id = tid and not voided and round(total, 2) <> round(subtotal - discount, 2);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Sale totals match subtotal minus discount', 'ok', bad_sales = 0, 'detail', bad_sales || ' mismatched'));

  -- bill numbers are unique per tenant
  select count(*) into dup_bills from (select bill_no from mob_sales where tenant_id = tid group by bill_no having count(*) > 1) d;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Bill numbers are unique', 'ok', dup_bills = 0, 'detail', dup_bills || ' duplicated'));

  -- no item's computed stock has gone negative
  select count(*) into neg_stock from (select item_id from mob_stock_movements where tenant_id = tid group by item_id having sum(qty) < 0) n;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'No item has negative stock', 'ok', neg_stock = 0, 'detail', neg_stock || ' negative'));

  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where (c->>'ok')::boolean = false), 'checks', checks);
end $$;

-- ---------- export: owner can pull every row at any time, suspended or not (no mob_guard entitlement
-- gate deliberately -- only the owner-role check, so an export still works after the shop is suspended) ----------
create or replace function mob_export_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if (me()->>'role') <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  tid := (me()->>'tenant_id')::uuid;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x)) from mob_items x where x.tenant_id = tid), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(to_jsonb(x)) from mob_item_units x where x.tenant_id = tid), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(x)) from mob_vendors x where x.tenant_id = tid), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(x)) from mob_customers x where x.tenant_id = tid), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(to_jsonb(x)) from mob_purchases x where x.tenant_id = tid), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(x)) from mob_sales x where x.tenant_id = tid), '[]'::jsonb),
    'repairs', coalesce((select jsonb_agg(to_jsonb(x)) from mob_repairs x where x.tenant_id = tid), '[]'::jsonb),
    'repair_events', coalesce((select jsonb_agg(to_jsonb(x)) from mob_repair_events x where x.tenant_id = tid), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from mob_payments x where x.tenant_id = tid), '[]'::jsonb),
    'stock_movements', coalesce((select jsonb_agg(to_jsonb(x)) from mob_stock_movements x where x.tenant_id = tid), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x)) from mob_audit x where x.tenant_id = tid), '[]'::jsonb)
  );
end $$;

-- ---------- demo tenant (same 12h-refresh pattern as demo-salon/demo-accounts/demo-pay) ----------
create or replace function mob_demo_seed(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare owner_id uuid; phone_item uuid := gen_random_uuid(); acc_item uuid := gen_random_uuid(); unit1 uuid := gen_random_uuid();
begin
  select id into owner_id from profiles where tenant_id = tid and role = 'owner' limit 1;
  if owner_id is null then return; end if;
  delete from mob_audit where tenant_id = tid; delete from mob_payments where tenant_id = tid;
  delete from mob_repair_events where tenant_id = tid; delete from mob_repairs where tenant_id = tid;
  delete from mob_sales where tenant_id = tid; delete from mob_purchases where tenant_id = tid;
  delete from mob_stock_movements where tenant_id = tid; delete from mob_item_units where tenant_id = tid; delete from mob_items where tenant_id = tid;
  delete from mob_vendors where tenant_id = tid;

  insert into mob_settings (tenant_id, shop_name, address, phone) values (tid, 'AUZsMob Demo Shop', 'MG Road, Demo City', '9000000000')
    on conflict (tenant_id) do update set shop_name = excluded.shop_name;

  insert into mob_items (id, tenant_id, name, category, serialized, selling_price, cost_price, low_stock_at, created_by) values
    (phone_item, tid, 'Galaxy A14 (Demo)', 'phone_new', true, 14999, 12000, 0, owner_id),
    (acc_item, tid, 'USB-C Cable (Demo)', 'accessory', false, 199, 90, 5, owner_id);
  insert into mob_item_units (id, tenant_id, item_id, imei, source, condition, cost_price, status, created_by) values
    (unit1, tid, phone_item, '100000000000001', 'new', 'new', 12000, 'in_stock', owner_id);
  insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, staff_id) values
    (gen_random_uuid(), tid, phone_item, unit1, 1, 'purchase', owner_id),
    (gen_random_uuid(), tid, acc_item, null, 20, 'purchase', owner_id);
end $$;
