-- =========================================================
-- New module: Memberships & Subscriptions -- fills a real gap the
-- existing product lineup (POS, CRM, Inventory, Booking, Payroll,
-- Website Builder) didn't cover: a recurring membership/package plan
-- sold once and consumed over time (a gym's monthly membership, a
-- salon's "10 haircuts" package, a cafe's subscription coffee card),
-- as opposed to a one-off order or a single booked appointment.
--
-- Three new `records` kinds, same generic-engine shape as everything
-- else in this schema (see CLAUDE.md's "The records table" section):
--   'plan'       -- {name, price, days, desc, active} -- a sellable
--                    membership tier, e.g. "Monthly unlimited" ₹2000/30 days.
--   'membership' -- {custPhone, custName, planId, planName, price,
--                    startDate, endDate, status, createdAt} -- one
--                    customer's purchase of a plan, with its own
--                    validity window. status is 'active'/'cancelled'
--                    -- 'expired' is derived client-side from endDate,
--                    never stored, so a plan's own validity change
--                    doesn't require touching every past membership.
--   'checkin'    -- {membershipId, custPhone, at} -- a single visit,
--                    logged by front-desk staff tapping a member in.
--
-- Gated behind a new 'membership' feature flag, defaulted on for the
-- gym and salon niches (where a package/membership model is core to
-- how the business actually sells) and left off elsewhere -- an
-- owner on any niche can still self-enable it once AUZlab grants the
-- entitlement, same as every other feature (see update_my_features).
-- Only touches niche_presets, so this changes nothing for tenants
-- already onboarded (see that table's own comment on why).
-- =========================================================

update niche_presets set default_features = default_features || '{"membership": true}'::jsonb
  where niche in ('gym', 'salon');

-- 'membership' and 'checkin' are day-to-day front-desk operations --
-- same trust level as ringing up an order, so open to every tenant
-- member, not just owner/manager (matches 'order' below). 'plan' is
-- a pricing decision, so owner/manager only (matches hr_settings).

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin')
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

-- push_record is what the app actually calls (see CLAUDE.md) -- these
-- table policies are a backstop, this is the real gate.
create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid; myrole text; myemp text; authorized boolean := false;
begin
  tid := (me()->>'tenant_id')::uuid;
  myrole := me()->>'role';
  if tid is null then raise exception 'not authorized'; end if;

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin') then
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
