-- =========================================================
-- Two real, live demo tenants a prospect can sign into and actually
-- use -- demo.html's module tour is a description of what they'd get;
-- this is the thing itself. Same pattern as
-- db/010_import_og_book_cafe.sql (direct inserts, not the
-- provision_tenant() RPC, since that RPC checks is_platform_admin()
-- via app_uid(), which isn't set while this migration runs as the
-- superuser).
--
-- Deliberately seeded with only a catalog (categories/items/tables),
-- never fake sales history: a prospect placing their own first order
-- and watching it show up live in Reports/CRM *is* the demo, not
-- something to fake in advance.
--
-- Both logins are owner-level (needed to see Settings/Menu/Payroll --
-- the whole point is "everything", not a cashier-limited slice) and
-- meant to be shared publicly on demo.html. That's fine for anything
-- scoped to the demo tenant's own data, but invite_staff() (db/013)
-- would let a public owner login insert an attacker-chosen email into
-- the single, globally-unique auth_users table -- a cheap way to
-- email-squat a real prospect's address before they ever sign up.
-- tenants.is_demo + the guard added to invite_staff() below closes
-- that specific hole explicitly, rather than relying on "the demo
-- tenant happens to have no roles yet so invite_staff already fails".
--
-- Password for both: AuzslabDemo!2026 (bcrypt hash below, cost 12,
-- generated with the same bcryptjs the API server itself uses --
-- verified with bcrypt.compare before this file was written).
-- =========================================================

alter table tenants add column if not exists is_demo boolean not null default false;

create or replace function invite_staff(p_email text, p_name text, p_phone text, p_role_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; role_name text; new_uid uuid; new_password text; demo boolean;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select is_demo into demo from tenants where id = tid;
  if demo then
    raise exception 'not available on a demo account';
  end if;

  select name into role_name from roles where id = p_role_id and tenant_id = tid;
  if role_name is null then
    raise exception 'unknown role';
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into auth_users (email, password_hash, app_metadata)
  values (
    p_email,
    crypt(new_password, gen_salt('bf', 12)),
    jsonb_build_object('tenant_id', tid, 'role', role_name, 'role_id', p_role_id, 'name', p_name, 'phone', p_phone)
  )
  returning id into new_uid;

  return jsonb_build_object('id', new_uid, 'email', p_email, 'temp_password', new_password);
end $$;

-- Also fixes a real bug this seed would otherwise have inherited:
-- niche_presets' retail preset stored its GST rate as "tax_rate", but
-- cfg() in index.html reads "tax" -- a freshly provisioned retail
-- tenant silently kept the default 5% instead of the intended 18%.
-- Fixed at the source in db/001 for any future fresh install; these
-- UPDATEs are what actually reach the live database, since 001 only
-- runs once on an empty database (see CLAUDE.md's migration gotcha).
-- Three places carry a copy of this same key, all fixed the same way
-- (merge the rename in, never replace the whole object -- db/008
-- already added expense_categories etc. to two of these three columns,
-- and a wholesale overwrite would silently erase it):
--   1. niche_presets itself -- the template future onboarding copies from
--   2. any retail tenant already provisioned BEFORE this migration, whose
--      tenant_settings.business_rules got the buggy key at provisioning time
--   3. that same tenant's own records(kind='settings') row -- provision_tenant()
--      copies business_rules into both places, and neither is ever re-read
--      from niche_presets afterward, so fixing only the template (as an
--      earlier draft of this migration did) would never reach an
--      already-onboarded client's live settings at all.
update niche_presets
  set default_business_rules = (default_business_rules - 'tax_rate') || jsonb_build_object('tax', (default_business_rules->>'tax_rate')::numeric)
  where niche = 'retail' and default_business_rules ? 'tax_rate';

update tenant_settings ts
  set business_rules = (business_rules - 'tax_rate') || jsonb_build_object('tax', (business_rules->>'tax_rate')::numeric)
  from tenants t
  where ts.tenant_id = t.id and t.niche = 'retail' and ts.business_rules ? 'tax_rate';

update records r
  set data = (data - 'tax_rate') || jsonb_build_object('tax', (data->>'tax_rate')::numeric)
  from tenants t
  where r.tenant_id = t.id and t.niche = 'retail' and r.kind = 'settings' and r.id = 'settings' and r.data ? 'tax_rate';

do $$
declare
  cafe_tid uuid;
  cafe_uid uuid;
  retail_tid uuid;
  retail_uid uuid;
  demo_hash text := '$2a$12$SLKRgnw1M1E2bBkW1754Se2gQzzJKZUWLUS9uFhVaOX2XFIBHzs6m';
begin
  -- ---- demo-cafe: restaurant/café flavor (tables, KOT, kitchen display) ----
  insert into tenants (slug, name, niche, plan, status, is_demo)
    values ('demo-cafe', 'AUZslab Demo — Café', 'cafe', 'pro', 'active', true)
    on conflict (slug) do nothing
    returning id into cafe_tid;
  if cafe_tid is null then select id into cafe_tid from tenants where slug = 'demo-cafe'; end if;
  update tenants set is_demo = true where id = cafe_tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select cafe_tid, preset.default_features, preset.default_labels, preset.default_business_rules
    from niche_presets preset where preset.niche = 'cafe'
    on conflict (tenant_id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('settings', cafe_tid, 'settings', jsonb_build_object(
      'id', 'settings', 'name', 'AUZslab Demo Café', 'bizType', 'restaurant', 'tax', 5, 'prefix', 'DEMO',
      'ftr', 'This is a shared public demo -- feel free to explore.', 'w', 80, 'sty', 'mono', 'fs', 12,
      'gw', 'Scan, order and relax. Your order goes straight to our kitchen.'
    ))
  on conflict (tenant_id, id) do nothing;

  -- Every seeded row's own id is embedded inside its jsonb `data` too,
  -- matching db/010_import_og_book_cafe.sql's own pattern exactly --
  -- index.html's save(kind,data,id=data.id||uid(),...) always falls
  -- back to a fresh random id when data.id is missing, so the first
  -- edit/sale/restock against a row with no id inside its own data
  -- would silently fork a duplicate under a new id instead of updating
  -- the seeded one.
  insert into records (id, tenant_id, kind, data) values
    ('demo-cafe-cat-bev', cafe_tid, 'cat', jsonb_build_object('id', 'demo-cafe-cat-bev', 'name', 'Beverages', 'n', 1)),
    ('demo-cafe-cat-food', cafe_tid, 'cat', jsonb_build_object('id', 'demo-cafe-cat-food', 'name', 'Snacks', 'n', 2)),
    ('demo-cafe-item-tea', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-tea', 'name', 'Masala Tea', 'cat', 'demo-cafe-cat-bev', 'price', 25, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb)),
    ('demo-cafe-item-coffee', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-coffee', 'name', 'Cappuccino', 'cat', 'demo-cafe-cat-bev', 'price', 60,
      'sizes', jsonb_build_array(jsonb_build_object('l', 'Regular', 'p', 60), jsonb_build_object('l', 'Large', 'p', 80)), 'mods', '[]'::jsonb)),
    ('demo-cafe-item-sandwich', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-sandwich', 'name', 'Grilled Sandwich', 'cat', 'demo-cafe-cat-food', 'price', 90, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb)),
    ('demo-cafe-item-pasta', cafe_tid, 'item', jsonb_build_object('id', 'demo-cafe-item-pasta', 'name', 'Veg Pasta', 'cat', 'demo-cafe-cat-food', 'price', 150, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb)),
    ('demo-cafe-table-1', cafe_tid, 'table', jsonb_build_object('id', 'demo-cafe-table-1', 'name', 'T1', 'sec', 'Main')),
    ('demo-cafe-table-2', cafe_tid, 'table', jsonb_build_object('id', 'demo-cafe-table-2', 'name', 'T2', 'sec', 'Main')),
    ('demo-cafe-table-3', cafe_tid, 'table', jsonb_build_object('id', 'demo-cafe-table-3', 'name', 'T3', 'sec', 'Terrace')),
    ('demo-cafe-table-4', cafe_tid, 'table', jsonb_build_object('id', 'demo-cafe-table-4', 'name', 'T4', 'sec', 'Terrace'))
  on conflict (tenant_id, id) do nothing;

  select id into cafe_uid from auth_users where email = 'demo-cafe@auzslab.in';
  if cafe_uid is null then
    insert into auth_users (email, password_hash, app_metadata)
      values ('demo-cafe@auzslab.in', demo_hash, jsonb_build_object('tenant_id', cafe_tid, 'role', 'owner'));
  end if;

  -- ---- demo-retail: clothing/apparel flavor (size/color stock, trial room, returns) ----
  insert into tenants (slug, name, niche, plan, status, is_demo)
    values ('demo-retail', 'AUZslab Demo — Retail', 'retail', 'pro', 'active', true)
    on conflict (slug) do nothing
    returning id into retail_tid;
  if retail_tid is null then select id into retail_tid from tenants where slug = 'demo-retail'; end if;
  update tenants set is_demo = true where id = retail_tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select retail_tid, preset.default_features, preset.default_labels, preset.default_business_rules
    from niche_presets preset where preset.niche = 'retail'
    on conflict (tenant_id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('settings', retail_tid, 'settings', jsonb_build_object(
      'id', 'settings', 'name', 'AUZslab Demo Retail', 'bizType', 'retail', 'tax', 18, 'prefix', 'DEMO',
      'ftr', 'This is a shared public demo -- feel free to explore.', 'w', 80, 'sty', 'mono', 'fs', 12
    ))
  on conflict (tenant_id, id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('demo-retail-cat-men', retail_tid, 'cat', jsonb_build_object('id', 'demo-retail-cat-men', 'name', 'T-Shirts', 'n', 1)),
    ('demo-retail-cat-jeans', retail_tid, 'cat', jsonb_build_object('id', 'demo-retail-cat-jeans', 'name', 'Jeans', 'n', 2)),
    ('demo-retail-item-tee', retail_tid, 'item', jsonb_build_object(
      'id', 'demo-retail-item-tee', 'name', 'Classic Tee', 'cat', 'demo-retail-cat-men', 'price', 499, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb,
      'variants', jsonb_build_array(
        jsonb_build_object('size', 'S', 'color', 'Black', 'barcode', null, 'qty', 10),
        jsonb_build_object('size', 'M', 'color', 'Black', 'barcode', null, 'qty', 12),
        jsonb_build_object('size', 'L', 'color', 'Black', 'barcode', null, 'qty', 8),
        jsonb_build_object('size', 'S', 'color', 'White', 'barcode', null, 'qty', 10),
        jsonb_build_object('size', 'M', 'color', 'White', 'barcode', null, 'qty', 12),
        jsonb_build_object('size', 'L', 'color', 'White', 'barcode', null, 'qty', 8)
      )
    )),
    ('demo-retail-item-jeans', retail_tid, 'item', jsonb_build_object(
      'id', 'demo-retail-item-jeans', 'name', 'Slim Jeans', 'cat', 'demo-retail-cat-jeans', 'price', 1299, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb,
      'variants', jsonb_build_array(
        jsonb_build_object('size', '30', 'color', 'Blue', 'barcode', null, 'qty', 6),
        jsonb_build_object('size', '32', 'color', 'Blue', 'barcode', null, 'qty', 8),
        jsonb_build_object('size', '34', 'color', 'Blue', 'barcode', null, 'qty', 6)
      )
    ))
  on conflict (tenant_id, id) do nothing;

  select id into retail_uid from auth_users where email = 'demo-retail@auzslab.in';
  if retail_uid is null then
    insert into auth_users (email, password_hash, app_metadata)
      values ('demo-retail@auzslab.in', demo_hash, jsonb_build_object('tenant_id', retail_tid, 'role', 'owner'));
  end if;
end $$;
