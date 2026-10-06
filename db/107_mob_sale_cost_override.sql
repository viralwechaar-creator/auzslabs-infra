-- AUZsMob: staff can change the purchase (cost) price of a line while billing, next to the selling price.
-- A line may carry costOverride; if the caller may see purchase rates (owner, manager, or staff when the owner allowed it)
-- it becomes the line's costPrice (so profit uses it) and the catalogue cost is kept as costListed. Everyone else's
-- costOverride is ignored. Only mob_push_sale changes (re-based on db/093, the latest definition).
-- mob_push_sale
create or replace function mob_push_sale(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; item jsonb; i int; bill text;
  unit mob_item_units; item_row mob_items; have numeric;
  subtotal numeric := 0; items_out jsonb := '[]'::jsonb;
  st_on boolean; cust_on boolean; vend_on boolean; unit_cost numeric; part_cost numeric; part_vendor uuid;
  cost_ovr numeric; can_rates boolean;
  total_amt numeric; paid_amt numeric; pay_mode text; cust_id uuid; cust_name text; cust_phone text;
begin
  tid := mob_guard('mob_sell');
  perform mob_require_feature(tid, 'sell', 'Selling is switched off for this shop');
  st_on := mob_feat(tid, 'stock'); cust_on := mob_feat(tid, 'customers'); vend_on := mob_feat(tid, 'vendors');
  can_rates := (me()->>'role') in ('owner', 'manager') or coalesce((select staff_see_purchase_rates from mob_settings where tenant_id = tid), false);
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
    -- the price this piece really cost for THIS sale (the vendor raised it, say); only people who may see purchase rates can set it
    cost_ovr := case when can_rates then nullif(item->>'costOverride', '')::numeric end;
    if cost_ovr < 0 then raise exception 'cost cannot be negative' using errcode = 'MB005'; end if;
    if item ? 'unitId' then
      select * into unit from mob_item_units where id = (item->>'unitId')::uuid and tenant_id = tid;
      if unit.id is null then raise exception 'unit not found' using errcode = 'MB004'; end if;
      if unit.status <> 'in_stock' then raise exception '% is not available for sale (status: %)', coalesce(unit.imei, unit.id::text), unit.status using errcode = 'MB006'; end if;
      update mob_item_units set status = 'sold', updated_at = now() where id = unit.id;
      insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, unit.item_id, unit.id, -1, 'sale', p_id, app_uid());
      items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', coalesce(cost_ovr, unit.cost_price), 'costListed', unit.cost_price));
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
        items_out := items_out || jsonb_build_array(item || jsonb_build_object('costPrice', coalesce(cost_ovr, item_row.cost_price), 'costListed', item_row.cost_price));
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
