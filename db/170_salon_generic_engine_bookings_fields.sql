-- Salon-onto-generic-engine migration, part 1: two small, additive columns on the already-shared
-- `bookings` table (db/003). The booking flow Salon's own frontend (app/public/salon/) has always
-- had two fields the generic bookings table never needed before: an email and a free-text note. A
-- `ref` short code is NOT stored here -- it was always just the booking id's first 8 hex characters
-- uppercased, recomputed on read, so nothing needs to carry it.
-- Purely additive: every other niche's existing use of `bookings` is completely unaffected (both
-- columns are nullable, nothing selects `*` and assumes a fixed column list anywhere that matters).
alter table bookings add column if not exists email text;
alter table bookings add column if not exists note text;

grant select, insert, update on bookings to app;

-- Per-tenant switch: which storage a salon tenant's data actually lives in. Defaults to 'store'
-- (today's salon_store JSON documents, completely unaffected) for every tenant that already exists
-- and every new one -- nothing changes for anyone until a tenant is explicitly flipped to 'generic'
-- after its real data has been migrated and proven correct. Read from tenant_settings.business_rules,
-- the same place `bizType` and other per-niche overrides already live (see db/133's own comment).
-- A generic-engine salon tenant's data (records/bookings) is RLS-protected, keyed off app_uid(); a public
-- site visitor has no AUZslab login at all, and salon.js's own request model (its own cookie session, never
-- a platform JWT) never sets app.uid either way -- so even an owner/staff-authenticated salon.js request has
-- nothing for withAuth() to use unless it resolves a real member of that tenant first. profiles itself is
-- also RLS-protected (owner-read-only), so that resolution needs its own small SECURITY DEFINER helper, the
-- same trusted-backend-only pattern as provision_from_payment / addon_request_pricing_context: salon.js has
-- already fully authorized the request (tenantFor + getSession/ownerPasswordOk/staffLogin) before this is
-- ever called, so trusting the tenant id argument alone is the correct, established precedent here, not a gap.
create or replace function salon_owner_uid(p_tenant uuid) returns uuid
  language sql security definer stable set search_path = public as $$
  select id from profiles where tenant_id = p_tenant and role = 'owner'
    and exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon')
  limit 1
$$;

drop function if exists salon_tenant(text);
create function salon_tenant(p_slug text) returns table (id uuid, name text, slug text, is_demo boolean, engine text)
  language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.slug, t.is_demo, coalesce(ts.business_rules->>'salonEngine', 'store')
  from tenants t left join tenant_settings ts on ts.tenant_id = t.id
  where t.slug = p_slug and t.niche = 'salon'
$$;
