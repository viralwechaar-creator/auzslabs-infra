-- =========================================================
-- AUZlabs platform: tenants + tenant_settings + niche presets
-- One row per client. Everything client-specific lives here,
-- never in application code.
-- =========================================================

create extension if not exists "pgcrypto";  -- provides gen_random_uuid()

-- ---------------------------------------------------------
-- tenants: who the client is, what kind of business, what
-- plan they're on, status
-- ---------------------------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,          -- subdomain, e.g. 'ogbookcafe' -> ogbookcafe.auzlabs.com
  name        text not null,                 -- display name, e.g. 'OG Book Cafe'
  niche       text not null default 'general'
              check (niche in ('cafe', 'salon', 'gym', 'retail', 'general')),
  plan        text not null default 'starter'
              check (plan in ('starter', 'pro', 'enterprise')),
  status      text not null default 'trial'
              check (status in ('trial', 'active', 'suspended', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table tenants is
  'One row per AUZlabs client. Onboarding a client = inserting a row here, never touching code.';

-- ---------------------------------------------------------
-- tenant_settings: everything that makes each client look
-- and behave differently, without a single code change
-- ---------------------------------------------------------
create table tenant_settings (
  tenant_id       uuid primary key references tenants(id) on delete cascade,

  -- what the client sees: logo, colors, display overrides
  branding        jsonb not null default '{}',
  -- example: {"logo_url": "...", "primary_color": "#4b2e1e", "secondary_color": "#f4ede4"}

  -- which modules/features this client has switched on
  features        jsonb not null default '{"pos": true}',
  -- example: {"pos": true, "crm": false, "loyalty": false}

  -- what a niche's generic concepts are called for this client
  -- (a cafe's "Table" is a salon's "Stylist" is a gym's "Trainer")
  labels          jsonb not null default '{}',
  -- example: {"catalog": "Menu Items", "resource": "Table", "booking": "Order"}

  -- business rules specific to this client — from the OG Book Cafe
  -- extraction, richer than a flat tax_rate, generalizes to any
  -- tax model/jurisdiction, not just India's CGST/SGST split
  business_rules  jsonb not null default '{}',
  -- example: {
  --   "currency": "INR",
  --   "currency_symbol": "₹",
  --   "tax_rate": 5,
  --   "tax_labels": ["CGST", "SGST"],
  --   "tax_id_label": "GSTIN",
  --   "invoice_prefix": "INV",
  --   "invoice_footer": "Thank you!",
  --   "paper_width_mm": 80,
  --   "invoice_style": "mono",
  --   "order_mode": "table",
  --   "self_order_welcome": "Scan, order and relax."
  -- }
  -- tax_labels is an array so a single "Tax" line, a two-way CGST/SGST
  -- split, or any other jurisdiction's model all fit with no schema change.

  updated_at      timestamptz not null default now()
);

comment on table tenant_settings is
  'Config-driven differences per tenant. A new client need becomes a new JSON key here, not new code.';

-- ---------------------------------------------------------
-- niche_presets: what a new client of a given niche starts
-- with — copied into their tenant_settings at onboarding,
-- then freely edited per client from there. Editing a preset
-- later never touches clients who already onboarded.
-- ---------------------------------------------------------
create table niche_presets (
  niche                   text primary key,
  default_features        jsonb not null default '{}',
  default_labels          jsonb not null default '{}',
  default_business_rules  jsonb not null default '{}'
);

insert into niche_presets (niche, default_features, default_labels, default_business_rules) values
('salon',  '{"booking": true,  "crm": true, "billing": true, "pos": false}',
           '{"catalog": "Services",   "resource": "Stylist", "booking": "Appointment"}',
           '{"currency": "INR"}'),
('cafe',   '{"booking": false, "crm": true, "billing": true, "pos": true, "self_order": true, "kds": true}',
           '{"catalog": "Menu Items", "resource": "Table",   "booking": "Order"}',
           -- field names here match cfg() in index.html/site.html exactly
           -- (tax, prefix, col, ftr, w, sty, fs, gw) — this is what actually
           -- becomes the new tenant's initial records(kind=''settings'') row
           '{"tax": 5, "prefix": "INV", "col": "#1f3d2e", "ftr": "Thank you!", "w": 80, "sty": "mono", "fs": 12, "gw": "Scan, order and relax. Your order goes straight to our kitchen."}'),
('gym',    '{"booking": true,  "crm": true, "billing": true, "pos": false}',
           '{"catalog": "Classes",    "resource": "Trainer",  "booking": "Class Booking"}',
           '{"currency": "INR"}'),
('retail', '{"booking": false, "crm": true, "billing": true, "pos": true}',
           '{"catalog": "Products",   "resource": "Counter",  "booking": "Sale"}',
           '{"currency": "INR", "tax_rate": 18}'),
('general', '{"booking": false, "crm": true, "billing": true, "pos": true}',
           '{"catalog": "Items",      "resource": "Counter",  "booking": "Sale"}',
           '{"currency": "INR"}');

-- Onboarding a new client becomes:
--   1. insert into tenants (slug, name, niche) values (..., 'cafe');
--   2. copy that niche's row from niche_presets into a new
--      tenant_settings row (features, labels, business_rules);
--   3. tweak whatever's different for that specific client.
-- No code change, no new table, no new deploy — for ANY niche in
-- this list, or a new one added later with its own preset row.

-- ---------------------------------------------------------
-- keep updated_at fresh automatically on every update
-- ---------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_tenants_updated_at
before update on tenants
for each row execute function set_updated_at();

create trigger trg_tenant_settings_updated_at
before update on tenant_settings
for each row execute function set_updated_at();
