-- tenant_settings has only an owner SELECT policy (db/013) and an admin_all ALL policy (db/006) --
-- there is no owner UPDATE policy, so a plain client.query('update tenant_settings ...') run through
-- an owner-authorized connection (set_config('app.uid', owner_uid, true)) silently matches zero rows:
-- no error, the write just never happens. Caught testing migrate_showoffsalon_to_generic_engine.mjs
-- against a scratch database before it ever touched production -- the same RLS-bypass bug class this
-- project has hit (and documented) repeatedly, this time on the write side of a table that only grants
-- owners read access. salon_owner_uid()/salon_tenant() (db/170) are the read-side precedent for a
-- narrow, niche-restricted SECURITY DEFINER helper with no further permission check; this is the
-- matching write-side helper, restricted the same way (niche='salon' only).
create or replace function salon_set_engine(p_slug text, p_engine text)
returns boolean language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if p_engine not in ('store', 'generic') then raise exception 'invalid engine'; end if;
  select id into tid from tenants where slug = p_slug and niche = 'salon';
  if tid is null then return false; end if;
  update tenant_settings set business_rules = business_rules || jsonb_build_object('salonEngine', p_engine)
    where tenant_id = tid;
  return true;
end $$;
