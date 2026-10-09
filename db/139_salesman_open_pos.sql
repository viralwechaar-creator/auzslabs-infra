-- Owner request: instead of the salesman having to type an owner email and
-- hand over a temporary password before they can even open the POS, add one
-- button that opens it directly -- and seed real dine-in tables too, so the
-- QR-order demo ("scan this table, place an order") actually has a table to
-- point at. salesman_provision_trial() (db/137/138) already seeds a cafe
-- trial's menu; this adds 6 tables (T1-T6) the same shape pos/shell.js's own
-- seed() already uses, and changes the function's return value from a bare
-- tenant id to {tenant_id, table_id} so the client can build a QR demo link
-- (/site.html?t=<table_id>, the exact URL console/p-menu.js's printQR()
-- already encodes for a real table) right after creating the trial, with no
-- extra round trip. salesman_my_trials() carries the same table_id for a
-- trial opened again later.
--
-- The actual "sign in as the owner" step needs a real JWT, which only
-- server/src/auth.js's signToken() can mint -- that half is a new HTTP route,
-- /admin/salesman-open-pos, in server/src/index.js (not SQL).

-- changing the return type (uuid -> jsonb) needs an explicit drop first --
-- `create or replace` refuses to change a function's return type on its own.
drop function if exists salesman_provision_trial(text, text, text);

create function salesman_provision_trial(p_business_name text, p_slug text, p_niche text default 'cafe')
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

    -- Dine-in tables (T1-T6) -- same shape pos/shell.js's own seed() creates,
    -- skipped here on purpose since this tenant already has categories by
    -- the time anyone opens the POS (seed() only ever runs when there are
    -- none) -- without this, a salesman-created trial would have a real
    -- menu but no tables to seat/order against.
    insert into records (id, tenant_id, kind, data) values
      -- site.html's QR lookup (M.tables.find(x=>x.id==T)) matches against
      -- `data.id`, not the outer records.id -- the client's own save()
      -- always stamps `data.id = id` (pos/core.js), so a server-seeded
      -- table needs the same 'id' key inside its data or no QR ever matches.
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

create or replace function salesman_my_trials() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche,
      'created_at', t.created_at,
      'has_owner', exists(select 1 from profiles p where p.tenant_id = t.id and p.role = 'owner'),
      'logo', r.data->>'logo', 'col', r.data->>'col',
      'table_id', (select rt.id from records rt where rt.tenant_id = t.id and rt.kind = 'table' order by rt.data->>'name' limit 1)
    ) order by t.created_at desc)
    from tenants t
    left join records r on r.tenant_id = t.id and r.kind = 'settings' and r.id = 'settings'
    where t.created_by_salesman = app_uid()
  ), '[]'::jsonb);
end $$;
