-- Owner request: a salesman's trial tenant should already look like a real,
-- working business during the pitch -- not an empty POS. salesman_provision_trial()
-- (db/137) now seeds a real starter catalogue for a cafe trial: 5 categories, 20
-- items, several with size variants (the same {l, p} shape pos/sell.js already
-- reads, see its optionSheet()). This is the SAME `records` kind='cat'/'item'
-- shape every niche's menu already uses -- no new table, no change to the app --
-- so it shows up immediately on the tenant's own site.html (QR ordering) AND the
-- POS the moment the salesman opens either one. The salesman can edit, delete or
-- add to any of this afterwards exactly like a real owner would.
--
-- Other niches (salon, gym, retail, mobile, general) are left exactly as before
-- (the niche preset's defaults, no starter catalogue) -- only cafe was asked for.

create or replace function salesman_provision_trial(p_business_name text, p_slug text, p_niche text default 'cafe')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid; preset niche_presets%rowtype; slug2 text := lower(btrim(coalesce(p_slug, '')));
  cat_hot uuid := gen_random_uuid(); cat_cold uuid := gen_random_uuid(); cat_snacks uuid := gen_random_uuid();
  cat_meals uuid := gen_random_uuid(); cat_desserts uuid := gen_random_uuid();
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
    values ('settings', tid, 'settings', preset.default_business_rules || jsonb_build_object('name', btrim(p_business_name)));

  if p_niche = 'cafe' then
    insert into records (id, tenant_id, kind, data) values
      (cat_hot,      tid, 'cat', jsonb_build_object('id', cat_hot,      'name', 'Hot Beverages',   'n', 1)),
      (cat_cold,     tid, 'cat', jsonb_build_object('id', cat_cold,     'name', 'Cold Beverages',   'n', 2)),
      (cat_snacks,   tid, 'cat', jsonb_build_object('id', cat_snacks,   'name', 'Snacks & Starters','n', 3)),
      (cat_meals,    tid, 'cat', jsonb_build_object('id', cat_meals,    'name', 'Sandwiches & Light Meals', 'n', 4)),
      (cat_desserts, tid, 'cat', jsonb_build_object('id', cat_desserts, 'name', 'Desserts',         'n', 5));

    insert into records (id, tenant_id, kind, data) values
      -- Hot Beverages (sizes: Regular / Large)
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Masala Chai',   'price', 30,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',30),  jsonb_build_object('l','Large','p',45)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Black Coffee',  'price', 40,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',40),  jsonb_build_object('l','Large','p',55)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cappuccino',    'price', 90,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Cafe Latte',    'price', 100, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',100), jsonb_build_object('l','Large','p',130)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_hot, 'name', 'Hot Chocolate', 'price', 110, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',110), jsonb_build_object('l','Large','p',140)))),

      -- Cold Beverages
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Cold Coffee',          'price', 120, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',120), jsonb_build_object('l','Large','p',150)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Iced Tea',             'price', 90,  'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',90),  jsonb_build_object('l','Large','p',120)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Fresh Lime Soda',      'price', 80,  'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Mango Shake',          'price', 140, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',140), jsonb_build_object('l','Large','p',170)))),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_cold, 'name', 'Chocolate Milkshake',  'price', 150, 'sizes', jsonb_build_array(jsonb_build_object('l','Regular','p',150), jsonb_build_object('l','Large','p',180)))),

      -- Snacks & Starters
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'French Fries',        'price', 140, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Veg Spring Roll',     'price', 160, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Chicken Wings',       'price', 220, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Paneer Tikka',        'price', 240, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_snacks, 'name', 'Nachos with Salsa',   'price', 180, 'sizes', '[]'::jsonb)),

      -- Sandwiches & Light Meals
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Grilled Veg Sandwich', 'price', 150, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Club Sandwich',        'price', 190, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Veg Burger',           'price', 140, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Chicken Burger',       'price', 180, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_meals, 'name', 'Pasta Alfredo',        'price', 230, 'sizes', '[]'::jsonb)),

      -- Desserts
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Brownie',    'price', 150, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Blueberry Cheesecake', 'price', 190, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Vanilla Ice Cream',    'price', 110, 'sizes', '[]'::jsonb)),
      (gen_random_uuid(), tid, 'item', jsonb_build_object('cat', cat_desserts, 'name', 'Chocolate Lava Cake',  'price', 170, 'sizes', '[]'::jsonb));
  end if;

  return tid;
end $$;
