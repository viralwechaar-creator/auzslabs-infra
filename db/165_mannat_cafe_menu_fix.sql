-- =========================================================
-- Fix for Mannat Cafe: db/164 silently skipped because the owner had
-- already opened the POS once, which auto-seeds a placeholder menu
-- (seed() in pos/shell.js: category 'Tea', 'Masala Tea' @ 25, 'Coffee'
-- @ 29/49, tables T1-T6) the first time any owner opens it with zero
-- categories -- db/164's own "skip if this tenant already has
-- categories" guard saw that placeholder and never ran. This deletes
-- ONLY that exact placeholder content (matched by name+price, same
-- caution as the original Mannat import's own note on this) before
-- re-running the same insert. Safe to run more than once: once the
-- real menu is in, there's nothing left matching the placeholder, and
-- the insert's own guard (no categories yet) then correctly skips.
-- =========================================================

do $$
declare
  v_tid uuid := '347a190b-3b5e-4fdf-a67a-3d86cd1c66f9';
  v_tea_cat text;
  v_item_count int;
begin
  select id into v_tea_cat from records
    where tenant_id = v_tid and kind = 'cat' and data->>'name' = 'Tea' and (data->>'n')::int = 1;
  if v_tea_cat is not null then
    select count(*) into v_item_count from records where tenant_id = v_tid and kind = 'item' and data->>'cat' = v_tea_cat;
    -- only the placeholder "Tea" category has exactly these 2 items -- the real
    -- one (from db/164's own import) has 5, so this never matches it, even
    -- though "Masala Tea" @ 25 happens to be a real item name/price too
    if v_item_count = 2
      and exists (select 1 from records where tenant_id = v_tid and kind = 'item' and data->>'cat' = v_tea_cat and data->>'name' = 'Masala Tea' and (data->>'price')::numeric = 25 and data->'sizes' = '[]'::jsonb)
      and exists (select 1 from records where tenant_id = v_tid and kind = 'item' and data->>'cat' = v_tea_cat and data->>'name' = 'Coffee' and (data->>'price')::numeric = 49)
    then
      delete from records where tenant_id = v_tid and kind = 'item' and data->>'cat' = v_tea_cat;
      delete from records where tenant_id = v_tid and kind = 'cat' and id = v_tea_cat;
    end if;
  end if;
  -- same caution for tables: only remove T1-T6 if there are exactly 6 tables total and
  -- they are exactly T1..T6 -- a tenant that renamed or added to them keeps its real tables
  if (select count(*) from records where tenant_id = v_tid and kind = 'table') = 6
    and (select count(*) from records where tenant_id = v_tid and kind = 'table' and data->>'name' in ('T1','T2','T3','T4','T5','T6')) = 6
  then
    delete from records where tenant_id = v_tid and kind = 'table' and data->>'name' in ('T1','T2','T3','T4','T5','T6');
  end if;
end $$;

do $$
declare
  v_tid uuid;
  cat_tea      uuid := gen_random_uuid();
  cat_coffee   uuid := gen_random_uuid();
  cat_shake    uuid := gen_random_uuid();
  cat_mojito   uuid := gen_random_uuid();
  cat_momos    uuid := gen_random_uuid();
  cat_pasta    uuid := gen_random_uuid();
  cat_fries    uuid := gen_random_uuid();
  cat_burger   uuid := gen_random_uuid();
  cat_chinese  uuid := gen_random_uuid();
  cat_maggi    uuid := gen_random_uuid();
  cat_sandwich uuid := gen_random_uuid();
  cat_pizza    uuid := gen_random_uuid();
begin
  select id into v_tid from tenants where id = '347a190b-3b5e-4fdf-a67a-3d86cd1c66f9';
  if v_tid is null then
    raise exception 'Mannat Cafe tenant (347a190b-...) not found -- check with the owner before re-running this';
  end if;

  if exists (select 1 from records where tenant_id = v_tid and kind = 'cat') then
    raise notice 'Mannat Cafe already has categories -- skipping, nothing changed';
    return;
  end if;

  -- ---- categories ----
  insert into records (id, tenant_id, kind, data, deleted, updated_at) values
    (cat_tea,      v_tid, 'cat', jsonb_build_object('id', cat_tea,      'name', 'Tea', 'n', 1), false, now()),
    (cat_coffee,   v_tid, 'cat', jsonb_build_object('id', cat_coffee,   'name', 'Coffee', 'n', 2), false, now()),
    (cat_shake,    v_tid, 'cat', jsonb_build_object('id', cat_shake,    'name', 'Shake', 'n', 3), false, now()),
    (cat_mojito,   v_tid, 'cat', jsonb_build_object('id', cat_mojito,   'name', 'Mojito', 'n', 4), false, now()),
    (cat_momos,    v_tid, 'cat', jsonb_build_object('id', cat_momos,    'name', 'Momos', 'n', 5), false, now()),
    (cat_pasta,    v_tid, 'cat', jsonb_build_object('id', cat_pasta,    'name', 'Pasta', 'n', 6), false, now()),
    (cat_fries,    v_tid, 'cat', jsonb_build_object('id', cat_fries,    'name', 'Fries', 'n', 7), false, now()),
    (cat_burger,   v_tid, 'cat', jsonb_build_object('id', cat_burger,   'name', 'Burger', 'n', 8), false, now()),
    (cat_chinese,  v_tid, 'cat', jsonb_build_object('id', cat_chinese,  'name', 'Chinese', 'n', 9), false, now()),
    (cat_maggi,    v_tid, 'cat', jsonb_build_object('id', cat_maggi,    'name', 'Maggi', 'n', 10), false, now()),
    (cat_sandwich, v_tid, 'cat', jsonb_build_object('id', cat_sandwich, 'name', 'Sandwich', 'n', 11), false, now()),
    (cat_pizza,    v_tid, 'cat', jsonb_build_object('id', cat_pizza,    'name', 'Pizza', 'n', 12), false, now());

  -- ---- Tea (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_tea, 'name', 'Tea', 'price', 15, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_tea, 'name', 'Masala Tea', 'price', 25, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_tea, 'name', 'Kesar Tea', 'price', 39, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_tea, 'name', 'Rose Tea', 'price', 25, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_tea, 'name', 'Lemon Tea', 'price', 25, 'sizes', '[]'::jsonb));

  -- ---- Coffee (M / L) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_coffee, 'name', 'Hot Coffee', 'price', 29, 'sizes', jsonb_build_array(jsonb_build_object('l','M','p',29), jsonb_build_object('l','L','p',49)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_coffee, 'name', 'Black Coffee', 'price', 29, 'sizes', jsonb_build_array(jsonb_build_object('l','M','p',29), jsonb_build_object('l','L','p',49)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_coffee, 'name', 'Cold Coffee', 'price', 59, 'sizes', jsonb_build_array(jsonb_build_object('l','M','p',59), jsonb_build_object('l','L','p',79)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_coffee, 'name', 'Cold Coffee with Ice Cream', 'price', 69, 'sizes', jsonb_build_array(jsonb_build_object('l','M','p',69), jsonb_build_object('l','L','p',89)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_coffee, 'name', 'Cold Coffee Ice Cream & Choco Chips', 'price', 79, 'sizes', jsonb_build_array(jsonb_build_object('l','M','p',79), jsonb_build_object('l','L','p',99))));

  -- ---- Shake (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Banana Shake', 'price', 59, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Mango Shake', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Papaya Shake', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Blue Berry Shake', 'price', 109, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Black Current Shake', 'price', 99, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Butter Scotch Shake', 'price', 119, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Apple Shake', 'price', 79, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Vanilla Shake', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Oreo Shake', 'price', 99, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'KitKat Shake', 'price', 109, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Strawberry Shake', 'price', 109, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_shake, 'name', 'Chocolate Shake', 'price', 99, 'sizes', '[]'::jsonb));

  -- ---- Mojito (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Green Mojito', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Mint Mojito', 'price', 59, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Blue Lagoon Mojito', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Watermelon Mojito', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Lemonade Mojito', 'price', 79, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_mojito, 'name', 'Ice-Tea Mojito', 'price', 89, 'sizes', '[]'::jsonb));

  -- ---- Momos (5 Pcs / 8 Pcs) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_momos, 'name', 'Veg Steam Momos', 'price', 49, 'sizes', jsonb_build_array(jsonb_build_object('l','5 Pcs','p',49), jsonb_build_object('l','8 Pcs','p',69)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_momos, 'name', 'Veg Fried Momos', 'price', 59, 'sizes', jsonb_build_array(jsonb_build_object('l','5 Pcs','p',59), jsonb_build_object('l','8 Pcs','p',79)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_momos, 'name', 'Steam Paneer Momos', 'price', 69, 'sizes', jsonb_build_array(jsonb_build_object('l','5 Pcs','p',69), jsonb_build_object('l','8 Pcs','p',89)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_momos, 'name', 'Fried Paneer Momos', 'price', 79, 'sizes', jsonb_build_array(jsonb_build_object('l','5 Pcs','p',79), jsonb_build_object('l','8 Pcs','p',89)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_momos, 'name', 'Gravy Momos', 'price', 69, 'sizes', jsonb_build_array(jsonb_build_object('l','5 Pcs','p',69), jsonb_build_object('l','8 Pcs','p',89))));

  -- ---- Pasta (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pasta, 'name', 'Marinara Pasta', 'price', 99, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pasta, 'name', 'Red Sauce Pasta', 'price', 119, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pasta, 'name', 'White Sauce Pasta', 'price', 149, 'sizes', '[]'::jsonb));

  -- ---- Fries (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'French Fries', 'price', 59, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'Masala French Fries', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'Cheese French Fries', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'Peri-Peri French Fries', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'Chilli Potato', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_fries, 'name', 'Honey Chilli Potato', 'price', 99, 'sizes', '[]'::jsonb));

  -- ---- Burger (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_burger, 'name', 'Aloo Tikki Burger', 'price', 49, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_burger, 'name', 'Double Tikki Burger', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_burger, 'name', 'Cheese Burger', 'price', 79, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_burger, 'name', 'Paneer Burger', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_burger, 'name', 'Green Veg Burger', 'price', 59, 'sizes', '[]'::jsonb));

  -- ---- Chinese (Half / Full) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_chinese, 'name', 'Chaumeen', 'price', 49, 'sizes', jsonb_build_array(jsonb_build_object('l','Half','p',49), jsonb_build_object('l','Full','p',69)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_chinese, 'name', 'Hakka Noodles', 'price', 79, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_chinese, 'name', 'Shezwan Noodles', 'price', 89, 'sizes', '[]'::jsonb));

  -- ---- Maggi (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_maggi, 'name', 'Plain Maggi', 'price', 39, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_maggi, 'name', 'Masala Maggi', 'price', 59, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_maggi, 'name', 'Veg Maggi', 'price', 69, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_maggi, 'name', 'Cheese Maggi', 'price', 79, 'sizes', '[]'::jsonb));

  -- ---- Sandwich (single price) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_sandwich, 'name', 'Veg Sandwich', 'price', 59, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_sandwich, 'name', 'Cheese Sandwich', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_sandwich, 'name', 'Paneer Sandwich', 'price', 89, 'sizes', '[]'::jsonb)),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_sandwich, 'name', 'Corn Sandwich', 'price', 69, 'sizes', '[]'::jsonb));

  -- ---- Pizza (S / L) ----
  insert into records (id, tenant_id, kind, data) values
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'OTC Pizza', 'price', 99, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',99), jsonb_build_object('l','L','p',139)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'Cheese Corn Pizza', 'price', 109, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',109), jsonb_build_object('l','L','p',149)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'Paneer Pizza', 'price', 129, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',129), jsonb_build_object('l','L','p',169)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'Margherita Pizza', 'price', 109, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',109), jsonb_build_object('l','L','p',149)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'Sweet Corn Pizza', 'price', 109, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',109), jsonb_build_object('l','L','p',149)))),
    (gen_random_uuid(), v_tid, 'item', jsonb_build_object('cat', cat_pizza, 'name', 'Vegetable Pizza', 'price', 89, 'sizes', jsonb_build_array(jsonb_build_object('l','S','p',89), jsonb_build_object('l','L','p',119))));

end $$;
