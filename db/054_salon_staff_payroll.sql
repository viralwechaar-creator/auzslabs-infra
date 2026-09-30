-- =========================================================
-- Salon Suite, part 2: staff logins + AUZslab Payroll link.
--
-- Staff accounts themselves live in salon_store (key='staff', db/053) --
-- the salon console is its own login surface -- but attendance has to
-- land where Payroll (app/public/payroll.html) reads it: `records`
-- kinds hr_employee / hr_attendance (db/024). `records` is RLS-locked
-- to signed-in tenant members and the salon console's API process has
-- no AUZslab session, so these narrow SECURITY DEFINER functions are
-- the only way the salon API touches them. All are restricted to
-- tenants with niche='salon' and to the exact record shapes
-- payroll.html itself writes (see its doPunch / employee editor), so a
-- punch made from the salon console shows up in Payroll's attendance
-- and pay run exactly like one made from Payroll's own mobile punch.
-- =========================================================

-- is_demo lets the API lock down uploads / password changes on the
-- public demo salon (db/055).
drop function if exists salon_tenant(text);
create function salon_tenant(p_slug text) returns table (id uuid, name text, slug text, is_demo boolean)
  language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.slug, t.is_demo from tenants t where t.slug = p_slug and t.niche = 'salon'
$$;

-- Employees already on this salon's payroll (owner picks one to link a
-- new staff login to).
create or replace function salon_hr_list(p_tenant uuid) returns jsonb
  language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.data->>'name', 'designation', r.data->>'designation',
           'phone', r.data->>'phone', 'active', coalesce((r.data->>'active')::boolean, true))
         order by r.data->>'name'), '[]'::jsonb)
  from records r
  where r.tenant_id = p_tenant and r.kind = 'hr_employee' and not r.deleted
    and exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon')
$$;

-- Creates the Payroll employee for a new staff login (salary structure
-- left at 0 for the owner to fill in under Payroll -> Employees), or
-- returns the existing one with the same phone so a re-created login
-- never duplicates a payroll row.
create or replace function salon_hr_ensure(p_tenant uuid, p_name text, p_phone text, p_designation text) returns text
  language plpgsql security definer set search_path = public as $$
declare eid text;
begin
  if not exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon') then raise exception 'unknown salon'; end if;
  select r.id into eid from records r
    where r.tenant_id = p_tenant and r.kind = 'hr_employee' and not r.deleted
      and coalesce(p_phone, '') <> '' and r.data->>'phone' = p_phone limit 1;
  if eid is not null then return eid; end if;
  eid := gen_random_uuid()::text;
  insert into records (id, tenant_id, kind, data) values (eid, p_tenant, 'hr_employee', jsonb_build_object(
    'id', eid, 'name', p_name, 'empId', '', 'dept', 'Salon', 'designation', coalesce(nullif(p_designation, ''), 'Stylist'),
    'phone', coalesce(p_phone, ''), 'dateJoined', to_char(current_date, 'YYYY-MM-DD'), 'shiftId', null, 'active', true,
    'salaryStructure', jsonb_build_object('basic', 0, 'hra', 0, 'allowances', 0, 'otRate', 0), 'source', 'salon'));
  return eid;
end $$;

-- Today's punch state + the last 7 days, for the staff member's own Today tab.
create or replace function salon_punch_state(p_tenant uuid, p_emp text, p_date text) returns jsonb
  language plpgsql security definer stable set search_path = public as $$
declare open_row jsonb; recent jsonb;
begin
  if not exists (select 1 from records r join tenants t on t.id = r.tenant_id
                 where r.tenant_id = p_tenant and r.id = p_emp and r.kind = 'hr_employee' and t.niche = 'salon') then
    return null;
  end if;
  select r.data into open_row from records r
    where r.tenant_id = p_tenant and r.kind = 'hr_attendance' and not r.deleted
      and r.data->>'empId' = p_emp and r.data->>'date' = p_date and (r.data->>'out') is null
    order by r.updated_at desc limit 1;
  select coalesce(jsonb_agg(x.d order by x.d->>'date' desc), '[]'::jsonb) into recent from (
    select r.data as d from records r
    where r.tenant_id = p_tenant and r.kind = 'hr_attendance' and not r.deleted and r.data->>'empId' = p_emp
    order by r.data->>'date' desc, r.updated_at desc limit 7) x;
  return jsonb_build_object('open', open_row is not null, 'in', open_row->>'in', 'recent', recent);
end $$;

-- Toggle: an open punch today gets its `out` set, otherwise a new `in`
-- row starts -- the same behaviour as Payroll's own doPunch().
create or replace function salon_punch(p_tenant uuid, p_emp text, p_date text, p_now text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare open_id text; open_data jsonb; nid text;
begin
  if not exists (select 1 from records r join tenants t on t.id = r.tenant_id
                 where r.tenant_id = p_tenant and r.id = p_emp and r.kind = 'hr_employee' and not r.deleted and t.niche = 'salon') then
    raise exception 'unknown employee';
  end if;
  select r.id, r.data into open_id, open_data from records r
    where r.tenant_id = p_tenant and r.kind = 'hr_attendance' and not r.deleted
      and r.data->>'empId' = p_emp and r.data->>'date' = p_date and (r.data->>'out') is null
    order by r.updated_at desc limit 1;
  if open_id is not null then
    update records set data = open_data || jsonb_build_object('out', p_now, 'source', 'salon')
      where tenant_id = p_tenant and id = open_id;
    return jsonb_build_object('status', 'out', 'at', p_now);
  end if;
  nid := gen_random_uuid()::text;
  insert into records (id, tenant_id, kind, data) values (nid, p_tenant, 'hr_attendance',
    jsonb_build_object('id', nid, 'empId', p_emp, 'date', p_date, 'in', p_now, 'source', 'salon'));
  return jsonb_build_object('status', 'in', 'at', p_now);
end $$;
