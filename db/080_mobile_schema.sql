-- =========================================================
-- AUZsMob: mobile phone retail & repair shops. A genuinely new product, built like Payroll v2 and
-- Accounting (own real tables, prefix mob_, every write through a SECURITY DEFINER function that checks
-- entitlement + role first -- NOT the generic `records` engine). Feature key: 'mobile'.
--
-- Core discipline, from the owner's own spec:
--  - Offline-first: every phone keeps its own copy; entries (purchases, sales, repair steps, stock
--    movements, due payments) are APPEND-ONLY with a CLIENT-GENERATED uuid id, inserted idempotently
--    (`on conflict (id) do nothing`) so resyncing never double-counts and two phones never clobber each
--    other. Corrections are a new entry or an owner edit, always logged to mob_audit (who/when/before/after).
--  - Stock is a SUM of mob_stock_movements, never a mutable counter -- two offline phones moving the same
--    item's stock can never lose an update, they just both append.
--  - Staff isolation is enforced here, in SQL, not just hidden in the UI: a plain staff member's RLS
--    policy on every entry table restricts them to rows where staff_id = app_uid(); owner/manager (or a
--    custom role with mob_reports) see every row. mob_sync_pull (081) applies the same scoping to what a
--    staff phone ever downloads in the first place -- isolation that only hid the UI would still leak
--    through a direct RPC call or a cached sync payload.
-- =========================================================

-- ---------- niche preset ----------
alter table tenants drop constraint if exists tenants_niche_check;
alter table tenants add constraint tenants_niche_check check (niche in ('cafe', 'salon', 'gym', 'retail', 'general', 'mobile'));

insert into niche_presets (niche, default_features, default_labels, default_business_rules) values
  ('mobile', '{"mobile": true}'::jsonb, '{}'::jsonb, '{"currency": "INR"}'::jsonb)
on conflict (niche) do nothing;

-- ---------- settings ----------
create table mob_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  shop_name text,
  address text,
  phone text,
  logo_url text,
  bill_footer text,
  bill_prefix text not null default 'BILL',
  language text not null default 'en' check (language in ('en', 'hi')),
  -- the one owner switch the spec calls for: staff see stock qty and selling price always, but their own
  -- purchase rate / profit only when this is on. Default off (safer default: owner opts staff in).
  staff_see_purchase_rates boolean not null default false,
  day_close_date date, -- entries dated on/before this are locked (see mob_guard in 081)
  updated_at timestamptz not null default now()
);
alter table mob_settings enable row level security; -- no policies -- only mob_* functions below ever touch this

create table mob_staff_prefs (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'hi')),
  primary key (tenant_id, user_id)
);
alter table mob_staff_prefs enable row level security;

-- ---------- master data: items, serialized units, vendors, customers. Client-generated id, editable with
-- optimistic concurrency (same shape as the platform's own push_record: compare updated_at, reject a stale
-- write instead of silently overwriting it) -- these aren't pure "entries" (section 2 of the spec calls out
-- sales/purchases/repair-steps/stock-movements specifically), a price or a name can genuinely be corrected. ----------
create table mob_items (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('phone_new', 'phone_used', 'accessory', 'watch', 'earbuds', 'headphone', 'cable', 'charger', 'other')),
  serialized boolean not null default false, -- true: stock lives in mob_item_units (one row per IMEI), not a quantity here
  selling_price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0, -- advisory "last/suggested rate" only -- real profit always uses the
                                                -- rate actually recorded on the purchase/unit/sale line, never this
  low_stock_at numeric(12,2) not null default 0,
  active boolean not null default true,
  created_by uuid not null,
  updated_at timestamptz not null default now()
);
create index idx_mob_items_tenant on mob_items (tenant_id);
alter table mob_items enable row level security;

create table mob_item_units ( -- one row per physical serialized phone -- new stock received serialized, or bought second-hand
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null references mob_items(id),
  imei text,
  imei2 text,
  source text not null default 'new' check (source in ('new', 'secondhand')),
  condition text, -- grade, mainly for second-hand
  -- second-hand intake details (section 3d): who it was bought from, proof, what came with it
  seller_name text, seller_phone text, id_proof_url text, accessories_included text,
  cost_price numeric(12,2) not null default 0,
  selling_price numeric(12,2), -- overrides mob_items.selling_price when set
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'returned')),
  created_by uuid not null,
  updated_at timestamptz not null default now()
);
-- a tenant-scoped IMEI can't collide with another unit this shop already has in stock or has sold
-- (duplicate-IMEI warning, section 3d) -- 'returned' is excluded so a returned-then-rebought phone works
create unique index idx_mob_unit_imei1 on mob_item_units (tenant_id, imei) where imei is not null and status <> 'returned';
create unique index idx_mob_unit_imei2 on mob_item_units (tenant_id, imei2) where imei2 is not null and status <> 'returned';
create index idx_mob_units_tenant on mob_item_units (tenant_id);
create index idx_mob_units_item on mob_item_units (item_id);
alter table mob_item_units enable row level security;

create table mob_vendors (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  created_by uuid not null,
  updated_at timestamptz not null default now()
);
create unique index idx_mob_vendor_name on mob_vendors (tenant_id, lower(name));
alter table mob_vendors enable row level security;

create table mob_customers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  created_by uuid not null,
  updated_at timestamptz not null default now()
);
create index idx_mob_customers_tenant on mob_customers (tenant_id);
alter table mob_customers enable row level security;

-- ---------- entries: append-only, client-generated id, never updated after the fact (section 2) ----------
create table mob_purchases (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  vendor_id uuid references mob_vendors(id),
  item_id uuid references mob_items(id),
  unit_id uuid references mob_item_units(id), -- set when this purchase brought in a serialized unit
  qty numeric(12,2) not null default 1,
  rate numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  photo_url text,
  repair_id uuid, -- optional: a part bought specifically for one repair job (section 3a)
  note text,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_purchases_tenant on mob_purchases (tenant_id, created_at);
create index idx_mob_purchases_staff on mob_purchases (tenant_id, staff_id);
alter table mob_purchases enable row level security;

create table mob_sales (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  bill_no text,
  customer_id uuid references mob_customers(id),
  customer_name text,
  customer_phone text,
  items jsonb not null default '[]'::jsonb, -- [{itemId, unitId, name, qty, price, costPrice}] -- costPrice is a
                                             -- snapshot at sale time, so profit reports never drift if an item's
                                             -- price changes later
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  payment_mode text not null default 'cash' check (payment_mode in ('cash', 'upi', 'card', 'credit')),
  voided boolean not null default false,
  void_reason text,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_sales_tenant on mob_sales (tenant_id, created_at);
create index idx_mob_sales_staff on mob_sales (tenant_id, staff_id);
alter table mob_sales enable row level security;

create table mob_repairs ( -- the job card itself: opened once, then only ever read -- status/parts/payments
                           -- are separate append-only events in mob_repair_events below
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_name text,
  customer_phone text,
  device_model text,
  imei text,
  problem text,
  advance numeric(12,2) not null default 0,
  estimate numeric(12,2),
  warranty_days int not null default 0,
  staff_id uuid not null, -- who opened the job
  created_at timestamptz not null default now()
);
create index idx_mob_repairs_tenant on mob_repairs (tenant_id, created_at);
create index idx_mob_repairs_staff on mob_repairs (tenant_id, staff_id);
alter table mob_repairs enable row level security;

create table mob_repair_events ( -- append-only: a status change, a part consumed, a payment taken, a note
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  repair_id uuid not null references mob_repairs(id),
  type text not null check (type in ('status', 'part', 'payment', 'note')),
  status text check (status in ('received', 'in_repair', 'ready', 'delivered', 'cancelled')), -- type='status'
  item_id uuid references mob_items(id), qty numeric(12,2), cost numeric(12,2),              -- type='part'
  amount numeric(12,2), method text,                                                          -- type='payment'
  note text,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_repair_events_repair on mob_repair_events (repair_id, created_at);
create index idx_mob_repair_events_tenant on mob_repair_events (tenant_id);
alter table mob_repair_events enable row level security;

create table mob_stock_movements ( -- the ledger: an item's/unit's stock is always sum(qty) from here, never
                                    -- a counter column, so two phones moving the same item's stock offline
                                    -- can never lose an update (section 6)
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid references mob_items(id),
  unit_id uuid references mob_item_units(id),
  qty numeric(12,2) not null, -- signed: + in, - out
  type text not null check (type in ('purchase', 'sale', 'repair_part', 'void_sale', 'adjustment', 'secondhand_intake')),
  ref_id uuid, -- the purchase/sale/repair_event/adjustment id that caused this movement
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_stock_mv_item on mob_stock_movements (tenant_id, item_id);
create index idx_mob_stock_mv_tenant on mob_stock_movements (tenant_id, created_at);
alter table mob_stock_movements enable row level security;

create table mob_payments ( -- settling a due: a customer paying down a sale's balance, or the shop paying a vendor
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('customer_due', 'vendor_due')),
  sale_id uuid references mob_sales(id),
  vendor_id uuid references mob_vendors(id),
  amount numeric(12,2) not null,
  method text not null default 'cash',
  note text,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_payments_tenant on mob_payments (tenant_id, created_at);
alter table mob_payments enable row level security;

create table mob_audit ( -- immutable: who, when, before, after -- every correction (void, owner edit, stock
                          -- adjustment) writes here and nothing here is ever updated or deleted
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_mob_audit_tenant on mob_audit (tenant_id, created_at);
alter table mob_audit enable row level security;

-- No table above is in the server's generic /db/:table allow-list and none gets a GRANT in 999_app_grants.sql
-- beyond RLS being on with zero policies -- exactly Accounting's pattern. Every read and write goes through a
-- mob_* SECURITY DEFINER function (081_mobile_engine.sql), which is what actually re-checks the 'mobile'
-- entitlement and the caller's role/permission before touching a row.
