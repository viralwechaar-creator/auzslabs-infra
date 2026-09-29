-- =========================================================
-- Inventory Phase 2: formal Purchase Orders and a Supplier master,
-- on top of the instant-purchase-entry + ingredient-stock model that
-- already existed (kind='ing', purchaseIng() in index.html). Two new
-- records kinds, same table, same "staff-writable, not owner-only"
-- tier as 'ing'/'waste' already sit in -- a cashier taking a delivery
-- shouldn't need a manager standing over them any more than logging
-- a walk-in purchase already does.
--   supplier -- {id, name, phone, notes}
--   po       -- {id, supplier, items:[{ing,ingId,qty,unit}], status,
--                createdAt, sentAt, receivedAt, receivedLines}
-- Same table (`records`), so no new grant needed (999_app_grants'
-- blanket grant already covers it).
-- =========================================================

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'supplier', 'po')
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
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'supplier', 'po')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip'))
      or (kind in ('hr_attendance', 'hr_leave') and data->>'empId' = my_employee_id())
    )
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (
      kind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'supplier', 'po')
      or (me()->>'role') = 'owner'
      or ((me()->>'role') = 'manager' and kind in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip'))
      or (kind = 'hr_attendance' and data->>'empId' = my_employee_id())
      or (kind = 'hr_leave' and data->>'empId' = my_employee_id() and data->>'status' = 'pending')
    )
  );

-- Menu availability from stock (§13 of the inventory spec) has to
-- reach the public QR self-order page too, not just the staff POS --
-- site.html has its own copy of index.html's itemOff() (same reason
-- 018_enforce_self_order_feature.sql exists: gating one surface and
-- missing another is the recurring bug in this codebase), but it had
-- no way to know ingredient stock at all, since public_menu() never
-- returned it. Adding it here -- name + qty only, never cost/
-- purchases/vendor, since this is served to anonymous customers with
-- no login.
create or replace function public_menu(tenant_slug text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'items',  coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'item'  and not r.deleted), '[]'::jsonb),
    'cats',   coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'cat'   and not r.deleted), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'table' and not r.deleted), '[]'::jsonb),
    'ings',   coalesce((select jsonb_agg(jsonb_build_object('name', r.data->>'name', 'qty', r.data->'qty')) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'ing' and not r.deleted), '[]'::jsonb),
    'cfg',    coalesce((
                select r.data || jsonb_build_object(
                  '_features', coalesce(ts.features, '{}'::jsonb),
                  '_enabled_features', coalesce(ts.enabled_features, '{}'::jsonb)
                )
                from records r
                join tenants t on t.id = r.tenant_id
                left join tenant_settings ts on ts.tenant_id = t.id
                where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'
              ), '{}'::jsonb)
  )
$$;

-- place_order() never validated an individual item's own availability
-- at all -- only the self_order feature flag and a rate limit -- so a
-- replayed/crafted request could always order a sold-out or now-zero-
-- stock item regardless of what the public page's own itemOff() hides.
-- Pre-existing gap, not introduced here, but it's exactly the
-- enforcement half of "menu availability from stock" -- hiding it in
-- the UI without this is the same "looks gated, isn't" shape as the
-- self_order toggle bug 018 itself fixed.
create or replace function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cnt int; tid uuid; on_ boolean; line jsonb; item_data jsonb; part text; ing_name text; ing_qty numeric; g_qty numeric;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select coalesce(ts.features->>'self_order','false')::boolean
     and coalesce(ts.enabled_features->>'self_order','true')::boolean
    into on_ from tenant_settings ts where ts.tenant_id = tid;
  if not coalesce(on_, false) then
    raise exception 'self-order is currently turned off for this business';
  end if;

  select count(*) into cnt from guest_orders where tenant_id = tid and tbl = t and status = 'new' and created_at > now() - interval '30 minutes';
  if cnt >= 5 then raise exception 'busy: too many pending orders for this table'; end if;

  for line in select * from jsonb_array_elements(coalesce(its, '[]'::jsonb)) loop
    select r.data into item_data from records r where r.tenant_id = tid and r.kind = 'item' and r.id = line->>'id' and not r.deleted;
    if item_data is null then raise exception 'one of those items is no longer on the menu'; end if;
    if (item_data->>'off')::boolean and (item_data->>'offUntil' is null or (item_data->>'offUntil')::timestamptz > now()) then
      raise exception '% is currently sold out', item_data->>'name';
    end if;
    if item_data->>'rec' is not null and item_data->>'rec' != '' then
      foreach part in array string_to_array(item_data->>'rec', ',') loop
        ing_name := trim(split_part(part, ':', 1));
        select (r.data->>'qty')::numeric into g_qty from records r where r.tenant_id = tid and r.kind = 'ing' and not r.deleted and lower(r.data->>'name') = lower(ing_name) limit 1;
        if g_qty is not null and g_qty <= 0 then
          raise exception '% is currently out of stock', item_data->>'name';
        end if;
      end loop;
    end if;
  end loop;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items) values (tid, t, n, p, nt, its);
end;
$$;

-- Same allow-list additions inside push_record -- see 024's own
-- comment on why both places need updating together (RLS is the
-- fallback for any other access path; this hardcoded check is the
-- real gate for every write index.html actually makes).
create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid; myrole text; myemp text; authorized boolean := false;
begin
  tid := (me()->>'tenant_id')::uuid;
  myrole := me()->>'role';
  if tid is null then raise exception 'not authorized'; end if;

  if rkind in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'supplier', 'po') then
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
