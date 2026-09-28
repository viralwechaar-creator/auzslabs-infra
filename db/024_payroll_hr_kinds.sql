-- =========================================================
-- Payroll is now its own product (app/public/payroll.html), not a
-- tab inside the POS -- it never reads or writes 'payrate'/'payslip'
-- (021_owner_only_payroll_kinds.sql) any more. Its own data lives in
-- new records kinds, all prefixed 'hr_' so they never collide with
-- anything the POS app already uses:
--   hr_settings   -- one per tenant, PF/ESIC/PT/TDS rates + company name
--   hr_employee   -- one per staff member on payroll (salary structure lives here)
--   hr_shift      -- shift definitions (start/end time)
--   hr_attendance -- one per employee per day, punch in/out
--   hr_leave      -- leave requests + approval state
--   hr_advance    -- loans/salary advances ledger
--   hr_payslip    -- one per employee per month, computed by a payroll run
--
-- Same table (`records`), so no new grant is needed (999_app_grants'
-- blanket grant already covers this table -- see that file's own
-- comment on why brand-new *tables* need their own explicit grant,
-- which doesn't apply here since we're not creating one).
--
-- Salary data needs the same "owner-only to even READ" treatment
-- payrate/payslip got in 021, extended two ways:
--   - payroll.html treats 'manager' as an HR/admin role too (isHR()),
--     not just 'owner' -- the POS's own payroll tab never did that,
--     so every hr_* admin check below explicitly lists 'manager'
--     alongside 'owner' rather than reusing the POS's owner-only
--     shorthand.
--   - employees need limited self-service: punch their own attendance,
--     request their own leave, see their own payslips -- without ever
--     seeing (or writing) anyone else's. my_employee_id() resolves
--     "which hr_employee row is the caller" once, the same way me()
--     resolves role/tenant once, so every policy below can just
--     compare data->>'empId' against it instead of re-deriving it.
-- =========================================================

create function my_employee_id() returns text language sql security definer stable set search_path = public as $$
  select id from records
  where tenant_id = (me()->>'tenant_id')::uuid
    and kind = 'hr_employee'
    and not deleted
    and data->>'authUserId' = app_uid()::text
  limit 1
$$;

drop policy if exists r_read on records;
create policy r_read on records for select
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind not in ('payrate', 'payslip', 'hr_settings', 'hr_employee', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip')
      or (me()->>'role') in ('owner', 'manager')
      or (kind = 'hr_employee' and data->>'authUserId' = app_uid()::text)
      or (kind in ('hr_attendance', 'hr_leave', 'hr_payslip') and data->>'empId' = my_employee_id())
    )
  );

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
    )
  );

drop policy if exists r_upd on records;
create policy r_upd on records for update
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip'))
      or (kind in ('hr_attendance', 'hr_leave') and data->>'empId' = my_employee_id())
    )
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
    )
  );

-- push_record is SECURITY DEFINER, so it runs as the function's owner
-- and bypasses the RLS policies above entirely -- they're the fallback
-- for any other access path, but this hardcoded check is the real gate
-- for every write index.html/payroll.html actually make (both only
-- ever call push_record, never a raw insert/update). Same allow-list
-- as r_ins/r_upd above, kept in sync by hand (that's the existing
-- pattern -- see 019_allow_kotlog_kind.sql doing the same two-places
-- update when 'kotlog' was added).
create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid; myrole text; myemp text; authorized boolean := false;
begin
  tid := (me()->>'tenant_id')::uuid;
  myrole := me()->>'role';
  if tid is null then raise exception 'not authorized'; end if;

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog') then
    authorized := true;
  elsif myrole = 'owner' then
    authorized := true;
  elsif myrole = 'manager' and rkind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip') then
    authorized := true;
  elsif rkind = 'hr_attendance' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp;
  elsif rkind = 'hr_leave' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp and rdata->>'status' = 'pending';
  end if;

  if not authorized then raise exception 'not authorized'; end if;

  select updated_at into cur from records where tenant_id = tid and id = rid;

  if cur is null then
    insert into records (id, tenant_id, kind, data, deleted) values (rid, tid, rkind, rdata, rdeleted) returning updated_at into newv;
  elsif force or base is null or cur = base then
    update records set kind = rkind, data = rdata, deleted = rdeleted where tenant_id = tid and id = rid returning updated_at into newv;
  else
    conflict := true; newv := cur;
  end if;

  return jsonb_build_object('ok', not conflict, 'conflict', conflict, 'server_updated_at', newv);
end $$;
