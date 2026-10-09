-- Owner request: stop putting the SAME category photo on every item in that
-- category -- match each item to a photo that actually shows that dish,
-- and leave an item with no genuine match without one at all (it already
-- falls back to the category's own drawn icon, see site.html's phArt() --
-- a deliberate "no photo yet" look, not a random or wrong one). Also: stop
-- setting a default gallery -- the owner uploads that themselves.
--
-- Of the 9 photos actually supplied, only these are a real match for a
-- specific seeded dish:
--   Masala Chai            -> hot-beverages.jpg   (a steaming chai glass)
--   Cappuccino              -> hero.jpg            (a real cappuccino, cup+latte art)
--   Cold Coffee             -> cold-beverages.jpg  (a cold/iced coffee glass)
--   Chocolate Milkshake     -> gallery-coldbrew.jpg (cream-topped iced drink)
--   French Fries            -> gallery-fries.jpg   (a real fries plate)
--   Veg Spring Roll         -> snacks.jpg          (real spring rolls)
--   Grilled Veg Sandwich    -> sandwiches.jpg      (a real grilled sandwich)
--   Club Sandwich           -> sandwiches.jpg      (same dish type, genuine match)
--   Veg Burger              -> gallery-burger.jpg  (a real burger)
--   Chicken Burger          -> gallery-burger.jpg  (same dish type, genuine match)
-- The other 14 items (Black Coffee, Cafe Latte, Hot Chocolate, Iced Tea,
-- Fresh Lime Soda, Mango Shake, Chicken Wings, Paneer Tikka, Nachos with
-- Salsa, Pasta Alfredo, and every dessert -- none of the supplied photos
-- show a dessert) get no `img` at all rather than a mismatched one.

create or replace function salesman_provision_trial(p_business_name text, p_slug text, p_niche text default 'cafe')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tid uuid; preset niche_presets%rowtype; slug2 text := lower(btrim(coalesce(p_slug, '')));
  cat_hot uuid := gen_random_uuid(); cat_cold uuid := gen_random_uuid(); cat_snacks uuid := gen_random_uuid();
  cat_meals uuid := gen_random_uuid(); cat_desserts uuid := gen_random_uuid();
  tbl1 uuid := gen_random_uuid(); tbl2 uuid := gen_random_uuid(); tbl3 uuid := gen_random_uuid();
  tbl4 uuid := gen_random_uuid(); tbl5 uuid := gen_random_uuid(); tbl6 uuid := gen_random_uuid();
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p_business_name, '')), '') is null then raise exception 'a business name is required'; end if;
  if slug2 !~ '^[a-z0-9][a-z0-9-]{1,30}$' then raise exception 'the address can only use lowercase letters, numbers and hyphens'; end if;
  if p_niche not in ('cafe', 'salon', 'gym', 'retail', 'general', 'mobile') then
    raise exception 'unknown niche: %', p_niche;
  end if;
  if exists(select 1 from tenants where slug = slug2) then
    raise exception 'that address is already taken -- pick a different one';
  end if;

  select * into preset from niche_presets where niche = p_niche;
  if not found then raise exception 'unknown niche: %', p_niche; end if;

  insert into tenants (name, slug, niche, is_trial, created_by_salesman)
    values (btrim(p_business_name), slug2, p_niche, true, app_uid())
    returning id into tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
    values (tid, preset.default_features, preset.default_labels, preset.default_business_rules);

  -- no siteHero/siteGallery default here either -- see salesman_apply_demo_content()'s
  -- own comment on why the hero stays on (one, already-matching, photo) while the
  -- gallery is left for the owner's own upload.
  insert into records (id, tenant_id, kind, data)
    values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object(
      'name', btrim(p_business_name),
      'siteHero', case when p_niche = 'cafe' then '/assets/demo-menu/hero.jpg' else null end
    ));

  if p_niche = 'cafe' then
    insert into records (id, tenant_id, kind, data) values
      (cat_hot,      tid, 'cat', jsonb_build_object('id', cat_hot,      'name', 'Hot Beverages',   'n', 1)),
      (cat_cold,     tid, 'cat', jsonb_build_object('id', cat_cold,     'name', 'Cold Beverages',   'n', 2)),
      (cat_snacks,   tid, 'cat', jsonb_build_object('id', cat_snacks,   'name', 'Snacks & Starters','n', 3)),
      (cat_meals,    tid, 'cat', jsonb_build_object('id', cat_meals,    'name', 'Sandwiches & Light Meals', 'n', 4)),
      (cat_desserts, tid, 'cat', jsonb_build_object('id', cat_desserts, 'name', 'Desserts',         'n', 5));

    insert into records (id, tenant_id, kind, data) values
      -- Hot Beverages (sizes: Regular / Large)
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Masala Chai',   'price', 30,  'img', '/assets/demo-menu/hot-beverages.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',30),  jsonb_build_object('l','Large','p',45)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Black Coffee',  'price', 40,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',40),  jsonb_build_object('l','Large','p',55)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cappuccino',    'price', 90,  'img', '/assets/demo-menu/hero.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cafe Latte',    'price', 100, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',100), jsonb_build_object('l','Large','p',130)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Hot Chocolate', 'price', 110, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',110), jsonb_build_object('l','Large','p',140)))),

      -- Cold Beverages
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Cold Coffee',          'price', 120, 'img', '/assets/demo-menu/cold-beverages.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',120), jsonb_build_object('l','Large','p',150)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Iced Tea',             'price', 90,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Fresh Lime Soda',      'price', 80,  'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Mango Shake',          'price', 140, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',140), jsonb_build_object('l','Large','p',170)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Chocolate Milkshake',  'price', 150, 'img', '/assets/demo-menu/gallery-coldbrew.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',150), jsonb_build_object('l','Large','p',180)))),

      -- Snacks & Starters
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'French Fries',        'price', 140, 'img', '/assets/demo-menu/gallery-fries.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Veg Spring Roll',     'price', 160, 'img', '/assets/demo-menu/snacks.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Chicken Wings',       'price', 220, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Paneer Tikka',        'price', 240, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Nachos with Salsa',   'price', 180, 'sizes', '[]'::jsonb)),

      -- Sandwiches & Light Meals
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Grilled Veg Sandwich', 'price', 150, 'img', '/assets/demo-menu/sandwiches.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Club Sandwich',        'price', 190, 'img', '/assets/demo-menu/sandwiches.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Veg Burger',           'price', 140, 'img', '/assets/demo-menu/gallery-burger.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Chicken Burger',       'price', 180, 'img', '/assets/demo-menu/gallery-burger.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Pasta Alfredo',        'price', 230, 'sizes', '[]'::jsonb)),

      -- Desserts -- none of the supplied photos show a dessert, so none get one
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Brownie',    'price', 150, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Blueberry Cheesecake', 'price', 190, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Vanilla Ice Cream',    'price', 110, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Lava Cake',  'price', 170, 'sizes', '[]'::jsonb));

    insert into records (id, tenant_id, kind, data) values
      (tbl1, tid, 'table', jsonb_build_object('id', tbl1, 'name', 'T1')),
      (tbl2, tid, 'table', jsonb_build_object('id', tbl2, 'name', 'T2')),
      (tbl3, tid, 'table', jsonb_build_object('id', tbl3, 'name', 'T3')),
      (tbl4, tid, 'table', jsonb_build_object('id', tbl4, 'name', 'T4')),
      (tbl5, tid, 'table', jsonb_build_object('id', tbl5, 'name', 'T5')),
      (tbl6, tid, 'table', jsonb_build_object('id', tbl6, 'name', 'T6'));

    return jsonb_build_object('tenant_id', tid, 'table_id', tbl1);
  end if;

  return jsonb_build_object('tenant_id', tid, 'table_id', null);
end $$;

-- Backfill (db/144), same item-specific matching -- and the "existing real
-- menu, fill in missing photos" branch now matches by the ITEM's own name
-- (falls through to nothing, not a guess, for a dish none of the supplied
-- photos actually show) instead of blanket-applying one photo per category.
create or replace function salesman_apply_demo_content(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cat_hot uuid := gen_random_uuid(); cat_cold uuid := gen_random_uuid(); cat_snacks uuid := gen_random_uuid();
  cat_meals uuid := gen_random_uuid(); cat_desserts uuid := gen_random_uuid();
  tbl1 uuid := gen_random_uuid(); tbl2 uuid := gen_random_uuid(); tbl3 uuid := gen_random_uuid();
  tbl4 uuid := gen_random_uuid(); tbl5 uuid := gen_random_uuid(); tbl6 uuid := gen_random_uuid();
  added_menu boolean := false;
  photos_backfilled int := 0;
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  if not exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()) then
    raise exception 'not your trial tenant';
  end if;

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
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Masala Chai',   'price', 30,  'img', '/assets/demo-menu/hot-beverages.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',30),  jsonb_build_object('l','Large','p',45)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Black Coffee',  'price', 40,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',40),  jsonb_build_object('l','Large','p',55)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cappuccino',    'price', 90,  'img', '/assets/demo-menu/hero.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cafe Latte',    'price', 100, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',100), jsonb_build_object('l','Large','p',130)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Hot Chocolate', 'price', 110, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',110), jsonb_build_object('l','Large','p',140)))),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Cold Coffee',          'price', 120, 'img', '/assets/demo-menu/cold-beverages.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',120), jsonb_build_object('l','Large','p',150)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Iced Tea',             'price', 90,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Fresh Lime Soda',      'price', 80,  'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Mango Shake',          'price', 140, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',140), jsonb_build_object('l','Large','p',170)))),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Chocolate Milkshake',  'price', 150, 'img', '/assets/demo-menu/gallery-coldbrew.jpg', 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',150), jsonb_build_object('l','Large','p',180)))),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'French Fries',        'price', 140, 'img', '/assets/demo-menu/gallery-fries.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Veg Spring Roll',     'price', 160, 'img', '/assets/demo-menu/snacks.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Chicken Wings',       'price', 220, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Paneer Tikka',        'price', 240, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Nachos with Salsa',   'price', 180, 'sizes', '[]'::jsonb)),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Grilled Veg Sandwich', 'price', 150, 'img', '/assets/demo-menu/sandwiches.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Club Sandwich',        'price', 190, 'img', '/assets/demo-menu/sandwiches.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Veg Burger',           'price', 140, 'img', '/assets/demo-menu/gallery-burger.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Chicken Burger',       'price', 180, 'img', '/assets/demo-menu/gallery-burger.jpg', 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Pasta Alfredo',        'price', 230, 'sizes', '[]'::jsonb)),

      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Brownie',    'price', 150, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Blueberry Cheesecake', 'price', 190, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Vanilla Ice Cream',    'price', 110, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), p_tenant_id, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Lava Cake',  'price', 170, 'sizes', '[]'::jsonb));

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
    -- a real menu already exists -- only fill in a photo for an item whose
    -- own name genuinely matches one of the supplied photos; everything
    -- else is left exactly as it is, never guessed
    update records r set data = r.data || jsonb_build_object('img',
      case r.data->>'name'
        when 'Masala Chai' then '/assets/demo-menu/hot-beverages.jpg'
        when 'Cappuccino' then '/assets/demo-menu/hero.jpg'
        when 'Cold Coffee' then '/assets/demo-menu/cold-beverages.jpg'
        when 'Chocolate Milkshake' then '/assets/demo-menu/gallery-coldbrew.jpg'
        when 'French Fries' then '/assets/demo-menu/gallery-fries.jpg'
        when 'Veg Spring Roll' then '/assets/demo-menu/snacks.jpg'
        when 'Grilled Veg Sandwich' then '/assets/demo-menu/sandwiches.jpg'
        when 'Club Sandwich' then '/assets/demo-menu/sandwiches.jpg'
        when 'Veg Burger' then '/assets/demo-menu/gallery-burger.jpg'
        when 'Chicken Burger' then '/assets/demo-menu/gallery-burger.jpg'
      end), updated_at = now()
      where r.tenant_id = p_tenant_id and r.kind = 'item' and not r.deleted
        and (r.data->>'img' is null or r.data->>'img' = '')
        and r.data->>'name' in ('Masala Chai','Cappuccino','Cold Coffee','Chocolate Milkshake','French Fries',
                                 'Veg Spring Roll','Grilled Veg Sandwich','Club Sandwich','Veg Burger','Chicken Burger');
    get diagnostics photos_backfilled = row_count;
  end if;

  -- hero only -- the gallery is left for the owner's own upload, never a default
  update records set data = data ||
    (case when data->>'siteHero' is null or data->>'siteHero' = '' then jsonb_build_object('siteHero', '/assets/demo-menu/hero.jpg') else '{}'::jsonb end),
    updated_at = now()
    where tenant_id = p_tenant_id and kind = 'settings' and id = 'settings';

  return jsonb_build_object('added_menu', added_menu, 'photos_backfilled', photos_backfilled);
end $$;
