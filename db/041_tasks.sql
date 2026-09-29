-- =========================================================
-- Third new ERP module: Tasks. A lightweight team to-do/assignment
-- board -- "restock napkins," "call the paneer vendor," "deep clean
-- the fryer" -- for daily ops work that isn't a customer order, a
-- support ticket, or an HR/payroll action, and has nowhere else to
-- live in the existing product lineup. Applies to every niche.
--
-- One new `records` kind, same generic-engine shape as every other
-- module in this schema:
--   'task' -- {title, desc, assignedTo (staff email), dueDate,
--              priority (low/medium/high), status (todo/
--              in_progress/done), createdAt, createdBy}
--
-- New 'tasks' feature flag, left off by default everywhere (a
-- generic utility, not niche-specific) -- an owner enables it like
-- any other entitled feature.
-- =========================================================

-- Day-to-day ops, same trust level as 'order'/'membership'/'ticket'
-- -- any tenant member can create/update a task (assign it to
-- themselves or a teammate, mark it done), not just owner/manager.

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
      or (kind = 'hr_document' and data->>'empId' = my_employee_id())
      or (kind = 'hr_regularization' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
      or (kind = 'hr_profile' and data->>'empId' = my_employee_id())
      or (kind = 'hr_advance' and data->>'empId' = my_employee_id() and data->>'status' = 'requested')
    )
  );

drop policy if exists r_upd on records;
create policy r_upd on records for update
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan'))
      or (kind in ('hr_attendance', 'hr_leave') and data->>'empId' = my_employee_id())
      or (kind = 'hr_document' and data->>'empId' = my_employee_id())
      or (kind = 'hr_regularization' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
      or (kind = 'hr_profile' and data->>'empId' = my_employee_id())
      or (kind = 'hr_advance' and data->>'empId' = my_employee_id() and data->>'status' = 'requested')
    )
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
      or (kind = 'hr_document' and data->>'empId' = my_employee_id())
      or (kind = 'hr_regularization' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
      or (kind = 'hr_profile' and data->>'empId' = my_employee_id())
      or (kind = 'hr_advance' and data->>'empId' = my_employee_id() and data->>'status' = 'requested')
    )
  );

create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid; myrole text; myemp text; authorized boolean := false;
begin
  tid := (me()->>'tenant_id')::uuid;
  myrole := me()->>'role';
  if tid is null then raise exception 'not authorized'; end if;

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task') then
    authorized := true;
  elsif myrole = 'owner' then
    authorized := true;
  elsif myrole = 'manager' and rkind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan') then
    authorized := true;
  elsif rkind = 'hr_attendance' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp;
  elsif rkind = 'hr_leave' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp and rdata->>'status' = 'pending';
  elsif rkind = 'hr_document' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp;
  elsif rkind = 'hr_regularization' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp and rdata->>'status' = 'pending';
  elsif rkind = 'hr_profile' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp;
  elsif rkind = 'hr_advance' then
    myemp := my_employee_id();
    authorized := myemp is not null and rdata->>'empId' = myemp and rdata->>'status' = 'requested';
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
