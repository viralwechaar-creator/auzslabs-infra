-- AUZsStyle store, round 5: coupons, reviews, returns/exchanges, courier tracking, order lookup, back-in-stock alerts,
-- the shop's own Razorpay keys (card payments), two WhatsApp order messages, abandoned-bag reminder, out-of-stock alert.

alter table sty_web_orders add column if not exists discount numeric(12,2) not null default 0;
alter table sty_web_orders add column if not exists coupon text;
alter table sty_web_orders add column if not exists courier text;
alter table sty_web_orders add column if not exists tracking_no text;
alter table sty_web_orders add column if not exists delivered_at timestamptz;
alter table sty_web_orders add column if not exists rzp_order_id text;
alter table sty_web_orders add column if not exists rzp_payment_id text;

-- ---------- coupons ----------
create table if not exists sty_coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  kind text not null check (kind in ('pct', 'flat', 'ship')),
  value numeric(12,2) not null default 0,
  min_order numeric(12,2) not null default 0,
  max_uses integer,
  used integer not null default 0,
  first_order_only boolean not null default false,
  starts_on date, ends_on date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
alter table sty_coupons enable row level security;

create or replace function sty_coupon_calc(tid uuid, p_code text, p_sub numeric, p_ship numeric, p_phone text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c sty_coupons; d numeric; ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  select * into c from sty_coupons where tenant_id = tid and code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then return jsonb_build_object('ok', false, 'msg', 'That coupon code is not valid'); end if;
  if c.starts_on is not null and current_date < c.starts_on then return jsonb_build_object('ok', false, 'msg', 'This coupon has not started yet'); end if;
  if c.ends_on is not null and current_date > c.ends_on then return jsonb_build_object('ok', false, 'msg', 'This coupon has expired'); end if;
  if c.max_uses is not null and c.used >= c.max_uses then return jsonb_build_object('ok', false, 'msg', 'This coupon has been fully used'); end if;
  if p_sub < c.min_order then return jsonb_build_object('ok', false, 'msg', 'Add items worth Rs ' || round(c.min_order) || ' or more to use this coupon'); end if;
  if length(ph) >= 8 then
    if exists (select 1 from sty_web_orders where tenant_id = tid and coupon = c.code and right(regexp_replace(customer->>'phone', '\D', '', 'g'), 10) = ph and status <> 'cancelled') then
      return jsonb_build_object('ok', false, 'msg', 'You have already used this coupon'); end if;
    if c.first_order_only and exists (select 1 from sty_web_orders where tenant_id = tid and right(regexp_replace(customer->>'phone', '\D', '', 'g'), 10) = ph and status <> 'cancelled') then
      return jsonb_build_object('ok', false, 'msg', 'This coupon is for first orders only'); end if;
  end if;
  d := case c.kind when 'pct' then round(p_sub * least(c.value, 100) / 100, 2) when 'flat' then least(c.value, p_sub) else coalesce(p_ship, 0) end;
  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'discount', d, 'msg', case c.kind when 'ship' then 'Free shipping applied' else 'Coupon applied: you save Rs ' || round(d) end);
end $$;

create or replace function public_sty_coupon_check(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; cfg jsonb; fee numeric; fo numeric; sub numeric := coalesce((p->>'subtotal')::numeric, 0); ship numeric;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null then return jsonb_build_object('ok', false, 'msg', 'Store not available'); end if;
  select config into cfg from sty_store where tenant_id = tid; cfg := coalesce(cfg, '{}'::jsonb);
  fee := coalesce(nullif(cfg->'shipping'->>'fee', '')::numeric, 0); fo := nullif(cfg->'shipping'->>'freeOver', '')::numeric;
  ship := case when fo is not null and fo > 0 and sub >= fo then 0 else fee end;
  return sty_coupon_calc(tid, p->>'code', sub, ship, p->>'phone');
end $$;

create or replace function sty_coupons_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'kind', kind, 'value', value, 'minOrder', min_order, 'maxUses', max_uses, 'used', used,
    'firstOnly', first_order_only, 'startsOn', starts_on, 'endsOn', ends_on, 'active', active, 'note', note) order by created_at desc) from sty_coupons where tenant_id = tid), '[]'::jsonb);
end $$;

create or replace function sty_coupon_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid; cd text := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9_-]', '', 'g'));
begin
  tid := sty_guard('sty_manage');
  if length(cd) < 3 or length(cd) > 24 then raise exception 'The code must be 3 to 24 letters or numbers' using errcode = 'ST002'; end if;
  if p->>'kind' not in ('pct', 'flat', 'ship') then raise exception 'Choose a coupon type' using errcode = 'ST002'; end if;
  if p->>'kind' = 'pct' and (coalesce((p->>'value')::numeric, 0) <= 0 or (p->>'value')::numeric > 100) then raise exception 'Percent must be between 1 and 100' using errcode = 'ST002'; end if;
  if p->>'kind' = 'flat' and coalesce((p->>'value')::numeric, 0) <= 0 then raise exception 'Enter the rupee amount' using errcode = 'ST002'; end if;
  if cid is null then
    insert into sty_coupons (tenant_id, code, kind, value, min_order, max_uses, first_order_only, starts_on, ends_on, active, note)
    values (tid, cd, p->>'kind', coalesce((p->>'value')::numeric, 0), coalesce((p->>'minOrder')::numeric, 0), nullif(p->>'maxUses', '')::int, coalesce((p->>'firstOnly')::boolean, false),
      nullif(p->>'startsOn', '')::date, nullif(p->>'endsOn', '')::date, coalesce((p->>'active')::boolean, true), nullif(p->>'note', '')) returning id into cid;
  else
    update sty_coupons set code = cd, kind = p->>'kind', value = coalesce((p->>'value')::numeric, 0), min_order = coalesce((p->>'minOrder')::numeric, 0), max_uses = nullif(p->>'maxUses', '')::int,
      first_order_only = coalesce((p->>'firstOnly')::boolean, false), starts_on = nullif(p->>'startsOn', '')::date, ends_on = nullif(p->>'endsOn', '')::date,
      active = coalesce((p->>'active')::boolean, true), note = nullif(p->>'note', '') where id = cid and tenant_id = tid;
  end if;
  perform sty_audit_log(tid, 'coupon.save', cd, null);
  return jsonb_build_object('id', cid);
exception when unique_violation then raise exception 'That code already exists' using errcode = 'ST002';
end $$;

create or replace function sty_coupon_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  delete from sty_coupons where id = p_id and tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- abandoned bags (only stored when the shop switches the reminder on) ----------
create table if not exists sty_web_carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  phone text not null,
  name text,
  lines jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reminded_at timestamptz,
  ordered_at timestamptz,
  unique (tenant_id, phone)
);
alter table sty_web_carts enable row level security;

create or replace function public_sty_cart_save(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cfg jsonb; ph text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10); l jsonb; v record; tot numeric := 0; ls jsonb := '[]'::jsonb;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null or length(ph) <> 10 or jsonb_typeof(p->'lines') <> 'array' then return jsonb_build_object('ok', false); end if;
  select config into cfg from sty_store where tenant_id = tid;
  if coalesce((cfg->>'abandonWa')::boolean, false) is not true then return jsonb_build_object('ok', false); end if;
  for l in select * from jsonb_array_elements(p->'lines') limit 20 loop
    select coalesce(v2.price, s.price) as price, s.name into v from sty_variants v2 join sty_styles s on s.id = v2.style_id where v2.id = nullif(l->>'variantId', '')::uuid and v2.tenant_id = tid;
    if found then tot := tot + v.price * greatest(coalesce((l->>'qty')::int, 1), 1); ls := ls || jsonb_build_object('name', v.name, 'qty', greatest(coalesce((l->>'qty')::int, 1), 1)); end if;
  end loop;
  if jsonb_array_length(ls) = 0 then return jsonb_build_object('ok', false); end if;
  insert into sty_web_carts (tenant_id, phone, name, lines, total) values (tid, ph, left(coalesce(p->>'name', ''), 60), ls, tot)
    on conflict (tenant_id, phone) do update set name = excluded.name, lines = excluded.lines, total = excluded.total, updated_at = now(), ordered_at = null;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- reviews (real buyers only: a delivered order, one review per style per order) ----------
create table if not exists sty_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  style_id uuid not null references sty_styles(id) on delete cascade,
  order_id uuid not null references sty_web_orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text, body text, name text,
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  unique (order_id, style_id)
);
create index if not exists sty_reviews_style on sty_reviews (style_id, status);
alter table sty_reviews enable row level security;

create or replace function public_sty_review_submit(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; sid uuid := nullif(p->>'styleId', '')::uuid; r int := (p->>'rating')::int;
begin
  select * into o from sty_web_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'ST002'; end if;
  if o.status <> 'delivered' then raise exception 'You can review a product once your order is delivered' using errcode = 'ST002'; end if;
  if not exists (select 1 from jsonb_array_elements(o.lines) x where (x->>'styleId')::uuid = sid) then raise exception 'That product is not in this order' using errcode = 'ST002'; end if;
  if r is null or r < 1 or r > 5 then raise exception 'Choose 1 to 5 stars' using errcode = 'ST002'; end if;
  insert into sty_reviews (tenant_id, style_id, order_id, rating, title, body, name)
    values (o.tenant_id, sid, o.id, r, left(nullif(trim(coalesce(p->>'title', '')), ''), 80), left(nullif(trim(coalesce(p->>'body', '')), ''), 800), split_part(o.customer->>'name', ' ', 1))
    on conflict (order_id, style_id) do update set rating = excluded.rating, title = excluded.title, body = excluded.body;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public_sty_reviews(p_slug text, p_style uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug);
begin
  if tid is null then return jsonb_build_object('count', 0, 'avg', 0, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('count', (select count(*) from sty_reviews where tenant_id = tid and style_id = p_style and status = 'published'),
    'avg', coalesce((select round(avg(rating)::numeric, 1) from sty_reviews where tenant_id = tid and style_id = p_style and status = 'published'), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'rating', rating, 'title', title, 'body', body, 'date', created_at) order by created_at desc)
      from (select * from sty_reviews where tenant_id = tid and style_id = p_style and status = 'published' order by created_at desc limit 30) x), '[]'::jsonb));
end $$;

create or replace function sty_reviews_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'style', s.name, 'rating', r.rating, 'title', r.title, 'body', r.body, 'name', r.name, 'status', r.status, 'date', r.created_at) order by r.created_at desc)
    from (select * from sty_reviews where tenant_id = tid order by created_at desc limit 200) r join sty_styles s on s.id = r.style_id), '[]'::jsonb);
end $$;

create or replace function sty_review_set(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  if p_status not in ('published', 'hidden') then raise exception 'bad status' using errcode = 'ST002'; end if;
  update sty_reviews set status = p_status where id = p_id and tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- returns and exchanges requested from the order page ----------
create table if not exists sty_web_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null references sty_web_orders(id) on delete cascade,
  kind text not null check (kind in ('return', 'exchange')),
  reason text,
  items jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received', 'refunded')),
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sty_web_returns_o on sty_web_returns (order_id);
alter table sty_web_returns enable row level security;

create or replace function public_sty_return_request(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; st sty_settings; days int;
begin
  select * into o from sty_web_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'ST002'; end if;
  if o.status <> 'delivered' then raise exception 'A return or exchange can be asked for once the order is delivered' using errcode = 'ST002'; end if;
  select * into st from sty_settings where tenant_id = o.tenant_id; days := coalesce(st.return_days, 30);
  if coalesce(o.delivered_at, o.updated_at) < now() - make_interval(days => days) then raise exception 'The % day return window for this order has ended', days using errcode = 'ST002'; end if;
  if exists (select 1 from sty_web_returns where order_id = o.id and status in ('requested', 'approved')) then raise exception 'You already have a request open for this order' using errcode = 'ST002'; end if;
  if coalesce(p->>'kind', '') not in ('return', 'exchange') then raise exception 'Choose return or exchange' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'reason', ''))) < 3 then raise exception 'Tell us why' using errcode = 'ST002'; end if;
  insert into sty_web_returns (tenant_id, order_id, kind, reason, items, note)
    values (o.tenant_id, o.id, p->>'kind', left(trim(p->>'reason'), 200), case when jsonb_typeof(p->'items') = 'array' then p->'items' else '[]'::jsonb end, left(coalesce(p->>'note', ''), 400));
  begin
    insert into notifications (tenant_id, type, title, body) values (o.tenant_id, 'store_return', 'Return request for order ' || o.number, (o.customer->>'name') || ' asked for a ' || (p->>'kind'));
    perform pg_notify('push_events', jsonb_build_object('tenant_id', o.tenant_id, 'title', 'Return request ' || o.number, 'body', (o.customer->>'name') || ': ' || (p->>'kind'), 'url', '/style.html#/store')::text);
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function sty_web_returns_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'orderId', o.id, 'number', o.number, 'customer', o.customer, 'kind', r.kind, 'reason', r.reason, 'items', r.items, 'note', r.note,
      'status', r.status, 'staffNote', r.staff_note, 'createdAt', r.created_at, 'total', o.total, 'lines', o.lines) order by r.created_at desc)
    from (select * from sty_web_returns where tenant_id = tid order by created_at desc limit 200) r join sty_web_orders o on o.id = r.order_id), '[]'::jsonb);
end $$;

create or replace function sty_web_return_set(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  if p ? 'status' and p->>'status' not in ('requested', 'approved', 'rejected', 'received', 'refunded') then raise exception 'bad status' using errcode = 'ST002'; end if;
  update sty_web_returns set status = coalesce(p->>'status', status), staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end, updated_at = now() where id = p_id and tenant_id = tid;
  perform sty_audit_log(tid, 'web_return.update', p_id::text, p);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- order lookup without the saved link ----------
create or replace function public_sty_order_find(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug); o sty_web_orders; ph text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
begin
  if tid is null or length(ph) <> 10 then raise exception 'We could not find that order. Check the order number and phone.' using errcode = 'ST002'; end if;
  select * into o from sty_web_orders where tenant_id = tid and upper(number) = upper(trim(coalesce(p->>'number', ''))) and right(regexp_replace(customer->>'phone', '\D', '', 'g'), 10) = ph;
  if not found then raise exception 'We could not find that order. Check the order number and phone.' using errcode = 'ST002'; end if;
  return jsonb_build_object('token', o.token);
end $$;

-- ---------- back-in-stock requests ----------
create table if not exists sty_web_notify (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  variant_id uuid not null references sty_variants(id) on delete cascade,
  phone text not null, name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists sty_web_notify_open on sty_web_notify (variant_id, phone) where sent_at is null;
alter table sty_web_notify enable row level security;

create or replace function public_sty_notify_me(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug); ph text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10); vid uuid := nullif(p->>'variantId', '')::uuid;
begin
  if tid is null then raise exception 'This store is not available' using errcode = 'ST001'; end if;
  if length(ph) <> 10 then raise exception 'Enter a 10 digit phone number' using errcode = 'ST002'; end if;
  if not exists (select 1 from sty_variants where id = vid and tenant_id = tid) then raise exception 'item not found' using errcode = 'ST002'; end if;
  if (select count(*) from sty_web_notify where tenant_id = tid and phone = ph and sent_at is null) >= 10 then raise exception 'Too many requests from this number' using errcode = 'ST002'; end if;
  insert into sty_web_notify (tenant_id, variant_id, phone, name) values (tid, vid, ph, left(coalesce(p->>'name', ''), 60)) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- courier tracking, delivered time, updated order JSON ----------
create or replace function sty_web_order_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o sty_web_orders; billed jsonb; berr text; o2 sty_web_orders;
begin
  tid := sty_guard('sty_sell');
  select * into o from sty_web_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'order not found' using errcode = 'ST002'; end if;
  if p ? 'status' and (p->>'status') not in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled') then raise exception 'bad status' using errcode = 'ST002'; end if;
  if p ? 'paymentStatus' and (p->>'paymentStatus') not in ('pending', 'submitted', 'paid', 'cod') then raise exception 'bad payment status' using errcode = 'ST002'; end if;
  update sty_web_orders set status = coalesce(p->>'status', status), payment_status = coalesce(p->>'paymentStatus', payment_status),
    staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end,
    courier = case when p ? 'courier' then left(nullif(trim(p->>'courier'), ''), 40) else courier end,
    tracking_no = case when p ? 'trackingNo' then left(nullif(trim(p->>'trackingNo'), ''), 60) else tracking_no end,
    delivered_at = case when p->>'status' = 'delivered' and delivered_at is null then now() else delivered_at end,
    sale_id = coalesce(nullif(p->>'saleId', '')::uuid, sale_id), updated_at = now()
    where id = p_id;
  perform sty_audit_log(tid, 'web_order.update', o.number, p);
  select * into o2 from sty_web_orders where id = p_id;
  if o2.sale_id is null and o2.payment_status = 'paid' and o2.status <> 'cancelled' then
    begin billed := sty_web_order_bill(p_id);
    exception when others then berr := sqlerrm; end;
  end if;
  return (select jsonb_build_object('id', id, 'number', number, 'status', status, 'paymentStatus', payment_status, 'saleId', sale_id, 'billed', billed->>'number', 'billError', berr) from sty_web_orders where id = p_id);
end $$;

create or replace function sty_web_orders_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; stt text := nullif(p->>'status', '');
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'token', o.token, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status,
      'utr', o.utr, 'customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping, 'total', o.total, 'note', o.note, 'staffNote', o.staff_note,
      'discount', o.discount, 'coupon', o.coupon, 'courier', o.courier, 'trackingNo', o.tracking_no, 'rzpPaid', o.rzp_payment_id is not null,
      'saleId', o.sale_id, 'saleNo', (select number from sty_sales where id = o.sale_id), 'createdAt', o.created_at) order by o.created_at desc)
    from (select * from sty_web_orders where tenant_id = tid and (stt is null or status = stt) order by created_at desc limit 200) o), '[]'::jsonb);
end $$;

create or replace function public_sty_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sty_web_orders; st sty_settings; tn text; feat jsonb; days int;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 20 then return null; end if;
  select * into o from sty_web_orders where token = lower(p_token);
  if not found then return null; end if;
  select * into st from sty_settings where tenant_id = o.tenant_id;
  select name into tn from tenants where id = o.tenant_id;
  feat := coalesce(st.features, '{}'::jsonb); days := coalesce(st.return_days, 30);
  return jsonb_build_object('number', o.number, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status, 'total', o.total,
    'subtotal', o.subtotal, 'shipping', o.shipping, 'discount', o.discount, 'coupon', o.coupon, 'courier', o.courier, 'trackingNo', o.tracking_no,
    'lines', o.lines, 'createdAt', o.created_at, 'returnDays', days,
    'canReturn', o.status = 'delivered' and coalesce(o.delivered_at, o.updated_at) >= now() - make_interval(days => days) and not exists (select 1 from sty_web_returns where order_id = o.id and status in ('requested', 'approved')),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'status', r.status, 'staffNote', r.staff_note, 'createdAt', r.created_at) order by r.created_at desc) from sty_web_returns r where r.order_id = o.id), '[]'::jsonb),
    'reviewed', coalesce((select jsonb_agg(style_id) from sty_reviews where order_id = o.id), '[]'::jsonb),
    'customer', jsonb_build_object('name', o.customer->>'name', 'city', o.customer->>'city', 'pin', o.customer->>'pin'),
    'shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn), 'phone', st.phone),
    'upi', case when o.payment_method = 'upi' and o.payment_status in ('pending', 'submitted') then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;

-- ---------- the shop's own Razorpay keys (card/UPI/netbanking). The money goes straight to the shop; AUZslab never holds it. ----------
create table if not exists sty_store_secrets (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  rzp_key_id text, rzp_secret text, updated_at timestamptz not null default now()
);
alter table sty_store_secrets enable row level security;

create or replace function sty_store_set_razorpay(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; kid text := trim(coalesce(p->>'keyId', '')); sec text := trim(coalesce(p->>'secret', '')); cur jsonb;
begin
  tid := sty_guard('sty_manage');
  select config into cur from sty_store where tenant_id = tid; cur := coalesce(cur, '{}'::jsonb);
  if coalesce((p->>'clear')::boolean, false) then
    delete from sty_store_secrets where tenant_id = tid;
    cur := cur || jsonb_build_object('payOnline', false) - 'rzpKey';
  else
    if kid !~ '^rzp_(live|test)_[A-Za-z0-9]{8,}$' then raise exception 'Enter the Key ID from your Razorpay dashboard (it starts with rzp_live_ or rzp_test_)' using errcode = 'ST002'; end if;
    if length(sec) < 12 then raise exception 'Enter the Key Secret from your Razorpay dashboard' using errcode = 'ST002'; end if;
    insert into sty_store_secrets (tenant_id, rzp_key_id, rzp_secret) values (tid, kid, sec)
      on conflict (tenant_id) do update set rzp_key_id = excluded.rzp_key_id, rzp_secret = excluded.rzp_secret, updated_at = now();
    cur := cur || jsonb_build_object('payOnline', true, 'rzpKey', kid);
  end if;
  insert into sty_store (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  perform sty_audit_log(tid, 'store.razorpay', null, jsonb_build_object('set', not coalesce((p->>'clear')::boolean, false)));
  return jsonb_build_object('ok', true, 'payOnline', not coalesce((p->>'clear')::boolean, false));
end $$;

-- server-only helpers (called by the API with the shop's keys; NOT in the RPC list)
create or replace function sty_online_start(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; k sty_store_secrets;
begin
  select * into o from sty_web_orders where token = lower(coalesce(p_token, ''));
  if not found or o.payment_method <> 'online' or o.payment_status = 'paid' or o.status = 'cancelled' then raise exception 'This order cannot be paid online' using errcode = 'ST002'; end if;
  select * into k from sty_store_secrets where tenant_id = o.tenant_id;
  if k.tenant_id is null then raise exception 'Card payment is not set up for this store' using errcode = 'ST002'; end if;
  return jsonb_build_object('number', o.number, 'total', o.total, 'key', k.rzp_key_id, 'secret', k.rzp_secret, 'name', o.customer->>'name', 'phone', o.customer->>'phone', 'email', o.customer->>'email');
end $$;

create or replace function sty_online_set_order(p_token text, p_order text) returns void language sql security definer set search_path = public as $$
  update sty_web_orders set rzp_order_id = p_order where token = lower(coalesce(p_token, '')) and payment_method = 'online' and payment_status <> 'paid';
$$;

create or replace function sty_online_confirm(p_token text, p_rzp_order text, p_payment text, p_sig text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; k sty_store_secrets; want text;
begin
  select * into o from sty_web_orders where token = lower(coalesce(p_token, ''));
  if not found or o.payment_method <> 'online' then raise exception 'Order not found' using errcode = 'ST002'; end if;
  if o.payment_status = 'paid' then return public_sty_order(o.token); end if;
  select * into k from sty_store_secrets where tenant_id = o.tenant_id;
  if k.tenant_id is null or o.rzp_order_id is null or o.rzp_order_id <> p_rzp_order then raise exception 'Payment could not be verified' using errcode = 'ST002'; end if;
  want := encode(hmac((p_rzp_order || '|' || p_payment)::bytea, convert_to(k.rzp_secret, 'UTF8'), 'sha256'), 'hex');
  if want <> lower(coalesce(p_sig, '')) then raise exception 'Payment could not be verified' using errcode = 'ST002'; end if;
  update sty_web_orders set payment_status = 'paid', rzp_payment_id = left(p_payment, 60), updated_at = now() where id = o.id;
  begin
    insert into notifications (tenant_id, type, title, body) values (o.tenant_id, 'store_paid', 'Order ' || o.number || ' paid online', (o.customer->>'name') || ' paid Rs ' || round(o.total) || '. Confirm the order to make the bill.');
    perform pg_notify('push_events', jsonb_build_object('tenant_id', o.tenant_id, 'title', 'Paid online: ' || o.number, 'body', (o.customer->>'name') || ' - Rs ' || round(o.total) || '. Confirm to bill it.', 'url', '/style.html#/store')::text);
  exception when others then null; end;
  return public_sty_order(o.token);
end $$;

-- ---------- link preview data for WhatsApp / Google (used by /store-share) ----------
create or replace function public_sty_share(p_slug text, p_style uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_public_tenant(p_slug); st sty_settings; cfg jsonb; s sty_styles; tn text;
begin
  if tid is null then return null; end if;
  select * into st from sty_settings where tenant_id = tid; select config into cfg from sty_store where tenant_id = tid; select name into tn from tenants where id = tid;
  if coalesce((cfg->>'on')::boolean, false) is not true then return null; end if;
  if p_style is not null then select * into s from sty_styles where id = p_style and tenant_id = tid and active; end if;
  return jsonb_build_object('shop', coalesce(nullif(cfg->>'brandName', ''), nullif(st.shop_name, ''), tn), 'tagline', cfg->>'tagline',
    'name', s.name, 'price', s.price, 'description', left(coalesce(s.description, s.details, ''), 180), 'photo', coalesce(s.photos->>0, s.photo_url),
    'heroPhoto', cfg->'heroImages'->>0);
end $$;

-- ---------- WhatsApp: only the two important order messages, plus back-in-stock (asked for by the customer) and the optional bag reminder ----------
insert into wa_templates (key, name, audience, title, body, params) values
  ('style_order_confirmed', 'auzslab_style_order_confirmed', 'shop', 'Online order confirmed',
   'Hi {{1}}, your order {{2}} from {{3}} is confirmed. Total Rs {{4}}. You can follow it any time here: {{5}} Thank you for shopping with us.', '{customer,number,shop,total,link}'),
  ('style_order_shipped', 'auzslab_style_order_shipped', 'shop', 'Online order shipped',
   'Hi {{1}}, your order {{2}} from {{3}} is on its way with {{4}}. Track it here: {{5}} Thank you for your patience.', '{customer,number,shop,courier,link}'),
  ('style_back_in_stock', 'auzslab_style_back_in_stock', 'shop', 'Back in stock',
   'Hi {{1}}, good news from {{2}}: {{3}} is back in stock. Order it here before it sells out again: {{4}} See you soon.', '{customer,shop,product,link}'),
  ('style_abandoned_bag', 'auzslab_style_abandoned_bag', 'shop', 'Bag reminder',
   'Hi {{1}}, you left something in your bag at {{2}}. It is still waiting for you here: {{3}} Need help? Just reply to this message.', '{customer,shop,link}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title, body = excluded.body, params = excluded.params;

create or replace function sty_web_order_wa() returns trigger language plpgsql security definer set search_path = public as $$
declare cfg jsonb; shop text; ph text; nm text; link text;
begin
  if new.status = old.status or new.status not in ('confirmed', 'shipped') then return new; end if;
  select config into cfg from sty_store where tenant_id = new.tenant_id;
  if coalesce((cfg->>'waOrder')::boolean, true) is not true then return new; end if;
  ph := right(regexp_replace(coalesce(new.customer->>'phone', ''), '\D', '', 'g'), 10);
  if length(ph) <> 10 then return new; end if;
  select coalesce(nullif(cfg->>'brandName', ''), nullif(shop_name, ''), (select name from tenants where id = new.tenant_id)) into shop from sty_settings where tenant_id = new.tenant_id;
  nm := split_part(coalesce(new.customer->>'name', 'there'), ' ', 1);
  link := wa_tenant_link(new.tenant_id, '/store.html#/order/' || new.token);
  if new.status = 'confirmed' then
    perform wa_enqueue(new.tenant_id, ph, 'style_order_confirmed', jsonb_build_array(nm, new.number, coalesce(shop, 'our store'), round(new.total)::text, link), new.id || '-confirmed');
  else
    perform wa_enqueue(new.tenant_id, ph, 'style_order_shipped', jsonb_build_array(nm, new.number, coalesce(shop, 'our store'), coalesce(nullif(trim(coalesce(new.courier, '') || ' ' || coalesce(new.tracking_no, '')), ''), 'our courier partner'), link), new.id || '-shipped');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sty_web_orders_wa on sty_web_orders;
create trigger sty_web_orders_wa after update of status on sty_web_orders for each row execute function sty_web_order_wa();

-- stock coming in: tell the people who asked (once), and tell the owner when a style sells out
create or replace function sty_stock_alerts() returns trigger language plpgsql security definer set search_path = public as $$
declare n record; cfg jsonb; shop text; pname text; tot int; sid uuid; sname text;
begin
  if new.qty > 0 and exists (select 1 from sty_web_notify where variant_id = new.variant_id and sent_at is null) then
    if coalesce((select sum(qty) from sty_stock_moves where variant_id = new.variant_id and tenant_id = new.tenant_id), 0) - new.qty <= 0 then
      select config into cfg from sty_store where tenant_id = new.tenant_id;
      select coalesce(nullif(cfg->>'brandName', ''), nullif(shop_name, ''), (select name from tenants where id = new.tenant_id)) into shop from sty_settings where tenant_id = new.tenant_id;
      select s.name into pname from sty_variants v join sty_styles s on s.id = v.style_id where v.id = new.variant_id;
      for n in select * from sty_web_notify where variant_id = new.variant_id and sent_at is null loop
        perform wa_enqueue(new.tenant_id, n.phone, 'style_back_in_stock', jsonb_build_array(split_part(coalesce(nullif(n.name, ''), 'there'), ' ', 1), coalesce(shop, 'our store'), coalesce(pname, 'Your item'), wa_tenant_link(new.tenant_id, '/store.html')), n.id::text);
        update sty_web_notify set sent_at = now() where id = n.id;
      end loop;
    end if;
  elsif new.qty < 0 then
    select v.style_id, s.name into sid, sname from sty_variants v join sty_styles s on s.id = v.style_id where v.id = new.variant_id;
    select coalesce(sum(m.qty), 0) into tot from sty_stock_moves m join sty_variants v on v.id = m.variant_id where v.style_id = sid and m.tenant_id = new.tenant_id;
    if tot <= 0 and tot - new.qty > 0 then
      insert into notifications (tenant_id, type, title, body) values (new.tenant_id, 'style_soldout', sname || ' is out of stock', 'The last piece was just sold. The store and the till now show it as sold out.');
      perform pg_notify('push_events', jsonb_build_object('tenant_id', new.tenant_id, 'title', sname || ' is sold out', 'body', 'No stock left. It shows as sold out on the store and the till.', 'url', '/style.html#/stock')::text);
    end if;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sty_stock_alerts_t on sty_stock_moves;
create trigger sty_stock_alerts_t after insert on sty_stock_moves for each row execute function sty_stock_alerts();

-- daily: one bag reminder per person (only shops that switched it on, and only people who typed their phone at checkout)
create or replace function sty_abandoned_run() returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; shop text; cfg jsonb;
begin
  for r in select c.* from sty_web_carts c where c.updated_at between now() - interval '48 hours' and now() - interval '3 hours'
      and (c.ordered_at is null or c.ordered_at < c.updated_at) and (c.reminded_at is null or c.reminded_at < now() - interval '7 days') loop
    select config into cfg from sty_store where tenant_id = r.tenant_id;
    continue when coalesce((cfg->>'abandonWa')::boolean, false) is not true or coalesce((cfg->>'on')::boolean, false) is not true;
    select coalesce(nullif(cfg->>'brandName', ''), nullif(shop_name, ''), (select name from tenants where id = r.tenant_id)) into shop from sty_settings where tenant_id = r.tenant_id;
    perform wa_enqueue(r.tenant_id, r.phone, 'style_abandoned_bag', jsonb_build_array(split_part(coalesce(nullif(r.name, ''), 'there'), ' ', 1), coalesce(shop, 'our store'), wa_tenant_link(r.tenant_id, '/store.html#/bag')), r.id || '-' || to_char(now(), 'YYYYMMDD'));
    update sty_web_carts set reminded_at = now() where id = r.id; n := n + 1;
  end loop;
  return n;
end $$;

-- the store settings list now also accepts the size chart and the two WhatsApp switches
create or replace function public_sty_place_order(p_slug text, p jsonb)
 returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cfg jsonb; st sty_settings; l jsonb; v record; q int; have int; lines jsonb := '[]'::jsonb; sub numeric := 0; ship numeric := 0;
  pay text; num text; tok text; oid uuid; cust jsonb; ph text; feat jsonb; recent int; tn text; free_over numeric; fee numeric; disc numeric := 0; cres jsonb;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null then raise exception 'This store is not available' using errcode = 'ST001'; end if;
  select config into cfg from sty_store where tenant_id = tid;
  cfg := coalesce(cfg, '{}'::jsonb);
  if coalesce((cfg->>'on')::boolean, false) is not true then raise exception 'This store is closed right now' using errcode = 'ST001'; end if;
  select * into st from sty_settings where tenant_id = tid;
  feat := coalesce(st.features, '{}'::jsonb);
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Your bag is empty' using errcode = 'ST002'; end if;
  if jsonb_array_length(p->'lines') > 40 then raise exception 'Too many items in one order' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please enter your name' using errcode = 'ST002'; end if;
  ph := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
  if length(ph) < 8 or length(ph) > 16 then raise exception 'Please enter a valid phone number' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'address', ''))) < 4 or length(trim(coalesce(p->>'city', ''))) < 2 or length(trim(coalesce(p->>'pin', ''))) < 4 then
    raise exception 'Please fill your full delivery address, city and PIN code' using errcode = 'ST002'; end if;
  if coalesce(p->>'email', '') <> '' and (p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right' using errcode = 'ST002'; end if;
  pay := coalesce(p->>'payment', 'cod');
  if pay = 'cod' then if not coalesce((cfg->'pay'->>'cod')::boolean, true) then raise exception 'Cash on delivery is not offered by this store' using errcode = 'ST002'; end if;
  elsif pay = 'upi' then if not coalesce((cfg->'pay'->>'upi')::boolean, true) or coalesce(feat->>'upiId', '') = '' then raise exception 'UPI payment is not set up for this store' using errcode = 'ST002'; end if;
  elsif pay = 'online' then if not coalesce((cfg->>'payOnline')::boolean, false) then raise exception 'Card payment is not set up for this store' using errcode = 'ST002'; end if;
  else raise exception 'Choose a payment method' using errcode = 'ST002'; end if;
  select count(*) into recent from sty_web_orders where tenant_id = tid and customer->>'phone' = ph and created_at > now() - interval '1 hour';
  if recent >= 4 then raise exception 'Too many orders from this number. Please wait a little.' using errcode = 'ST002'; end if;

  for l in select * from jsonb_array_elements(p->'lines') loop
    q := greatest(coalesce((l->>'qty')::int, 0), 0);
    if q < 1 or q > 20 then raise exception 'Quantity must be between 1 and 20' using errcode = 'ST002'; end if;
    select v2.id vid, v2.colour, v2.size, coalesce(v2.price, s.price) price, s.mrp, s.id sid, s.name, s.badge, s.photo_url, s.photos, s.colour_photos
      into v from sty_variants v2 join sty_styles s on s.id = v2.style_id
      where v2.id = nullif(l->>'variantId', '')::uuid and v2.tenant_id = tid and v2.active and s.active;
    if not found then raise exception 'One item in your bag is no longer available' using errcode = 'ST002'; end if;
    if v.badge = 'soldout' then raise exception '% is sold out', v.name using errcode = 'ST002'; end if;
    select coalesce(sum(qty), 0)::int into have from sty_stock_moves where tenant_id = tid and variant_id = v.vid;
    if have < q then raise exception 'Only % left of % (% %)', greatest(have, 0), v.name, v.colour, v.size using errcode = 'ST002'; end if;
    sub := sub + v.price * q;
    lines := lines || jsonb_build_object('styleId', v.sid, 'variantId', v.vid, 'name', v.name, 'colour', v.colour, 'size', v.size, 'price', v.price, 'mrp', v.mrp, 'qty', q,
      'photo', coalesce((v.colour_photos->v.colour->>0), (v.photos->>0), v.photo_url));
  end loop;

  fee := coalesce(nullif(cfg->'shipping'->>'fee', '')::numeric, 0); free_over := nullif(cfg->'shipping'->>'freeOver', '')::numeric;
  ship := case when free_over is not null and free_over > 0 and sub >= free_over then 0 else fee end;
  if coalesce(trim(p->>'coupon'), '') <> '' then
    cres := sty_coupon_calc(tid, p->>'coupon', sub, ship, ph);
    if not coalesce((cres->>'ok')::boolean, false) then raise exception '%', cres->>'msg' using errcode = 'ST002'; end if;
    disc := (cres->>'discount')::numeric;
  end if;
  num := 'W' || lpad(sty_next(tid, 'web_order')::text, 5, '0');
  tok := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  cust := jsonb_build_object('name', left(trim(p->>'name'), 80), 'email', left(coalesce(p->>'email', ''), 120), 'phone', ph,
    'address', left(trim(p->>'address'), 200), 'address2', left(coalesce(p->>'address2', ''), 120), 'city', left(trim(p->>'city'), 80),
    'state', left(coalesce(p->>'state', ''), 60), 'pin', left(trim(p->>'pin'), 12), 'country', left(coalesce(nullif(p->>'country', ''), 'India'), 60));
  insert into sty_web_orders (tenant_id, number, token, payment_method, payment_status, customer, lines, subtotal, shipping, total, note, discount, coupon)
    values (tid, num, tok, pay, case when pay = 'cod' then 'cod' else 'pending' end, cust, lines, sub, ship, sub + ship - disc, left(coalesce(p->>'note', ''), 400), disc, case when disc > 0 then upper(trim(p->>'coupon')) end)
    returning id into oid;
  select name into tn from tenants where id = tid;
  if disc > 0 then update sty_coupons set used = used + 1 where tenant_id = tid and code = upper(trim(p->>'coupon')); end if;
  update sty_web_carts set ordered_at = now() where tenant_id = tid and phone = right(ph, 10);
  begin
    insert into notifications (tenant_id, type, title, body) values (tid, 'store_order', 'New online order ' || num, (cust->>'name') || ' ordered ' || jsonb_array_length(lines) || ' item(s), Rs ' || (sub + ship - disc));
  exception when others then null;
  end;
  return jsonb_build_object('number', num, 'token', tok, 'total', sub + ship - disc, 'discount', disc, 'payment', pay,
    'upi', case when pay = 'upi' then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;

create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; k text; ok_keys text[] := array['on', 'tagline', 'announce', 'heroImages', 'heroTitle', 'heroCta', 'about', 'founders',
    'stores', 'faqs', 'policies', 'shipping', 'pay', 'social', 'email', 'phone', 'brandName', 'showSale', 'sizeGuide', 'waOrder', 'abandonWa'];
begin
  tid := sty_guard('sty_manage');
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'ST002'; end if;
  if length(p::text) > 120000 then raise exception 'store settings are too large' using errcode = 'ST002'; end if;
  select config into cur from sty_store where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sty_store (tenant_id, config) values (tid, cur)
    on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  perform sty_audit_log(tid, 'store.save', null, null);
  return sty_store_get();
end $$;
