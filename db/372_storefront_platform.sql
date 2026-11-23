-- =========================================================
-- AUZslab storefront platform (phase 1): a new, separate flagship product -- any local business builds its
-- own online store (catalog, collections, orders, checkout, a first-party theme). A store belongs to a
-- tenant exactly like AUZsStyle/Accounting/Payroll data does (db/001's own tenants table), gated by the
-- 'storefront' feature flag on tenant_settings, same switch mechanism as every other product. Own dedicated
-- tables (sfx_*), not the generic records engine -- the pattern CLAUDE.md asks for and Accounting/Payroll v2/
-- AUZsMob already follow. RLS is on with zero policies on every table below: nothing is ever reached through
-- the generic /db/:table route: every read and write goes through a SECURITY DEFINER function below, each
-- one starting with sfx_guard(perm), and every one of those functions must be registered in
-- server/src/data/rpc-registry.js or the API 404s it. New tables get an explicit grant here (999's own
-- comment explains why: 999_app_grants.sql regrants everything on every boot, but being explicit here too
-- matches the convention every other dedicated-table migration in this project already follows).
--
-- The public storefront itself reuses AUZsStyle's existing renderer (app/public/store.html + store/store.js,
-- generalized in this same change to fall back to public_sfx_store() when a tenant has no AUZsStyle store) --
-- see that file's own comment. So every public_sfx_* function below is written to the EXACT same shape/
-- contract as its public_sty_* twin (db/228/232/236/248), on purpose: same renderer, same calls, different
-- product's own tables underneath.
-- =========================================================

-- ---------- permissions (same shape as sty_perm/mob_perm before it) ----------
create function sfx_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'storefront', 'false') <> 'true' or coalesce(e->>'storefront', 'true') = 'false' then
    raise exception 'The AUZslab storefront is not enabled for this business' using errcode = 'SF001';
  end if;
  return tid;
end $$;

-- Keys: sfx_view (read catalog/collections/orders), sfx_manage (create/edit catalog, collections, store
-- settings, theme, payments, domains, and change an order's status). Owner always has both; a custom role's
-- own permissions jsonb (roles.permissions) is honoured exactly like every other module; a plain manager gets
-- both (small-business single-location phase 1 -- no finer split yet), any other staff role gets view only.
create function sfx_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid;
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid and tenant_id = tid;
    if perms is not null then return coalesce((perms->>k)::boolean, false); end if;
  end if;
  if r = 'manager' then return k in ('sfx_view', 'sfx_manage'); end if;
  return k = 'sfx_view';
end $$;

create function sfx_guard(k text default 'sfx_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; plan_status_ text; trial_ends_ timestamptz;
begin
  tid := sfx_tenant();
  -- Trial/payment gate (see sfx_stores' own comment): a business whose plan is paused/cancelled, or whose
  -- trial window has lapsed before the real "mark it paused" job has run yet (a lazy check, same idea as
  -- mob_day_locked's lazy date check elsewhere in this codebase), can still READ everything (sfx_view and
  -- the null-permission read calls like sfx_context) but not write -- "err toward refusing writes" is the
  -- owner's own call here. No sfx_stores row yet (the owner has never opened the store) is never refused.
  select plan_status, trial_ends_at into plan_status_, trial_ends_ from sfx_stores where tenant_id = tid;
  if plan_status_ in ('paused', 'cancelled') or (coalesce(plan_status_, 'trial') = 'trial' and trial_ends_ is not null and trial_ends_ < now()) then
    if k = 'sfx_manage' then
      raise exception 'Your storefront trial has ended. Add a payment method to keep editing and selling.' using errcode = 'SF010';
    end if;
  end if;
  if k is not null and not sfx_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create function sfx_perms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, sfx_perm(k)) from unnest(array['sfx_view', 'sfx_manage']) k
$$;

-- ---------- tables ----------
create table sfx_stores (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  theme text not null default 'minimal' check (theme in ('minimal', 'classic')),
  published boolean not null default false,
  config jsonb not null default '{}'::jsonb,  -- brandName, tagline, email, phone, currency, heroImages
  -- Trial/payment gate. A separate task owns the signup flow, the real pricing (product_prices-style,
  -- $0 until an admin sets it) and the job/flow that actually flips plan_status to 'paused' once
  -- trial_ends_at has passed with no payment, and back to 'active' once a plan is approved -- this
  -- migration only carries the fields and the guard check below so that work never needs to touch this
  -- table again. A row with no owner action yet still gets a real 3-day window the moment it's created
  -- (by sfx_store_save below, or by that other task's own onboarding insert).
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '3 days'),
  plan_status text not null default 'trial' check (plan_status in ('trial', 'active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table sfx_stores enable row level security;

-- a store's own Razorpay keys (the money goes straight to the store's own account -- same design as
-- AUZsStyle's sty_store_secrets, db/232). Never exposed by any function below except to confirm a payment.
create table sfx_store_secrets (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  rzp_key_id text not null,
  rzp_secret text not null,
  updated_at timestamptz not null default now()
);
alter table sfx_store_secrets enable row level security;

create table sfx_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  handle text,
  category text,
  description text,
  images jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  price numeric(12,2) not null default 0,
  compare_at numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sfx_products_tenant on sfx_products (tenant_id, status);
create unique index idx_sfx_products_handle on sfx_products (tenant_id, handle) where handle is not null;
alter table sfx_products enable row level security;

create table sfx_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references sfx_products(id) on delete cascade,
  label text not null default 'Default',
  sku text,
  barcode text,
  price numeric(12,2) not null default 0,
  stock int not null default 0 check (stock >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sfx_variants_product on sfx_variants (product_id, position);
create index idx_sfx_variants_tenant on sfx_variants (tenant_id);
alter table sfx_variants enable row level security;

create table sfx_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  handle text,
  description text,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_sfx_collections_handle on sfx_collections (tenant_id, handle) where handle is not null;
alter table sfx_collections enable row level security;

create table sfx_collection_products (
  collection_id uuid not null references sfx_collections(id) on delete cascade,
  product_id uuid not null references sfx_products(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, product_id)
);
alter table sfx_collection_products enable row level security;

-- One row per customer order. Same shape as AUZsStyle's sty_web_orders (db/228) on purpose (the shared public
-- renderer reads/writes both the same way), a fresh table and id sequence of its own (never sty_web_orders,
-- never acc_documents, never the generic records engine -- its own order model per the brief).
create table sfx_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null,
  token text not null unique,
  status text not null default 'new' check (status in ('new', 'confirmed', 'fulfilled', 'cancelled', 'returned')),
  payment_method text not null check (payment_method in ('cod', 'online')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed')),
  rzp_order_id text,
  rzp_payment_id text,
  customer jsonb not null,   -- name, email, phone, address, address2, city, state, pin, country
  lines jsonb not null,      -- snapshot: productId, variantId, name, label, price, qty, image
  subtotal numeric(12,2) not null,
  shipping numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  note text,
  tracking text,
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create index idx_sfx_orders_tenant on sfx_orders (tenant_id, status, created_at desc);
alter table sfx_orders enable row level security;

create table sfx_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references sfx_products(id) on delete cascade,
  order_token text,
  rating int not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now()
);
create index idx_sfx_reviews_product on sfx_reviews (product_id);
alter table sfx_reviews enable row level security;

create table sfx_stock_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  variant_id uuid not null references sfx_variants(id) on delete cascade,
  phone text not null,
  name text,
  created_at timestamptz not null default now()
);
alter table sfx_stock_alerts enable row level security;

-- Bring-your-own-domain, verification half only (phase 1 stretch goal -- actually serving the storefront on
-- the domain, the Caddy site-block side, is phase 2). token is the TXT value the owner is asked to publish;
-- hostname is globally unique (two tenants can never fight over the same external domain).
create table sfx_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hostname text not null unique,
  token text not null,
  status text not null default 'pending' check (status in ('pending', 'verified')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index idx_sfx_domains_tenant on sfx_domains (tenant_id);
alter table sfx_domains enable row level security;

grant select, insert, update, delete on sfx_stores, sfx_store_secrets, sfx_products, sfx_variants,
  sfx_collections, sfx_collection_products, sfx_orders, sfx_reviews, sfx_stock_alerts, sfx_domains to app;

-- ---------- owner/staff: store settings ----------
create function sfx_context() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard(null); st sfx_stores; tn text; tslug text;
begin
  select name, slug into tn, tslug from tenants where id = tid;
  select * into st from sfx_stores where tenant_id = tid;
  return jsonb_build_object(
    'tenant', jsonb_build_object('id', tid, 'name', tn, 'slug', tslug),
    'perms', sfx_perms(),
    'store', jsonb_build_object('theme', coalesce(st.theme, 'minimal'), 'published', coalesce(st.published, false), 'config', coalesce(st.config, '{}'::jsonb)),
    'razorpayConnected', exists(select 1 from sfx_store_secrets where tenant_id = tid),
    'counts', jsonb_build_object(
      'products', (select count(*) from sfx_products where tenant_id = tid),
      'activeProducts', (select count(*) from sfx_products where tenant_id = tid and status = 'active'),
      'collections', (select count(*) from sfx_collections where tenant_id = tid),
      'toFulfill', (select count(*) from sfx_orders where tenant_id = tid and status in ('new', 'confirmed')),
      'lowStock', (select count(*) from sfx_variants where tenant_id = tid and stock > 0 and stock < 5),
      'salesTotal', (select coalesce(sum(total), 0) from sfx_orders where tenant_id = tid and payment_status = 'paid')
    )
  );
end $$;

create function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages'];
  k text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'SF002'; end if;
  theme_ := coalesce(p->>'theme', (select theme from sfx_stores where tenant_id = tid), 'minimal');
  if theme_ not in ('minimal', 'classic') then raise exception 'Choose Minimal or Classic' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sfx_stores (tenant_id, theme, published, config) values (tid, theme_, coalesce((p->>'published')::boolean, (select published from sfx_stores where tenant_id = tid), false), cur)
    on conflict (tenant_id) do update set theme = excluded.theme, published = excluded.published, config = excluded.config, updated_at = now();
  return sfx_context();
end $$;

create function sfx_store_set_razorpay(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); kid text := trim(coalesce(p->>'keyId', '')); sec text := trim(coalesce(p->>'secret', ''));
begin
  if coalesce((p->>'clear')::boolean, false) then
    delete from sfx_store_secrets where tenant_id = tid;
    return jsonb_build_object('ok', true, 'connected', false);
  end if;
  if kid !~ '^rzp_(live|test)_[A-Za-z0-9]{8,}$' then raise exception 'Enter the Key ID from your Razorpay dashboard (it starts with rzp_live_ or rzp_test_)' using errcode = 'SF002'; end if;
  if length(sec) < 12 then raise exception 'Enter the Key Secret from your Razorpay dashboard' using errcode = 'SF002'; end if;
  insert into sfx_store_secrets (tenant_id, rzp_key_id, rzp_secret) values (tid, kid, sec)
    on conflict (tenant_id) do update set rzp_key_id = excluded.rzp_key_id, rzp_secret = excluded.rzp_secret, updated_at = now();
  return jsonb_build_object('ok', true, 'connected', true);
end $$;

-- ---------- owner/staff: catalog ----------
create function sfx_variant_json(v sfx_variants) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', v.id, 'label', v.label, 'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'stock', v.stock, 'position', v.position)
$$;

create function sfx_product_json(p sfx_products) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'handle', p.handle, 'category', p.category, 'description', p.description,
    'images', coalesce(p.images, '[]'::jsonb), 'status', p.status, 'price', p.price, 'compareAt', p.compare_at,
    'variants', coalesce((select jsonb_agg(sfx_variant_json(v) order by v.position, v.created_at) from sfx_variants v where v.product_id = p.id), '[]'::jsonb),
    'stock', coalesce((select sum(v.stock) from sfx_variants v where v.product_id = p.id), 0),
    'createdAt', p.created_at, 'updatedAt', p.updated_at)
$$;

create function sfx_product_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(sfx_product_json(p) order by p.created_at desc) from sfx_products p where p.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_product_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); p sfx_products;
begin
  select * into p from sfx_products where id = p_id and tenant_id = tid;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  return sfx_product_json(p);
end $$;

-- p = { name, category, description, status, images:[url], compareAt, variants:[{id?,label,sku,barcode,price,stock}] }.
-- A product with no explicit variants gets exactly one ("Default"), generated from price/stock at the top
-- of p if given, so the cart/checkout code (shared with AUZsStyle's renderer) always has a variant to sell.
create function sfx_product_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_products; name_ text := trim(coalesce(p->>'name', '')); handle_ text;
  vs jsonb; v jsonb; keep uuid[] := '{}'; vid uuid; status_ text := coalesce(p->>'status', 'draft');
begin
  if length(name_) < 1 or length(name_) > 160 then raise exception 'Enter a product title' using errcode = 'SF002'; end if;
  if status_ not in ('draft', 'active', 'archived') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  handle_ := nullif(regexp_replace(lower(coalesce(p->>'handle', name_)), '[^a-z0-9]+', '-', 'g'), '');
  handle_ := nullif(trim(both '-' from coalesce(handle_, '')), '');
  if p_id is not null then
    select * into row_ from sfx_products where id = p_id and tenant_id = tid;
    if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  end if;
  if handle_ is not null and exists(select 1 from sfx_products where tenant_id = tid and handle = handle_ and id is distinct from p_id) then
    handle_ := handle_ || '-' || substr(md5(random()::text), 1, 5);
  end if;
  if p_id is null then
    insert into sfx_products (tenant_id, name, handle, category, description, images, status, price, compare_at)
      values (tid, name_, handle_, nullif(p->>'category', ''), nullif(p->>'description', ''), coalesce(p->'images', '[]'::jsonb), status_,
        coalesce((p->>'price')::numeric, 0), nullif(p->>'compareAt', '')::numeric)
      returning * into row_;
  else
    update sfx_products set name = name_, handle = handle_, category = nullif(p->>'category', ''), description = nullif(p->>'description', ''),
      images = coalesce(p->'images', images), status = status_, price = coalesce((p->>'price')::numeric, price), compare_at = nullif(p->>'compareAt', '')::numeric,
      updated_at = now()
      where id = p_id and tenant_id = tid returning * into row_;
  end if;
  vs := coalesce(p->'variants', '[]'::jsonb);
  if jsonb_typeof(vs) <> 'array' or jsonb_array_length(vs) = 0 then
    vs := jsonb_build_array(jsonb_build_object('label', 'Default', 'sku', p->>'sku', 'price', coalesce(p->>'price', '0'), 'stock', coalesce(p->>'stock', '0')));
  end if;
  if jsonb_array_length(vs) > 100 then raise exception 'Too many variants on one product' using errcode = 'SF002'; end if;
  for v in select * from jsonb_array_elements(vs) loop
    if trim(coalesce(v->>'label', '')) = '' then raise exception 'Each variant needs a label' using errcode = 'SF002'; end if;
    if coalesce((v->>'price')::numeric, 0) < 0 or coalesce((v->>'stock')::int, 0) < 0 then raise exception 'Price and stock cannot be negative' using errcode = 'SF002'; end if;
    vid := nullif(v->>'id', '')::uuid;
    if vid is not null and exists(select 1 from sfx_variants where id = vid and product_id = row_.id) then
      update sfx_variants set label = v->>'label', sku = nullif(v->>'sku', ''), barcode = nullif(v->>'barcode', ''),
        price = coalesce((v->>'price')::numeric, 0), stock = coalesce((v->>'stock')::int, 0), updated_at = now() where id = vid;
      keep := keep || vid;
    else
      insert into sfx_variants (tenant_id, product_id, label, sku, barcode, price, stock, position)
        values (tid, row_.id, v->>'label', nullif(v->>'sku', ''), nullif(v->>'barcode', ''), coalesce((v->>'price')::numeric, 0), coalesce((v->>'stock')::int, 0), coalesce((v->>'position')::int, 0))
        returning id into vid;
      keep := keep || vid;
    end if;
  end loop;
  delete from sfx_variants where product_id = row_.id and not (id = any(keep));
  select price into row_.price from sfx_variants where product_id = row_.id order by position limit 1;
  if row_.price is not null then update sfx_products set price = row_.price where id = row_.id; end if;
  select * into row_ from sfx_products where id = row_.id;
  return sfx_product_json(row_);
end $$;

create function sfx_product_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  delete from sfx_products where id = p_id and tenant_id = tid;
end $$;

-- ---------- owner/staff: collections ----------
create function sfx_collection_json(c sfx_collections, with_products boolean default false) returns jsonb language plpgsql stable as $$
declare out_ jsonb;
begin
  out_ := jsonb_build_object('id', c.id, 'name', c.name, 'handle', c.handle, 'description', c.description, 'image', c.image,
    'productCount', (select count(*) from sfx_collection_products where collection_id = c.id));
  if with_products then
    out_ := out_ || jsonb_build_object('products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'status', p.status,
          'image', p.images->0, 'stock', (select coalesce(sum(v.stock), 0) from sfx_variants v where v.product_id = p.id)) order by cp.position)
      from sfx_collection_products cp join sfx_products p on p.id = cp.product_id where cp.collection_id = c.id), '[]'::jsonb));
  end if;
  return out_;
end $$;

create function sfx_collection_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(sfx_collection_json(c) order by c.created_at desc) from sfx_collections c where c.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_collection_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c sfx_collections;
begin
  select * into c from sfx_collections where id = p_id and tenant_id = tid;
  if not found then raise exception 'Collection not found' using errcode = 'SF003'; end if;
  return sfx_collection_json(c, true);
end $$;

-- p = { name, description, image, productIds:[uuid] }
create function sfx_collection_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); name_ text := trim(coalesce(p->>'name', '')); handle_ text; c sfx_collections; pid uuid; idx int := 0;
begin
  if length(name_) < 1 or length(name_) > 160 then raise exception 'Enter a collection title' using errcode = 'SF002'; end if;
  handle_ := nullif(trim(both '-' from regexp_replace(lower(name_), '[^a-z0-9]+', '-', 'g')), '');
  if handle_ is not null and exists(select 1 from sfx_collections where tenant_id = tid and handle = handle_ and id is distinct from p_id) then
    handle_ := handle_ || '-' || substr(md5(random()::text), 1, 5);
  end if;
  if p_id is null then
    insert into sfx_collections (tenant_id, name, handle, description, image) values (tid, name_, handle_, nullif(p->>'description', ''), nullif(p->>'image', '')) returning * into c;
  else
    update sfx_collections set name = name_, handle = handle_, description = nullif(p->>'description', ''), image = nullif(p->>'image', ''), updated_at = now()
      where id = p_id and tenant_id = tid returning * into c;
    if not found then raise exception 'Collection not found' using errcode = 'SF003'; end if;
  end if;
  delete from sfx_collection_products where collection_id = c.id;
  if jsonb_typeof(p->'productIds') = 'array' then
    for pid in select (jsonb_array_elements_text(p->'productIds'))::uuid loop
      if exists(select 1 from sfx_products where id = pid and tenant_id = tid) then
        insert into sfx_collection_products (collection_id, product_id, position) values (c.id, pid, idx) on conflict do nothing;
        idx := idx + 1;
      end if;
    end loop;
  end if;
  return sfx_collection_json(c, true);
end $$;

create function sfx_collection_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  delete from sfx_collections where id = p_id and tenant_id = tid;
end $$;

-- ---------- owner/staff: orders ----------
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'customerName', o.customer->>'name', 'total', o.total, 'createdAt', o.created_at) ||
    case when detail then jsonb_build_object('customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping,
      'note', o.note, 'tracking', o.tracking, 'timeline', o.timeline, 'token', o.token) else '{}'::jsonb end
$$;

create function sfx_order_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(sfx_order_json(o) order by o.created_at desc) from sfx_orders o where o.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_order_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); o sfx_orders;
begin
  select * into o from sfx_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  return sfx_order_json(o, true);
end $$;

create function sfx_order_timeline_add(o sfx_orders, label text) returns jsonb language sql immutable as $$
  select coalesce(o.timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('label', label, 'at', now()))
$$;

create function sfx_order_set_status(p_id uuid, p_status text, p_tracking text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders;
begin
  if p_status not in ('fulfilled', 'cancelled') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  select * into o from sfx_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status in ('fulfilled', 'cancelled', 'returned') then raise exception 'This order can no longer be changed' using errcode = 'SF002'; end if;
  update sfx_orders set status = p_status, tracking = coalesce(p_tracking, tracking),
    timeline = sfx_order_timeline_add(o, case when p_status = 'fulfilled' then 'Order fulfilled' else 'Order cancelled' end), updated_at = now()
    where id = p_id returning * into o;
  return sfx_order_json(o, true);
end $$;

create function sfx_order_note(p_id uuid, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders;
begin
  select * into o from sfx_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  update sfx_orders set note = left(coalesce(p_note, ''), 1500), timeline = sfx_order_timeline_add(o, 'Internal note updated'), updated_at = now()
    where id = p_id returning * into o;
  return sfx_order_json(o, true);
end $$;

-- ---------- owner/staff: bring-your-own-domain (verification only; see sites.js for the real DNS check and
-- the bare-bones status this gives the owner -- serving the storefront on the domain is phase 2) ----------
create function sfx_domain_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'hostname', hostname, 'token', token, 'status', status, 'createdAt', created_at) order by created_at desc)
    from sfx_domains where tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_domain_connect(p_hostname text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); host_ text := lower(trim(coalesce(p_hostname, ''))); row_ sfx_domains;
begin
  host_ := regexp_replace(host_, '\.$', '');
  if host_ !~ '^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then raise exception 'Enter a hostname such as example.com' using errcode = 'SF002'; end if;
  if exists(select 1 from sfx_domains where hostname = host_) then raise exception 'This domain is already connected to a store' using errcode = 'SF002'; end if;
  insert into sfx_domains (tenant_id, hostname, token) values (tid, host_, 'auzslab-' || gen_random_uuid()) returning * into row_;
  return jsonb_build_object('id', row_.id, 'hostname', row_.hostname, 'token', row_.token, 'status', row_.status, 'createdAt', row_.created_at);
end $$;

-- called only by server/src/routes/sites.js, after it has itself confirmed the TXT record over real public DNS
create function sfx_domain_verify_prepare(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_domains;
begin
  select * into row_ from sfx_domains where id = p_id and tenant_id = tid;
  if not found then raise exception 'Domain not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('hostname', row_.hostname, 'token', row_.token, 'status', row_.status);
end $$;

create function sfx_domain_mark_verified(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_domains;
begin
  update sfx_domains set status = 'verified', verified_at = now() where id = p_id and tenant_id = tid returning * into row_;
  if not found then raise exception 'Domain not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('id', row_.id, 'hostname', row_.hostname, 'status', row_.status);
end $$;

-- ---------- public storefront (same contract as public_sty_*; see app/public/store/store.js) ----------
create function sfx_public_tenant(p_slug text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  select id into tid from tenants where slug = lower(coalesce(p_slug, ''));
  if tid is null then return null; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'storefront', 'false') <> 'true' or coalesce(e->>'storefront', 'true') = 'false' then return null; end if;
  return tid;
end $$;

create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); st sfx_stores; tn text;
begin
  if tid is null then return null; end if;
  select * into st from sfx_stores where tenant_id = tid;
  select name into tn from tenants where id = tid;
  if coalesce(st.published, false) is not true then return jsonb_build_object('closed', true, 'name', coalesce(st.config->>'brandName', tn, 'Store')); end if;
  return jsonb_build_object(
    'shop', jsonb_build_object('name', coalesce(st.config->>'brandName', tn, 'Store'), 'phone', st.config->>'phone'),
    'config', jsonb_build_object('on', true, 'template', st.theme, 'brandName', coalesce(st.config->>'brandName', tn), 'tagline', st.config->>'tagline',
      'heroImages', coalesce(st.config->'heroImages', '[]'::jsonb), 'minimalPages', '[]'::jsonb, 'stores', '[]'::jsonb),
    'upi', null, 'cod', true,
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'handle', p.handle, 'category', p.category, 'description', p.description,
        'photos', coalesce(p.images, '[]'::jsonb), 'photoUrl', p.images->>0, 'price', p.price, 'mrp', p.compare_at, 'createdAt', p.created_at,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.label, 'colour', 'Original', 'price', v.price, 'left', least(v.stock, 9)) order by v.position)
          from sfx_variants v where v.product_id = p.id and v.stock > 0), '[]'::jsonb)) order by p.created_at desc)
      from sfx_products p where p.tenant_id = tid and p.status = 'active'), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.description,
        'styleIds', coalesce((select jsonb_agg(cp.product_id) from sfx_collection_products cp where cp.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
      from sfx_collections c where c.tenant_id = tid), '[]'::jsonb));
end $$;

create function public_sfx_reviews(p_slug text, p_style uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); c int; avg_ numeric;
begin
  if tid is null then return null; end if;
  select count(*), avg(rating) into c, avg_ from sfx_reviews where tenant_id = tid and product_id = p_style;
  return jsonb_build_object('count', coalesce(c, 0), 'average', round(coalesce(avg_, 0), 1));
end $$;

create function public_sfx_review_submit(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders; pid uuid := nullif(p->>'styleId', '')::uuid; rating int := (p->>'rating')::int;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if rating is null or rating < 1 or rating > 5 then raise exception 'Choose 1 to 5 stars' using errcode = 'SF002'; end if;
  if not exists(select 1 from sfx_products where id = pid and tenant_id = o.tenant_id) then raise exception 'Product not found' using errcode = 'SF003'; end if;
  insert into sfx_reviews (tenant_id, product_id, order_token, rating, body) values (o.tenant_id, pid, o.token, rating, left(coalesce(p->>'body', ''), 2000));
  return jsonb_build_object('ok', true);
end $$;

create function public_sfx_notify_me(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); vid uuid := nullif(p->>'variantId', '')::uuid; ph text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
begin
  if tid is null then raise exception 'This store is not available' using errcode = 'SF001'; end if;
  if length(ph) < 8 then raise exception 'Please enter a valid phone number' using errcode = 'SF002'; end if;
  if not exists(select 1 from sfx_variants where id = vid and tenant_id = tid) then raise exception 'Item not found' using errcode = 'SF003'; end if;
  insert into sfx_stock_alerts (tenant_id, variant_id, phone, name) values (tid, vid, ph, left(coalesce(p->>'name', ''), 80));
  return jsonb_build_object('ok', true);
end $$;

-- Coupons are not part of phase 1 -- this answers honestly rather than silently doing nothing, which is what
-- the shared renderer's coupon box calls either way.
create function public_sfx_coupon_check(p_slug text, p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('ok', false, 'msg', 'Coupon codes are not available for this store yet.')
$$;

-- Lightweight storefront analytics are not part of phase 1 -- this succeeds (so the shared renderer's
-- periodic flush never errors) without fabricating or storing anything.
create function public_sfx_track(p_slug text, p jsonb) returns void language sql stable as $$
  select null
$$;

-- p = { name, email, phone, address, address2, city, state, pin, country, note, payment: 'cod'|'online', lines: [{variantId, qty}] }
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); st sfx_stores; l jsonb; q int; lines jsonb := '[]'::jsonb; sub numeric := 0;
  pay text; num text; tok text; oid uuid; cust jsonb; ph text; recent int;
  vid uuid; vproduct uuid; vlabel text; vprice numeric; vstock int; vname text; vimage text;
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
    if q > vstock then raise exception '%s has only %s left', vname, vstock using errcode = 'SF002'; end if;
    lines := lines || jsonb_build_array(jsonb_build_object('productId', vproduct, 'variantId', vid, 'name', vname, 'label', vlabel, 'price', vprice, 'qty', q, 'image', vimage));
    sub := sub + vprice * q;
    update sfx_variants set stock = stock - q where id = vid;
  end loop;
  select count(*) into recent from sfx_orders where tenant_id = tid and customer->>'phone' = ph and created_at > now() - interval '10 minutes';
  if recent >= 5 then raise exception 'Too many orders just now. Please wait a few minutes and try again.' using errcode = 'SF002'; end if;
  select 'SF' || to_char(now(), 'YYMMDD') || '-' || lpad((coalesce(max(substring(number from '\d+$')::int), 0) + 1)::text, 4, '0') into num
    from sfx_orders where tenant_id = tid and number like 'SF' || to_char(now(), 'YYMMDD') || '-%';
  tok := encode(gen_random_bytes(16), 'hex');
  cust := jsonb_build_object('name', trim(p->>'name'), 'email', nullif(p->>'email', ''), 'phone', ph, 'address', p->>'address', 'address2', p->>'address2',
    'city', p->>'city', 'state', p->>'state', 'pin', p->>'pin', 'country', coalesce(p->>'country', 'India'));
  insert into sfx_orders (tenant_id, number, token, payment_method, customer, lines, subtotal, shipping, total, note, timeline)
    values (tid, num, tok, pay, cust, lines, sub, 0, sub, nullif(p->>'note', ''), jsonb_build_array(jsonb_build_object('label', 'Order placed', 'at', now())))
    returning id into oid;
  begin
    insert into notifications (tenant_id, type, title, body) values (tid, 'sfx_order', 'New order ' || num, trim(p->>'name') || ' placed an order for ' || sub::text || '.');
  exception when others then null; end;
  return jsonb_build_object('token', tok, 'number', num, 'total', sub, 'payment', pay);
end $$;

create function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then return null; end if;
  return jsonb_build_object('number', o.number, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'lines', o.lines, 'note', o.note, 'tracking', o.tracking, 'createdAt', o.created_at);
end $$;

-- A cash-on-delivery order has no online capture step; "I have paid" on a COD order just records that the
-- customer says they've paid, same honesty level as AUZsStyle's UPI manual-reference flow -- it never marks
-- an ONLINE order paid (that only ever happens from the signed webhook-equivalent confirm, see sfx_online_confirm).
create function public_sfx_order_paid(p_token text, p_utr text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.payment_method <> 'cod' or o.payment_status = 'paid' then return public_sfx_order(o.token); end if;
  update sfx_orders set note = coalesce(note, '') || E'\nCustomer payment reference: ' || left(coalesce(p_utr, ''), 60), updated_at = now() where id = o.id;
  return public_sfx_order(o.token);
end $$;

create function public_sfx_order_find(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); o sfx_orders; ph text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
begin
  if tid is null then raise exception 'This store is not available' using errcode = 'SF001'; end if;
  select * into o from sfx_orders where tenant_id = tid and upper(number) = upper(trim(coalesce(p->>'number', ''))) and right(customer->>'phone', 8) = right(ph, 8);
  if not found then raise exception 'We could not find that order' using errcode = 'SF003'; end if;
  return jsonb_build_object('token', o.token);
end $$;

create function public_sfx_return_request(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status <> 'fulfilled' then raise exception 'This order is not eligible for a return yet' using errcode = 'SF002'; end if;
  update sfx_orders set timeline = sfx_order_timeline_add(o, 'Return requested: ' || left(coalesce(p->>'kind', 'return'), 20) || ' - ' || left(coalesce(p->>'reason', ''), 200)), updated_at = now() where id = o.id;
  begin
    insert into notifications (tenant_id, type, title, body) values (o.tenant_id, 'sfx_return', 'Return requested: ' || o.number, left(coalesce(p->>'reason', ''), 200));
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- server-only (not in the RPC registry -- called by the API with the store's own Razorpay keys,
-- same shape as sty_online_start/sty_online_set_order/sty_online_confirm, db/232) ----------
create function sfx_online_start(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders; k sfx_store_secrets;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found or o.payment_method <> 'online' or o.payment_status = 'paid' or o.status = 'cancelled' then raise exception 'This order cannot be paid online' using errcode = 'SF002'; end if;
  select * into k from sfx_store_secrets where tenant_id = o.tenant_id;
  if k.tenant_id is null then raise exception 'Card payment is not set up for this store' using errcode = 'SF002'; end if;
  return jsonb_build_object('number', o.number, 'total', o.total, 'key', k.rzp_key_id, 'secret', k.rzp_secret, 'name', o.customer->>'name', 'phone', o.customer->>'phone', 'email', o.customer->>'email');
end $$;

create function sfx_online_set_order(p_token text, p_order text) returns void language sql security definer set search_path = public as $$
  update sfx_orders set rzp_order_id = p_order where token = lower(coalesce(p_token, '')) and payment_method = 'online' and payment_status <> 'paid';
$$;

create function sfx_online_confirm(p_token text, p_rzp_order text, p_payment text, p_sig text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders; k sfx_store_secrets; want text;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found or o.payment_method <> 'online' then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.payment_status = 'paid' then return public_sfx_order(o.token); end if;
  select * into k from sfx_store_secrets where tenant_id = o.tenant_id;
  if k.tenant_id is null or o.rzp_order_id is null or o.rzp_order_id <> p_rzp_order then raise exception 'Payment could not be verified' using errcode = 'SF002'; end if;
  want := encode(hmac((p_rzp_order || '|' || p_payment)::bytea, convert_to(k.rzp_secret, 'UTF8'), 'sha256'), 'hex');
  if want <> lower(coalesce(p_sig, '')) then raise exception 'Payment could not be verified' using errcode = 'SF002'; end if;
  update sfx_orders set payment_status = 'paid', status = 'confirmed', rzp_payment_id = left(p_payment, 60),
    timeline = sfx_order_timeline_add(o, 'Paid online'), updated_at = now() where id = o.id;
  begin
    insert into notifications (tenant_id, type, title, body) values (o.tenant_id, 'sfx_order_paid', 'Order ' || o.number || ' paid online', 'Paid Rs ' || round(o.total) || '.');
  exception when others then null; end;
  return public_sfx_order(o.token);
end $$;

-- ---------- site_access(): a storefront-platform shop whose store is published gets the same public
-- "store" kind AUZsStyle already gets (db/303) -- this is the ONLY reason the shared wildcard address and
-- store.html/store.js need no further change to serve the new product's own tenants. ----------
create or replace function site_access(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; feat jsonb; en jsonb; kind text := 'none'; app text := 'app';
begin
  select * into t from tenants where slug = lower(coalesce(p_slug, ''));
  if not found or t.status in ('suspended', 'cancelled') then return jsonb_build_object('exists', false); end if;
  select coalesce(features, '{}'::jsonb), coalesce(enabled_features, '{}'::jsonb) into feat, en from tenant_settings where tenant_id = t.id;
  feat := coalesce(feat, '{}'::jsonb); en := coalesce(en, '{}'::jsonb);
  if t.build_type = 'custom' then kind := 'custom';
  elsif t.niche = 'salon' or (feat->>'salon' = 'true' and coalesce(en->>'salon', '') <> 'false') then kind := 'salon';
  elsif feat->>'style' = 'true' and coalesce(en->>'style', '') <> 'false' and tenant_cap(t.id, 'online_store')
        and coalesce((select config->>'on' from sty_store where tenant_id = t.id), 'false') = 'true' then kind := 'store';
  elsif feat->>'storefront' = 'true' and coalesce(en->>'storefront', '') <> 'false'
        and coalesce((select published::text from sfx_stores where tenant_id = t.id), 'false') = 'true' then kind := 'store';
  elsif feat->>'self_order' = 'true' and coalesce(en->>'self_order', '') <> 'false' and tenant_cap(t.id, 'online_store') then kind := 'qr';
  end if;
  app := case
    when feat->>'pos' = 'true' then 'auzspos' when feat->>'style' = 'true' then 'auzsstyle' when feat->>'mobile' = 'true' then 'auzsmob'
    when feat->>'accounting' = 'true' then 'auzsledger' when feat->>'payroll' = 'true' then 'auzspay' when feat->>'scan' = 'true' then 'auzsscan'
    when feat->>'finance' = 'true' then 'auzsfinance' when feat->>'storefront' = 'true' then 'auzsshop' else 'app' end;
  return jsonb_build_object('exists', true, 'kind', kind, 'app', app,
    'demo', coalesce(t.is_demo, false),
    'style', (feat->>'style' = 'true' and coalesce(en->>'style', '') <> 'false'));
end $$;
-- Rollback: drop every function/table starting sfx_ above (in dependency order: public_sfx_*, sfx_online_*,
-- sfx_order_*, sfx_collection_*, sfx_product_*, sfx_store_*, sfx_domain_*, sfx_guard/perm/tenant, then the
-- tables), and re-run db/303_site_access_demo_style.sql to restore site_access() without the storefront branch.
