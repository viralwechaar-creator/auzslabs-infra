-- Business types for the build page (Phase 1 of the modular builder).
-- The person chooses the business type; it is never guessed from the modules they tick. Two different things are kept apart:
--   tenants.niche     = the business CATEGORY (cafe, retail, salon, mobile, ...)   -> registry column "niche"
--   settings.bizType  = how the POS BEHAVES (restaurant, retail, salon)             -> registry column "pos_mode"
-- A new type that reuses an existing niche and POS mode is just a new row here: no frontend or function change.
-- A new niche value needs tenants_niche_check widened; a new POS mode needs POS code. Neither is part of this migration.
--
-- "Salon / services" is listed but COMING SOON: start_self_trial refuses it (status and a hard niche rule), because the Salon console is gated
-- by niche alone (db/053) and would otherwise open without the salon entitlement. Existing Salon gates and tenants are NOT touched.
-- Nothing existing is rewritten: no backfill of tenants, trials or settings. The only data change is the visible label of the scan screen
-- (stable id 'scan' unchanged).
--
-- Whole file is one transaction (psql stops at the first error and the open transaction is rolled back). Safe to run twice.
--
-- ROLLBACK (manual): 1) re-run the start_self_trial definition from db/263_module_catalogue.sql
--   2) update module_catalogue set screens = (select jsonb_agg(case when s->>'id' = 'scan' then jsonb_set(s, '{label}', '"Scan to bill"') else s end order by o)
--        from jsonb_array_elements(screens) with ordinality t(s, o)) where key = 'scan';
--   3) drop function if exists public_module_tiers(jsonb); drop function if exists public_business_types(); drop table if exists business_types;
-- Businesses created in between keep a harmless business_type key in their trial JSON and a bizType in their settings.
begin;

create table if not exists business_types (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null,
  description text not null default '',
  niche text not null check (niche in ('cafe', 'salon', 'retail', 'mobile', 'custom')),
  pos_mode text not null check (pos_mode in ('restaurant', 'retail', 'salon')),
  catalogue_tags text[] not null default '{}',
  recommended text[] not null default '{}',
  unavailable jsonb not null default '[]'::jsonb check (jsonb_typeof(unavailable) = 'array'),
  status text not null default 'active' check (status in ('active', 'coming_soon')),
  sort int not null default 100,
  constraint business_types_salon_not_active check (niche <> 'salon' or status <> 'active')
);
alter table business_types enable row level security;   -- no policies: read only through the functions below

insert into business_types (key, label, description, niche, pos_mode, catalogue_tags, recommended, status, sort) values
  ('retail', 'Retail / general shop', 'Shops that sell products: groceries, clothing, books, hardware and more.', 'retail', 'retail', '{retail,clothing}', '{pos,scan}', 'active', 10),
  ('cafe', 'Cafe / restaurant / cloud kitchen', 'Tables, kitchen orders, takeaway and delivery.', 'cafe', 'restaurant', '{cafe}', '{pos,kitchen,self_order}', 'active', 20),
  ('salon', 'Salon / services', 'Salons, spas and other service businesses. Our team sets these up for you.', 'salon', 'salon', '{salon}', '{salon,payroll}', 'coming_soon', 30),
  ('mobile', 'Mobile shop / repair', 'Phone sales with IMEI, repairs and dues.', 'mobile', 'retail', '{mobile}', '{mobile,scan}', 'active', 40)
on conflict (key) do nothing;

-- what the builder shows: public configuration only (no tenant data, no prices, not the internal niche or POS mode)
create or replace function public_business_types() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'status', status) order by sort, key), '[]'::jsonb)
  from business_types
$$;

-- Display only: which modules to recommend, which are optional for this type, which are unavailable and why.
-- Compatibility tags are advice. Access is still decided by the existing entitlement guards and by module_resolve / start_self_trial.
create or replace function public_module_tiers(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare bt business_types%rowtype; out_rec jsonb := '[]'::jsonb; m record; tier text; why text; ex jsonb;
begin
  select * into bt from business_types where key = coalesce(p->>'business_type', '');
  if not found then raise exception 'That business type is not available.'; end if;
  for m in select * from module_catalogue where active order by sort, key loop
    ex := (select x from jsonb_array_elements(bt.unavailable) x where x->>'key' = m.key limit 1);
    why := null;
    if m.status <> 'available' then tier := 'unavailable'; why := 'Set up by our team.';
    elsif ex is not null then tier := 'unavailable'; why := coalesce(ex->>'reason', 'Not available for this business type.');
    elsif m.key = any (bt.recommended) then tier := 'recommended';
    elsif m.niches && bt.catalogue_tags then tier := 'compatible';
    else tier := 'unavailable'; why := 'Not suggested for this business type yet.';
    end if;
    out_rec := out_rec || jsonb_build_object('key', m.key, 'tier', tier, 'reason', why);
  end loop;
  return jsonb_build_object('business_type', bt.key, 'status', bt.status, 'modules', out_rec);
end $$;

-- visible label of the scan screen only; the stable screen id stays 'scan'
update module_catalogue set screens = (
  select jsonb_agg(case when s->>'id' = 'scan' then jsonb_set(s, '{label}', '"Barcode & Scan"') else s end order by o)
  from jsonb_array_elements(screens) with ordinality t(s, o)) where key = 'scan';

-- start_self_trial: db/263 plus the business type (see the header). Same signature, same security properties.
create or replace function start_self_trial(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); biz text := trim(coalesce(p->>'business_name', '')); cname text := trim(coalesce(p->>'contact_name', ''));
  v_phone text := trim(coalesce(p->>'phone', '')); keys text[]; blocks jsonb; feats jsonb := '{}'; v_slug text; base text; tid uuid; ends timestamptz := now() + interval '3 days';
  b record; email text; res jsonb; added jsonb;
  v_type text := trim(coalesce(p->>'business_type', '')); bt business_types%rowtype; u record;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'This login already has a business. Open it from your apps.'; end if;
  if exists (select 1 from platform_admins where id = uid) then raise exception 'Platform admins cannot start a trial.'; end if;
  if biz = '' then raise exception 'Please enter your business name.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'Please enter a valid mobile number.'; end if;
  -- the business type is chosen by the person, never guessed from the modules they tick
  if v_type = '' then raise exception 'Please choose your business type.'; end if;
  select * into bt from business_types where key = v_type;
  if not found then raise exception 'That business type is not available.'; end if;
  -- Coming soon types cannot be started here. A salon is also refused whatever its status says: the Salon console is gated by niche only (db/053),
  -- so a self-start with niche 'salon' would open it without the salon entitlement.
  if bt.status <> 'active' or bt.niche = 'salon' then raise exception '% is coming soon and cannot be started here yet. Please contact AUZslab and we will set it up for you.', bt.label; end if;
  select coalesce(array_agg(distinct x), '{}') into keys from jsonb_array_elements_text(coalesce(p->'blocks', '[]'::jsonb)) x;
  if coalesce(array_length(keys, 1), 0) = 0 then raise exception 'Pick at least one block.'; end if;
  res := module_resolve(keys);
  added := res->'added';
  -- modules the registry explicitly marks unavailable for this type (a business rule; authorization is still the entitlement guards)
  for u in select x->>'key' as k, x->>'reason' as why from jsonb_array_elements(bt.unavailable) x loop
    if u.k = any (select jsonb_array_elements_text(res->'keys')) then raise exception '% is not available for %. %', coalesce((select mc.label from module_catalogue mc where mc.key = u.k), u.k), bt.label, coalesce(u.why, ''); end if;
  end loop;
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
  insert into tenants (name, slug, niche, status, is_trial) values (left(biz, 160), v_slug, bt.niche, 'trial', true) returning id into tid;
  insert into tenant_settings (tenant_id, features, trial)
    values (tid, feats, jsonb_build_object('state', 'active', 'started', now(), 'ends', ends, 'blocks', blocks, 'business_type', bt.key));
  insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('name', left(biz, 160), 'bizType', bt.pos_mode));
  insert into profiles (id, tenant_id, email, role) values (uid, tid, email, 'owner');
  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner') where id = uid;
  insert into notifications (tenant_id, type, title, body) values (null, 'self_trial', 'New 3-day trial: ' || biz, left(cname, 80) || ' · ' || v_phone || ' · ' || array_to_string(keys, ', '));
  return jsonb_build_object('tenant_id', tid, 'slug', v_slug, 'ends', ends, 'keys', to_jsonb(keys), 'added', added, 'business_type', bt.key);
end $$;

commit;
