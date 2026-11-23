-- =========================================================
-- AUZslab storefront platform (phase 3, commerce essentials): a first real slice of the owner hub pages that
-- db/372 (phase 1) deliberately left as honest "Coming soon" panels. This migration lands Customers and
-- Discounts only -- see the PR body for exactly what else (Segments/Companies, Growth, Inventory/Transfers/
-- Categories, Drafts/Returns/Shipping/Abandoned checkouts) is still "Coming soon" and not attempted here.
--
-- Same discipline as db/372: own dedicated tables (sfx_*), RLS on with zero policies, every read/write goes
-- through a SECURITY DEFINER function starting with sfx_guard(perm), every function registered in
-- server/src/data/rpc-registry.js, grants given explicitly here (999_app_grants.sql regrants on every boot,
-- but this project's convention is to also grant in the migration that creates the table).
--
-- Numbering note: at the time this was written, the only other sfx_/storefront migrations visible from this
-- worktree were db/372 (this branch's own base) and db/375 (feature/storefront-theme-marketplace, fetched for
-- comparison -- feature/storefront-onboarding-reconciled does not exist as a pushed branch yet). 376 is the
-- next free number across those. All of these phase-3 branches will likely need renumbering once they
-- converge on main; that's expected and is not this migration's problem to solve.
-- =========================================================

-- ---------- Customers: a manual record (name/phone/email/notes) PLUS whatever sfx_customer_list derives
-- live from sfx_orders by phone number -- the same "derived from orders, no separate entry workflow forced
-- on the owner" convention AUZsStyle's own party/customer views already use. A manual row is optional and
-- only needed for a customer who has not ordered yet, or to attach notes. ----------
create table sfx_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sfx_customers_tenant on sfx_customers (tenant_id);
create unique index idx_sfx_customers_phone on sfx_customers (tenant_id, phone) where phone is not null and phone <> '';
alter table sfx_customers enable row level security;

-- ---------- Discounts: real, stored, checkout-affecting discount codes. Percent or flat amount off, with an
-- optional minimum order value, expiry, and usage limit. used_count is only ever incremented atomically by
-- sfx_discount_claim() at the moment a real order is placed (never by the owner-facing save/list RPCs), so
-- it is always an honest count of orders that actually used the code. ----------
create table sfx_discounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  kind text not null check (kind in ('percent', 'flat')),
  value numeric(12,2) not null check (value > 0),
  min_order numeric(12,2) check (min_order is null or min_order >= 0),
  expires_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  used_count int not null default 0 check (used_count >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_sfx_discounts_code on sfx_discounts (tenant_id, upper(code));
alter table sfx_discounts enable row level security;

-- An order's total after any discount. subtotal/total already existed (db/372); these two columns record
-- which code (if any) was used and exactly how much it took off, so an order's own record always shows it.
alter table sfx_orders add column discount_code text;
alter table sfx_orders add column discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0);

grant select, insert, update, delete on sfx_customers, sfx_discounts to app;

-- ---------- owner/staff: customers ----------
create function sfx_customer_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((
    with order_agg as (
      select o.customer->>'phone' as phone, (array_agg(o.customer->>'name' order by o.created_at desc))[1] as name,
        (array_agg(o.customer->>'email' order by o.created_at desc))[1] as email,
        count(*) as order_count, coalesce(sum(o.total) filter (where o.payment_status = 'paid'), 0) as lifetime_spend,
        max(o.created_at) as last_order_at
      from sfx_orders o where o.tenant_id = tid and coalesce(o.customer->>'phone', '') <> ''
      group by o.customer->>'phone'
    ), merged as (
      select c.id, c.name, c.phone, c.email, c.notes, true as manual,
        coalesce(a.order_count, 0) as order_count, coalesce(a.lifetime_spend, 0) as lifetime_spend, a.last_order_at
      from sfx_customers c left join order_agg a on a.phone = c.phone
      where c.tenant_id = tid
      union all
      select null::uuid, a.name, a.phone, a.email, null, false,
        a.order_count, a.lifetime_spend, a.last_order_at
      from order_agg a
      where not exists (select 1 from sfx_customers c where c.tenant_id = tid and c.phone = a.phone)
    )
    select jsonb_agg(jsonb_build_object('id', coalesce(id::text, 'order:' || phone), 'manual', manual,
      'name', coalesce(name, 'Unnamed customer'), 'phone', phone, 'email', email, 'notes', notes,
      'orderCount', order_count, 'lifetimeSpend', lifetime_spend, 'lastOrderAt', last_order_at)
      order by last_order_at desc nulls last, lower(coalesce(name, '')))
    from merged
  ), '[]'::jsonb);
end $$;

create function sfx_customer_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); name_ text := trim(coalesce(p->>'name', '')); phone_ text := trim(coalesce(p->>'phone', ''));
  email_ text := trim(coalesce(p->>'email', '')); row_ sfx_customers;
begin
  if name_ = '' then raise exception 'Enter a customer name' using errcode = 'SF002'; end if;
  begin
    if p_id is not null then
      update sfx_customers set name = name_, phone = nullif(phone_, ''), email = nullif(email_, ''), notes = left(coalesce(p->>'notes', ''), 2000), updated_at = now()
        where id = p_id and tenant_id = tid returning * into row_;
      if not found then raise exception 'Customer not found' using errcode = 'SF003'; end if;
    else
      insert into sfx_customers (tenant_id, name, phone, email, notes) values (tid, name_, nullif(phone_, ''), nullif(email_, ''), left(coalesce(p->>'notes', ''), 2000))
        returning * into row_;
    end if;
  exception when unique_violation then raise exception 'A customer with this phone number already exists' using errcode = 'SF002';
  end;
  return jsonb_build_object('id', row_.id, 'manual', true, 'name', row_.name, 'phone', row_.phone, 'email', row_.email, 'notes', row_.notes, 'orderCount', 0, 'lifetimeSpend', 0, 'lastOrderAt', null);
end $$;

create function sfx_customer_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  delete from sfx_customers where id = p_id and tenant_id = tid;
end $$;

-- ---------- owner/staff: discounts ----------
create function sfx_discount_json(d sfx_discounts) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', d.id, 'code', d.code, 'kind', d.kind, 'value', d.value, 'minOrder', d.min_order,
    'expiresAt', d.expires_at, 'usageLimit', d.usage_limit, 'usedCount', d.used_count, 'status', d.status, 'createdAt', d.created_at)
$$;

create function sfx_discount_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(sfx_discount_json(d) order by d.created_at desc) from sfx_discounts d where d.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_discount_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); code_ text := upper(trim(coalesce(p->>'code', ''))); kind_ text := coalesce(p->>'kind', 'percent');
  value_ numeric := nullif(p->>'value', '')::numeric; minorder_ numeric := nullif(p->>'minOrder', '')::numeric;
  expires_ timestamptz := nullif(p->>'expiresAt', '')::timestamptz; limit_ int := nullif(p->>'usageLimit', '')::int; row_ sfx_discounts;
begin
  if code_ !~ '^[A-Z0-9_-]{2,30}$' then raise exception 'Enter a code of 2-30 letters, numbers, - or _' using errcode = 'SF002'; end if;
  if kind_ not in ('percent', 'flat') then raise exception 'Choose percentage or flat amount off' using errcode = 'SF002'; end if;
  if value_ is null or value_ <= 0 then raise exception 'Enter a discount value greater than 0' using errcode = 'SF002'; end if;
  if kind_ = 'percent' and value_ > 100 then raise exception 'A percentage discount cannot exceed 100' using errcode = 'SF002'; end if;
  if minorder_ is not null and minorder_ < 0 then raise exception 'Minimum order value cannot be negative' using errcode = 'SF002'; end if;
  if limit_ is not null and limit_ <= 0 then raise exception 'Usage limit must be at least 1' using errcode = 'SF002'; end if;
  begin
    if p_id is not null then
      update sfx_discounts set code = code_, kind = kind_, value = value_, min_order = minorder_, expires_at = expires_, usage_limit = limit_, updated_at = now()
        where id = p_id and tenant_id = tid returning * into row_;
      if not found then raise exception 'Discount not found' using errcode = 'SF003'; end if;
    else
      insert into sfx_discounts (tenant_id, code, kind, value, min_order, expires_at, usage_limit)
        values (tid, code_, kind_, value_, minorder_, expires_, limit_) returning * into row_;
    end if;
  exception when unique_violation then raise exception 'A discount with this code already exists' using errcode = 'SF002';
  end;
  return sfx_discount_json(row_);
end $$;

create function sfx_discount_set_status(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_discounts;
begin
  if p_status not in ('active', 'archived') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  update sfx_discounts set status = p_status, updated_at = now() where id = p_id and tenant_id = tid returning * into row_;
  if not found then raise exception 'Discount not found' using errcode = 'SF003'; end if;
  return sfx_discount_json(row_);
end $$;

-- ---------- public storefront checkout: real discount math, exact to the paisa ----------
-- Read-only validate-and-preview (used by public_sfx_coupon_check): never increments used_count.
create function sfx_discount_check(p_tenant uuid, p_code text, p_subtotal numeric) returns sfx_discounts language plpgsql stable as $$
declare d sfx_discounts; code_u text := upper(trim(coalesce(p_code, '')));
begin
  if code_u = '' then raise exception 'Enter a discount code' using errcode = 'SF002'; end if;
  select * into d from sfx_discounts where tenant_id = p_tenant and upper(code) = code_u;
  if not found or d.status <> 'active' then raise exception 'Invalid discount code' using errcode = 'SF002'; end if;
  if d.expires_at is not null and d.expires_at < now() then raise exception 'This discount code has expired' using errcode = 'SF002'; end if;
  if d.usage_limit is not null and d.used_count >= d.usage_limit then raise exception 'This discount code has reached its usage limit' using errcode = 'SF002'; end if;
  if d.min_order is not null and p_subtotal < d.min_order then raise exception 'This code needs a minimum order of Rs %', d.min_order using errcode = 'SF002'; end if;
  return d;
end $$;

-- Round to the paisa, never more than the subtotal itself.
create function sfx_discount_amount(d sfx_discounts, p_subtotal numeric) returns numeric language sql immutable as $$
  select least(p_subtotal, round(case when d.kind = 'percent' then p_subtotal * d.value / 100 else d.value end, 2))
$$;

-- Re-validates everything sfx_discount_check does, then atomically claims one use: the UPDATE's own WHERE
-- clause re-checks status/usage_limit at commit time, so two concurrent checkouts racing the last remaining
-- use cannot both succeed (the loser's UPDATE matches no row and this raises, same as an already-exhausted
-- code). Only ever called from inside public_sfx_place_order's own transaction.
create function sfx_discount_claim(p_tenant uuid, p_code text, p_subtotal numeric) returns sfx_discounts language plpgsql as $$
declare d sfx_discounts;
begin
  d := sfx_discount_check(p_tenant, p_code, p_subtotal);
  update sfx_discounts set used_count = used_count + 1, updated_at = now()
    where id = d.id and status = 'active' and (usage_limit is null or used_count < usage_limit)
    returning * into d;
  if not found then raise exception 'This discount code has reached its usage limit' using errcode = 'SF002'; end if;
  return d;
end $$;

create or replace function public_sfx_coupon_check(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); d sfx_discounts; sub numeric := greatest(0, coalesce((p->>'subtotal')::numeric, 0));
begin
  if tid is null then return jsonb_build_object('ok', false, 'msg', 'This store is not available.'); end if;
  begin
    d := sfx_discount_check(tid, p->>'code', sub);
  exception when others then return jsonb_build_object('ok', false, 'msg', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'code', d.code, 'discount', sfx_discount_amount(d, sub));
end $$;

-- Carries over the full body of db/372's public_sfx_place_order and adds: claim+apply a discount code
-- (p->>'coupon') before the order is inserted, recording discount_code/discount_amount on the order and
-- reducing total by exactly that amount. Everything else (stock checks/decrement, rate limiting, order
-- numbering) is unchanged from db/372.
create or replace function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); st sfx_stores; l jsonb; q int; lines jsonb := '[]'::jsonb; sub numeric := 0;
  pay text; num text; tok text; oid uuid; cust jsonb; ph text; recent int;
  vid uuid; vproduct uuid; vlabel text; vprice numeric; vstock int; vname text; vimage text;
  coupon_in text := trim(coalesce(p->>'coupon', '')); discount_row sfx_discounts; discount_amt numeric := 0; order_total numeric;
begin
  if tid is null then raise exception 'This store is not available' using errcode = 'SF001'; end if;
  select * into st from sfx_stores where tenant_id = tid;
  if coalesce(st.published, false) is not true then raise exception 'This store is closed right now' using errcode = 'SF001'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Your bag is empty' using errcode = 'SF002'; end if;
  if jsonb_array_length(p->'lines') > 40 then raise exception 'Too many items in one order' using errcode = 'SF002'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please enter your name' using errcode = 'SF002'; end if;
  ph := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
  if length(ph) < 8 or length(ph) > 16 then raise exception 'Please enter a valid phone number' using errcode = 'SF002'; end if;
  if length(trim(coalesce(p->>'address', ''))) < 4 or length(trim(coalesce(p->>'city', ''))) < 2 or length(trim(coalesce(p->>'pin', ''))) < 4 then
    raise exception 'Please fill your full delivery address, city and PIN code' using errcode = 'SF002'; end if;
  pay := case when p->>'payment' = 'online' and exists(select 1 from sfx_store_secrets where tenant_id = tid) then 'online' else 'cod' end;
  for l in select * from jsonb_array_elements(p->'lines') loop
    select v.id, v.product_id, v.label, v.price, v.stock, pr.name, pr.images->>0 into vid, vproduct, vlabel, vprice, vstock, vname, vimage
      from sfx_variants v join sfx_products pr on pr.id = v.product_id
      where v.id = (l->>'variantId')::uuid and v.tenant_id = tid and pr.status = 'active';
    if not found then raise exception 'One of the items in your bag is no longer available' using errcode = 'SF002'; end if;
    q := greatest(1, least(20, coalesce((l->>'qty')::int, 1)));
    if q > vstock then raise exception '% has only % left', vname, vstock using errcode = 'SF002'; end if;
    lines := lines || jsonb_build_array(jsonb_build_object('productId', vproduct, 'variantId', vid, 'name', vname, 'label', vlabel, 'price', vprice, 'qty', q, 'image', vimage));
    sub := sub + vprice * q;
    update sfx_variants set stock = stock - q where id = vid;
  end loop;
  if coupon_in <> '' then
    discount_row := sfx_discount_claim(tid, coupon_in, sub);
    discount_amt := sfx_discount_amount(discount_row, sub);
  end if;
  order_total := sub - discount_amt;
  select count(*) into recent from sfx_orders where tenant_id = tid and customer->>'phone' = ph and created_at > now() - interval '10 minutes';
  if recent >= 5 then raise exception 'Too many orders just now. Please wait a few minutes and try again.' using errcode = 'SF002'; end if;
  select 'SF' || to_char(now(), 'YYMMDD') || '-' || lpad((coalesce(max(substring(number from '\d+$')::int), 0) + 1)::text, 4, '0') into num
    from sfx_orders where tenant_id = tid and number like 'SF' || to_char(now(), 'YYMMDD') || '-%';
  tok := encode(gen_random_bytes(16), 'hex');
  cust := jsonb_build_object('name', trim(p->>'name'), 'email', nullif(p->>'email', ''), 'phone', ph, 'address', p->>'address', 'address2', p->>'address2',
    'city', p->>'city', 'state', p->>'state', 'pin', p->>'pin', 'country', coalesce(p->>'country', 'India'));
  insert into sfx_orders (tenant_id, number, token, payment_method, customer, lines, subtotal, shipping, total, discount_code, discount_amount, note, timeline)
    values (tid, num, tok, pay, cust, lines, sub, 0, order_total, case when discount_row.id is not null then discount_row.code else null end, discount_amt,
      nullif(p->>'note', ''), jsonb_build_array(jsonb_build_object('label', 'Order placed', 'at', now())))
    returning id into oid;
  begin
    insert into notifications (tenant_id, type, title, body) values (tid, 'sfx_order', 'New order ' || num, trim(p->>'name') || ' placed an order for ' || order_total::text || '.');
  exception when others then null; end;
  return jsonb_build_object('token', tok, 'number', num, 'total', order_total, 'subtotal', sub, 'discount', discount_amt, 'payment', pay);
end $$;

-- Carry discount fields through to both the owner-facing and the customer-facing order view.
create or replace function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'customerName', o.customer->>'name', 'total', o.total, 'createdAt', o.created_at) ||
    case when detail then jsonb_build_object('customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping,
      'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
      'note', o.note, 'tracking', o.tracking, 'timeline', o.timeline, 'token', o.token) else '{}'::jsonb end
$$;

create or replace function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then return null; end if;
  return jsonb_build_object('number', o.number, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
    'lines', o.lines, 'note', o.note, 'tracking', o.tracking, 'createdAt', o.created_at);
end $$;

-- Rollback: drop public_sfx_place_order's discount lines are reverted by re-creating db/372's own copy of
-- it, then drop function sfx_discount_claim/sfx_discount_check/sfx_discount_amount/sfx_discount_set_status/
-- sfx_discount_save/sfx_discount_list/sfx_discount_json/sfx_customer_delete/sfx_customer_save/
-- sfx_customer_list, drop table sfx_discounts, sfx_customers, and alter table sfx_orders drop column
-- discount_code, discount_amount.
