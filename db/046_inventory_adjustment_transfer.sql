-- =========================================================
-- Purchases (ing.purchases / item.purchases / 'purchase') and Expenses
-- ('exp') were already distinct kinds -- never summed together
-- anywhere in the app, so that specific bug (counting an operating
-- expense as inventory spend) never existed in this schema. What was
-- genuinely missing, per the user's own write-up on transaction types:
--
--   'adjustment' -- a stock correction (the "Adjust" button in
--                   backoffice.html's Inventory tab) previously just
--                   mutated ing.qty directly via a bare prompt() with
--                   NO record of who changed it, when, or why -- no
--                   audit trail at all, unlike every other stock
--                   movement (purchase, waste) which already writes
--                   its own log entry.
--   'transfer'   -- moving stock between named areas (e.g. "Main
--                   Store" -> "Kitchen"). This schema has no
--                   multi-location/outlet concept (a single ing.qty
--                   per ingredient, no per-location split) -- adding
--                   real per-location stock tracking would mean
--                   rewriting every deduction path (dedu() in
--                   index.html) to know which location a sale drew
--                   from, well beyond this migration's scope. This
--                   is deliberately just the audit trail half: total
--                   stock is unaffected (the same total that moved
--                   out of one area moved into the other), logged so
--                   an owner can at least see what moved where and
--                   when, matching the user's own example numbers.
-- =========================================================

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer')
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

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer') then
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
