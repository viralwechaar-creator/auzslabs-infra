-- =========================================================
-- db/023_demo_tenants.sql seeded a catalog thin enough that both demo
-- tenants still look mostly empty the moment you leave the POS/billing
-- tab -- no ingredients, no recipes, no low-stock/reorder signal, no
-- coupon, no Payroll data at all. This fills every OTHER static, safe
-- thing a demo tenant is missing -- catalog breadth, ingredient stock
-- + recipes (cafe), a coupon, shift definitions, and a few sample
-- employees for the now-standalone Payroll app (app/public/payroll.html).
--
-- Still deliberately NOT seeded: any order/sale, any CRM customer, any
-- payslip. Those are derived from real activity (CRM is order.cust
-- aggregated in memory -- see V.crm in index.html -- there's no
-- separate customer table to seed), and 023's own comment already
-- covers why: a prospect's own first order *is* the demo, not
-- something to fake in advance. Faking sales history here would also
-- corrupt the shared public demo for every other visitor at once,
-- since both logins are shared, not per-visitor.
-- =========================================================

do $$
declare
  cafe_tid uuid;
  retail_tid uuid;
begin
  select id into cafe_tid from tenants where slug = 'demo-cafe';
  select id into retail_tid from tenants where slug = 'demo-retail';

  -- index.html's cfg() only ever sees tenant_settings/records -- it has
  -- no way to read tenants.is_demo -- so the client-side niche preview
  -- switcher (see effBizType()/PREVIEW_CATALOGS in index.html) gates on
  -- this instead, merged into the same jsonb every other setting lives
  -- in rather than replacing the whole object (matches 023's own rule).
  update records set data = data || jsonb_build_object('isDemo', true)
    where tenant_id in (cafe_tid, retail_tid) and kind = 'settings' and id = 'settings';

  -- ---- demo-cafe: broader menu across more categories ----
  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-cat-main', cafe_tid, 'cat', jsonb_build_object('id', 'demo-cafe-cat-main', 'name', 'Main Course', 'n', 3)),
    ('demo-cafe-cat-dessert', cafe_tid, 'cat', jsonb_build_object('id', 'demo-cafe-cat-dessert', 'name', 'Desserts', 'n', 4)),

    ('demo-cafe-item-coldcoffee', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-coldcoffee', 'name', 'Cold Coffee', 'cat', 'demo-cafe-cat-bev', 'price', 90, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'rec', 'Milk:0.2, Coffee powder:15, Sugar:10', 'cost', 35, 'st', 'Bar')),
    ('demo-cafe-item-lemonade', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-lemonade', 'name', 'Fresh Lime Soda', 'cat', 'demo-cafe-cat-bev', 'price', 70, 'sizes', '[]'::jsonb, 'mods', jsonb_build_array('Sweet:0', 'Salted:0'), 'cost', 20, 'st', 'Bar')),

    ('demo-cafe-item-club', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-club', 'name', 'Club Sandwich', 'cat', 'demo-cafe-cat-food', 'price', 120, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'rec', 'Bread:3, Cheese:30', 'cost', 55, 'st', 'Kitchen')),
    ('demo-cafe-item-frenchfries', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-frenchfries', 'name', 'French Fries', 'cat', 'demo-cafe-cat-food', 'price', 80, 'sizes', '[]'::jsonb, 'mods', jsonb_build_array('Peri peri:10', 'Cheese dip:20'), 'cost', 30, 'st', 'Kitchen')),

    ('demo-cafe-item-paneertikka', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-paneertikka', 'name', 'Paneer Tikka', 'cat', 'demo-cafe-cat-main', 'price', 220, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'rec', 'Paneer:150', 'cost', 110, 'st', 'Kitchen')),
    ('demo-cafe-item-biryani', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-biryani', 'name', 'Veg Biryani', 'cat', 'demo-cafe-cat-main', 'price', 180, 'sizes', jsonb_build_array(jsonb_build_object('l', 'Half', 'p', 130), jsonb_build_object('l', 'Full', 'p', 180)), 'mods', '[]'::jsonb, 'rec', 'Rice:200', 'cost', 75, 'st', 'Kitchen')),

    ('demo-cafe-item-gulabjamun', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-gulabjamun', 'name', 'Gulab Jamun (2 pc)', 'cat', 'demo-cafe-cat-dessert', 'price', 60, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'cost', 22, 'st', 'Dessert')),
    ('demo-cafe-item-brownie', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-brownie', 'name', 'Chocolate Brownie', 'cat', 'demo-cafe-cat-dessert', 'price', 110, 'sizes', '[]'::jsonb, 'mods', jsonb_build_array('With ice cream:40'), 'cost', 45, 'st', 'Dessert'))
  on conflict (tenant_id, id) do nothing;

  -- give the two items that already existed a recipe + cost too, so
  -- every menu item now deducts real ingredient stock on sale
  update records set data = data || jsonb_build_object('rec', 'Milk:0.15, Tea leaves:3, Sugar:8', 'cost', 8)
    where tenant_id = cafe_tid and kind = 'item' and id = 'demo-cafe-item-tea';
  update records set data = data || jsonb_build_object('rec', 'Milk:0.2, Coffee powder:18, Sugar:8', 'cost', 22)
    where tenant_id = cafe_tid and kind = 'item' and id = 'demo-cafe-item-coffee';
  update records set data = data || jsonb_build_object('rec', 'Bread:2, Cheese:20', 'cost', 40)
    where tenant_id = cafe_tid and kind = 'item' and id = 'demo-cafe-item-sandwich';
  update records set data = data || jsonb_build_object('rec', 'Rice:180, Cheese:15', 'cost', 60)
    where tenant_id = cafe_tid and kind = 'item' and id = 'demo-cafe-item-pasta';

  -- ingredient stock (kind='ing') -- what every 'rec' string above
  -- refers to by name. Coffee powder and Bread are seeded already
  -- below their own low-stock threshold, on purpose, so the Inventory
  -- tab's low-stock banner and Reports' reorder-alert both have
  -- something real to show without needing any sales first.
  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-ing-milk', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-milk', 'name', 'Milk', 'unit', 'L', 'qty', 8, 'low', 3)),
    ('demo-cafe-ing-tea', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-tea', 'name', 'Tea leaves', 'unit', 'g', 'qty', 400, 'low', 100)),
    ('demo-cafe-ing-coffee', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-coffee', 'name', 'Coffee powder', 'unit', 'g', 'qty', 60, 'low', 100)),
    ('demo-cafe-ing-sugar', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-sugar', 'name', 'Sugar', 'unit', 'g', 'qty', 2000, 'low', 500)),
    ('demo-cafe-ing-bread', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-bread', 'name', 'Bread', 'unit', 'pc', 'qty', 4, 'low', 10)),
    ('demo-cafe-ing-cheese', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-cheese', 'name', 'Cheese', 'unit', 'g', 'qty', 1500, 'low', 300)),
    ('demo-cafe-ing-paneer', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-paneer', 'name', 'Paneer', 'unit', 'g', 'qty', 2000, 'low', 500)),
    ('demo-cafe-ing-rice', cafe_tid, 'ing', jsonb_build_object('id', 'demo-cafe-ing-rice', 'name', 'Rice', 'unit', 'g', 'qty', 5000, 'low', 1000))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-coupon-welcome', cafe_tid, 'coupon', jsonb_build_object('id', 'demo-cafe-coupon-welcome', 'code', 'WELCOME10', 'type', '%', 'value', 10, 'expiry', null, 'maxUses', null))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-shift-morning', cafe_tid, 'hr_shift', jsonb_build_object('id', 'demo-cafe-shift-morning', 'name', 'Morning', 'start', '08:00', 'end', '16:00', 'overnight', false)),
    ('demo-cafe-shift-evening', cafe_tid, 'hr_shift', jsonb_build_object('id', 'demo-cafe-shift-evening', 'name', 'Evening', 'start', '16:00', 'end', '23:00', 'overnight', false))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-emp-1', cafe_tid, 'hr_employee', jsonb_build_object(
      'id', 'demo-cafe-emp-1', 'name', 'Ananya Rao', 'empId', 'EMP-01', 'dept', 'Kitchen', 'designation', 'Head Chef',
      'phone', '9800000001', 'dateJoined', '2025-01-15', 'shiftId', 'demo-cafe-shift-morning', 'authEmail', '', 'authUserId', null,
      'active', true, 'salaryStructure', jsonb_build_object('basic', 22000, 'hra', 4000, 'allowances', 2000, 'otRate', 150)
    )),
    ('demo-cafe-emp-2', cafe_tid, 'hr_employee', jsonb_build_object(
      'id', 'demo-cafe-emp-2', 'name', 'Rohit Sharma', 'empId', 'EMP-02', 'dept', 'Front of house', 'designation', 'Server',
      'phone', '9800000002', 'dateJoined', '2025-03-01', 'shiftId', 'demo-cafe-shift-evening', 'authEmail', '', 'authUserId', null,
      'active', true, 'salaryStructure', jsonb_build_object('basic', 15000, 'hra', 2500, 'allowances', 1000, 'otRate', 100)
    ))
  on conflict (tenant_id, id) do nothing;

  -- ---- demo-retail: broader catalog across more categories ----
  insert into records (id, tenant_id, kind, data) values
    ('demo-retail-cat-women', retail_tid, 'cat', jsonb_build_object('id', 'demo-retail-cat-women', 'name', 'Women''s Tops', 'n', 3)),
    ('demo-retail-cat-access', retail_tid, 'cat', jsonb_build_object('id', 'demo-retail-cat-access', 'name', 'Accessories', 'n', 4)),

    ('demo-retail-item-shirt', retail_tid, 'item', jsonb_build_object(
      'id', 'demo-retail-item-shirt', 'name', 'Formal Shirt', 'cat', 'demo-retail-cat-men', 'price', 899, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'cost', 420,
      'variants', jsonb_build_array(
        jsonb_build_object('size', 'M', 'color', 'White', 'barcode', null, 'qty', 9),
        jsonb_build_object('size', 'L', 'color', 'White', 'barcode', null, 'qty', 7),
        jsonb_build_object('size', 'XL', 'color', 'White', 'barcode', null, 'qty', 5),
        jsonb_build_object('size', 'M', 'color', 'Sky Blue', 'barcode', null, 'qty', 6)
      )
    )),
    ('demo-retail-item-kurti', retail_tid, 'item', jsonb_build_object(
      'id', 'demo-retail-item-kurti', 'name', 'Printed Kurti', 'cat', 'demo-retail-cat-women', 'price', 649, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'cost', 300,
      'variants', jsonb_build_array(
        jsonb_build_object('size', 'S', 'color', 'Yellow', 'barcode', null, 'qty', 5),
        jsonb_build_object('size', 'M', 'color', 'Yellow', 'barcode', null, 'qty', 7),
        jsonb_build_object('size', 'L', 'color', 'Yellow', 'barcode', null, 'qty', 4),
        jsonb_build_object('size', 'M', 'color', 'Maroon', 'barcode', null, 'qty', 1)
      )
    )),
    ('demo-retail-item-belt', retail_tid, 'item', jsonb_build_object(
      'id', 'demo-retail-item-belt', 'name', 'Leather Belt', 'cat', 'demo-retail-cat-access', 'price', 399, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb, 'cost', 150,
      'variants', jsonb_build_array(
        jsonb_build_object('size', 'Free size', 'color', 'Black', 'barcode', null, 'qty', 1),
        jsonb_build_object('size', 'Free size', 'color', 'Brown', 'barcode', null, 'qty', 6)
      )
    ))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-retail-coupon-welcome', retail_tid, 'coupon', jsonb_build_object('id', 'demo-retail-coupon-welcome', 'code', 'WELCOME10', 'type', '%', 'value', 10, 'expiry', null, 'maxUses', null))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-retail-shift-store', retail_tid, 'hr_shift', jsonb_build_object('id', 'demo-retail-shift-store', 'name', 'Store hours', 'start', '10:00', 'end', '20:00', 'overnight', false))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-retail-emp-1', retail_tid, 'hr_employee', jsonb_build_object(
      'id', 'demo-retail-emp-1', 'name', 'Priya Menon', 'empId', 'EMP-01', 'dept', 'Sales floor', 'designation', 'Store associate',
      'phone', '9800000003', 'dateJoined', '2025-02-10', 'shiftId', 'demo-retail-shift-store', 'authEmail', '', 'authUserId', null,
      'active', true, 'salaryStructure', jsonb_build_object('basic', 16000, 'hra', 2500, 'allowances', 1000, 'otRate', 100)
    ))
  on conflict (tenant_id, id) do nothing;
end $$;
