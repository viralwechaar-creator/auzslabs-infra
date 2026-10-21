-- AUZsStyle online store: a public shop page for a clothing / footwear business (/store.html on the shop's own address).
-- The shop's catalogue is read from the same styles + variants the till uses. Visitors place orders that land in an inbox
-- (sty_web_orders); staff confirm them and turn them into a normal bill. Pay by UPI QR (the shop's own UPI id) or cash on
-- delivery. Online card payment is a request the platform admin must switch on (payReq), not live by default.
-- Store settings (hero pictures, stores, FAQ, shipping, ...) are one jsonb document per shop in sty_store.

create table if not exists sty_store (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table sty_store enable row level security;

create table if not exists sty_web_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null,
  token text not null unique,
  status text not null default 'new' check (status in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled')),
  payment_method text not null check (payment_method in ('cod', 'upi', 'online')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'submitted', 'paid', 'cod')),
  utr text,
  customer jsonb not null,                                  -- name, email, phone, address, city, state, pin, country
  lines jsonb not null,                                     -- snapshot: styleId, variantId, name, colour, size, price, mrp, qty, photo
  subtotal numeric(12,2) not null, shipping numeric(12,2) not null default 0, total numeric(12,2) not null,
  note text, staff_note text,
  sale_id uuid,                                             -- set when staff turn it into a bill
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create index if not exists sty_web_orders_t on sty_web_orders(tenant_id, status, created_at desc);
alter table sty_web_orders enable row level security;

-- public: is this address a shop with AUZsStyle on? returns its tenant id or null
create or replace function sty_public_tenant(p_slug text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  select id into tid from tenants where slug = lower(coalesce(p_slug, ''));
  if tid is null then return null; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'style', 'false') <> 'true' or coalesce(e->>'style', 'true') = 'false' then return null; end if;
  return tid;
end $$;

-- ---------- owner side ----------
create or replace function sty_store_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; c jsonb;
begin
  tid := sty_guard('sty_view');
  select config into c from sty_store where tenant_id = tid;
  return coalesce(c, '{}'::jsonb) || jsonb_build_object('slug', (select slug from tenants where id = tid));
end $$;

create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; k text; ok_keys text[] := array['on', 'tagline', 'announce', 'heroImages', 'heroTitle', 'heroCta', 'about', 'founders',
    'stores', 'faqs', 'policies', 'shipping', 'pay', 'social', 'email', 'phone', 'brandName'];
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

-- the shop asks AUZslab to switch on online card payments; the platform admin sees a notification
create or replace function sty_store_request_payments() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; nm text;
begin
  tid := sty_guard('sty_manage');
  select config into cur from sty_store where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  if coalesce(cur->>'payReq', '') in ('requested', 'live') then return sty_store_get(); end if;
  cur := cur || jsonb_build_object('payReq', 'requested', 'payReqAt', now());
  insert into sty_store (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  select name into nm from tenants where id = tid;
  begin
    insert into notifications (tenant_id, type, title, body) values (null, 'store_payments_request', 'Online payments requested',
      coalesce(nm, 'A shop') || ' asked for online card payments on its AUZsStyle store.');
  exception when others then null;
  end;
  return sty_store_get();
end $$;

-- ---------- public store ----------
create or replace function public_sty_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st sty_settings; cfg jsonb; tn text; feat jsonb;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null then return null; end if;
  select * into st from sty_settings where tenant_id = tid;
  select config into cfg from sty_store where tenant_id = tid;
  cfg := coalesce(cfg, '{}'::jsonb) - 'payReqAt';
  if coalesce((cfg->>'on')::boolean, false) is not true then return jsonb_build_object('closed', true, 'name', coalesce(nullif(st.shop_name, ''), (select name from tenants where id = tid))); end if;
  select name into tn from tenants where id = tid;
  feat := coalesce(st.features, '{}'::jsonb);
  return jsonb_build_object(
    'shop', jsonb_build_object('name', coalesce(nullif(cfg->>'brandName', ''), nullif(st.shop_name, ''), tn, 'Shop'), 'address', st.address, 'phone', coalesce(nullif(cfg->>'phone', ''), st.phone),
      'logoUrl', st.logo_url, 'returnDays', st.return_days),
    'config', cfg - 'payReq',
    'upi', case when coalesce((cfg->'pay'->>'upi')::boolean, true) and coalesce(feat->>'upiId', '') <> '' then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end,
    'cod', coalesce((cfg->'pay'->>'cod')::boolean, true),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
        'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g,
        'code', s.code, 'photos', coalesce(s.photos, '[]'::jsonb), 'colourPhotos', coalesce(s.colour_photos, '{}'::jsonb), 'photoUrl', s.photo_url,
        'collection', s.collection, 'price', s.price, 'mrp', s.mrp, 'badge', s.badge, 'createdAt', s.created_at,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'price', coalesce(v.price, s.price),
            'left', least(greatest(coalesce((select sum(m.qty) from sty_stock_moves m where m.variant_id = v.id and m.tenant_id = tid), 0), 0), 9)::int) order by v.colour, v.size)
          from sty_variants v where v.style_id = s.id and v.active), '[]'::jsonb)) order by s.created_at desc)
      from sty_styles s where s.tenant_id = tid and s.active), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.note,
        'styleIds', coalesce((select jsonb_agg(m.style_id) from sty_collection_styles m where m.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
      from sty_collections c where c.tenant_id = tid), '[]'::jsonb));
end $$;

-- p = { name, email, phone, address, address2, city, state, pin, country, note, payment: 'cod'|'upi', lines: [{variantId, qty}] }
create or replace function public_sty_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cfg jsonb; st sty_settings; l jsonb; v record; q int; have int; lines jsonb := '[]'::jsonb; sub numeric := 0; ship numeric := 0;
  pay text; num text; tok text; oid uuid; cust jsonb; ph text; feat jsonb; recent int; tn text; free_over numeric; fee numeric;
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
  num := 'W' || lpad(sty_next(tid, 'web_order')::text, 5, '0');
  tok := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  cust := jsonb_build_object('name', left(trim(p->>'name'), 80), 'email', left(coalesce(p->>'email', ''), 120), 'phone', ph,
    'address', left(trim(p->>'address'), 200), 'address2', left(coalesce(p->>'address2', ''), 120), 'city', left(trim(p->>'city'), 80),
    'state', left(coalesce(p->>'state', ''), 60), 'pin', left(trim(p->>'pin'), 12), 'country', left(coalesce(nullif(p->>'country', ''), 'India'), 60));
  insert into sty_web_orders (tenant_id, number, token, payment_method, payment_status, customer, lines, subtotal, shipping, total, note)
    values (tid, num, tok, pay, case when pay = 'cod' then 'cod' else 'pending' end, cust, lines, sub, ship, sub + ship, left(coalesce(p->>'note', ''), 400))
    returning id into oid;
  select name into tn from tenants where id = tid;
  begin
    insert into notifications (tenant_id, type, title, body) values (tid, 'store_order', 'New online order ' || num, (cust->>'name') || ' ordered ' || jsonb_array_length(lines) || ' item(s), Rs ' || (sub + ship));
  exception when others then null;
  end;
  return jsonb_build_object('number', num, 'token', tok, 'total', sub + ship, 'payment', pay,
    'upi', case when pay = 'upi' then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;

-- public: the order page. The token is the only access.
create or replace function public_sty_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sty_web_orders; st sty_settings; tn text; feat jsonb;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 20 then return null; end if;
  select * into o from sty_web_orders where token = lower(p_token);
  if not found then return null; end if;
  select * into st from sty_settings where tenant_id = o.tenant_id;
  select name into tn from tenants where id = o.tenant_id;
  feat := coalesce(st.features, '{}'::jsonb);
  return jsonb_build_object('number', o.number, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status, 'total', o.total,
    'subtotal', o.subtotal, 'shipping', o.shipping, 'lines', o.lines, 'createdAt', o.created_at,
    'customer', jsonb_build_object('name', o.customer->>'name', 'city', o.customer->>'city', 'pin', o.customer->>'pin'),
    'shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn), 'phone', st.phone),
    'upi', case when o.payment_method = 'upi' and o.payment_status in ('pending', 'submitted') then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;

-- public: the customer tells us the UPI reference after paying. Staff still check it in their bank app.
create or replace function public_sty_order_paid(p_token text, p_utr text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; u text := regexp_replace(coalesce(p_utr, ''), '[^A-Za-z0-9]', '', 'g');
begin
  select * into o from sty_web_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'ST002'; end if;
  if o.payment_method <> 'upi' or o.payment_status not in ('pending', 'submitted') then raise exception 'This order does not need a payment reference' using errcode = 'ST002'; end if;
  if length(u) < 6 or length(u) > 30 then raise exception 'Enter the UPI reference number (UTR) from your payment app' using errcode = 'ST002'; end if;
  update sty_web_orders set utr = u, payment_status = 'submitted', updated_at = now() where id = o.id;
  return public_sty_order(o.token);
end $$;

-- ---------- staff inbox ----------
create or replace function sty_web_orders_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; stt text := nullif(p->>'status', '');
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'token', o.token, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status,
      'utr', o.utr, 'customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping, 'total', o.total, 'note', o.note, 'staffNote', o.staff_note,
      'saleId', o.sale_id, 'createdAt', o.created_at) order by o.created_at desc)
    from (select * from sty_web_orders where tenant_id = tid and (stt is null or status = stt) order by created_at desc limit 200) o), '[]'::jsonb);
end $$;

create or replace function sty_web_orders_open() returns integer language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return (select count(*)::int from sty_web_orders where tenant_id = tid and status = 'new');
end $$;

create or replace function sty_web_order_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o sty_web_orders;
begin
  tid := sty_guard('sty_sell');
  select * into o from sty_web_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'order not found' using errcode = 'ST002'; end if;
  if p ? 'status' and (p->>'status') not in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled') then raise exception 'bad status' using errcode = 'ST002'; end if;
  if p ? 'paymentStatus' and (p->>'paymentStatus') not in ('pending', 'submitted', 'paid', 'cod') then raise exception 'bad payment status' using errcode = 'ST002'; end if;
  update sty_web_orders set status = coalesce(p->>'status', status), payment_status = coalesce(p->>'paymentStatus', payment_status),
    staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end,
    sale_id = coalesce(nullif(p->>'saleId', '')::uuid, sale_id), updated_at = now()
    where id = p_id;
  perform sty_audit_log(tid, 'web_order.update', o.number, p);
  return (select jsonb_build_object('id', id, 'number', number, 'status', status, 'paymentStatus', payment_status) from sty_web_orders where id = p_id);
end $$;
