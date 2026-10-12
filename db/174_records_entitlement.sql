-- Server-side entitlement check for the generic `records` engine (owner report: a staff login of an
-- AUZsMob-only business opened the POS). The apps' gates (ds/gate.js, native app) only hide the screen;
-- this makes the database itself refuse POS data for a business that has not bought AUZsPOS.
-- Allowed always: the business `settings` record (every app reads its brand/config) and hr_* payroll-link records.
-- Fail open when the entitlement row is missing (old/demo tenants), so nothing legitimate is locked out.
create or replace function records_entitled(k text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; f jsonb; en jsonb;
begin
  if tid is null then return true; end if;                       -- platform admin / no tenant: other policies decide
  if k = 'settings' or k like 'hr\_%' then return true; end if;
  select features, enabled_features into f, en from tenant_settings where tenant_id = tid;
  if f is null then return true; end if;
  if (f->>'pos') = 'true' and coalesce(en->>'pos', 'true') <> 'false' then return true; end if;
  if (f->>'website_builder') = 'true' and k = 'sitepage' then return true; end if;
  return false;
end $$;

drop policy if exists r_entitled on records;
create policy r_entitled on records as restrictive for all
  using (records_entitled(kind)) with check (records_entitled(kind));
