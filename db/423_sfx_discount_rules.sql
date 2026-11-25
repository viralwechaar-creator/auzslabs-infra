-- Storefront round E: richer discounts.
--  * New kinds: free_shipping, buy_x_get_y (cheapest get-units are free or part-priced).
--  * Rules: start date, specific products, one use per customer, first order only, automatic (no code needed).
--  * The checkout function is untouched. It still claims the code and records a simple discount; a trigger on the new order then
--    recalculates the real amount from the order lines, so the saved order is always exact.
alter table sfx_discounts drop constraint if exists sfx_discounts_kind_check;
alter table sfx_discounts add constraint sfx_discounts_kind_check check (kind in ('percent', 'flat', 'free_shipping', 'buy_x_get_y'));
alter table sfx_discounts drop constraint if exists sfx_discounts_value_check;
alter table sfx_discounts add constraint sfx_discounts_value_check check (value >= 0);
alter table sfx_discounts add column if not exists starts_at timestamptz;
alter table sfx_discounts add column if not exists product_ids uuid[];
alter table sfx_discounts add column if not exists per_customer_limit int check (per_customer_limit is null or per_customer_limit > 0);
alter table sfx_discounts add column if not exists first_order_only boolean not null default false;
alter table sfx_discounts add column if not exists automatic boolean not null default false;
alter table sfx_discounts add column if not exists buy_qty int check (buy_qty is null or buy_qty > 0);
alter table sfx_discounts add column if not exists get_qty int check (get_qty is null or get_qty > 0);
alter table sfx_discounts add column if not exists get_percent numeric(5,2) not null default 100 check (get_percent > 0 and get_percent <= 100);

create or replace function sfx_discount_json(d sfx_discounts) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', d.id, 'code', d.code, 'kind', d.kind, 'value', d.value, 'minOrder', d.min_order,
    'expiresAt', d.expires_at, 'usageLimit', d.usage_limit, 'usedCount', d.used_count, 'status', d.status, 'createdAt', d.created_at,
    'startsAt', d.starts_at, 'productIds', coalesce(to_jsonb(d.product_ids), '[]'::jsonb), 'perCustomerLimit', d.per_customer_limit,
    'firstOrderOnly', d.first_order_only, 'automatic', d.automatic, 'buyQty', d.buy_qty, 'getQty', d.get_qty, 'getPercent', d.get_percent)
$$;

-- What a discount takes off these lines. lines: [{productId, price, qty}]. Never more than the eligible amount.
create function sfx_discount_eval(d sfx_discounts, lines jsonb, p_subtotal numeric) returns numeric language plpgsql immutable as $$
declare elig numeric := 0; units numeric[] := '{}'; l jsonb; i int; n int; free_n int; off_ numeric := 0; grp int;
begin
  if d.kind = 'free_shipping' then return 0; end if;
  for l in select * from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) loop
    if d.product_ids is null or coalesce(array_length(d.product_ids, 1), 0) = 0 or (l->>'productId')::uuid = any(d.product_ids) then
      elig := elig + (l->>'price')::numeric * (l->>'qty')::int;
      if d.kind = 'buy_x_get_y' then for i in 1..(l->>'qty')::int loop units := units || (l->>'price')::numeric; end loop; end if;
    end if;
  end loop;
  if d.kind = 'percent' then return least(elig, round(elig * d.value / 100, 2)); end if;
  if d.kind = 'flat' then return least(elig, d.value); end if;
  if d.kind = 'buy_x_get_y' then
    grp := coalesce(d.buy_qty, 1) + coalesce(d.get_qty, 1); n := coalesce(array_length(units, 1), 0);
    free_n := (n / grp) * coalesce(d.get_qty, 1);
    if free_n <= 0 then return 0; end if;
    select coalesce(sum(u), 0) into off_ from (select u from unnest(units) u order by u asc limit free_n) x;
    return least(elig, round(off_ * d.get_percent / 100, 2));
  end if;
  return 0;
end $$;

-- Whole-order amount used by older code paths (kept for compatibility): free shipping and gift rules need lines, so they give 0 here.
create or replace function sfx_discount_amount(d sfx_discounts, p_subtotal numeric) returns numeric language sql immutable as $$
  select case when d.kind in ('free_shipping', 'buy_x_get_y') then 0 else least(p_subtotal, round(case when d.kind = 'percent' then p_subtotal * d.value / 100 else d.value end, 2)) end
$$;

create or replace function sfx_discount_check(p_tenant uuid, p_code text, p_subtotal numeric) returns sfx_discounts language plpgsql stable as $$
declare d sfx_discounts; code_u text := upper(trim(coalesce(p_code, '')));
begin
  if code_u = '' then raise exception 'Enter a discount code' using errcode = 'SF002'; end if;
  select * into d from sfx_discounts where tenant_id = p_tenant and upper(code) = code_u and not automatic;
  if not found or d.status <> 'active' then raise exception 'Invalid discount code' using errcode = 'SF002'; end if;
  if d.starts_at is not null and d.starts_at > now() then raise exception 'This discount code is not active yet' using errcode = 'SF002'; end if;
  if d.expires_at is not null and d.expires_at < now() then raise exception 'This discount code has expired' using errcode = 'SF002'; end if;
  if d.usage_limit is not null and d.used_count >= d.usage_limit then raise exception 'This discount code has reached its usage limit' using errcode = 'SF002'; end if;
  if d.min_order is not null and p_subtotal < d.min_order then raise exception 'This code needs a minimum order of Rs %', d.min_order using errcode = 'SF002'; end if;
  return d;
end $$;

-- Rules that need the customer: one use per customer, first order only.
create function sfx_discount_customer_ok(d sfx_discounts, p_tenant uuid, p_phone text) returns text language plpgsql stable security definer set search_path = public as $$
declare used int;
begin
  if d.per_customer_limit is not null then
    select count(*) into used from sfx_orders where tenant_id = p_tenant and discount_code = d.code and status <> 'cancelled' and customer->>'phone' = p_phone;
    if used >= d.per_customer_limit then return 'You have already used this code'; end if;
  end if;
  if d.first_order_only and exists (select 1 from sfx_orders where tenant_id = p_tenant and status <> 'cancelled' and customer->>'phone' = p_phone) then
    return 'This code is for first orders only';
  end if;
  return null;
end $$;

-- Recalculate the discount on the new order from its own lines. Also applies an automatic discount when no code was used.
create or replace function sfx_orders_discount_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare d sfx_discounts; amt numeric; msg text; lines_ jsonb := new.lines; best sfx_discounts; best_amt numeric := 0; r sfx_discounts;
begin
  if new.discount_code is null then
    for r in select * from sfx_discounts where tenant_id = new.tenant_id and automatic and status = 'active'
        and (starts_at is null or starts_at <= now()) and (expires_at is null or expires_at > now()) and (usage_limit is null or used_count < usage_limit)
        and (min_order is null or new.subtotal >= min_order) loop
      if sfx_discount_customer_ok(r, new.tenant_id, new.customer->>'phone') is not null then continue; end if;
      amt := sfx_discount_eval(r, lines_, new.subtotal);
      if r.kind = 'free_shipping' then amt := 0.01; end if;   -- ranks below any real money discount
      if amt > best_amt then best := r; best_amt := amt; end if;
    end loop;
    if best.id is not null then
      update sfx_discounts set used_count = used_count + 1 where id = best.id and (usage_limit is null or used_count < usage_limit);
      new.discount_code := best.code;
      if best.kind <> 'free_shipping' then
        amt := sfx_discount_eval(best, lines_, new.subtotal);
        new.discount_amount := amt; new.total := new.total - amt;
      end if;
    end if;
    return new;
  end if;
  select * into d from sfx_discounts where tenant_id = new.tenant_id and upper(code) = upper(new.discount_code);
  if not found then return new; end if;
  msg := sfx_discount_customer_ok(d, new.tenant_id, new.customer->>'phone');
  if msg is not null then raise exception '%', msg using errcode = 'SF002'; end if;
  if d.kind in ('percent', 'flat') and (d.product_ids is null or coalesce(array_length(d.product_ids, 1), 0) = 0) then return new; end if;
  amt := sfx_discount_eval(d, lines_, new.subtotal);
  if d.kind <> 'free_shipping' and amt = 0 and d.product_ids is not null and coalesce(array_length(d.product_ids, 1), 0) > 0 then
    raise exception 'This code does not apply to the items in your bag' using errcode = 'SF002';
  end if;
  new.total := new.total + new.discount_amount - amt; new.discount_amount := amt;
  return new;
end $$;
drop trigger if exists sfx_orders_disc_rules on sfx_orders;
create trigger sfx_orders_disc_rules before insert on sfx_orders for each row execute function sfx_orders_discount_rules();

-- After the shipping fee was added: a free-shipping discount takes it off again.
create function sfx_orders_free_shipping() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.discount_code is not null and new.shipping > 0 and exists (select 1 from sfx_discounts d where d.tenant_id = new.tenant_id and upper(d.code) = upper(new.discount_code) and d.kind = 'free_shipping') then
    new.total := new.total - new.shipping; new.shipping := 0;
  end if;
  return new;
end $$;
drop trigger if exists sfx_orders_shipping_free on sfx_orders;
create trigger sfx_orders_shipping_free before insert on sfx_orders for each row execute function sfx_orders_free_shipping();

-- Public check: also validates customer rules when a phone is sent, and works out the exact amount from the bag.
create or replace function public_sfx_coupon_check(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); d sfx_discounts; sub numeric := greatest(0, coalesce((p->>'subtotal')::numeric, 0)); lines_ jsonb := '[]'::jsonb; l jsonb; amt numeric; msg text; ph text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
begin
  if tid is null then return jsonb_build_object('ok', false, 'msg', 'This store is not available.'); end if;
  if jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      lines_ := lines_ || coalesce((select jsonb_build_array(jsonb_build_object('productId', v.product_id, 'price', v.price, 'qty', greatest(1, least(20, coalesce((l->>'qty')::int, 1)))))
        from sfx_variants v where v.id = (l->>'variantId')::uuid and v.tenant_id = tid), '[]'::jsonb);
    end loop;
    sub := coalesce((select sum((x->>'price')::numeric * (x->>'qty')::int) from jsonb_array_elements(lines_) x), sub);
  end if;
  begin
    d := sfx_discount_check(tid, p->>'code', sub);
    if ph <> '' then msg := sfx_discount_customer_ok(d, tid, ph); if msg is not null then return jsonb_build_object('ok', false, 'msg', msg); end if; end if;
  exception when others then return jsonb_build_object('ok', false, 'msg', sqlerrm);
  end;
  amt := case when jsonb_array_length(lines_) > 0 then sfx_discount_eval(d, lines_, sub) else sfx_discount_amount(d, sub) end;
  return jsonb_build_object('ok', true, 'code', d.code, 'discount', amt, 'freeShipping', d.kind = 'free_shipping');
end $$;

-- Save with the new options.
create or replace function sfx_discount_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); auto_ boolean := coalesce((p->>'automatic')::boolean, false);
  code_ text := upper(trim(coalesce(p->>'code', ''))); kind_ text := coalesce(p->>'kind', 'percent');
  value_ numeric := coalesce(nullif(p->>'value', '')::numeric, 0); minorder_ numeric := nullif(p->>'minOrder', '')::numeric;
  starts_ timestamptz := nullif(p->>'startsAt', '')::timestamptz; expires_ timestamptz := nullif(p->>'expiresAt', '')::timestamptz;
  limit_ int := nullif(p->>'usageLimit', '')::int; pcl_ int := nullif(p->>'perCustomerLimit', '')::int; first_ boolean := coalesce((p->>'firstOrderOnly')::boolean, false);
  buy_ int := nullif(p->>'buyQty', '')::int; get_ int := nullif(p->>'getQty', '')::int; gp_ numeric := coalesce(nullif(p->>'getPercent', '')::numeric, 100);
  pids uuid[]; row_ sfx_discounts;
begin
  if code_ !~ '^[A-Z0-9_ -]{2,30}$' or (not auto_ and code_ ~ ' ') then raise exception 'Enter a code of 2-30 letters, numbers, - or _' using errcode = 'SF002'; end if;
  if kind_ not in ('percent', 'flat', 'free_shipping', 'buy_x_get_y') then raise exception 'Choose the kind of discount' using errcode = 'SF002'; end if;
  if kind_ in ('percent', 'flat') and value_ <= 0 then raise exception 'Enter a discount value greater than 0' using errcode = 'SF002'; end if;
  if kind_ = 'percent' and value_ > 100 then raise exception 'A percentage discount cannot exceed 100' using errcode = 'SF002'; end if;
  if kind_ = 'buy_x_get_y' and (buy_ is null or get_ is null) then raise exception 'Say how many to buy and how many they get' using errcode = 'SF002'; end if;
  if gp_ <= 0 or gp_ > 100 then raise exception 'The gift discount must be between 1 and 100 percent' using errcode = 'SF002'; end if;
  if minorder_ is not null and minorder_ < 0 then raise exception 'Minimum order value cannot be negative' using errcode = 'SF002'; end if;
  if limit_ is not null and limit_ <= 0 then raise exception 'Usage limit must be at least 1' using errcode = 'SF002'; end if;
  if starts_ is not null and expires_ is not null and expires_ <= starts_ then raise exception 'The end date must be after the start date' using errcode = 'SF002'; end if;
  if jsonb_typeof(p->'productIds') = 'array' and jsonb_array_length(p->'productIds') > 0 then
    select array_agg(x::uuid) into pids from jsonb_array_elements_text(p->'productIds') x;
    if (select count(*) from sfx_products where tenant_id = tid and id = any(pids)) <> array_length(pids, 1) then raise exception 'One of the chosen products was not found' using errcode = 'SF002'; end if;
  end if;
  begin
    if p_id is not null then
      update sfx_discounts set code = code_, kind = kind_, value = value_, min_order = minorder_, expires_at = expires_, usage_limit = limit_, starts_at = starts_, product_ids = pids,
        per_customer_limit = pcl_, first_order_only = first_, automatic = auto_, buy_qty = buy_, get_qty = get_, get_percent = gp_, updated_at = now()
        where id = p_id and tenant_id = tid returning * into row_;
      if not found then raise exception 'Discount not found' using errcode = 'SF003'; end if;
    else
      insert into sfx_discounts (tenant_id, code, kind, value, min_order, expires_at, usage_limit, starts_at, product_ids, per_customer_limit, first_order_only, automatic, buy_qty, get_qty, get_percent)
        values (tid, code_, kind_, value_, minorder_, expires_, limit_, starts_, pids, pcl_, first_, auto_, buy_, get_, gp_) returning * into row_;
    end if;
  exception when unique_violation then raise exception 'A discount with this code already exists' using errcode = 'SF002';
  end;
  return sfx_discount_json(row_);
end $$;
grant execute on function sfx_discount_save(uuid, jsonb), public_sfx_coupon_check(text, jsonb), sfx_discount_eval(sfx_discounts, jsonb, numeric) to app;

-- The checkout reply reports what the saved order really charges (the discount may have been recalculated by the trigger).
alter function public_sfx_place_order(text, jsonb) rename to public_sfx_place_order_pre423;
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public_sfx_place_order_pre423(p_slug, p); o sfx_orders;
begin
  select * into o from sfx_orders where token = r->>'token';
  if found then r := r || jsonb_build_object('total', o.total, 'discount', o.discount_amount, 'shipping', o.shipping); end if;
  return r;
end $$;
grant execute on function public_sfx_place_order(text, jsonb) to app;

-- Where the order came from (source, medium, campaign, landing page). Stored exactly as sent, trimmed; never used for pricing.
alter table sfx_orders add column if not exists attribution jsonb;
alter function public_sfx_place_order(text, jsonb) rename to public_sfx_place_order_pre423b;
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public_sfx_place_order_pre423b(p_slug, p); a jsonb := p->'attribution'; k text; clean jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(a) = 'object' then
    for k in select unnest(array['source', 'medium', 'campaign', 'landing', 'referrer']) loop
      if nullif(trim(a->>k), '') is not null then clean := clean || jsonb_build_object(k, left(trim(a->>k), 200)); end if;
    end loop;
    if clean <> '{}'::jsonb then update sfx_orders set attribution = clean where token = r->>'token'; end if;
  end if;
  return r;
end $$;
grant execute on function public_sfx_place_order(text, jsonb) to app;
alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre423;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre423(o, detail) || jsonb_build_object('attribution', o.attribution)
$$;

-- Rollback (attribution): drop function sfx_order_json(sfx_orders,boolean) and rename sfx_order_json_pre423 back; drop function public_sfx_place_order(text,jsonb) and rename public_sfx_place_order_pre423b back; drop column sfx_orders.attribution.
-- Rollback (place order): drop function public_sfx_place_order(text, jsonb); alter function public_sfx_place_order_pre423(text, jsonb) rename to public_sfx_place_order;
-- Rollback: drop triggers sfx_orders_disc_rules and sfx_orders_shipping_free and their functions; drop functions sfx_discount_eval and sfx_discount_customer_ok;
-- restore sfx_discount_save, sfx_discount_check, sfx_discount_amount, sfx_discount_json and public_sfx_coupon_check from db/377; drop the added sfx_discounts columns; restore the old kind and value checks.
