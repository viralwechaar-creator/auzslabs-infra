-- Phase 1A of the modular platform: ONE module catalogue in the database, and server-side dependency checks for the
-- 3-day self-serve trial. Additive only: no existing table, feature key, price or customer row is changed.
-- The catalogue DESCRIBES what exists today. It does not make products share data or open in one workspace.
--   requires  : modules that must also be on (verified in code; only self_order -> pos so far)
--   conflicts : modules that cannot be combined (none verified, so none defined)
--   features  : the existing tenant_settings.features keys the module switches on (same keys as trial_blocks.features)
--   status    : available = can be ticked in the builder | arrangement = set up by our team | included = always there
--   templates : preset looks that work with the module today (classic = the standard look, modern = the opt-in Modern look)
--   screens   : the single screens the builder offers, each opening a page of the existing app
-- Later directions (NOT built here): shared customers/suppliers/items through stable links inside one tenant, product-specific
-- data (IMEI, salon, sizes/colours, recipes, payroll maths) keeps its own meaning, sale-to-accounting posting through a
-- retry-safe event, preset templates kept apart from business logic, add/remove modules after the trial through the quote flow,
-- native apps adopting shared modules gradually.

create table if not exists module_catalogue (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null,
  description text not null default '',
  family text not null default '',
  niches text[] not null default '{}',
  requires text[] not null default '{}',
  conflicts text[] not null default '{}',
  features text[] not null default '{}',
  status text not null default 'available' check (status in ('available', 'arrangement', 'included')),
  templates text[] not null default '{}',
  sort int not null default 100,
  screens jsonb not null default '[]'::jsonb,
  active boolean not null default true
);
alter table module_catalogue enable row level security;   -- no policies: read only through the functions below

insert into module_catalogue (key, label, description, family, niches, requires, conflicts, features, status, templates, sort, screens) values
  ('pos', 'AUZsPOS', 'Billing, tables, kitchen, customers and stock for shops, cafes and restaurants. CRM, billing and inventory come with it.', 'Sell', '{cafe,retail,clothing}', '{}', '{}', '{pos,crm,billing,inventory}', 'available', '{classic,modern}', 10, '[{"id": "bill", "label": "Billing and invoices", "url": "/index.html?tab=sell", "g": "bars"}, {"id": "tables", "label": "Tables and dine-in", "url": "/index.html?tab=tables", "g": "bars"}, {"id": "kitchen", "label": "Kitchen orders", "url": "/index.html?tab=kitchen", "g": "bars"}, {"id": "stock", "label": "Stock and items", "url": "/dashboard.html#inv/stock", "g": "bars"}, {"id": "cust", "label": "Customers and loyalty", "url": "/dashboard.html#crm/customers", "g": "bars"}, {"id": "offers", "label": "Offers and coupons", "url": "/dashboard.html#mkt/offers", "g": "bars"}]'::jsonb),
  ('self_order', 'QR table ordering', 'Guests scan the table QR and order from their phone. Orders arrive in AUZsPOS, so it needs AUZsPOS.', 'Sell', '{cafe}', '{pos}', '{}', '{self_order}', 'available', '{classic}', 20, '[{"id": "qr", "label": "QR table ordering", "url": "/dashboard.html#qr/ordering", "g": "bars"}]'::jsonb),
  ('scan', 'AUZsScan', 'Scan barcodes to sell and add stock. Runs on the AUZsLedger books but works on its own.', 'Sell', '{retail,clothing,mobile}', '{}', '{}', '{scan}', 'available', '{classic,modern}', 50, '[{"id": "scan", "label": "Scan to bill", "url": "/scan.html", "g": "bars"}]'::jsonb),
  ('mobile', 'AUZsMob', 'IMEI stock, sales and repair job cards for mobile phone shops.', 'Phone shop', '{mobile}', '{}', '{}', '{mobile}', 'available', '{classic,modern}', 60, '[{"id": "phones", "label": "Phone sales and IMEI", "url": "/mob.html#/sell", "g": "ring"}, {"id": "repair", "label": "Repairs", "url": "/mob.html#/repairs", "g": "ring"}, {"id": "dues", "label": "Customer and vendor dues", "url": "/mob.html#/dues", "g": "ring"}]'::jsonb),
  ('style', 'AUZsStyle', 'Sizes, colours, barcode tags and an online store for clothing and footwear shops.', 'Clothing', '{clothing}', '{}', '{}', '{style}', 'available', '{classic}', 70, '[{"id": "sizes", "label": "Sizes and colours", "url": "/style.html#/stock", "g": "tri"}, {"id": "tags", "label": "Barcode tags", "url": "/style.html#/stock", "g": "tri"}, {"id": "store", "label": "Online store", "url": "/style.html#/store", "g": "tri"}]'::jsonb),
  ('payroll', 'AUZsPay', 'Staff attendance, leave, salary and payslips.', 'People', '{cafe,salon,retail,clothing,mobile}', '{}', '{}', '{payroll}', 'available', '{classic,modern}', 30, '[{"id": "attend", "label": "Staff attendance", "url": "/payroll.html#/time", "g": "dots"}, {"id": "pay", "label": "Salary and payslips", "url": "/payroll.html#/pay", "g": "dots"}, {"id": "leave", "label": "Leave requests", "url": "/payroll.html#/leave", "g": "dots"}]'::jsonb),
  ('accounting', 'AUZsLedger', 'Invoices, purchases, GST and books with double-entry accounting.', 'Money', '{cafe,salon,retail,clothing,mobile}', '{}', '{}', '{accounting}', 'available', '{classic,modern}', 40, '[{"id": "gst", "label": "GST invoices and books", "url": "/accounts.html#/home", "g": "sq"}]'::jsonb),
  ('finance', 'AUZsFinance', 'Money in and out, owner capital, loans and dues.', 'Money', '{cafe,salon,retail,clothing,mobile}', '{}', '{}', '{finance}', 'available', '{classic}', 80, '[{"id": "cash", "label": "Expenses and cash", "url": "/finance.html#/activity", "g": "sq"}, {"id": "loans", "label": "Loans and owner money", "url": "/finance.html#/owner", "g": "sq"}]'::jsonb),
  ('website_builder', 'Website builder', 'Your own website, edited by you.', 'Online', '{cafe,salon,retail,clothing,mobile}', '{}', '{}', '{website_builder}', 'available', '{classic}', 90, '[{"id": "web", "label": "Your own website", "url": "/builder.html", "g": "orbit"}]'::jsonb),
  ('salon', 'AUZslab Salon', 'Bookings, services, billing and a staff console for salons. Set up with our team, so it is not part of the 3-day self-serve trial.', 'Salon', '{salon}', '{}', '{}', '{salon,booking,crm,billing}', 'arrangement', '{}', 100, '[]'::jsonb),
  ('hub', 'AUZslab Hub', 'The single sign-in and launcher for all your apps. Always included.', 'Platform', '{cafe,salon,retail,clothing,mobile}', '{}', '{}', '{}', 'included', '{}', 0, '[]'::jsonb)
on conflict (key) do nothing;

-- what the builder shows (public: it holds no business data and no prices)
create or replace function public_module_catalogue() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'family', family,
    'niches', to_jsonb(niches), 'requires', to_jsonb(requires), 'conflicts', to_jsonb(conflicts), 'features', to_jsonb(features),
    'status', status, 'templates', to_jsonb(templates), 'screens', screens) order by sort, key), '[]'::jsonb)
  from module_catalogue where active
$$;

-- The one place that turns a selection into a valid one. Used by the builder preview AND by start_self_trial.
-- Returns {keys:[everything to switch on], added:[{key, because}]} or raises a plain-language error.
create or replace function module_resolve(p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sel text[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_keys, '{}')) x), '{}');
  allk text[]; added jsonb := '[]'; m record; r text; k text; changed boolean := true; guard int := 0; c text;
begin
  foreach k in array sel loop
    select * into m from module_catalogue where key = k and active;
    if m.key is null then raise exception 'Unknown module: %', left(k, 40); end if;
    if m.status <> 'available' then raise exception '% is set up by our team, so it cannot be ticked here.', m.label; end if;
    if not exists (select 1 from trial_blocks tb where tb.key = k and tb.active) then raise exception '% is not available for the trial right now.', m.label; end if;
  end loop;
  allk := sel;
  while changed and guard < 10 loop
    changed := false; guard := guard + 1;
    for m in select * from module_catalogue where key = any(allk) loop
      foreach r in array m.requires loop
        if not (r = any(allk)) then
          if not exists (select 1 from module_catalogue d where d.key = r and d.active and d.status = 'available')
             or not exists (select 1 from trial_blocks tb where tb.key = r and tb.active) then
            raise exception '% needs %, which is not available right now.', m.label, r;
          end if;
          allk := allk || r; changed := true;
          added := added || jsonb_build_array(jsonb_build_object('key', r, 'because', m.key));
        end if;
      end loop;
    end loop;
  end loop;
  for m in select * from module_catalogue where key = any(allk) loop
    foreach c in array m.conflicts loop
      if c = any(allk) then raise exception '% cannot be combined with %.', m.label, c; end if;
    end loop;
  end loop;
  return jsonb_build_object('keys', to_jsonb(allk), 'added', added);
end $$;

create or replace function public_module_resolve(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return module_resolve(coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'blocks', '[]'::jsonb)) x), '{}'));
end $$;

-- start_self_trial: same as db/262 (3 days, lock, data kept, notification, return keys) with the selection now checked and
-- completed by module_resolve(). The browser's list is never trusted.
create or replace function start_self_trial(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); biz text := trim(coalesce(p->>'business_name', '')); cname text := trim(coalesce(p->>'contact_name', ''));
  v_phone text := trim(coalesce(p->>'phone', '')); keys text[]; blocks jsonb; feats jsonb := '{}'; v_slug text; base text; tid uuid; ends timestamptz := now() + interval '3 days';
  b record; email text; res jsonb; added jsonb;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'This login already has a business. Open it from your apps.'; end if;
  if exists (select 1 from platform_admins where id = uid) then raise exception 'Platform admins cannot start a trial.'; end if;
  if biz = '' then raise exception 'Please enter your business name.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'Please enter a valid mobile number.'; end if;
  select coalesce(array_agg(distinct x), '{}') into keys from jsonb_array_elements_text(coalesce(p->'blocks', '[]'::jsonb)) x;
  if coalesce(array_length(keys, 1), 0) = 0 then raise exception 'Pick at least one block.'; end if;
  res := module_resolve(keys);
  added := res->'added';
  select coalesce(array_agg(x), '{}') into keys from jsonb_array_elements_text(res->'keys') x;
  select coalesce(jsonb_agg(jsonb_build_object('key', tb.key, 'label', tb.label, 'features', to_jsonb(tb.features), 'price', tb.price_month)
           || case when exists (select 1 from jsonb_array_elements(added) a where a->>'key' = tb.key)
                   then jsonb_build_object('added_for', (select a->>'because' from jsonb_array_elements(added) a where a->>'key' = tb.key limit 1)) else '{}'::jsonb end
           order by tb.sort), '[]'::jsonb) into blocks
    from trial_blocks tb where tb.active and tb.key = any(keys);
  if jsonb_array_length(blocks) = 0 then raise exception 'Pick at least one block.'; end if;
  for b in select * from trial_blocks where active and key = any(keys) loop
    select feats || coalesce(jsonb_object_agg(f, true), '{}'::jsonb) into feats from unnest(b.features) f;
  end loop;
  base := left(coalesce(nullif(regexp_replace(lower(biz), '[^a-z0-9]', '', 'g'), ''), 'shop'), 24);
  v_slug := base;
  while exists (select 1 from tenants where tenants.slug = v_slug) or v_slug in ('app','www','api','admin','status','mail','auth','login','start','go','demo','agents','next') loop
    v_slug := base || substr(md5(random()::text), 1, 4);
  end loop;
  select au.email into email from auth_users au where au.id = uid;
  insert into tenants (name, slug, niche, status, is_trial) values (left(biz, 160), v_slug, 'retail', 'trial', true) returning id into tid;
  insert into tenant_settings (tenant_id, features, trial)
    values (tid, feats, jsonb_build_object('state', 'active', 'started', now(), 'ends', ends, 'blocks', blocks));
  insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('name', left(biz, 160)));
  insert into profiles (id, tenant_id, email, role) values (uid, tid, email, 'owner');
  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner') where id = uid;
  insert into notifications (tenant_id, type, title, body) values (null, 'self_trial', 'New 3-day trial: ' || biz, left(cname, 80) || ' · ' || v_phone || ' · ' || array_to_string(keys, ', '));
  return jsonb_build_object('tenant_id', tid, 'slug', v_slug, 'ends', ends, 'keys', to_jsonb(keys), 'added', added);
end $$;

-- ROLLBACK (manual, only if needed): re-run the start_self_trial definition from db/262_self_trial_blocks.sql, then
--   drop function if exists public_module_resolve(jsonb); drop function if exists module_resolve(text[]);
--   drop function if exists public_module_catalogue(); drop table if exists module_catalogue;
-- Trials already started keep working: trial.blocks only gained an optional "added_for" note.
