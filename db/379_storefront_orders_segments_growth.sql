-- =========================================================
-- Storefront phase 3, part 3: Shipping rates, Draft orders, Returns, Abandoned checkouts, Segments, Companies, Growth.
-- Same discipline as db/372/377/378: sfx_* tables, RLS on with no policies, access only through sfx_guard()
-- SECURITY DEFINER functions, registered in rpc-registry.js.
-- =========================================================

-- ---------- Checkout settings: shipping fee + free-over threshold, abandoned-cart capture ----------
create function sfx_checkout_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config into c from sfx_stores where tenant_id = tid;
  return jsonb_build_object('shipping', coalesce(c->'shipping', '{}'::jsonb), 'abandonCapture', coalesce((c->>'abandonCapture')::boolean, false));
end $$;

create function sfx_checkout_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; fee_ numeric; free_ numeric;
begin
  fee_ := coalesce(nullif(p->'shipping'->>'fee', '')::numeric, 0); free_ := coalesce(nullif(p->'shipping'->>'freeOver', '')::numeric, 0);
  if fee_ < 0 or fee_ > 100000 then raise exception 'Enter a shipping fee between 0 and 100000' using errcode = 'SF002'; end if;
  if free_ < 0 then raise exception 'Free-shipping amount cannot be negative' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object(
    'shipping', jsonb_build_object('fee', fee_, 'freeOver', free_, 'note', left(coalesce(p->'shipping'->>'note', ''), 300)),
    'abandonCapture', coalesce((p->>'abandonCapture')::boolean, false));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return sfx_checkout_settings_get();
end $$;

-- Shipping is applied to every new order by trigger, from the store's own settings: fee unless (subtotal - discount) reaches
-- the free-over amount. The checkout's total is therefore always what the order row says.
create function sfx_orders_apply_shipping() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; fee_ numeric; free_ numeric;
begin
  if new.shipping is distinct from 0 then return new; end if;
  select config->'shipping' into c from sfx_stores where tenant_id = new.tenant_id;
  fee_ := coalesce(nullif(c->>'fee', '')::numeric, 0); free_ := coalesce(nullif(c->>'freeOver', '')::numeric, 0);
  if fee_ > 0 and not (free_ > 0 and (new.subtotal - coalesce(new.discount_amount, 0)) >= free_) then
    new.shipping := fee_; new.total := new.total + fee_;
  end if;
  return new;
end $$;
create trigger sfx_orders_shipping before insert on sfx_orders for each row execute function sfx_orders_apply_shipping();

-- the public checkout returns the corrected total, and marks a matching abandoned cart recovered
alter function public_sfx_place_order(text, jsonb) rename to public_sfx_place_order_core;
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; o sfx_orders;
begin
  r := public_sfx_place_order_core(p_slug, p);
  select * into o from sfx_orders where token = r->>'token';
  if found then
    update sfx_abandoned set recovered = true where tenant_id = o.tenant_id and phone = o.customer->>'phone' and not recovered;
    r := r || jsonb_build_object('shipping', o.shipping, 'total', o.total);
  end if;
  return r;
end $$;

alter function public_sfx_store(text) rename to public_sfx_store_core;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; tid uuid := sfx_public_tenant(p_slug); c jsonb;
begin
  r := public_sfx_store_core(p_slug);
  if r is null or tid is null or r->'config' is null then return r; end if;
  select config into c from sfx_stores where tenant_id = tid;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('shipping', coalesce(c->'shipping', '{}'::jsonb), 'abandonWa', coalesce((c->>'abandonCapture')::boolean, false)));
end $$;

-- ---------- Abandoned checkouts ----------
create table sfx_abandoned (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  phone text not null, name text, lines jsonb not null default '[]'::jsonb, total numeric(12,2) not null default 0,
  recovered boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
alter table sfx_abandoned enable row level security;

create function public_sfx_cart_save(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); ph text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'); l jsonb; ln jsonb := '[]'::jsonb; t numeric := 0; q int; pr numeric; nm text; lbl text; c jsonb; n int;
begin
  if tid is null then return jsonb_build_object('ok', false); end if;
  select config into c from sfx_stores where tenant_id = tid;
  if not coalesce((c->>'abandonCapture')::boolean, false) then return jsonb_build_object('ok', false); end if;   -- off unless the owner opted in
  if length(ph) < 8 or length(ph) > 16 or jsonb_typeof(p->'lines') <> 'array' then return jsonb_build_object('ok', false); end if;
  select count(*) into n from sfx_abandoned where tenant_id = tid and updated_at > now() - interval '1 hour';
  if n > 300 then return jsonb_build_object('ok', false); end if;
  for l in select * from jsonb_array_elements(p->'lines') limit 30 loop
    select v.price, pr.name, v.label into pr, nm, lbl from sfx_variants v join sfx_products pr on pr.id = v.product_id where v.id = (l->>'variantId')::uuid and v.tenant_id = tid;
    if found then q := greatest(1, least(20, coalesce((l->>'qty')::int, 1))); ln := ln || jsonb_build_array(jsonb_build_object('name', nm, 'label', lbl, 'price', pr, 'qty', q)); t := t + pr * q; end if;
  end loop;
  if jsonb_array_length(ln) = 0 then return jsonb_build_object('ok', false); end if;
  insert into sfx_abandoned (tenant_id, phone, name, lines, total) values (tid, ph, left(coalesce(p->>'name', ''), 120), ln, t)
    on conflict (tenant_id, phone) do update set name = excluded.name, lines = excluded.lines, total = excluded.total, recovered = false, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create function sfx_abandoned_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'phone', a.phone, 'name', a.name, 'lines', a.lines, 'total', a.total, 'recovered', a.recovered, 'updatedAt', a.updated_at) order by a.updated_at desc)
    from sfx_abandoned a where a.tenant_id = tid and (a.recovered or a.updated_at < now() - interval '30 minutes')), '[]'::jsonb);
end $$;
create function sfx_abandoned_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_abandoned where id = p_id and tenant_id = tid; end $$;

-- ---------- Draft orders ----------
create table sfx_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer jsonb not null default '{}'::jsonb, lines jsonb not null default '[]'::jsonb, note text,
  status text not null default 'open' check (status in ('open', 'converted')), order_id uuid references sfx_orders(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table sfx_drafts enable row level security;

create function sfx_draft_json(d sfx_drafts) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', d.id, 'customer', d.customer, 'note', d.note, 'status', d.status, 'orderId', d.order_id, 'createdAt', d.created_at,
    'lines', d.lines, 'total', coalesce((select sum((l->>'price')::numeric * (l->>'qty')::int) from jsonb_array_elements(d.lines) l), 0))
$$;

create function sfx_draft_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(sfx_draft_json(d) order by d.created_at desc) from sfx_drafts d where d.tenant_id = tid), '[]'::jsonb); end $$;

-- lines come in as [{variantId, qty}]; prices are always read from the variant, never trusted from the caller
create function sfx_draft_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); l jsonb; ln jsonb := '[]'::jsonb; q int; v record; row_ sfx_drafts; cust jsonb;
begin
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Add at least one product' using errcode = 'SF002'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Enter the customer name' using errcode = 'SF002'; end if;
  for l in select * from jsonb_array_elements(p->'lines') loop
    select v2.id, v2.product_id, v2.label, v2.price, pr.name into v from sfx_variants v2 join sfx_products pr on pr.id = v2.product_id where v2.id = (l->>'variantId')::uuid and v2.tenant_id = tid;
    if not found then raise exception 'A product in this draft no longer exists' using errcode = 'SF002'; end if;
    q := greatest(1, least(999, coalesce((l->>'qty')::int, 1)));
    ln := ln || jsonb_build_array(jsonb_build_object('productId', v.product_id, 'variantId', v.id, 'name', v.name, 'label', v.label, 'price', v.price, 'qty', q));
  end loop;
  cust := jsonb_build_object('name', trim(p->>'name'), 'phone', regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 'email', nullif(p->>'email', ''),
    'address', coalesce(p->>'address', ''), 'city', coalesce(p->>'city', ''), 'pin', coalesce(p->>'pin', ''), 'state', coalesce(p->>'state', ''), 'country', 'India');
  if p_id is null then
    insert into sfx_drafts (tenant_id, customer, lines, note) values (tid, cust, ln, left(coalesce(p->>'note', ''), 1000)) returning * into row_;
  else
    update sfx_drafts set customer = cust, lines = ln, note = left(coalesce(p->>'note', ''), 1000), updated_at = now() where id = p_id and tenant_id = tid and status = 'open' returning * into row_;
    if not found then raise exception 'Draft not found or already converted' using errcode = 'SF003'; end if;
  end if;
  return sfx_draft_json(row_);
end $$;

create function sfx_draft_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_drafts where id = p_id and tenant_id = tid and status = 'open'; end $$;

-- Turns a draft into a real order: checks and takes stock, numbers it, records it. Payment is "cod" (owner collects it).
create function sfx_draft_convert(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_drafts; l jsonb; sub numeric := 0; num text; tok text; oid uuid; stock_ int; nm text; q int;
begin
  select * into d from sfx_drafts where id = p_id and tenant_id = tid and status = 'open' for update;
  if not found then raise exception 'Draft not found or already converted' using errcode = 'SF003'; end if;
  for l in select * from jsonb_array_elements(d.lines) loop
    q := (l->>'qty')::int;
    select v.stock, pr.name into stock_, nm from sfx_variants v join sfx_products pr on pr.id = v.product_id where v.id = (l->>'variantId')::uuid and v.tenant_id = tid for update;
    if not found then raise exception 'A product in this draft no longer exists' using errcode = 'SF002'; end if;
    if q > stock_ then raise exception '% has only % left', nm, stock_ using errcode = 'SF002'; end if;
    update sfx_variants set stock = stock - q, updated_at = now() where id = (l->>'variantId')::uuid;
    insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, -q, 'adjust', 'Draft order converted');
    sub := sub + (l->>'price')::numeric * q;
  end loop;
  select 'SF' || to_char(now(), 'YYMMDD') || '-' || lpad((coalesce(max(substring(number from '\d+$')::int), 0) + 1)::text, 4, '0') into num
    from sfx_orders where tenant_id = tid and number like 'SF' || to_char(now(), 'YYMMDD') || '-%';
  tok := encode(gen_random_bytes(16), 'hex');
  insert into sfx_orders (tenant_id, number, token, payment_method, customer, lines, subtotal, shipping, total, note, timeline)
    values (tid, num, tok, 'cod', d.customer, d.lines, sub, 0, sub, nullif(d.note, ''), jsonb_build_array(jsonb_build_object('label', 'Created from a draft order', 'at', now())))
    returning id into oid;
  update sfx_drafts set status = 'converted', order_id = oid, updated_at = now() where id = p_id;
  return jsonb_build_object('orderId', oid, 'number', num);
end $$;

-- ---------- Returns ----------
create table sfx_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null references sfx_orders(id) on delete cascade,
  lines jsonb not null,                      -- [{variantId, name, label, qty, price}]
  reason text, status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received', 'refunded')),
  refund_amount numeric(12,2), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index idx_sfx_returns on sfx_returns (tenant_id, status);
alter table sfx_returns enable row level security;

create function sfx_return_json(r sfx_returns) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', r.id, 'orderId', r.order_id, 'orderNumber', (select number from sfx_orders where id = r.order_id), 'lines', r.lines, 'reason', r.reason,
    'status', r.status, 'refundAmount', r.refund_amount, 'createdAt', r.created_at,
    'value', coalesce((select sum((l->>'price')::numeric * (l->>'qty')::int) from jsonb_array_elements(r.lines) l), 0))
$$;

create function sfx_return_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin return coalesce((select jsonb_agg(sfx_return_json(r) order by r.created_at desc) from sfx_returns r where r.tenant_id = tid), '[]'::jsonb); end $$;

-- p_lines: [{variantId, qty}]; quantities can never exceed what the order contained minus what other (non-rejected) returns already cover
create function sfx_return_create(p_order uuid, p_lines jsonb, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; l jsonb; ol jsonb; ln jsonb := '[]'::jsonb; q int; ordered int; already int; row_ sfx_returns;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status in ('cancelled', 'new') then raise exception 'Only an order that has been confirmed or fulfilled can have a return' using errcode = 'SF002'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose at least one item to return' using errcode = 'SF002'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := coalesce((l->>'qty')::int, 0);
    if q <= 0 then continue; end if;
    select x into ol from jsonb_array_elements(o.lines) x where x->>'variantId' = l->>'variantId' limit 1;
    if ol is null then raise exception 'That item is not part of this order' using errcode = 'SF002'; end if;
    ordered := (ol->>'qty')::int;
    select coalesce(sum((x->>'qty')::int), 0) into already from sfx_returns r, jsonb_array_elements(r.lines) x where r.order_id = o.id and r.status <> 'rejected' and x->>'variantId' = l->>'variantId';
    if q + already > ordered then raise exception 'You can return at most % of "%" (% ordered, % already in returns)', ordered - already, ol->>'name', ordered, already using errcode = 'SF002'; end if;
    ln := ln || jsonb_build_array(jsonb_build_object('variantId', l->>'variantId', 'name', ol->>'name', 'label', ol->>'label', 'qty', q, 'price', (ol->>'price')::numeric));
  end loop;
  if jsonb_array_length(ln) = 0 then raise exception 'Choose at least one item to return' using errcode = 'SF002'; end if;
  insert into sfx_returns (tenant_id, order_id, lines, reason) values (tid, o.id, ln, left(coalesce(p_reason, ''), 500)) returning * into row_;
  return sfx_return_json(row_);
end $$;

-- requested -> approved | rejected -> received (units go back on the shelf) -> refunded. One way only.
create function sfx_return_set(p_id uuid, p_status text, p_amount numeric default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_returns; l jsonb; value_ numeric; allowed text[];
begin
  select * into r from sfx_returns where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'Return not found' using errcode = 'SF003'; end if;
  allowed := case r.status when 'requested' then array['approved', 'rejected'] when 'approved' then array['received'] when 'received' then array['refunded'] else array[]::text[] end;
  if not (p_status = any(allowed)) then raise exception 'A % return cannot move to "%"', r.status, p_status using errcode = 'SF002'; end if;
  if p_status = 'received' then
    for l in select * from jsonb_array_elements(r.lines) loop
      update sfx_variants set stock = stock + (l->>'qty')::int, updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = tid;
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, (l->>'qty')::int, 'restock', 'Return received');
    end loop;
  end if;
  if p_status = 'refunded' then
    value_ := (select coalesce(sum((x->>'price')::numeric * (x->>'qty')::int), 0) from jsonb_array_elements(r.lines) x);
    if p_amount is null or p_amount < 0 or p_amount > value_ then raise exception 'Refund must be between 0 and %', value_ using errcode = 'SF002'; end if;
    update sfx_returns set refund_amount = round(p_amount, 2) where id = p_id;
  end if;
  update sfx_returns set status = p_status, updated_at = now() where id = p_id returning * into r;
  return sfx_return_json(r);
end $$;

-- ---------- Companies (business customers) ----------
create table sfx_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, gstin text, contact text, notes text,
  created_at timestamptz not null default now()
);
create unique index idx_sfx_companies_name on sfx_companies (tenant_id, lower(name));
alter table sfx_companies enable row level security;
alter table sfx_customers add column if not exists company_id uuid references sfx_companies(id) on delete set null;

create function sfx_company_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'gstin', c.gstin, 'contact', c.contact, 'notes', c.notes,
    'customers', (select count(*) from sfx_customers x where x.company_id = c.id)) order by lower(c.name)) from sfx_companies c where c.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_company_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n text := trim(coalesce(p->>'name', '')); g text := upper(trim(coalesce(p->>'gstin', ''))); row_ sfx_companies;
begin
  if n = '' then raise exception 'Enter the company name' using errcode = 'SF002'; end if;
  if g <> '' and g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'That GST number does not look right' using errcode = 'SF002'; end if;
  begin
    if p_id is null then insert into sfx_companies (tenant_id, name, gstin, contact, notes) values (tid, left(n, 160), nullif(g, ''), left(coalesce(p->>'contact', ''), 160), left(coalesce(p->>'notes', ''), 1000)) returning * into row_;
    else update sfx_companies set name = left(n, 160), gstin = nullif(g, ''), contact = left(coalesce(p->>'contact', ''), 160), notes = left(coalesce(p->>'notes', ''), 1000) where id = p_id and tenant_id = tid returning * into row_;
      if not found then raise exception 'Company not found' using errcode = 'SF003'; end if;
    end if;
  exception when unique_violation then raise exception 'A company with this name already exists' using errcode = 'SF002';
  end;
  return jsonb_build_object('id', row_.id, 'name', row_.name, 'gstin', row_.gstin, 'contact', row_.contact, 'notes', row_.notes, 'customers', 0);
end $$;

create function sfx_company_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_companies where id = p_id and tenant_id = tid; end $$;

create function sfx_customer_set_company(p_customer uuid, p_company uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  if p_company is not null and not exists (select 1 from sfx_companies where id = p_company and tenant_id = tid) then raise exception 'Company not found' using errcode = 'SF003'; end if;
  update sfx_customers set company_id = p_company, updated_at = now() where id = p_customer and tenant_id = tid;
  if not found then raise exception 'Customer not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Segments: saved rules over customers derived from orders ----------
create table sfx_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, rule jsonb not null default '{}'::jsonb,   -- minOrders, minSpend, inactiveDays (all optional)
  created_at timestamptz not null default now()
);
alter table sfx_segments enable row level security;

create function sfx_customer_agg(p_tenant uuid) returns table(phone text, name text, email text, orders bigint, spend numeric, last_order_at timestamptz) language sql stable set search_path = public as $$
  select o.customer->>'phone', (array_agg(o.customer->>'name' order by o.created_at desc))[1], (array_agg(o.customer->>'email' order by o.created_at desc))[1],
    count(*), coalesce(sum(o.total) filter (where o.payment_status = 'paid'), 0), max(o.created_at)
  from sfx_orders o where o.tenant_id = p_tenant and coalesce(o.customer->>'phone', '') <> '' and o.status <> 'cancelled' group by o.customer->>'phone'
$$;

create function sfx_segment_members(p_tenant uuid, p_rule jsonb) returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('phone', a.phone, 'name', a.name, 'email', a.email, 'orders', a.orders, 'spend', a.spend, 'lastOrderAt', a.last_order_at) order by a.spend desc), '[]'::jsonb)
  from sfx_customer_agg(p_tenant) a
  where a.orders >= coalesce(nullif(p_rule->>'minOrders', '')::int, 0) and a.spend >= coalesce(nullif(p_rule->>'minSpend', '')::numeric, 0)
    and (nullif(p_rule->>'inactiveDays', '') is null or a.last_order_at < now() - make_interval(days => (p_rule->>'inactiveDays')::int))
$$;

create function sfx_segment_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'rule', s.rule, 'count', jsonb_array_length(sfx_segment_members(tid, s.rule))) order by s.created_at) from sfx_segments s where s.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_segment_members_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); s sfx_segments;
begin
  select * into s from sfx_segments where id = p_id and tenant_id = tid;
  if not found then raise exception 'Segment not found' using errcode = 'SF003'; end if;
  return sfx_segment_members(tid, s.rule);
end $$;

create function sfx_segment_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n text := trim(coalesce(p->>'name', '')); rule_ jsonb := '{}'::jsonb; row_ sfx_segments;
begin
  if n = '' then raise exception 'Enter a segment name' using errcode = 'SF002'; end if;
  if nullif(p->>'minOrders', '') is not null then if (p->>'minOrders')::int < 0 then raise exception 'Minimum orders cannot be negative' using errcode = 'SF002'; end if; rule_ := rule_ || jsonb_build_object('minOrders', (p->>'minOrders')::int); end if;
  if nullif(p->>'minSpend', '') is not null then if (p->>'minSpend')::numeric < 0 then raise exception 'Minimum spend cannot be negative' using errcode = 'SF002'; end if; rule_ := rule_ || jsonb_build_object('minSpend', (p->>'minSpend')::numeric); end if;
  if nullif(p->>'inactiveDays', '') is not null then if (p->>'inactiveDays')::int < 1 then raise exception 'Inactive days must be at least 1' using errcode = 'SF002'; end if; rule_ := rule_ || jsonb_build_object('inactiveDays', (p->>'inactiveDays')::int); end if;
  if rule_ = '{}'::jsonb then raise exception 'Set at least one rule (orders, spend or days inactive)' using errcode = 'SF002'; end if;
  if p_id is null then insert into sfx_segments (tenant_id, name, rule) values (tid, left(n, 80), rule_) returning * into row_;
  else update sfx_segments set name = left(n, 80), rule = rule_ where id = p_id and tenant_id = tid returning * into row_;
    if not found then raise exception 'Segment not found' using errcode = 'SF003'; end if;
  end if;
  return jsonb_build_object('id', row_.id, 'name', row_.name, 'rule', row_.rule, 'count', jsonb_array_length(sfx_segment_members(tid, row_.rule)));
end $$;

create function sfx_segment_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_segments where id = p_id and tenant_id = tid; end $$;

-- ---------- Growth: campaigns tied to a discount code, with real orders and revenue ----------
create table sfx_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, channel text not null default 'other', discount_code text, spend numeric(12,2) not null default 0 check (spend >= 0),
  started_on date not null default current_date, created_at timestamptz not null default now()
);
alter table sfx_campaigns enable row level security;

create function sfx_campaign_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'channel', c.channel, 'discountCode', c.discount_code, 'spend', c.spend, 'startedOn', c.started_on,
    'orders', coalesce(x.n, 0), 'revenue', coalesce(x.rev, 0)) order by c.created_at desc)
    from sfx_campaigns c left join lateral (select count(*) n, coalesce(sum(o.total) filter (where o.payment_status = 'paid'), 0) rev from sfx_orders o
      where o.tenant_id = tid and c.discount_code is not null and upper(o.discount_code) = upper(c.discount_code) and o.status <> 'cancelled' and o.created_at::date >= c.started_on) x on true
    where c.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_campaign_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n text := trim(coalesce(p->>'name', '')); ch text := coalesce(nullif(p->>'channel', ''), 'other'); code_ text := upper(trim(coalesce(p->>'discountCode', '')));
  spend_ numeric := coalesce(nullif(p->>'spend', '')::numeric, 0); row_ sfx_campaigns;
begin
  if n = '' then raise exception 'Enter a campaign name' using errcode = 'SF002'; end if;
  if ch not in ('instagram', 'facebook', 'whatsapp', 'email', 'google', 'influencer', 'other') then raise exception 'Choose a channel' using errcode = 'SF002'; end if;
  if spend_ < 0 then raise exception 'Spend cannot be negative' using errcode = 'SF002'; end if;
  if code_ <> '' and not exists (select 1 from sfx_discounts where tenant_id = tid and upper(code) = code_) then raise exception 'There is no discount with the code %', code_ using errcode = 'SF002'; end if;
  if p_id is null then insert into sfx_campaigns (tenant_id, name, channel, discount_code, spend) values (tid, left(n, 120), ch, nullif(code_, ''), spend_) returning * into row_;
  else update sfx_campaigns set name = left(n, 120), channel = ch, discount_code = nullif(code_, ''), spend = spend_ where id = p_id and tenant_id = tid returning * into row_;
    if not found then raise exception 'Campaign not found' using errcode = 'SF003'; end if;
  end if;
  return jsonb_build_object('id', row_.id);
end $$;

create function sfx_campaign_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_campaigns where id = p_id and tenant_id = tid; end $$;

grant select, insert, update, delete on sfx_abandoned, sfx_drafts, sfx_returns, sfx_companies, sfx_segments, sfx_campaigns to app;

-- The owner's order list now carries each order's lines, note, tracking and timeline (db/372 returned only the summary,
-- so the order detail page showed no items). Also what the Returns form needs.
create or replace function sfx_order_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(sfx_order_json(o, true) order by o.created_at desc) from sfx_orders o where o.tenant_id = tid), '[]'::jsonb);
end $$;

-- Rollback: drop the sfx_* functions above, the trigger sfx_orders_shipping, the six tables, sfx_customers.company_id; restore
-- public_sfx_place_order / public_sfx_store by dropping the wrappers and renaming the *_core functions back.
