-- =========================================================
-- Payroll's employee-self-service view (app/public/payroll.html)
-- is getting a real "Loan & Advance" screen showing the employee's
-- own outstanding balance, and a new "Notifications" screen HR can
-- post announcements to. Two RLS gaps this opens, both fixed here:
--
--   1. hr_advance was owner/manager-only to read (021's payrate/payslip
--      treatment, extended in 024) -- an employee could never see their
--      own advance/loan rows at all, so advanceOutstanding() silently
--      returned 0 for them even when a real balance existed. Adding
--      a self-read clause, same shape as hr_attendance/hr_leave/hr_payslip's.
--
--   2. hr_announcement (new kind, first used by this migration) is
--      NOT in r_read's restricted list, so it's already readable by
--      every tenant member for free -- but writing one goes through
--      push_record, whose manager branch only authorizes the fixed
--      hr_* list from 024, which predates this kind. Without adding
--      it there, a manager posting an announcement 404s with "not
--      authorized" (owner already works today via the unconditional
--      owner branch, so this is only a manager gap).
-- =========================================================

drop policy if exists r_read on records;
create policy r_read on records for select
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind not in ('payrate', 'payslip', 'hr_settings', 'hr_employee', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip')
      or (me()->>'role') in ('owner', 'manager')
      or (kind = 'hr_employee' and data->>'authUserId' = app_uid()::text)
      or (kind in ('hr_attendance', 'hr_leave', 'hr_payslip', 'hr_advance') and data->>'empId' = my_employee_id())
    )
  );

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement'))
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
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement'))
      or (kind in ('hr_attendance', 'hr_leave') and data->>'empId' = my_employee_id())
    )
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
    )
  );

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
  elsif myrole = 'manager' and rkind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement') then
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
