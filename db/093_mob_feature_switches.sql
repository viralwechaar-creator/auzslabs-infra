-- =========================================================
-- AUZsMob feature switches: one app, a different shape per shop.
--
-- A client who only wants to track staff work (sell, buy, repairs as plain items) should not see stock counts,
-- customers, vendors, IMEI tracking or repair job cards; a bigger shop wants all of it. Each part is now a
-- switch the OWNER controls in Settings -> Features, stored in mob_settings.features (jsonb) and resolved with
-- defaults by mob_features() so a shop that has never touched it keeps exactly what it has today.
--
--   sell, purchase        on/off   the two core entries
--   repairs               'full' (job cards, the existing screens) | 'simple' (a repair is a service item you sell,
--                         with the part you bought entered on the line) | 'off'
--   stock                 on/off   quantity counts, low-stock, and refusing a sale that exceeds stock.
--                         Off = loose items are sold and bought without any stock movement. (Serial-numbered phones
--                         are separate: see 'serials'.)
--   serials               on/off   IMEI / serial units and buying used phones. Off = phones are ordinary items.
--   customers             on/off   customer name/phone on a sale, credit sales and the customer dues screen.
--                         Off = every sale is paid in full.
--   vendors               on/off   vendor list, a vendor on a purchase, and vendor dues.
--   dayclose              on/off   the owner's day-close lock
--
-- Like db/018 taught, a switch is only real if EVERY layer checks it: the screens hide it, and these functions
-- refuse it server-side (errcode MB010) so calling the API directly cannot bypass it. Switching something off
-- never deletes data; switching it back on brings everything back. The staff ledger counts a repair sold with a
-- part cost as bought-and-sold: the part is recorded as a purchase by the same staffer, so profit is exact.
--
-- Only the owner can change features (mob_save_settings checks the role), and every change is audit-logged.
-- =========================================================

alter table mob_settings add column if not exists features jsonb not null default '{}'::jsonb;

-- 'service' items (a repair, labour): never counted in stock, may carry the cost of a part on the sale line
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'mob_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%phone_new%' loop
    execute format('alter table mob_items drop constraint %I', c.conname);
  end loop;
  alter table mob_items add constraint mob_items_category_check
    check (category in ('phone_new', 'phone_used', 'accessory', 'watch', 'earbuds', 'headphone', 'cable', 'charger', 'service', 'other'));
end $$;

create or replace function mob_feature_defaults() returns jsonb language sql immutable as $$
  select '{"sell":true,"purchase":true,"repairs":"full","stock":true,"serials":true,"customers":true,"vendors":true,"dayclose":true}'::jsonb
$$;

create or replace function mob_features(tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select mob_feature_defaults() || coalesce((select features from mob_settings where tenant_id = tid), '{}'::jsonb)
$$;

create or replace function mob_feat(tid uuid, k text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((mob_features(tid)->>k)::boolean, true)
$$;

create or replace function mob_repairs_mode(tid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(mob_features(tid)->>'repairs', 'full')
$$;

create or replace function mob_require_feature(tid uuid, k text, msg text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not mob_feat(tid, k) then raise exception '%', msg using errcode = 'MB010'; end if;
end $$;

-- the owner's day-close lock only applies while the dayclose feature is on
create or replace function mob_day_locked(tid uuid, at timestamptz) returns boolean language sql stable as $$
  select case when not mob_feat(tid, 'dayclose') then false
              else coalesce((select day_close_date from mob_settings where tenant_id = tid) >= at::date, false) end
$$;

-- mob_context
create or replace function mob_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s mob_settings; lang text; demo boolean; seeded timestamptz; caller_uid text;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is not null then
    select is_demo into demo from tenants where id = tid;
    if demo and coalesce((select features->>'mobile' from tenant_settings where tenant_id = tid), 'false') = 'true' then
      select demo_seeded_at into seeded from mob_settings where tenant_id = tid;
      if (seeded is null or now() - seeded > interval '12 hours') and pg_try_advisory_xact_lock(hashtext('mob_demo_reset')) then
        caller_uid := current_setting('app.uid', true);
        perform mob_demo_seed(tid);
        perform set_config('app.uid', caller_uid, true);
      end if;
    end if;
  end if;

  tid := mob_tenant();
  select * into s from mob_settings where tenant_id = tid;
  if s.tenant_id is null then
    -- first visit: create a default settings row so every later read/write has one to update
    insert into mob_settings (tenant_id) values (tid) on conflict (tenant_id) do nothing returning * into s;
    if s.tenant_id is null then select * into s from mob_settings where tenant_id = tid; end if;
  end if;
  select language into lang from mob_staff_prefs where tenant_id = tid and user_id = app_uid();
  return jsonb_build_object(
    'perms', mob_perms(),
    'can_see_rates', (me()->>'role') in ('owner', 'manager') or coalesce(s.staff_see_purchase_rates, false),
    'settings', jsonb_build_object(
      'shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'logoUrl', s.logo_url,
      'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language,
      'staffSeePurchaseRates', s.staff_see_purchase_rates, 'dayCloseDate', s.day_close_date,
      'features', mob_features(tid)
    ),
    'my_language', coalesce(lang, s.language, 'en'),
    'my_language_set', lang is not null or s.language is not null
  );
end $$;

-- mob_save_settings
create or replace function mob_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fk text; fv jsonb; old_features jsonb;
begin
  tid := mob_guard('mob_manage');
  if p ? 'features' then
    if (me()->>'role') <> 'owner' then raise exception 'Only the owner can change features' using errcode = '42501'; end if;
    if jsonb_typeof(p->'features') <> 'object' then raise exception 'features must be an object' using errcode = 'MB005'; end if;
    for fk, fv in select * from jsonb_each(p->'features') loop
      if fk = 'repairs' then
        if fv #>> '{}' not in ('off', 'simple', 'full') then raise exception 'repairs must be off, simple or full' using errcode = 'MB005'; end if;
      elsif fk in ('sell', 'purchase', 'stock', 'serials', 'customers', 'vendors', 'dayclose') then
        if jsonb_typeof(fv) <> 'boolean' then raise exception '% must be on or off', fk using errcode = 'MB005'; end if;
      else
        raise exception 'unknown feature %', fk using errcode = 'MB005';
      end if;
    end loop;
    old_features := mob_features(tid);
    update mob_settings set features = old_features || (p->'features'), updated_at = now() where tenant_id = tid;
    perform mob_audit_log(tid, 'mob_settings', tid, 'features', old_features, mob_features(tid));
  end if;
  update mob_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address),
    phone = coalesce(p->>'phone', phone), logo_url = coalesce(p->>'logoUrl', logo_url),
    bill_footer = coalesce(p->>'billFooter', bill_footer), bill_prefix = coalesce(p->>'billPrefix', bill_prefix),
    language = coalesce(p->>'language', language),
    staff_see_purchase_rates = coalesce((p->>'staffSeePurchaseRates')::boolean, staff_see_purchase_rates),
    day_close_date = case when p ? 'dayCloseDate' then nullif(p->>'dayCloseDate', '')::date else day_close_date end,
    updated_at = now()
  where tenant_id = tid;
  return mob_context();
end $$;

-- mob_save_vendor
create or replace function mob_save_vendor(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_vendors; newv timestamptz;
begin
  tid := mob_guard('mob_purchase'); -- any staffer entering a purchase can add a new vendor name on the fly
  perform mob_require_feature(tid, 'vendors', 'Vendors are switched off for this shop');
  select * into cur from mob_vendors where id = p_id and tenant_id = tid;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_vendors (id, tenant_id, name, phone, created_by) values (p_id, tid, p->>'name', p->>'phone', app_uid())
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning updated_at into newv;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;

-- mob_save_customer
create or replace function mob_save_customer(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_customers; newv timestamptz;
begin
  tid := mob_guard('mob_sell');
  perform mob_require_feature(tid, 'customers', 'Customers are switched off for this shop');
  select * into cur from mob_customers where id = p_id and tenant_id = tid;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_customers (id, tenant_id, name, phone, created_by) values (p_id, tid, p->>'name', p->>'phone', app_uid())
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning updated_at into newv;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;

-- mob_push_purchase
create or replace function mob_push_purchase(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; item mob_items; unit_id uuid; total numeric; ser_on boolean; st_on boolean; vend_id uuid; is_serial boolean;
begin
  tid := mob_guard('mob_purchase');
  perform mob_require_feature(tid, 'purchase', 'Buying is switched off for this shop');
  ser_on := mob_feat(tid, 'serials'); st_on := mob_feat(tid, 'stock');
  if exists (select 1 from mob_purchases where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  if mob_day_locked(tid, coalesce((p->>'at')::timestamptz, now())) then raise exception 'That day is closed' using errcode = 'MB003'; end if;

  select * into item from mob_items where id = (p->>'itemId')::uuid and tenant_id = tid;
  if item.id is null then raise exception 'item not found' using errcode = 'MB004'; end if;
  total := coalesce((p->>'qty')::numeric, 1) * coalesce((p->>'rate')::numeric, 0);

  if not ser_on and coalesce(p->>'source','') = 'secondhand' then raise exception 'Buying used phones is switched off for this shop' using errcode = 'MB010'; end if;
  is_serial := ser_on and (item.serialized or (p->>'imei') is not null or coalesce(p->>'source','') = 'secondhand');
  if mob_feat(tid, 'vendors') then vend_id := nullif(p->>'vendorId','')::uuid; else vend_id := null; end if;

  if is_serial then
    unit_id := coalesce((p->>'unitId')::uuid, gen_random_uuid());
    insert into mob_item_units (id, tenant_id, item_id, imei, imei2, source, condition, seller_name, seller_phone, id_proof_url, accessories_included, cost_price, selling_price, status, created_by)
      values (unit_id, tid, item.id, nullif(p->>'imei',''), nullif(p->>'imei2',''), coalesce(p->>'source','new'), p->>'condition',
              p->>'sellerName', p->>'sellerPhone', p->>'idProofUrl', p->>'accessoriesIncluded',
              coalesce((p->>'rate')::numeric, 0), nullif(p->>'sellingPrice','')::numeric, 'in_stock', app_uid());
    insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, item.id, unit_id, 1, case when coalesce(p->>'source','new') = 'secondhand' then 'secondhand_intake' else 'purchase' end, p_id, app_uid());
  elsif st_on and item.category <> 'service' then
    insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, item.id, coalesce((p->>'qty')::numeric, 1), 'purchase', p_id, app_uid());
  end if;

  insert into mob_purchases (id, tenant_id, vendor_id, item_id, unit_id, qty, rate, total, photo_url, repair_id, note, staff_id)
    values (p_id, tid, vend_id, item.id, unit_id, coalesce((p->>'qty')::numeric, 1), coalesce((p->>'rate')::numeric, 0), total,
            p->>'photoUrl', nullif(p->>'repairId','')::uuid, p->>'note', app_uid());

  return jsonb_build_object('ok', true, 'id', p_id, 'unitId', unit_id);
end $$;

-- mob_push_sale
create or replace function mob_push_sale(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; item jsonb; i int; bill text;
  unit mob_item_units; item_row mob_items; have numeric;
  subtotal numeric := 0; items_out jsonb := '[]'::jsonb;
  st_on boolean; cust_on boolean; vend_on boolean; unit_cost numeric; part_cost numeric; part_vendor uuid;
  total_amt numeric; paid_amt numeric; pay_mode text; cust_id uuid; cust_name text; cust_phone text;
begin
  tid := mob_guard('mob_sell');
  perform mob_require_feature(tid, 'sell', 'Selling is switched off for this shop');
  st_on := mob_feat(tid, 'stock'); cust_on := mob_feat(tid, 'customers'); vend_on := mob_feat(tid, 'vendors');
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
      if item_row.category = 'service' then
        -- a repair or other service: nothing in stock. If the staffer entered what the part cost, that cost is the line's
        -- cost snapshot AND is recorded as a purchase of their own, so the repair counts as bought-and-sold in the ledger.
        part_cost := nullif(item->>'partCost', '')::numeric;
        unit_cost := coalesce(part_cost, item_row.cost_price);
        if part_cost is not null and part_cost > 0 then
          part_vendor := null;
          if vend_on and nullif(item->>'vendorId', '') is not null then
            select id into part_vendor from mob_vendors where id = (item->>'vendorId')::uuid and tenant_id = tid;
          end if;
          insert into mob_purchases (id, tenant_id, vendor_id, item_id, qty, rate, total, note, staff_id)
            values (md5(p_id::text || ':part:' || i::text)::uuid, tid, part_vendor, item_row.id, 1, part_cost, part_cost,
                    'Part for repair: ' || coalesce(nullif(item->>'partName', ''), item_row.name), app_uid())
            on conflict (id) do nothing;
        end if;
        items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', unit_cost));
      else
        if st_on then
          select coalesce(sum(qty), 0) into have from mob_stock_movements where item_id = item_row.id and tenant_id = tid;
          if have < (item->>'qty')::numeric then raise exception 'not enough stock for %', item_row.name using errcode = 'MB007'; end if;
          insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
            values (gen_random_uuid(), tid, item_row.id, -(item->>'qty')::numeric, 'sale', p_id, app_uid());
        end if;
        items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', item_row.cost_price));
      end if;
    end if;
    subtotal := subtotal + (item->>'price')::numeric * coalesce((item->>'qty')::numeric, 1);
  end loop;

  bill := mob_next_bill_no(tid);

  total_amt := subtotal - coalesce((p->>'discount')::numeric, 0);
  -- customers switched off: no customer on the bill and no credit; every sale is paid in full
  if cust_on then
    cust_id := nullif(p->>'customerId','')::uuid; cust_name := p->>'customerName'; cust_phone := p->>'customerPhone';
    paid_amt := coalesce((p->>'paid')::numeric, total_amt); pay_mode := coalesce(p->>'paymentMode', 'cash');
  else
    cust_id := null; cust_name := null; cust_phone := null;
    paid_amt := total_amt; pay_mode := case when coalesce(p->>'paymentMode', 'cash') = 'credit' then 'cash' else coalesce(p->>'paymentMode', 'cash') end;
  end if;

  insert into mob_sales (id, tenant_id, bill_no, customer_id, customer_name, customer_phone, items, subtotal, discount, total, paid, balance, payment_mode, staff_id)
    values (p_id, tid, bill, cust_id, cust_name, cust_phone, items_out,
            subtotal, coalesce((p->>'discount')::numeric, 0), total_amt, paid_amt, greatest(0, total_amt - paid_amt), pay_mode, app_uid());

  return jsonb_build_object('ok', true, 'id', p_id, 'billNo', bill, 'total', subtotal - coalesce((p->>'discount')::numeric, 0));
end $$;

-- mob_void_sale
create or replace function mob_void_sale(p_sale_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sale mob_sales; item jsonb; i int;
begin
  tid := mob_guard('mob_manage');
  select * into sale from mob_sales where id = p_sale_id and tenant_id = tid for update;
  if sale.id is null then raise exception 'sale not found' using errcode = 'MB004'; end if;
  if sale.voided then raise exception 'already voided' using errcode = 'MB008'; end if;

  for i in 0 .. jsonb_array_length(sale.items) - 1 loop
    item := sale.items->i;
    if item ? 'unitId' then
      update mob_item_units set status = 'in_stock', updated_at = now() where id = (item->>'unitId')::uuid and tenant_id = tid;
      insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, (item->>'itemId')::uuid, (item->>'unitId')::uuid, 1, 'void_sale', p_sale_id, app_uid());
    else
      -- put quantity back only if this sale actually took it out (stock counting may have been off at the time)
      if exists (select 1 from mob_stock_movements where tenant_id = tid and ref_id = p_sale_id and item_id = (item->>'itemId')::uuid and type = 'sale') then
        insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
          values (gen_random_uuid(), tid, (item->>'itemId')::uuid, (item->>'qty')::numeric, 'void_sale', p_sale_id, app_uid());
      end if;
    end if;
  end loop;

  update mob_sales set voided = true, void_reason = p_reason where id = p_sale_id;
  perform mob_audit_log(tid, 'mob_sales', p_sale_id, 'void', to_jsonb(sale), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- mob_create_repair
create or replace function mob_create_repair(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_repair');
  if mob_repairs_mode(tid) <> 'full' then raise exception 'Repair job cards are switched off for this shop' using errcode = 'MB010'; end if;
  if exists (select 1 from mob_repairs where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_repairs (id, tenant_id, customer_name, customer_phone, device_model, imei, problem, advance, estimate, warranty_days, staff_id)
    values (p_id, tid, p->>'customerName', p->>'customerPhone', p->>'deviceModel', p->>'imei', p->>'problem',
            coalesce((p->>'advance')::numeric, 0), nullif(p->>'estimate','')::numeric, coalesce((p->>'warrantyDays')::int, 0), app_uid());
  insert into mob_repair_events (id, tenant_id, repair_id, type, status, staff_id)
    values (gen_random_uuid(), tid, p_id, 'status', 'received', app_uid());
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- mob_push_repair_event
create or replace function mob_push_repair_event(p_id uuid, p_repair_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r mob_repairs; item_row mob_items; have numeric; etype text;
begin
  tid := mob_guard('mob_repair');
  if mob_repairs_mode(tid) <> 'full' then raise exception 'Repair job cards are switched off for this shop' using errcode = 'MB010'; end if;
  if exists (select 1 from mob_repair_events where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into r from mob_repairs where id = p_repair_id and tenant_id = tid;
  if r.id is null then raise exception 'repair job not found' using errcode = 'MB004'; end if;
  if not (r.staff_id = app_uid() or mob_perm('mob_reports')) then raise exception 'not authorized' using errcode = '42501'; end if;

  etype := p->>'type';
  if etype = 'part' then
    select * into item_row from mob_items where id = (p->>'itemId')::uuid and tenant_id = tid for update;
    if item_row.id is null then raise exception 'part not found' using errcode = 'MB004'; end if;
    select coalesce(sum(qty), 0) into have from mob_stock_movements where item_id = item_row.id and tenant_id = tid;
    if have < (p->>'qty')::numeric then raise exception 'not enough stock for %', item_row.name using errcode = 'MB007'; end if;
    insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, item_row.id, -(p->>'qty')::numeric, 'repair_part', p_id, app_uid());
    insert into mob_repair_events (id, tenant_id, repair_id, type, item_id, qty, cost, staff_id)
      values (p_id, tid, p_repair_id, 'part', item_row.id, (p->>'qty')::numeric, coalesce((p->>'cost')::numeric, item_row.cost_price), app_uid());
  elsif etype = 'status' then
    if p->>'status' not in ('received', 'in_repair', 'ready', 'delivered', 'cancelled') then raise exception 'bad status'; end if;
    insert into mob_repair_events (id, tenant_id, repair_id, type, status, staff_id) values (p_id, tid, p_repair_id, 'status', p->>'status', app_uid());
  elsif etype = 'payment' then
    insert into mob_repair_events (id, tenant_id, repair_id, type, amount, method, staff_id) values (p_id, tid, p_repair_id, 'payment', (p->>'amount')::numeric, coalesce(p->>'method','cash'), app_uid());
  elsif etype = 'note' then
    insert into mob_repair_events (id, tenant_id, repair_id, type, note, staff_id) values (p_id, tid, p_repair_id, 'note', p->>'note', app_uid());
  else
    raise exception 'unknown event type' using errcode = 'MB005';
  end if;

  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- mob_push_payment
create or replace function mob_push_payment(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_sell');
  if p->>'kind' = 'customer_due' then perform mob_require_feature(tid, 'customers', 'Customers and dues are switched off for this shop'); end if;
  if p->>'kind' = 'vendor_due' then perform mob_require_feature(tid, 'vendors', 'Vendors are switched off for this shop'); end if;
  if exists (select 1 from mob_payments where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_payments (id, tenant_id, kind, sale_id, vendor_id, amount, method, note, staff_id)
    values (p_id, tid, p->>'kind', nullif(p->>'saleId','')::uuid, nullif(p->>'vendorId','')::uuid, (p->>'amount')::numeric, coalesce(p->>'method','cash'), p->>'note', app_uid());
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- mob_adjust_stock
create or replace function mob_adjust_stock(p_id uuid, p_item_id uuid, p_qty_delta numeric, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_manage');
  perform mob_require_feature(tid, 'stock', 'Stock counting is switched off for this shop');
  if exists (select 1 from mob_stock_movements where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_stock_movements (id, tenant_id, item_id, qty, type, staff_id) values (p_id, tid, p_item_id, p_qty_delta, 'adjustment', app_uid());
  perform mob_audit_log(tid, 'mob_items', p_item_id, 'adjustment', null, jsonb_build_object('delta', p_qty_delta, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- mob_report_ledger
create or replace function mob_report_ledger(p_from date default null, p_to date default null, p_staff_id uuid default null, p_limit int default 2000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz; res jsonb;
begin
  tid := mob_guard('mob_reports');
  from_ts := coalesce(p_from, current_date - 29)::timestamptz;
  to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';

  with lines as (
    select s.id sale_id, s.bill_no, s.created_at sold_at, it, s.customer_name, s.staff_id sold_by_id,
           u.imei, coalesce(pu.created_at, case when it ? 'partCost' then s.created_at end) purchased_at,
           coalesce(pu.staff_id, case when it ? 'partCost' then s.staff_id end) purchased_by_id, coalesce(v.name, v2.name) vendor_name,
           (it ? 'partCost' or it ? 'partName') is_repair, nullif(it->>'partName', '') part_name,
           coalesce((it->>'qty')::numeric, 1) qty, (it->>'price')::numeric price, coalesce((it->>'costPrice')::numeric, 0) cost
    from mob_sales s
    cross join lateral jsonb_array_elements(s.items) it
    left join mob_item_units u on u.id = nullif(it->>'unitId', '')::uuid
    left join mob_purchases pu on pu.unit_id = u.id and pu.tenant_id = tid
    left join mob_vendors v on v.id = pu.vendor_id
    left join mob_vendors v2 on v2.id = nullif(it->>'vendorId', '')::uuid and v2.tenant_id = tid
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
        'vendor_name', t.vendor_name, 'is_repair', t.is_repair, 'part_name', t.part_name, 'purchased_at', t.purchased_at, 'purchased_by_id', t.purchased_by_id,
        'purchased_by', coalesce(nullif(pp.name, ''), pp.email)) order by t.sold_at desc)
      from top t left join profiles sp on sp.id = t.sold_by_id left join profiles pp on pp.id = t.purchased_by_id), '[]'::jsonb),
    'total_sale', (select sale from tot), 'total_cost', (select cost from tot), 'total_profit', (select profit from tot),
    'total_rows', (select n from tot), 'truncated', (select n from tot) > greatest(coalesce(p_limit, 2000), 1)
  ) into res;
  return res;
end $$;

