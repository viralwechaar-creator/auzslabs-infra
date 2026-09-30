-- =========================================================
-- db/049 refused to touch mannatcafe because that tenant already
-- existed by the time it ran -- created earlier through the normal
-- admin onboarding flow, not by 049. When its owner first opened the
-- POS with zero categories, the app's own seed() auto-ran (index.html
-- boot(): "if owner && no categories && not already seeded"),
-- creating a placeholder "Tea" category with Masala Tea ₹25 / Coffee
-- ₹49 -- generic demo content, not anything from the Spice Yard PDF.
--
-- This migration finishes the job against that SAME existing tenant:
-- retires the auto-seeded placeholder category/items (soft-deleted,
-- not hard-deleted, matching this app's own convention -- so nothing
-- is silently destroyed, just hidden), then adds the real 6-category/
-- 34-item/30-ingredient catalogue db/049 would have created. Leaves
-- the tenant row, both existing owner logins, tenant_settings and the
-- auto-created tables (T1-T6) completely untouched.
-- =========================================================

do $$
declare
  tid uuid := (select id from tenants where slug = 'mannatcafe');
  preset niche_presets%rowtype;
  cat_starters uuid := gen_random_uuid();
  cat_main uuid := gen_random_uuid();
  cat_breads uuid := gen_random_uuid();
  cat_rice uuid := gen_random_uuid();
  cat_bev uuid := gen_random_uuid();
  cat_dessert uuid := gen_random_uuid();
begin
  if tid is null then
    raise exception 'no mannatcafe tenant found -- run db/049 first';
  end if;

  if exists (select 1 from records where tenant_id = tid and kind = 'cat' and data->>'name' = 'Starters' and not deleted) then
    raise exception 'mannatcafe already has the real menu -- this migration is one-time only';
  end if;

  -- retire the auto-seeded placeholder content (soft delete, same as
  -- every delete in this app -- see save(kind,data,id,true))
  update records set deleted = true, updated_at = now()
    where tenant_id = tid and kind = 'item' and data->>'name' in ('Masala Tea', 'Coffee') and not deleted
      and data->>'price' in ('25', '49'); -- the seed()-specific prices, so a real "Masala Tea"/"Coffee" added later by the owner is never caught by this
  update records set deleted = true, updated_at = now()
    where tenant_id = tid and kind = 'cat' and data->>'name' = 'Tea' and not deleted;

  select * into preset from niche_presets where niche = 'cafe';

  -- upsert, not insert -- provision_tenant (or the admin onboarding
  -- flow that created this tenant) already left a settings row behind
  insert into records (id, tenant_id, kind, data, deleted, updated_at) values
    ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', 'Mannat Cafe'), false, now())
  on conflict (tenant_id, id) do update set data = records.data || excluded.data, deleted = false, updated_at = now();

  -- ---- categories ----
  insert into records (id, tenant_id, kind, data, deleted, updated_at) values
    (cat_starters, tid, 'cat', jsonb_build_object('id', cat_starters, 'name', 'Starters', 'n', 1), false, now()),
    (cat_main,     tid, 'cat', jsonb_build_object('id', cat_main,     'name', 'Main Course', 'n', 2), false, now()),
    (cat_breads,   tid, 'cat', jsonb_build_object('id', cat_breads,   'name', 'Breads', 'n', 3), false, now()),
    (cat_rice,     tid, 'cat', jsonb_build_object('id', cat_rice,     'name', 'Rice & Sides', 'n', 4), false, now()),
    (cat_bev,      tid, 'cat', jsonb_build_object('id', cat_bev,      'name', 'Beverages', 'n', 5), false, now()),
    (cat_dessert,  tid, 'cat', jsonb_build_object('id', cat_dessert,  'name', 'Desserts', 'n', 6), false, now());

  -- ---- ingredient master (opening stock as given in the PDF) ----
  insert into records (id, tenant_id, kind, data, deleted, updated_at)
  select gen_random_uuid(), tid, 'ing', jsonb_build_object('name', name, 'unit', unit, 'qty', qty, 'low', low), false, now()
  from (values
    ('Basmati Rice','kg',45,15),('Maida','kg',30,10),('Paneer','kg',15,5),('Chicken','kg',35,10),
    ('Yellow Dal','kg',20,6),('Onion','kg',40,12),('Tomato','kg',35,10),('Potato','kg',25,8),
    ('Capsicum','kg',12,4),('Curd','kg',20,6),('Cream','L',10,3),('Butter','kg',8,2),
    ('Cooking Oil','L',35,10),('Garlic','kg',5,2),('Ginger','kg',5,2),('Green Chilli','kg',4,1),
    ('Coriander','kg',4,1),('Mint','kg',3,1),('Biryani Masala','kg',3,1),('Garam Masala','kg',2,0.5),
    ('Red Chilli Powder','kg',3,1),('Turmeric','kg',3,1),('Salt','kg',15,5),('Sugar','kg',15,5),
    ('Tea','kg',4,1),('Coffee','kg',3,1),('Milk','L',30,10),('Lemon','kg',8,2),
    ('Ice Cream','L',10,3),('Chocolate Syrup','L',5,1)
  ) as ing(name, unit, qty, low);

  -- ---- menu items (price/serving from the PDF; rec = "Ingredient:qty,..."
  -- in the SAME unit as that ingredient's stock above, kg/L not g/ml) ----
  insert into records (id, tenant_id, kind, data, deleted, updated_at) values
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Paneer Tikka', 'price', 280, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Paneer:0.2, Curd:0.04, Capsicum:0.03, Onion:0.02, Ginger:0.005, Garlic:0.005, Red Chilli Powder:0.005, Garam Masala:0.003, Cooking Oil:0.01, Lemon:0.005'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Chicken Tikka', 'price', 320, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Chicken:0.22, Curd:0.05, Ginger:0.008, Garlic:0.008, Red Chilli Powder:0.006, Garam Masala:0.004, Cooking Oil:0.01, Lemon:0.008'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Veg Spring Roll', 'price', 180, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.08, Potato:0.06, Capsicum:0.04, Onion:0.03, Cooking Oil:0.03, Salt:0.003'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Crispy Corn', 'price', 190, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Capsicum:0.03, Onion:0.02, Cooking Oil:0.02, Red Chilli Powder:0.005, Salt:0.003'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Chicken 65', 'price', 300, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Chicken:0.22, Curd:0.03, Ginger:0.006, Garlic:0.006, Red Chilli Powder:0.008, Cooking Oil:0.02, Salt:0.003'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_starters, 'name', 'Hara Bhara Kebab', 'price', 220, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Potato:0.1, Green Chilli:0.005, Ginger:0.005, Garam Masala:0.003, Cooking Oil:0.02, Salt:0.003, Coriander:0.005'), false, now()),

    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Paneer Butter Masala', 'price', 290, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Paneer:0.18, Tomato:0.12, Butter:0.025, Cream:0.04, Onion:0.05, Ginger:0.005, Garlic:0.005, Garam Masala:0.004, Red Chilli Powder:0.004, Cooking Oil:0.01'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Kadai Paneer', 'price', 280, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Paneer:0.18, Capsicum:0.06, Onion:0.05, Tomato:0.06, Garlic:0.006, Ginger:0.005, Red Chilli Powder:0.005, Garam Masala:0.004, Cooking Oil:0.015'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Dal Tadka', 'price', 190, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Yellow Dal:0.1, Tomato:0.05, Onion:0.04, Butter:0.015, Cooking Oil:0.01, Garlic:0.01, Garam Masala:0.003, Turmeric:0.002, Coriander:0.005'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Butter Chicken', 'price', 340, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Chicken:0.22, Tomato:0.1, Butter:0.03, Cream:0.05, Onion:0.04, Ginger:0.006, Garlic:0.006, Garam Masala:0.005, Red Chilli Powder:0.005'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Chicken Curry', 'price', 320, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Chicken:0.25, Onion:0.06, Tomato:0.06, Ginger:0.008, Garlic:0.008, Red Chilli Powder:0.006, Turmeric:0.003, Garam Masala:0.004, Cooking Oil:0.02'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Veg Biryani', 'price', 260, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Basmati Rice:0.18, Potato:0.04, Capsicum:0.03, Onion:0.05, Tomato:0.03, Curd:0.03, Cooking Oil:0.02, Biryani Masala:0.008, Mint:0.004, Coriander:0.004, Salt:0.004'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_main, 'name', 'Chicken Biryani', 'price', 330, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Basmati Rice:0.18, Chicken:0.22, Onion:0.06, Tomato:0.04, Curd:0.05, Cooking Oil:0.025, Ginger:0.008, Garlic:0.008, Biryani Masala:0.01, Mint:0.005, Coriander:0.005, Salt:0.005'), false, now()),

    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Tandoori Roti', 'price', 30, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.03, Salt:0.001'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Butter Roti', 'price', 40, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.03, Butter:0.008, Salt:0.001'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Plain Naan', 'price', 50, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.06, Curd:0.01, Salt:0.001'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Butter Naan', 'price', 65, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.06, Curd:0.01, Butter:0.012, Salt:0.001'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Garlic Naan', 'price', 80, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.1, Curd:0.02, Butter:0.015, Garlic:0.008, Coriander:0.003, Salt:0.002'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_breads, 'name', 'Cheese Naan', 'price', 120, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Maida:0.07, Curd:0.015, Butter:0.01'), false, now()),

    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_rice, 'name', 'Jeera Rice', 'price', 180, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Basmati Rice:0.15, Butter:0.01, Cooking Oil:0.005, Salt:0.003'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_rice, 'name', 'Veg Fried Rice', 'price', 220, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Basmati Rice:0.18, Capsicum:0.04, Onion:0.03, Cooking Oil:0.015, Salt:0.004'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_rice, 'name', 'Chicken Fried Rice', 'price', 280, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Basmati Rice:0.18, Chicken:0.1, Capsicum:0.04, Onion:0.03, Cooking Oil:0.015, Salt:0.004'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_rice, 'name', 'Plain Raita', 'price', 90, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Curd:0.18, Salt:0.002'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_rice, 'name', 'Boondi Raita', 'price', 110, 'sizes', '[]'::jsonb, 'st', 'Kitchen', 'rec', 'Curd:0.17, Salt:0.002'), false, now()),

    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Masala Chaas', 'price', 80, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', 'Curd:0.15, Salt:0.002'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Sweet Lassi', 'price', 120, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', 'Curd:0.2, Sugar:0.02'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Fresh Lime Soda', 'price', 100, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', 'Lemon:0.03, Sugar:0.015'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Cold Coffee', 'price', 160, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', 'Milk:0.25, Coffee:0.01, Sugar:0.015'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Masala Tea', 'price', 60, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', 'Milk:0.1, Tea:0.005, Sugar:0.01'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_bev, 'name', 'Mineral Water', 'price', 40, 'sizes', '[]'::jsonb, 'st', 'Bar', 'rec', ''), false, now()),

    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_dessert, 'name', 'Gulab Jamun', 'price', 100, 'sizes', '[]'::jsonb, 'st', 'Dessert', 'rec', 'Milk:0.03, Maida:0.015, Sugar:0.04'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_dessert, 'name', 'Brownie', 'price', 150, 'sizes', '[]'::jsonb, 'st', 'Dessert', 'rec', 'Maida:0.04, Butter:0.015, Sugar:0.02, Chocolate Syrup:0.02'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_dessert, 'name', 'Vanilla Ice Cream', 'price', 130, 'sizes', '[]'::jsonb, 'st', 'Dessert', 'rec', 'Ice Cream:0.12'), false, now()),
    (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_dessert, 'name', 'Chocolate Shake', 'price', 180, 'sizes', '[]'::jsonb, 'st', 'Dessert', 'rec', 'Milk:0.2, Ice Cream:0.06, Chocolate Syrup:0.03, Sugar:0.01'), false, now());

end $$;
