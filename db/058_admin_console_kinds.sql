-- =========================================================
-- Admin console (app/public/dashboard.html + console/*.js): new record kinds,
-- all ordinary 'records' rows, written by the owner or a manager:
--   outlet     {name, addr, phone, gstin, active, virtual}            multi-outlet
--   device     {name, outlet, code, kind, lastSeen}                   device mapping
--   addongrp   {name, mods:'Cheese:20,Extra:10', min, max}            add-on groups
--   tax        {name, rate, inclusive}                                tax master
--   settlement {platform, from, to, gross, commission, net, status}   aggregator payouts
--   platform   {name, active, commission, autoAccept, storeId}        aggregator settings
--   giftcard   {code, balance, issuedTo, expiry}
--   segment    {name, rules}                                          marketing segments
--   campaign   {name, channel, segment, message, status, sentLog}     marketing campaigns
--   closing    {d, ing, counted, book}                                closing stock entries
--   quicklink  {user, links}                                          per-user shortcuts
-- Records of per-outlet kinds carry data.outlet ('main' when absent).
-- =========================================================

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink'))
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink'))
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink'))
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

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove') then
    authorized := true;
  elsif myrole = 'owner' then
    authorized := true;
  elsif myrole = 'manager' and rkind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink') then
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
