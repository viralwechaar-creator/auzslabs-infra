-- =========================================================
-- Salon Suite storage. A salon tenant runs Showoff Salon's original
-- site / admin console / invoice app (app/public/salon/) against
-- server/src/salon.js, which keeps the same document shape the original
-- Vercel app kept in a Blob: one JSON document per tenant
-- (key='db': settings, menu, content, stylists, gallery, bookings,
-- invoices, expenses, counters) plus key='admin' for the console's own
-- password hash / lockout counters.
--
-- Not reachable through the generic /db API (server/src/index.js's
-- TABLES whitelist deliberately omits it) and deliberately no RLS: only
-- the API process (role "app") ever touches it, always scoped to the
-- tenant resolved from the request's subdomain. New table => explicit
-- grant to app in the same migration (see db/015).
-- =========================================================
create table if not exists salon_store (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  key        text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
grant select, insert, update, delete on salon_store to app;

-- tenants and profiles are RLS-protected and the API's salon routes run
-- with no signed-in user (public site, then the console's own login), so
-- these two narrow SECURITY DEFINER lookups are the only way in. Both are
-- restricted to niche='salon' tenants.
create or replace function salon_tenant(p_slug text) returns table (id uuid, name text, slug text)
  language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.slug from tenants t where t.slug = p_slug and t.niche = 'salon'
$$;

-- bcrypt hashes of the tenant's owner login(s): until the salon owner sets
-- a console-specific password, the salon console accepts the owner's
-- normal AUZslab password.
create or replace function salon_owner_hashes(p_tenant uuid) returns setof text
  language sql security definer stable set search_path = public as $$
  select au.password_hash from profiles p join auth_users au on au.id = p.id
  where p.tenant_id = p_tenant and p.role = 'owner'
    and exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon')
$$;
