-- =========================================================
-- AUZsMob engine: permissions, settings, master data, the push/pull sync functions, reports, integrity
-- check. See 080_mobile_schema.sql's header for the architecture this follows.
-- =========================================================

-- ---------- permissions (same shape as pay_perm/pay_tenant/pay_guard, gsm_perm before it) ----------
create or replace function mob_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'mobile', 'false') <> 'true' or coalesce(e->>'mobile', 'true') = 'false' then
    raise exception 'AUZsMob is not enabled for this business' using errcode = 'MB001';
  end if;
  return tid;
end $$;

-- Keys: mob_view, mob_sell, mob_purchase, mob_repair, mob_reports (see every staffer's data, not just your
-- own), mob_manage (catalog/vendors/settings/void/adjust). Custom role (profiles.role_id -> roles.permissions)
-- honoured exactly, same as every other module; missing key = no access.
create or replace function mob_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid;
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid and tenant_id = tid;
    return coalesce((perms->>k)::boolean, false);
  end if;
  if r = 'manager' then return k in ('mob_view', 'mob_sell', 'mob_purchase', 'mob_repair', 'mob_reports', 'mob_manage'); end if;
  return k in ('mob_view', 'mob_sell', 'mob_purchase', 'mob_repair');
end $$;

create or replace function mob_guard(k text default 'mob_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_tenant();
  if k is not null and not mob_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create or replace function mob_perms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, mob_perm(k)) from unnest(array['mob_view','mob_sell','mob_purchase','mob_repair','mob_reports','mob_manage']) k
$$;

-- is a given entry date locked by the owner's day-close? used by push functions to refuse a backdated
-- write into a closed day (the spec's "optional owner day close lock")
create or replace function mob_day_locked(tid uuid, at timestamptz) returns boolean language sql stable as $$
  select coalesce((select day_close_date from mob_settings where tenant_id = tid) >= at::date, false)
$$;

-- ---------- bootstrap ----------
-- not STABLE: this does a conditional INSERT (default settings row, first visit), and Postgres refuses a
-- data-modifying statement inside a function marked stable/immutable
create or replace function mob_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s mob_settings; lang text;
begin
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
      'staffSeePurchaseRates', s.staff_see_purchase_rates, 'dayCloseDate', s.day_close_date
    ),
    'my_language', coalesce(lang, s.language, 'en')
  );
end $$;

create or replace function mob_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_manage');
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

create or replace function mob_save_my_language(p_lang text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard();
  if p_lang not in ('en', 'hi') then raise exception 'unsupported language'; end if;
  insert into mob_staff_prefs (tenant_id, user_id, language) values (tid, app_uid(), p_lang)
    on conflict (tenant_id, user_id) do update set language = p_lang;
end $$;

-- ---------- master data: item / vendor / customer / unit (optimistic concurrency, same contract as push_record) ----------
create or replace function mob_save_item(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_items; newv timestamptz;
begin
  tid := mob_guard('mob_manage');
  select * into cur from mob_items where id = p_id and tenant_id = tid;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_items (id, tenant_id, name, category, serialized, selling_price, cost_price, low_stock_at, active, created_by)
    values (p_id, tid, p->>'name', coalesce(p->>'category', 'other'), coalesce((p->>'serialized')::boolean, false),
            coalesce((p->>'sellingPrice')::numeric, 0), coalesce((p->>'costPrice')::numeric, 0),
            coalesce((p->>'lowStockAt')::numeric, 0), coalesce((p->>'active')::boolean, true), app_uid())
  on conflict (id) do update set
    name = excluded.name, category = excluded.category, serialized = excluded.serialized,
    selling_price = excluded.selling_price, cost_price = excluded.cost_price, low_stock_at = excluded.low_stock_at,
    active = excluded.active, updated_at = now()
  returning updated_at into newv;
  if cur.id is not null then
    perform mob_audit_log(tid, 'mob_items', p_id, 'edit', to_jsonb(cur), p);
  end if;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;

create or replace function mob_audit_log(tid uuid, entity text, entity_id uuid, action text, before_data jsonb, after_data jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into mob_audit (tenant_id, entity, entity_id, action, before_data, after_data, staff_id)
    values (tid, entity, entity_id, action, before_data, after_data, app_uid());
end $$;

create or replace function mob_save_vendor(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_vendors; newv timestamptz;
begin
  tid := mob_guard('mob_purchase'); -- any staffer entering a purchase can add a new vendor name on the fly
  select * into cur from mob_vendors where id = p_id and tenant_id = tid;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_vendors (id, tenant_id, name, phone, created_by) values (p_id, tid, p->>'name', p->>'phone', app_uid())
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning updated_at into newv;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;

create or replace function mob_save_customer(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_customers; newv timestamptz;
begin
  tid := mob_guard('mob_sell');
  select * into cur from mob_customers where id = p_id and tenant_id = tid;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_customers (id, tenant_id, name, phone, created_by) values (p_id, tid, p->>'name', p->>'phone', app_uid())
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning updated_at into newv;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;

-- manual unit correction (condition/price/note, or un-selling back to in_stock/returned) -- never used to
-- MAKE a sale ('sold' only ever comes from mob_push_sale, which is the only place stock moves atomically)
create or replace function mob_save_unit(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_item_units; newv timestamptz; new_status text;
begin
  tid := mob_guard('mob_manage');
  select * into cur from mob_item_units where id = p_id and tenant_id = tid;
  if cur.id is null then raise exception 'unit not found'; end if;
  if p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  new_status := coalesce(p->>'status', cur.status);
  if cur.status = 'sold' and new_status <> 'sold' then raise exception 'void the sale to return this unit to stock, not a direct edit' using errcode = 'MB002'; end if;
  if new_status = 'sold' then raise exception 'a unit can only be marked sold by recording a sale' using errcode = 'MB002'; end if;
  update mob_item_units set condition = coalesce(p->>'condition', condition), selling_price = case when p ? 'sellingPrice' then nullif(p->>'sellingPrice','')::numeric else selling_price end,
    status = new_status, updated_at = now()
  where id = p_id returning updated_at into newv;
  perform mob_audit_log(tid, 'mob_item_units', p_id, 'edit', to_jsonb(cur), p);
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv);
end $$;

-- ---------- entries: idempotent inserts (client-generated id, on conflict do nothing = already synced) ----------

-- mob_push_purchase: records a purchase and, when it's a serialized item (or an explicit imei/secondhand
-- intake is given), creates the mob_item_units row in the same transaction -- a purchase can never exist
-- without the stock it was supposed to create, or vice versa.
create or replace function mob_push_purchase(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; item mob_items; unit_id uuid; total numeric;
begin
  tid := mob_guard('mob_purchase');
  if exists (select 1 from mob_purchases where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  if mob_day_locked(tid, coalesce((p->>'at')::timestamptz, now())) then raise exception 'That day is closed' using errcode = 'MB003'; end if;

  select * into item from mob_items where id = (p->>'itemId')::uuid and tenant_id = tid;
  if item.id is null then raise exception 'item not found' using errcode = 'MB004'; end if;
  total := coalesce((p->>'qty')::numeric, 1) * coalesce((p->>'rate')::numeric, 0);

  if item.serialized or (p->>'imei') is not null or coalesce(p->>'source','') = 'secondhand' then
    unit_id := coalesce((p->>'unitId')::uuid, gen_random_uuid());
    insert into mob_item_units (id, tenant_id, item_id, imei, imei2, source, condition, seller_name, seller_phone, id_proof_url, accessories_included, cost_price, selling_price, status, created_by)
      values (unit_id, tid, item.id, nullif(p->>'imei',''), nullif(p->>'imei2',''), coalesce(p->>'source','new'), p->>'condition',
              p->>'sellerName', p->>'sellerPhone', p->>'idProofUrl', p->>'accessoriesIncluded',
              coalesce((p->>'rate')::numeric, 0), nullif(p->>'sellingPrice','')::numeric, 'in_stock', app_uid());
    insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, item.id, unit_id, 1, case when coalesce(p->>'source','new') = 'secondhand' then 'secondhand_intake' else 'purchase' end, p_id, app_uid());
  else
    insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, item.id, coalesce((p->>'qty')::numeric, 1), 'purchase', p_id, app_uid());
  end if;

  insert into mob_purchases (id, tenant_id, vendor_id, item_id, unit_id, qty, rate, total, photo_url, repair_id, note, staff_id)
    values (p_id, tid, nullif(p->>'vendorId','')::uuid, item.id, unit_id, coalesce((p->>'qty')::numeric, 1), coalesce((p->>'rate')::numeric, 0), total,
            p->>'photoUrl', nullif(p->>'repairId','')::uuid, p->>'note', app_uid());

  return jsonb_build_object('ok', true, 'id', p_id, 'unitId', unit_id);
end $$;

-- mob_push_sale: the one way a sale is ever created. Locks every unit/item row involved so two tills can
-- never both sell the same phone -- the second one gets a clean "already sold" error.
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

  for i in 0 .. jsonb_array_length(p->'items') - 1 loop
    item := p->'items'->i;
    if item ? 'unitId' then
      select * into unit from mob_item_units where id = (item->>'unitId')::uuid and tenant_id = tid for update;
      if unit.id is null then raise exception 'unit not found' using errcode = 'MB004'; end if;
      if unit.status <> 'in_stock' then raise exception '% is not available for sale (status: %)', coalesce(unit.imei, unit.id::text), unit.status using errcode = 'MB006'; end if;
      update mob_item_units set status = 'sold', updated_at = now() where id = unit.id;
      insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, unit.item_id, unit.id, -1, 'sale', p_id, app_uid());
      items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', unit.cost_price));
    else
      select * into item_row from mob_items where id = (item->>'itemId')::uuid and tenant_id = tid for update;
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

create or replace function mob_next_bill_no(tid uuid) returns text language plpgsql security definer set search_path = public as $$
declare n bigint; pfx text;
begin
  select bill_prefix into pfx from mob_settings where tenant_id = tid;
  insert into invoice_counters (tenant_id, seq) values (tid, 1)
    on conflict (tenant_id) do update set seq = invoice_counters.seq + 1
    returning seq into n;
  return coalesce(pfx, 'BILL') || '-' || lpad(n::text, 6, '0');
end $$;

-- mob_void_sale: owner/manager only, restores stock, never deletes the row
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
      insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, (item->>'itemId')::uuid, (item->>'qty')::numeric, 'void_sale', p_sale_id, app_uid());
    end if;
  end loop;

  update mob_sales set voided = true, void_reason = p_reason where id = p_sale_id;
  perform mob_audit_log(tid, 'mob_sales', p_sale_id, 'void', to_jsonb(sale), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- repairs ----------
create or replace function mob_create_repair(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_repair');
  if exists (select 1 from mob_repairs where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_repairs (id, tenant_id, customer_name, customer_phone, device_model, imei, problem, advance, estimate, warranty_days, staff_id)
    values (p_id, tid, p->>'customerName', p->>'customerPhone', p->>'deviceModel', p->>'imei', p->>'problem',
            coalesce((p->>'advance')::numeric, 0), nullif(p->>'estimate','')::numeric, coalesce((p->>'warrantyDays')::int, 0), app_uid());
  insert into mob_repair_events (id, tenant_id, repair_id, type, status, staff_id)
    values (gen_random_uuid(), tid, p_id, 'status', 'received', app_uid());
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- mob_push_repair_event: one job's status moves, a part gets consumed, a payment comes in, or a note is
-- added -- each is its own append-only event. Only the staffer who opened the job, or owner/manager/anyone
-- with mob_reports, may add to it (same isolation spirit as reads).
create or replace function mob_push_repair_event(p_id uuid, p_repair_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r mob_repairs; item_row mob_items; have numeric; etype text;
begin
  tid := mob_guard('mob_repair');
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

-- ---------- dues settlement ----------
create or replace function mob_push_payment(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_sell');
  if exists (select 1 from mob_payments where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_payments (id, tenant_id, kind, sale_id, vendor_id, amount, method, note, staff_id)
    values (p_id, tid, p->>'kind', nullif(p->>'saleId','')::uuid, nullif(p->>'vendorId','')::uuid, (p->>'amount')::numeric, coalesce(p->>'method','cash'), p->>'note', app_uid());
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------- owner stock correction ----------
create or replace function mob_adjust_stock(p_id uuid, p_item_id uuid, p_qty_delta numeric, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_manage');
  if exists (select 1 from mob_stock_movements where id = p_id) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into mob_stock_movements (id, tenant_id, item_id, qty, type, staff_id) values (p_id, tid, p_item_id, p_qty_delta, 'adjustment', app_uid());
  perform mob_audit_log(tid, 'mob_items', p_item_id, 'adjustment', null, jsonb_build_object('delta', p_qty_delta, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- staff directory (profiles' own RLS is owner-only; this re-opens it to manager/mob_reports, same lesson as gsm_staff_names) ----------
create or replace function mob_staff_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := mob_guard('mob_reports');
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.name, ''), p.email), 'role', p.role)) from profiles p where p.tenant_id = tid), '[]'::jsonb);
end $$;
