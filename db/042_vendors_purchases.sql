-- =========================================================
-- Fourth new ERP module: Vendors & Purchases. Cafe already has
-- supplier + purchase-order tracking baked into its Inventory tab
-- (ingInv() in index.html, kind='supplier'/'po', tied to ingredient
-- stock levels), and Retail has itemized variant purchases (kind=
-- 'item'.purchases, tied to variant stock). Salon, gym and general
-- niches have neither -- an owner buying shampoo, towels, gym
-- equipment or office supplies has nowhere to record who they
-- bought it from or what they paid, short of the generic 'exp'
-- expense log (which has no vendor concept at all).
--
-- Deliberately NOT tied to any inventory/stock levels (unlike the
-- cafe/retail versions) -- this is a simpler, niche-agnostic
-- "what did I buy and from whom" record for spend tracking, not a
-- stock-replenishment workflow. Two new `records` kinds:
--   'vendor'   -- {name, phone, email, notes}
--   'purchase' -- {vendorId, vendorName, items: [{desc, qty,
--                  unitPrice}], amount, date, notes}
--
-- New 'purchases' feature flag, defaulted on for salon/gym/general
-- (the niches with no existing purchase-tracking tool) via
-- niche_presets -- future onboardings only. Cafe/retail keep their
-- existing tools; an owner there can still self-enable this too if
-- they want the general version alongside.
-- =========================================================

update niche_presets set default_features = default_features || '{"purchases": true}'::jsonb
  where niche in ('salon', 'gym', 'general');

-- Recording a purchase is a back-office op (spend tracking), same
-- trust level as 'exp' (expenses) -- open to any tenant member, not
-- owner/manager only.

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase')
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

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase') then
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
