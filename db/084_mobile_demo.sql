-- =========================================================
-- AUZsMob: fold into the one consolidated demo tenant (see CLAUDE.md "One consolidated demo tenant",
-- db/078) instead of standing up a fourth separate demo tenant -- the same owner login that already
-- shows off POS/Payroll/Accounting now also shows AUZsMob, at https://demo.auzslab.in/mob.html.
--
-- mob_context() is every mob client's one bootstrap call (app/public/mob/shell.js's boot()), so it is
-- the natural place for the "demo data older than 12h gets rebuilt" check -- the exact same pattern as
-- acc_bootstrap() (db/064) and pay_bootstrap(), just folded into the call this module already makes on
-- every page load instead of a separate RPC.
-- =========================================================

alter table mob_settings add column if not exists demo_seeded_at timestamptz;

-- mob_demo_seed: richer than the original stub -- a phone still in stock (so Sell/offline-catalog has
-- something to find), a second phone already sold on credit (so Reports/Dues has something to show),
-- and an open repair job (so Repairs isn't empty either).
create or replace function mob_demo_seed(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid; phone_item uuid := gen_random_uuid(); acc_item uuid := gen_random_uuid();
  unit1 uuid := gen_random_uuid(); unit2 uuid := gen_random_uuid(); sale1 uuid := gen_random_uuid(); repair1 uuid := gen_random_uuid();
begin
  select id into owner_id from profiles where tenant_id = tid and role = 'owner' limit 1;
  if owner_id is null then return; end if;
  delete from mob_audit where tenant_id = tid; delete from mob_payments where tenant_id = tid;
  delete from mob_repair_events where tenant_id = tid; delete from mob_repairs where tenant_id = tid;
  delete from mob_sales where tenant_id = tid; delete from mob_purchases where tenant_id = tid;
  delete from mob_stock_movements where tenant_id = tid; delete from mob_item_units where tenant_id = tid; delete from mob_items where tenant_id = tid;
  delete from mob_vendors where tenant_id = tid; delete from mob_customers where tenant_id = tid;

  insert into mob_settings (tenant_id, shop_name, address, phone, demo_seeded_at) values (tid, 'AUZsMob Demo Shop', 'MG Road, Demo City', '9000000000', now())
    on conflict (tenant_id) do update set shop_name = excluded.shop_name, demo_seeded_at = now();

  insert into mob_items (id, tenant_id, name, category, serialized, selling_price, cost_price, low_stock_at, created_by) values
    (phone_item, tid, 'Galaxy A14 (Demo)', 'phone_new', true, 14999, 12000, 0, owner_id),
    (acc_item, tid, 'USB-C Cable (Demo)', 'accessory', false, 199, 90, 5, owner_id);

  -- one phone still in stock
  insert into mob_item_units (id, tenant_id, item_id, imei, source, condition, cost_price, status, created_by) values
    (unit1, tid, phone_item, '100000000000001', 'new', 'new', 12000, 'in_stock', owner_id);
  insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, staff_id) values
    (gen_random_uuid(), tid, phone_item, unit1, 1, 'purchase', owner_id),
    (gen_random_uuid(), tid, acc_item, null, 20, 'purchase', owner_id);

  -- a second phone, bought and sold on part-credit -- shows up in Reports and Dues
  insert into mob_item_units (id, tenant_id, item_id, imei, source, condition, cost_price, status, created_by) values
    (unit2, tid, phone_item, '100000000000002', 'new', 'new', 12000, 'sold', owner_id);
  insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, staff_id, created_at) values
    (gen_random_uuid(), tid, phone_item, unit2, 1, 'purchase', owner_id, now() - interval '2 days'),
    (gen_random_uuid(), tid, phone_item, unit2, -1, 'sale', owner_id, now() - interval '1 day');
  insert into mob_sales (id, tenant_id, bill_no, customer_name, customer_phone, items, subtotal, discount, total, paid, balance, payment_mode, staff_id, created_at) values
    (sale1, tid, 'BILL-DEMO-1', 'Demo Customer', '9876500000',
     jsonb_build_array(jsonb_build_object('itemId', phone_item, 'unitId', unit2, 'name', 'Galaxy A14 (Demo)', 'qty', 1, 'price', 14999, 'costPrice', 12000)),
     14999, 0, 14999, 10000, 4999, 'credit', owner_id, now() - interval '1 day');

  -- an open repair job
  insert into mob_repairs (id, tenant_id, customer_name, customer_phone, device_model, imei, problem, advance, estimate, warranty_days, staff_id, created_at) values
    (repair1, tid, 'Demo Walk-in', '9876500001', 'iPhone 11 (Demo)', null, 'Cracked screen', 500, 2500, 30, owner_id, now() - interval '3 hours');
  insert into mob_repair_events (id, tenant_id, repair_id, type, status, staff_id, created_at) values
    (gen_random_uuid(), tid, repair1, 'status', 'received', owner_id, now() - interval '3 hours'),
    (gen_random_uuid(), tid, repair1, 'status', 'in_repair', owner_id, now() - interval '1 hour');
end $$;

-- mob_context: now also the demo-refresh bootstrap, same shape as acc_bootstrap (db/064) -- a demo
-- tenant's mobile data older than 12h (or never seeded) is rebuilt before the context is returned.
create or replace function mob_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s mob_settings; lang text; demo boolean; seeded timestamptz; caller_uid text;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is not null then
    select is_demo into demo from tenants where id = tid;
    if demo and coalesce((select features->>'mobile' from tenant_settings where tenant_id = tid), 'false') = 'true' then
      select demo_seeded_at into seeded from mob_settings where tenant_id = tid;
      if (seeded is null or now() - seeded > interval '12 hours') and pg_try_advisory_xact_lock(hashtext('mob_demo_reset')) then
        caller_uid := current_setting('app.uid', true);
        perform mob_demo_seed(tid);
        perform set_config('app.uid', caller_uid, true);
      end if;
    end if;
  end if;

  tid := mob_tenant();
  select * into s from mob_settings where tenant_id = tid;
  if s.tenant_id is null then
    -- first visit: create a default settings row so every later read/write has one to update
    insert into mob_settings (tenant_id) values (tid) on conflict (tenant_id) do nothing returning * into s;
    if s.tenant_id is null then select * into s from mob_settings where tenant_id = tid; end if;
  end if;
  select language into lang from mob_staff_prefs where tenant_id = tid and user_id = app_uid();
  return jsonb_build_object(
    'perms', mob_perms(),
    'can_see_rates', (me()->>'role') in ('owner', 'manager') or coalesce(s.staff_see_purchase_rates, false),
    'settings', jsonb_build_object(
      'shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'logoUrl', s.logo_url,
      'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language,
      'staffSeePurchaseRates', s.staff_see_purchase_rates, 'dayCloseDate', s.day_close_date
    ),
    'my_language', coalesce(lang, s.language, 'en')
  );
end $$;

-- Enable it on the live consolidated demo tenant (no-op, harmlessly, if that tenant does not exist in
-- this environment yet -- e.g. a fresh install that has not run db/078 against real data).
update tenant_settings set features = features || '{"mobile": true}'::jsonb
  where tenant_id = (select id from tenants where slug = 'demo' and is_demo);
