-- Owner screenshot: "Mannat Cafe" (a trial created before db/138-143 were
-- deployed) still shows the generic placeholder menu pos/shell.js's own
-- seed() creates on first POS login ("Masala Tea" Rs 25, "Coffee" M29/L49) --
-- no photos, because salesman_provision_trial()'s menu/photo seeding only
-- ever runs at the moment a NEW trial is created. It never reaches back and
-- fixes a trial made earlier, or one whose owner already opened the empty
-- POS and triggered seed() before the menu-seeding feature existed.
--
-- salesman_apply_demo_content(tenant_id) is the backfill: safe to call on
-- ANY of a salesman's own trials, any number of times.
--   - Retires the exact seed() placeholder (cat 'Tea', items 'Masala Tea'/
--     'Coffee' at the seed()-specific prices) the same way db/050 already
--     did for the real Mannat Cafe import -- soft-deleted, never hard
--     deleted, so a genuine "Masala Tea" the owner added later at a
--     different price is never touched.
--   - Adds the real 5-category/24-item demo menu + 6 tables ONLY if this
--     tenant has no categories left after that (so it never duplicates a
--     menu the salesman already built or already ran this on).
--   - Backfills `img` onto any item that still has none, matched to its own
--     category's default photo by name (best-effort; an item in a category
--     this function doesn't recognise is left exactly as it is).
--   - Sets siteHero/siteGallery only if they are not already set.

create or replace function salesman_apply_demo_content(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cat_hot uuid := gen_random_uuid(); cat_cold uuid := gen_random_uuid(); cat_snacks uuid := gen_random_uuid();
  cat_meals uuid := gen_random_uuid(); cat_desserts uuid := gen_random_uuid();
  tbl1 uuid := gen_random_uuid(); tbl2 uuid := gen_random_uuid(); tbl3 uuid := gen_random_uuid();
  tbl4 uuid := gen_random_uuid(); tbl5 uuid := gen_random_uuid(); tbl6 uuid := gen_random_uuid();
  img_hot text := '/assets/demo-menu/hot-beverages.jpg';
  img_cold text := '/assets/demo-menu/cold-beverages.jpg';
  img_snacks text := '/assets/demo-menu/snacks.jpg';
  img_meals text := '/assets/demo-menu/sandwiches.jpg';
  img_desserts text := '/assets/demo-menu/desserts.jpg';
  added_menu boolean := false;
  photos_backfilled int := 0;
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;

  -- retire the generic placeholder seed() leaves behind (db/050's own precedent)
  update records set deleted = true, updated_at = now()
    where tenant_id = p_tenant_id and kind = 'item' and data->>'name' in ('Masala Tea', 'Coffee') and not deleted
      and data->>'price' in ('25', '49');
  update records set deleted = true, updated_at = now()
    where tenant_id = p_tenant_id and kind = 'cat' and data->>'name' = 'Tea' and not deleted;

  if not exists(select 1 from records where tenant_id = p_tenant_id and kind = 'cat' and not deleted) then
    insert into records (id, tenant_id, kind, data) values
      (cat_hot,      p_tenant_id, 'cat', jsonb_build_object('id', cat_hot,      'name', 'Hot Beverages',   'n', 1)),
      (cat_cold,     p_tenant_id, 'cat', jsonb_build_object('id', cat_cold,     'name', 'Cold Beverages',   'n', 2)),
      (cat_snacks,   p_tenant_id, 'cat', jsonb_build_object('id', cat_snacks,   'name', 'Snacks & Starters','n', 3)),
      (cat_meals,    p_tenant_id, 'cat', jsonb_build_object('id', cat_meals,    'name', 'Sandwiches & Light Meals', 'n', 4)),
      (cat_desserts, p_tenant_id, 'cat', jsonb_build_object('id', cat_desserts, 'name', 'Desserts',         'n', 5));

    insert into records (id, tenant_id, kind, data) values
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Masala Chai',   'price', 30,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',30),  jsonb_build_object('l','Large','p',45)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Black Coffee',  'price', 40,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',40),  jsonb_build_object('l','Large','p',55)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cappuccino',    'price', 90,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cafe Latte',    'price', 100, 'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',100), jsonb_build_object('l','Large','p',130)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Hot Chocolate', 'price', 110, 'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',110), jsonb_build_object('l','Large','p',140)))),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Cold Coffee',          'price', 120, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',120), jsonb_build_object('l','Large','p',150)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Iced Tea',             'price', 90,  'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Fresh Lime Soda',      'price', 80,  'img', img_cold, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Mango Shake',          'price', 140, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',140), jsonb_build_object('l','Large','p',170)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Chocolate Milkshake',  'price', 150, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',150), jsonb_build_object('l','Large','p',180)))),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'French Fries',        'price', 140, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Veg Spring Roll',     'price', 160, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Chicken Wings',       'price', 220, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Paneer Tikka',        'price', 240, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Nachos with Salsa',   'price', 180, 'img', img_snacks, 'sizes', '[]'::jsonb)),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Grilled Veg Sandwich', 'price', 150, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Club Sandwich',        'price', 190, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Veg Burger',           'price', 140, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Chicken Burger',       'price', 180, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Pasta Alfredo',        'price', 230, 'img', img_meals, 'sizes', '[]'::jsonb)),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Brownie',    'price', 150, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Blueberry Cheesecake', 'price', 190, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Vanilla Ice Cream',    'price', 110, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Lava Cake',  'price', 170, 'img', img_desserts, 'sizes', '[]'::jsonb));

    if not exists(select 1 from records where tenant_id = p_tenant_id and kind = 'table' and not deleted) then
      insert into records (id, tenant_id, kind, data) values
        (tbl1, p_tenant_id, 'table', jsonb_build_object('id', tbl1, 'name', 'T1')),
        (tbl2, p_tenant_id, 'table', jsonb_build_object('id', tbl2, 'name', 'T2')),
        (tbl3, p_tenant_id, 'table', jsonb_build_object('id', tbl3, 'name', 'T3')),
        (tbl4, p_tenant_id, 'table', jsonb_build_object('id', tbl4, 'name', 'T4')),
        (tbl5, p_tenant_id, 'table', jsonb_build_object('id', tbl5, 'name', 'T5')),
        (tbl6, p_tenant_id, 'table', jsonb_build_object('id', tbl6, 'name', 'T6'));
    end if;

    added_menu := true;
  else
    -- a real menu already exists -- just backfill a photo onto any item
    -- that doesn't have one yet, best-effort matched by its category's name
    update records r set data = r.data || jsonb_build_object('img',
      case lower(coalesce((select c.data->>'name' from records c where c.tenant_id = p_tenant_id and c.kind = 'cat' and c.id = r.data->>'cat' and not c.deleted), ''))
        when 'hot beverages' then img_hot
        when 'cold beverages' then img_cold
        when 'snacks & starters' then img_snacks
        when 'sandwiches & light meals' then img_meals
        when 'desserts' then img_desserts
        else img_hot
      end), updated_at = now()
      where r.tenant_id = p_tenant_id and r.kind = 'item' and not r.deleted and (r.data->>'img' is null or r.data->>'img' = '');
    get diagnostics photos_backfilled = row_count;
  end if;

  update records set data = data ||
    (case when data->>'siteHero' is null or data->>'siteHero' = '' then jsonb_build_object('siteHero', '/assets/demo-menu/hero.jpg') else '{}'::jsonb end) ||
    (case when data->>'siteGallery' is null or data->>'siteGallery' = '' then
      jsonb_build_object('siteGallery', '/assets/demo-menu/gallery-burger.jpg,/assets/demo-menu/gallery-coldbrew.jpg,/assets/demo-menu/gallery-fries.jpg')
    else '{}'::jsonb end),
    updated_at = now()
    where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';

  return jsonb_build_object('added_menu', added_menu, 'photos_backfilled', photos_backfilled);
end $$;
