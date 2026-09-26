I'm building AUZlabs, a multi-tenant SaaS platform for restaurant/cafe software.
This repo is our first build — OG Book Cafe's POS — currently live in production
on Vercel + Supabase, serving a real paying client right now.

GOAL: analyze this codebase and produce a generic, config-driven "raw" version of
it that can become the reusable AUZlabs POS product for future clients, WITHOUT
touching the current live production system in any way.

HARD RULES — do not break these:
- Do NOT modify, commit to, or deploy anything on the current production branch
  or environment.
- Do NOT touch the live Vercel or Supabase project settings.
- All analysis is read-only first. Any code changes go on a NEW branch (e.g.
  `raw-platform-extract`), never on main/production.
- Stop after producing the branch + a written summary. Do not deploy it anywhere.
  I will review before anything goes near new infrastructure or the live client.

TARGET ARCHITECTURE — the output must plug into this exactly, so match it:

1. Multi-tenant Postgres schema (already built, do not redesign it):

```sql
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  plan        text not null default 'starter'
              check (plan in ('starter', 'pro', 'enterprise')),
  status      text not null default 'trial'
              check (status in ('trial', 'active', 'suspended', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table tenant_settings (
  tenant_id       uuid primary key references tenants(id) on delete cascade,
  branding        jsonb not null default '{}',
  -- e.g. {"logo_url": "...", "primary_color": "#4b2e1e", "secondary_color": "#f4ede4"}
  features        jsonb not null default '{"pos": true}',
  -- e.g. {"pos": true, "crm": false, "loyalty": false}
  business_rules  jsonb not null default '{}',
  -- e.g. {"currency": "INR", "tax_rate": 5, "order_mode": "table", "receipt_footer": "Thank you!"}
  updated_at      timestamptz not null default now()
);
```

Every other business table (orders, menu_items, customers, etc.) has a
`tenant_id` column and a Row-Level Security policy. IMPORTANT: this app is
static HTML/JS talking directly to Supabase (RPC + RLS) — there is no
server-side process to hold a persistent DB connection, so isolation must be
enforced entirely inside Postgres/Supabase, not via a `SET app.tenant_id`
session variable from server middleware. Use this shape instead:

```sql
-- staff/users are linked to exactly one tenant
create table staff (
  id         uuid primary key references auth.users(id),
  tenant_id  uuid not null references tenants(id)
);

alter table orders enable row level security;
create policy tenant_isolation on orders
  using (tenant_id = (select tenant_id from staff where id = auth.uid()));
```

Every insert/update from client-side JS still sends `tenant_id` explicitly
(resolved from the subdomain, see below) — RLS is the backstop that rejects
it if it doesn't match the logged-in staff member's real tenant, even if
client code has a bug.

2. Tenant-resolution pattern for THIS app (static, no build step, no server):

```js
// Runs on page load, in plain JS — no middleware, no Next.js.
// Resolves which client this page belongs to from the subdomain,
// then reads their branding/features/business_rules to configure the page.
const subdomain = window.location.hostname.split('.')[0];

const { data: tenant } = await supabase
  .from('tenants')
  .select('id, name, status')
  .eq('slug', subdomain)
  .single();

if (!tenant || tenant.status === 'suspended' || tenant.status === 'cancelled') {
  // show a "not available" page and stop
}

const { data: settings } = await supabase
  .from('tenant_settings')
  .select('branding, features, business_rules')
  .eq('tenant_id', tenant.id)
  .single();

// settings.branding.logo_url, settings.business_rules.tax_rate, etc.
// now drive the page instead of hardcoded values. Every subsequent
// Supabase insert/query includes tenant_id: tenant.id explicitly.
```

`tenants` and `tenant_settings` need a permissive RLS read policy (anyone can
look up branding/settings by slug — it's not sensitive) but writes to them
stay locked down to an admin/service role.

YOUR TASKS, in order:

1. INVENTORY — list every feature/screen/module currently in this POS
   (billing, KOT, table management, discounts, inventory, reports, whatever
   actually exists). This becomes the baseline feature set for the generic product.

2. AUDIT — search the codebase for anything hardcoded specifically for OG Book
   Cafe: the cafe's name, logo file references, hex color codes, tax rate or
   currency literals, receipt footer text, any `if` condition checking a
   specific client name/ID/env value. Report each finding with file path and
   line number.

3. CATEGORIZE each finding into one of:
   - branding (logo/colors/name) → belongs in tenant_settings.branding
   - feature flag (on/off capability) → tenant_settings.features
   - business rule (a number/text that varies per client) → tenant_settings.business_rules
   - genuine one-off logic only this client needs (should be rare — flag it clearly)

4. PROPOSE the exact tenant_settings JSON (branding/features/business_rules)
   that represents OG Book Cafe's current real configuration, once extracted.

5. REFACTOR on the new branch only: replace each hardcoded value with a read
   from the tenant/tenant_settings lookup shown above (or an equivalent you
   explain if the real structure of this app differs further once you look).

6. PACKAGE the resulting generic app source as static files (no build step
   assumed) plus the SQL for the tenants/tenant_settings/staff tables and
   their RLS policies — this is what will get adapted into the AUZlabs
   self-hosted stack, not dropped in as-is.

7. STOP. Do not deploy. Report back with: the branch name and diff summary,
   the full hardcoded-values audit list, and the proposed tenant_settings JSON.
