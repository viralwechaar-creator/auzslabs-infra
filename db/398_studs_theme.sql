-- Studs: a new built-in storefront theme (black Studio Drop, white catalogue, campaign carousel).
--
-- Studs is an approved built-in theme offered to every store (enabled_tenants = null). Installing creates a DRAFT only; a store
--   goes live on it only when its owner presses Publish, and can roll back for that store alone. To restrict it: set enabled_tenants
--   to '{}' or to a list of tenant ids (see the notes at the end of this file).
--   * No store's theme, active install, products, collections, URL, checkout or account settings are touched.
--   * Installing Studs only creates a DRAFT copy (sfx_theme_installs, published_content = null), as for every theme.
--   * Only sfx_theme_install_set_active / sfx_studs_publish (the merchant's explicit Publish) make it live for that one store.
--
-- ROLLBACK: see the comment block at the very end (the merchant-side undo is sfx_theme_revert_active).

-- 1. the chrome value a store can carry
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'sfx_stores'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%theme%minimal%' loop
    execute 'alter table sfx_stores drop constraint ' || quote_ident(c);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'sfx_themes'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%base_chrome%' loop
    execute 'alter table sfx_themes drop constraint ' || quote_ident(c);
  end loop;
end $$;
alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic', 'studs'));
alter table sfx_themes add constraint sfx_themes_base_chrome_check check (base_chrome is null or base_chrome in ('minimal', 'classic', 'studs'));

-- 2. who may see / install a theme. null = every store (all existing themes); an array = only those stores ('{}' = nobody).
alter table sfx_themes add column if not exists enabled_tenants uuid[];

-- 3. what to go back to: remembered when a theme is made active
alter table sfx_stores add column if not exists previous_theme text;
alter table sfx_stores add column if not exists previous_install_id uuid references sfx_theme_installs(id) on delete set null;

create or replace function sfx_theme_available(th sfx_themes, tid uuid) returns boolean language sql stable set search_path = public as $$
  select th.status = 'approved' and (th.enabled_tenants is null or tid = any(th.enabled_tenants));
$$;

-- 4. the library only lists themes this store may use (every existing theme has enabled_tenants = null, so nothing changes for them)
create or replace function sfx_theme_marketplace_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', th.id, 'name', th.name, 'slug', th.slug, 'description', th.description, 'previewImageUrl', th.preview_image_url,
    'priceCents', th.price_cents, 'isBuiltin', th.is_builtin,
    'developerName', (select name from tenants where id = th.developer_tenant_id),
    'installed', exists(select 1 from sfx_theme_installs i where i.theme_id = th.id and i.tenant_id = tid and not i.custom)
  ) order by th.is_builtin desc, th.price_cents, th.name) from sfx_themes th where sfx_theme_available(th, tid)), '[]'::jsonb);
end $$;

-- 5. install: identical to db/395 plus the availability check
create or replace function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); th sfx_themes; existing sfx_theme_installs; purchase sfx_theme_purchases;
  dev_share int; plat_share int;
begin
  select * into th from sfx_themes where id = p_theme_id;
  if th.id is null or not sfx_theme_available(th, tid) then raise exception 'This theme is not available in the marketplace' using errcode = 'SF106'; end if;
  select * into existing from sfx_theme_installs where tenant_id = tid and theme_id = p_theme_id and not custom;
  if existing.id is not null then return jsonb_build_object('installId', existing.id, 'alreadyInstalled', true); end if;
  if th.price_cents > 0 then
    raise exception 'Paid themes are coming soon -- platform billing for theme sales is not live yet' using errcode = 'SF107';
  end if;
  insert into sfx_theme_purchases (tenant_id, theme_id, version_id, price_cents) values (tid, p_theme_id, th.approved_version_id, th.price_cents) returning * into purchase;
  if th.price_cents > 0 and th.developer_tenant_id is not null then
    dev_share := floor(th.price_cents * 0.64)::int;
    plat_share := th.price_cents - dev_share;
    insert into sfx_dev_commission_ledger (developer_tenant_id, theme_id, purchase_id, sale_amount_cents, developer_share_cents, platform_share_cents)
      values (th.developer_tenant_id, th.id, purchase.id, th.price_cents, dev_share, plat_share);
  end if;
  -- a DRAFT only: published_content stays null and the store's active theme is not touched
  insert into sfx_theme_installs (tenant_id, theme_id, source_version_id, draft_content, published_content)
    values (tid, p_theme_id, th.approved_version_id, coalesce((select content from sfx_theme_versions where id = th.approved_version_id), '{}'::jsonb), null)
    returning * into existing;
  return jsonb_build_object('installId', existing.id, 'alreadyInstalled', false);
end $$;

create or replace function sfx_studs_url_ok(v text, contact boolean default false) returns boolean language sql immutable set search_path = public as $$
  select length(v) <= 600 and v !~ '\s' and (v ~* '^https://.+' or v ~ '^/[^/].*' or v ~ '^#/.*' or (contact and v ~* '^(mailto:|tel:).+'));
$$;

-- 6. Studs settings: checked and cleaned here. Only known fields survive, links must be https or a site path, sizes are capped.
create or replace function sfx_studs_clean_settings(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare o jsonb := '{}'::jsonb; k text; v text; arr jsonb; e jsonb; clean jsonb; n int;
  txt text[] := array['heroAlt', 'heroLabel', 'dropTitle', 'dropNav', 'moreTitle', 'quoteText', 'quoteAlt', 'closingText', 'closingAlt', 'dropCollection'];
  urls text[] := array['heroImage', 'heroHref', 'quoteImage', 'closingImage', 'closingHref'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array txt loop
    if p ? k and jsonb_typeof(p->k) = 'string' then o := o || jsonb_build_object(k, left(p->>k, 200)); end if;
  end loop;
  foreach k in array urls loop
    if p ? k and jsonb_typeof(p->k) = 'string' then
      v := trim(p->>k);
      if v = '' then null;
      elsif sfx_studs_url_ok(v) then o := o || jsonb_build_object(k, v);
      else raise exception '% must be an https address or a site path', k using errcode = 'SF002'; end if;
    end if;
  end loop;
  if p ? 'dropSlugs' and jsonb_typeof(p->'dropSlugs') = 'array' then
    o := o || jsonb_build_object('dropSlugs', coalesce((select jsonb_agg(x) from (select jsonb_array_elements_text(p->'dropSlugs') x limit 12) q where length(x) < 80), '[]'::jsonb));
  end if;
  -- lists of { text, href } / { image, collection } / { label, href } objects
  foreach k in array array['announcements', 'campaigns', 'footerLinks', 'channels', 'collectionImagesList'] loop
    if p ? k and jsonb_typeof(p->k) = 'array' then
      arr := '[]'::jsonb; n := 0;
      for e in select * from jsonb_array_elements(p->k) loop
        n := n + 1; exit when n > 12;
        continue when jsonb_typeof(e) <> 'object';
        clean := '{}'::jsonb;
        for v in select unnest(array['text', 'label', 'collection', 'panel']) loop
          if e ? v and jsonb_typeof(e->v) = 'string' then clean := clean || jsonb_build_object(v, left(e->>v, 120)); end if;
        end loop;
        for v in select unnest(array['href', 'image']) loop
          if e ? v and jsonb_typeof(e->v) = 'string' and trim(e->>v) <> '' then
            if sfx_studs_url_ok(trim(e->>v), v = 'href') then clean := clean || jsonb_build_object(v, trim(e->>v));
            else raise exception 'A % in % must be an https address or a site path', v, k using errcode = 'SF002'; end if;
          end if;
        end loop;
        if clean <> '{}'::jsonb then arr := arr || jsonb_build_array(clean); end if;
      end loop;
      if k <> 'collectionImagesList' then o := o || jsonb_build_object(k, arr); end if;
    end if;
  end loop;
  return o;
end $$;

-- the merchant edits the draft settings of one of their own Studs installs
create or replace function sfx_studs_settings_save(p_install_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes; c jsonb;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  if th.slug <> 'studs' then raise exception 'This theme has no Studs settings'; end if;
  c := sfx_studs_clean_settings(p);
  update sfx_theme_installs set draft_content = jsonb_set(coalesce(draft_content, '{}'::jsonb), '{settings}', c) where id = i.id;
  return jsonb_build_object('ok', true, 'settings', c);
end $$;

-- 7. making an install live. Same as db/376, plus: availability check, remember what was live, and for Studs the explicit
--    activation also publishes the current draft (one action, one store).
create or replace function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes; st sfx_stores;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  if th.base_chrome = 'studs' and not sfx_theme_available(th, tid) then raise exception 'This theme is not available for your store yet' using errcode = 'SF106'; end if;
  select * into st from sfx_stores where tenant_id = tid;
  if st.active_install_id is distinct from p_install_id then
    insert into sfx_stores (tenant_id, previous_theme, previous_install_id) values (tid, coalesce(st.theme, 'minimal'), st.active_install_id)
      on conflict (tenant_id) do update set previous_theme = coalesce(sfx_stores.theme, 'minimal'), previous_install_id = sfx_stores.active_install_id;
  end if;
  if th.base_chrome = 'studs' and i.published_content is null then
    update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  end if;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.base_chrome is not null then
    update sfx_stores set theme = th.base_chrome where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- explicit Publish of a Studs draft: copies the draft to the live copy and makes it the store's active theme
create or replace function sfx_studs_publish(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  if th.base_chrome is distinct from 'studs' then raise exception 'This is not a Studs theme'; end if;
  update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  perform sfx_theme_install_set_active(p_install_id);
  return jsonb_build_object('ok', true);
end $$;

-- the merchant's one-step way back: restores whatever was live before (and the chrome that went with it). Only this store changes.
create or replace function sfx_theme_revert_active() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); st sfx_stores;
begin
  select * into st from sfx_stores where tenant_id = tid;
  if st.tenant_id is null or st.previous_theme is null then raise exception 'There is no earlier theme to go back to' using errcode = 'SF002'; end if;
  update sfx_stores set theme = previous_theme, active_install_id = previous_install_id, previous_theme = null, previous_install_id = null, updated_at = now() where tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;

-- 8. saving store settings keeps working while Studs is live (db/394 only accepted Minimal or Classic). Studs can never be chosen
--    through this function, only kept when it is already the store's theme.
create or replace function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; cur_theme text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages', 'pages', 'files', 'customFields', 'markets', 'policies', 'privacy'];
  list_keys text[] := array['pages', 'files', 'customFields', 'markets']; obj_keys text[] := array['policies', 'privacy'];
  k text; pk text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'SF002'; end if;
  select theme into cur_theme from sfx_stores where tenant_id = tid;
  theme_ := coalesce(p->>'theme', cur_theme, 'minimal');
  if theme_ not in ('minimal', 'classic') and not (theme_ = 'studs' and cur_theme = 'studs') then raise exception 'Choose Minimal or Classic' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(list_keys) then
      if jsonb_typeof(p->k) <> 'array' then raise exception '% must be a list', k using errcode = 'SF002'; end if;
      if jsonb_array_length(p->k) > 200 then raise exception 'Too many items in %', k using errcode = 'SF002'; end if;
      if length((p->k)::text) > 300000 then raise exception 'That list is too large. Remove some items.' using errcode = 'SF002'; end if;
    end if;
    if k = any(obj_keys) then
      if jsonb_typeof(p->k) <> 'object' then raise exception '% must be an object', k using errcode = 'SF002'; end if;
      for pk in select jsonb_object_keys(p->k) loop
        if pk not in ('shipping', 'returns', 'privacy', 'terms', 'contactEmail', 'retention') then raise exception 'Unknown field %', pk using errcode = 'SF002'; end if;
        if jsonb_typeof(p->k->pk) <> 'string' or length(p->k->>pk) > 8000 then raise exception 'Each policy must be text up to 8000 characters' using errcode = 'SF002'; end if;
      end loop;
    end if;
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sfx_stores (tenant_id, theme, published, config) values (tid, theme_, coalesce((p->>'published')::boolean, (select published from sfx_stores where tenant_id = tid), false), cur)
    on conflict (tenant_id) do update set theme = excluded.theme, published = excluded.published, config = excluded.config, updated_at = now();
  return sfx_context();
end $$;

-- 9. the public storefront. A wrapper around the existing function: for every store whose live theme is NOT Studs it returns the
--    inner result untouched. For a Studs store it adds the store's published Studs settings (config.studs) and also lists items
--    that are sold out (the Studs pages show them washed out with a Sold out label).
alter function public_sfx_store(text) rename to public_sfx_store_prestuds;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_prestuds(p_slug); tid uuid; st sfx_stores; settings_ jsonb; gone jsonb;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  if st.theme is distinct from 'studs' then return r; end if;
  select coalesce(sfx_studs_clean_settings(i.published_content->'settings'), '{}'::jsonb) into settings_ from sfx_theme_installs i where i.id = st.active_install_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'handle', p.handle, 'category', p.category, 'description', p.description,
      'photos', coalesce(p.images, '[]'::jsonb), 'photoUrl', p.images->>0, 'price', p.price, 'mrp', p.compare_at, 'createdAt', p.created_at,
      'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.label, 'colour', 'Original', 'price', v.price, 'left', 0) order by v.position)
        from sfx_variants v where v.product_id = p.id), '[]'::jsonb)) order by p.created_at desc), '[]'::jsonb) into gone
    from sfx_products p where p.tenant_id = tid and p.status = 'active'
      and exists (select 1 from sfx_variants v where v.product_id = p.id)
      and not exists (select 1 from sfx_variants v where v.product_id = p.id and v.stock > 0);
  return jsonb_set(jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('studs', coalesce(settings_, '{}'::jsonb))),
    '{styles}', coalesce(r->'styles', '[]'::jsonb) || gone);
end $$;

-- 10. the theme itself. enabled_tenants = null: offered to every store. Installing still only creates a draft; a store goes live on it only when its owner presses Publish. To restrict it again: update sfx_themes set enabled_tenants = '{}' where slug='studs'.
insert into sfx_themes (name, slug, description, price_cents, status, is_builtin, base_chrome, enabled_tenants, preview_image_url)
values ('Studs', 'studs', 'A bold, photography-led retail storefront: a black Studio Drop, a campaign carousel on Shop all, borderless product tiles and a white catalogue.', 0, 'approved', true, 'studs', null, '/theme-previews/studs.jpg')
on conflict (slug) do nothing;
insert into sfx_theme_versions (theme_id, version_number, content, frozen)
select id, 1, '{"kind":"studs","sections":[],"settings":{}}'::jsonb, true from sfx_themes where slug = 'studs'
  and not exists (select 1 from sfx_theme_versions v where v.theme_id = sfx_themes.id);
update sfx_themes th set approved_version_id = (select id from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1)
 where th.slug = 'studs' and th.approved_version_id is null;

grant execute on function sfx_theme_marketplace_list() to app;
grant execute on function sfx_theme_install(uuid) to app;
grant execute on function sfx_theme_install_set_active(uuid) to app;
grant execute on function sfx_studs_settings_save(uuid, jsonb) to app;
grant execute on function sfx_studs_publish(uuid) to app;
grant execute on function sfx_theme_revert_active() to app;
grant execute on function sfx_store_save(jsonb) to app;
grant execute on function public_sfx_store(text) to app;

-- STAGING NOTES (nothing below is run by this file)
--   Turn Studs on for ONE internal store:   update sfx_themes set enabled_tenants = array['<tenant uuid>']::uuid[] where slug = 'studs';
--   Turn it off again for everyone:         update sfx_themes set enabled_tenants = '{}' where slug = 'studs';
--   A merchant's rollback (their own store only): select sfx_theme_revert_active();   (the owner dashboard has a button)
-- FULL ROLLBACK of this migration (only if no store is on Studs; check first: select count(*) from sfx_stores where theme = 'studs'):
--   drop function public_sfx_store(text); alter function public_sfx_store_prestuds(text) rename to public_sfx_store;
--   delete from sfx_theme_installs where theme_id = (select id from sfx_themes where slug = 'studs');
--   delete from sfx_theme_versions where theme_id = (select id from sfx_themes where slug = 'studs'); update sfx_themes set approved_version_id = null where slug = 'studs'; delete from sfx_themes where slug = 'studs';
--   alter table sfx_stores drop constraint sfx_stores_theme_check; alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic'));
--   (the earlier definitions of sfx_store_save, sfx_theme_install, sfx_theme_install_set_active, sfx_theme_marketplace_list are in db/394, 395, 376, 375: re-run those functions)
