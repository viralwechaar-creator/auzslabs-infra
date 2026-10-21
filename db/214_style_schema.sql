-- =========================================================
-- AUZsStyle: clothing and footwear shops. Built like AUZsMob / Payroll / Accounting: its own real tables (prefix sty_),
-- every write through a SECURITY DEFINER function that checks entitlement + role first, NOT the generic `records`
-- engine. Feature key: 'style'.
--
-- Ideas that shape the schema:
--  - A STYLE ("Blue Slim Shirt") owns many VARIANTS (colour x size). Stock, barcodes and every sale line are per variant.
--  - Stock is the SUM of sty_stock_moves (append-only), never a counter, per branch. A count correction is a new move.
--  - Sales lines keep a snapshot (style, category, size, colour, price, cost) so analytics never change when a style
--    is renamed or repriced later.
--  - Sales / purchases / returns carry a client-generated uuid so a retried offline request never double-posts.
-- All tables: RLS on, no policies, nothing granted: only the sty_* functions touch them.
-- =========================================================

create table sty_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  shop_name text, address text, phone text, gstin text, logo_url text, bill_footer text,
  bill_prefix text not null default 'AS',
  language text not null default 'en' check (language in ('en', 'hi')),
  currency text not null default 'INR',
  allow_negative_stock boolean not null default false,
  max_discount_pct numeric(5,2) not null default 20,        -- above this a plain staffer needs a manager
  return_days integer not null default 30,                  -- returns after this many days need a manager
  loyalty_earn_pct numeric(5,2) not null default 1,         -- points earned = bill total x this % / 100
  loyalty_point_value numeric(8,2) not null default 1,      -- rupees one point is worth when redeeming
  round_off boolean not null default true,
  default_tax_pct numeric(5,2) not null default 5,
  tax_slabs jsonb not null default '[]'::jsonb,             -- e.g. [{"upto":2500,"rate":5},{"rate":18}], checked by the accountant
  price_includes_tax boolean not null default true,
  lead_days integer not null default 7,                     -- supplier lead time used by reorder suggestions
  cover_days integer not null default 21,                   -- how many days of sales a reorder should cover
  slow_days integer not null default 60,                    -- no sale for this long = slow stock
  require_customer_phone boolean not null default false,
  staff_see_cost boolean not null default false,
  day_close_date date,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table sty_settings enable row level security;

create table sty_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'shop' check (kind in ('shop', 'warehouse')),
  address text,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index sty_branches_t on sty_branches(tenant_id);
alter table sty_branches enable row level security;

create table sty_counters (
  tenant_id uuid not null references tenants(id) on delete cascade,
  k text not null,
  n bigint not null default 0,
  primary key (tenant_id, k)
);
alter table sty_counters enable row level security;

create table sty_styles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text not null default 'Clothing',
  subcategory text,
  brand text, season text, gender text,
  hsn text,
  tax_pct numeric(5,2),                                     -- null = work it out from the settings (slabs or default)
  cost numeric(12,2) not null default 0,                    -- suggested cost; real profit uses the variant's average cost
  price numeric(12,2) not null default 0,
  mrp numeric(12,2) not null default 0,
  notes text, photo_url text,
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index sty_styles_t on sty_styles(tenant_id, active);
alter table sty_styles enable row level security;

create table sty_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  style_id uuid not null references sty_styles(id) on delete cascade,
  colour text not null default '',
  size text not null default '',
  barcode text not null,
  sku text,
  cost numeric(12,2) not null default 0,                    -- weighted average cost, moved by purchases
  price numeric(12,2),                                      -- null = the style's price
  reorder_at integer not null default 2,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, barcode),
  unique (tenant_id, style_id, colour, size)
);
create index sty_variants_style on sty_variants(style_id);
alter table sty_variants enable row level security;

create table sty_stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references sty_branches(id),
  variant_id uuid not null references sty_variants(id),
  qty integer not null,                                     -- change in saleable stock (+ in, - out)
  dmg integer not null default 0,                           -- change in damaged (held out of sale) stock
  kind text not null check (kind in ('opening', 'purchase', 'sale', 'return', 'exchange_in', 'adjust', 'damage', 'lost',
                                      'transfer_out', 'transfer_in', 'void', 'count')),
  ref_type text, ref_id uuid,
  unit_cost numeric(12,2),
  note text,
  staff_id uuid,
  at timestamptz not null default now()
);
create index sty_moves_variant on sty_stock_moves(tenant_id, variant_id, branch_id);
create index sty_moves_at on sty_stock_moves(tenant_id, at);
alter table sty_stock_moves enable row level security;

create table sty_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, contact text, phone text, gstin text, category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index sty_suppliers_t on sty_suppliers(tenant_id);
alter table sty_suppliers enable row level security;

create table sty_purchases (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid references sty_suppliers(id),
  branch_id uuid not null references sty_branches(id),
  invoice_no text,
  at timestamptz not null default now(),
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'part', 'paid')),
  note text, staff_id uuid,
  created_at timestamptz not null default now()
);
create index sty_purchases_t on sty_purchases(tenant_id, at);
alter table sty_purchases enable row level security;

create table sty_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  purchase_id uuid not null references sty_purchases(id) on delete cascade,
  variant_id uuid not null references sty_variants(id),
  qty integer not null check (qty > 0),
  unit_cost numeric(12,2) not null default 0
);
create index sty_plines_p on sty_purchase_lines(purchase_id);
alter table sty_purchase_lines enable row level security;

create table sty_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null references sty_suppliers(id),
  purchase_id uuid references sty_purchases(id),
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'cash',
  note text, staff_id uuid,
  at timestamptz not null default now()
);
create index sty_spay_s on sty_supplier_payments(tenant_id, supplier_id);
alter table sty_supplier_payments enable row level security;

create table sty_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, phone text,
  usual_size text, birthday date, anniversary date, notes text,
  points integer not null default 0,
  credit numeric(12,2) not null default 0,                  -- store credit from returns
  created_at timestamptz not null default now()
);
create unique index sty_customers_phone on sty_customers(tenant_id, phone) where phone is not null and phone <> '';
create index sty_customers_t on sty_customers(tenant_id);
alter table sty_customers enable row level security;

create table sty_sales (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  seq bigint not null,
  number text not null,
  branch_id uuid not null references sty_branches(id),
  customer_id uuid references sty_customers(id),
  staff_id uuid,
  at timestamptz not null default now(),
  subtotal numeric(14,2) not null default 0,               -- sum of price x qty before any discount
  discount numeric(14,2) not null default 0,               -- total discount (lines + bill)
  tax numeric(14,2) not null default 0,
  rounding numeric(6,2) not null default 0,
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  status text not null default 'paid' check (status in ('paid', 'due', 'void')),
  payments jsonb not null default '[]'::jsonb,
  points_earned integer not null default 0,
  points_used integer not null default 0,
  note text, void_reason text, voided_at timestamptz, voided_by uuid,
  offline boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, seq)
);
create index sty_sales_t on sty_sales(tenant_id, at);
create index sty_sales_cust on sty_sales(tenant_id, customer_id);
alter table sty_sales enable row level security;

create table sty_sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_id uuid not null references sty_sales(id) on delete cascade,
  variant_id uuid not null references sty_variants(id),
  style_id uuid not null,
  style_name text not null, category text, brand text, colour text, size text, barcode text,
  qty integer not null check (qty > 0),
  mrp numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,                  -- unit price before discount
  disc numeric(12,2) not null default 0,                   -- total discount on this line (line + share of bill discount)
  tax_pct numeric(5,2) not null default 0,
  tax numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,                    -- what the customer paid for this line, tax included
  cost numeric(12,2) not null default 0,                   -- unit cost snapshot
  returned integer not null default 0
);
create index sty_slines_sale on sty_sale_lines(sale_id);
create index sty_slines_variant on sty_sale_lines(tenant_id, variant_id);
alter table sty_sale_lines enable row level security;

create table sty_returns (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_id uuid not null references sty_sales(id),
  branch_id uuid not null references sty_branches(id),
  customer_id uuid references sty_customers(id),
  staff_id uuid,
  at timestamptz not null default now(),
  mode text not null check (mode in ('cash', 'upi', 'card', 'credit_note', 'exchange')),
  reason text,
  refund numeric(14,2) not null default 0,
  exchange_sale_id uuid references sty_sales(id),
  created_at timestamptz not null default now()
);
create index sty_returns_t on sty_returns(tenant_id, at);
alter table sty_returns enable row level security;

create table sty_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  return_id uuid not null references sty_returns(id) on delete cascade,
  sale_line_id uuid not null references sty_sale_lines(id),
  variant_id uuid not null references sty_variants(id),
  qty integer not null check (qty > 0),
  amount numeric(12,2) not null default 0,
  damaged boolean not null default false
);
create index sty_rlines_r on sty_return_lines(return_id);
alter table sty_return_lines enable row level security;

create table sty_transfers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null,
  from_branch uuid not null references sty_branches(id),
  to_branch uuid not null references sty_branches(id),
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  note text, created_by uuid, received_by uuid,
  at timestamptz not null default now(), received_at timestamptz
);
create index sty_transfers_t on sty_transfers(tenant_id, at);
alter table sty_transfers enable row level security;

create table sty_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  transfer_id uuid not null references sty_transfers(id) on delete cascade,
  variant_id uuid not null references sty_variants(id),
  qty integer not null check (qty > 0)
);
create index sty_tlines_t on sty_transfer_lines(transfer_id);
alter table sty_transfer_lines enable row level security;

create table sty_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references sty_branches(id),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  opening_cash numeric(12,2) not null default 0,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  note text
);
create index sty_shifts_t on sty_shifts(tenant_id, started_at);
alter table sty_shifts enable row level security;

create table sty_targets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  month date not null,                                      -- first day of the month
  target numeric(14,2) not null default 0,
  commission_pct numeric(5,2) not null default 0,
  primary key (tenant_id, user_id, month)
);
alter table sty_targets enable row level security;

create table sty_holds (                                    -- trial-room / bill-on-hold
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references sty_branches(id),
  label text, staff_id uuid,
  lines jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'closed')),
  at timestamptz not null default now()
);
create index sty_holds_t on sty_holds(tenant_id, status);
alter table sty_holds enable row level security;

create table sty_audit (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid, action text not null, ref text,
  detail jsonb,
  at timestamptz not null default now()
);
create index sty_audit_t on sty_audit(tenant_id, at);
alter table sty_audit enable row level security;
