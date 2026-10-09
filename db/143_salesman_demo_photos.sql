-- Owner request: send the owner's own supplied café photos (not AI/stock
-- art) so a brand-new cafe trial never looks empty while a client is
-- scanning and ordering, before a salesman has uploaded anything of the
-- client's own. The photos live as plain static files checked into this
-- repo, app/public/assets/demo-menu/ (served same-origin on every tenant
-- subdomain, same as /logo.png) -- no upload, no per-tenant storage, since
-- these are shared defaults, not one tenant's own asset.
--
-- Every item in a category gets that category's photo (item.img, the
-- field site.html/pos/sell.js/console already render); the settings record
-- gets a default siteHero + a 3-photo siteGallery. A salesman can still
-- replace any of this with the real client's own photos afterward exactly
-- like the logo -- this only sets what a brand-new trial starts with.

create or replace function salesman_provision_trial(p_business_name text, p_slug text, p_niche text default 'cafe')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tid uuid; preset niche_presets%rowtype; slug2 text := lower(btrim(coalesce(p_slug, '')));
  cat_hot uuid := gen_random_uuid(); cat_cold uuid := gen_random_uuid(); cat_snacks uuid := gen_random_uuid();
  cat_meals uuid := gen_random_uuid(); cat_desserts uuid := gen_random_uuid();
  tbl1 uuid := gen_random_uuid(); tbl2 uuid := gen_random_uuid(); tbl3 uuid := gen_random_uuid();
  tbl4 uuid := gen_random_uuid(); tbl5 uuid := gen_random_uuid(); tbl6 uuid := gen_random_uuid();
  img_hot text := '/assets/demo-menu/hot-beverages.jpg';
  img_cold text := '/assets/demo-menu/cold-beverages.jpg';
  img_snacks text := '/assets/demo-menu/snacks.jpg';
  img_meals text := '/assets/demo-menu/sandwiches.jpg';
  img_desserts text := '/assets/demo-menu/desserts.jpg';
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

  insert into records (id, tenant_id, kind, data)
    values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object(
      'name', btrim(p_business_name),
      'siteHero', case when p_niche = 'cafe' then '/assets/demo-menu/hero.jpg' else null end,
      'siteGallery', case when p_niche = 'cafe' then
        '/assets/demo-menu/gallery-burger.jpg,/assets/demo-menu/gallery-coldbrew.jpg,/assets/demo-menu/gallery-fries.jpg'
      else null end
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
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Masala Chai',   'price', 30,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',30),  jsonb_build_object('l','Large','p',45)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Black Coffee',  'price', 40,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',40),  jsonb_build_object('l','Large','p',55)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cappuccino',    'price', 90,  'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cafe Latte',    'price', 100, 'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',100), jsonb_build_object('l','Large','p',130)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Hot Chocolate', 'price', 110, 'img', img_hot, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',110), jsonb_build_object('l','Large','p',140)))),

      -- Cold Beverages
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Cold Coffee',          'price', 120, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',120), jsonb_build_object('l','Large','p',150)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Iced Tea',             'price', 90,  'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Fresh Lime Soda',      'price', 80,  'img', img_cold, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Mango Shake',          'price', 140, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',140), jsonb_build_object('l','Large','p',170)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Chocolate Milkshake',  'price', 150, 'img', img_cold, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',150), jsonb_build_object('l','Large','p',180)))),

      -- Snacks & Starters
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'French Fries',        'price', 140, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Veg Spring Roll',     'price', 160, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Chicken Wings',       'price', 220, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Paneer Tikka',        'price', 240, 'img', img_snacks, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Nachos with Salsa',   'price', 180, 'img', img_snacks, 'sizes', '[]'::jsonb)),

      -- Sandwiches & Light Meals
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Grilled Veg Sandwich', 'price', 150, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Club Sandwich',        'price', 190, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Veg Burger',           'price', 140, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Chicken Burger',       'price', 180, 'img', img_meals, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Pasta Alfredo',        'price', 230, 'img', img_meals, 'sizes', '[]'::jsonb)),

      -- Desserts
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Brownie',    'price', 150, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Blueberry Cheesecake', 'price', 190, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Vanilla Ice Cream',    'price', 110, 'img', img_desserts, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Lava Cake',  'price', 170, 'img', img_desserts, 'sizes', '[]'::jsonb));

    -- Dine-in tables (T1-T6) -- see db/139's own comment for why these are
    -- seeded here (pos/shell.js's own seed() never runs once categories
    -- already exist) and why each needs 'id' inside its own data.
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
