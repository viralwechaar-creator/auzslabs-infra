-- Kaarigari: a new built-in storefront theme (Indian artisan/handicrafts storefront: pottery, textiles, brass,
-- incense, woven fibres, carved wood). Integrated the same way Studs was (db/398): a fully bespoke, separately
-- coded chrome (app/public/store/kaarigari.js + kaarigari.css), not a generic-section theme.
--
-- Kaarigari is an approved built-in theme offered to every store (enabled_tenants = null). Installing creates a
--   DRAFT only; a store goes live on it only when its owner presses Publish, and can roll back for that store
--   alone. To restrict it: set enabled_tenants to '{}' or to a list of tenant ids (same notes as db/398).
--   * No store's theme, active install, products, collections, URL, checkout or account settings are touched.
--   * Installing Kaarigari only creates a DRAFT copy (sfx_theme_installs, published_content = null).
--   * Only sfx_theme_install_set_active / sfx_kaarigari_publish (the merchant's explicit Publish) make it live.
--
-- PRICE: price_cents = 0 (free), same as the other four built-ins (Minimal, Classic, Salon, Kiln) and Studs. The
--   approved handoff brief (theme-handoffs/kaarigari/CLAUDE.md) does not specify a price, so this is an assumption
--   -- flagged for the owner to correct if Kaarigari was meant to be a paid theme.
--
-- SETTINGS: unlike Studs, Kaarigari ships with no owner-editable settings object -- the approved design (hero,
--   craft/editorial imagery, footer skyline) is a fixed bespoke look with the merchant's own catalogue/collections
--   dropped in, not a set of fields worth exposing in a live-preview settings editor yet. If that changes, follow
--   db/398's sfx_studs_clean_settings/sfx_studs_settings_save pattern for a sfx_kaarigari_* counterpart.
--
-- ROLLBACK: see the comment block at the very end.

-- 1. the chrome values a store/theme can carry
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
alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic', 'studs', 'kaarigari'));
alter table sfx_themes add constraint sfx_themes_base_chrome_check check (base_chrome is null or base_chrome in ('minimal', 'classic', 'studs', 'kaarigari'));

-- 2. install: identical shape to db/398's sfx_theme_install (already generic across every base_chrome theme --
--    no redefinition needed here, sfx_theme_available()/sfx_theme_install() from db/398 already cover Kaarigari).

-- 3. making an install live, now generalized to any bespoke base_chrome theme (not just 'studs'): remembers what
--    was live, and the explicit activation also publishes the current draft for a bespoke-chrome theme the first
--    time it goes live (matches db/398's own studs-specific behavior, extended to kaarigari too).
create or replace function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes; st sfx_stores; bespoke boolean;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  bespoke := th.base_chrome in ('studs', 'kaarigari');
  if bespoke and not sfx_theme_available(th, tid) then raise exception 'This theme is not available for your store yet' using errcode = 'SF106'; end if;
  select * into st from sfx_stores where tenant_id = tid;
  if st.active_install_id is distinct from p_install_id then
    insert into sfx_stores (tenant_id, previous_theme, previous_install_id) values (tid, coalesce(st.theme, 'minimal'), st.active_install_id)
      on conflict (tenant_id) do update set previous_theme = coalesce(sfx_stores.theme, 'minimal'), previous_install_id = sfx_stores.active_install_id;
  end if;
  if bespoke and i.published_content is null then
    update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  end if;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.base_chrome is not null then
    update sfx_stores set theme = th.base_chrome where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- explicit Publish of a Kaarigari draft: same shape as db/398's sfx_studs_publish
create or replace function sfx_kaarigari_publish(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  if th.base_chrome is distinct from 'kaarigari' then raise exception 'This is not a Kaarigari theme'; end if;
  update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  perform sfx_theme_install_set_active(p_install_id);
  return jsonb_build_object('ok', true);
end $$;

-- 4. saving store settings keeps working while Kaarigari is live (db/398 only let 'studs' ride along with
--    minimal/classic; extend the same exception to 'kaarigari'). Kaarigari can never be chosen through this
--    function either, only kept when it is already the store's theme (set via the install/publish/activate path).
create or replace function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; cur_theme text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages', 'pages', 'files', 'customFields', 'markets', 'policies', 'privacy'];
  list_keys text[] := array['pages', 'files', 'customFields', 'markets']; obj_keys text[] := array['policies', 'privacy'];
  k text; pk text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'SF002'; end if;
  select theme into cur_theme from sfx_stores where tenant_id = tid;
  theme_ := coalesce(p->>'theme', cur_theme, 'minimal');
  if theme_ not in ('minimal', 'classic') and not (theme_ in ('studs', 'kaarigari') and cur_theme = theme_) then raise exception 'Choose Minimal or Classic' using errcode = 'SF002'; end if;
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

-- 5. the public storefront: for a Kaarigari store, return the inner result unchanged (unlike Studs, Kaarigari has
--    no owner-editable settings object yet (see the note at the top of this file), so there is nothing to merge
--    into config.kaarigari -- the theme builds everything from the store's real collections/products already in
--    the result). This wrapper exists so a future Kaarigari settings object (if ever added) has one obvious place
--    to plug in, the same way db/398 added one for Studs.
alter function public_sfx_store(text) rename to public_sfx_store_prekaarigari;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_prekaarigari(p_slug); tid uuid; st sfx_stores;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  if st.theme is distinct from 'kaarigari' then return r; end if;
  return r;
end $$;

-- 6. the theme itself. enabled_tenants = null: offered to every store. Installing still only creates a draft; a
--    store goes live on it only when its owner presses Publish.
insert into sfx_themes (name, slug, description, price_cents, status, is_builtin, base_chrome, enabled_tenants, preview_image_url)
values ('Kaarigari', 'kaarigari',
  'An Indian artisan and handicrafts storefront: a full-screen hero, a six-collection homepage layout, an editorial craft story and a skyline footer, built for clay, block-printed textiles, brass, woven fibres and carved wood.',
  0, 'approved', true, 'kaarigari', null, '/store/kaarigari/hero.jpg')
on conflict (slug) do nothing;
insert into sfx_theme_versions (theme_id, version_number, content, frozen)
select id, 1, '{"kind":"kaarigari","sections":[],"settings":{}}'::jsonb, true from sfx_themes where slug = 'kaarigari'
  and not exists (select 1 from sfx_theme_versions v where v.theme_id = sfx_themes.id);
update sfx_themes th set approved_version_id = (select id from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1)
 where th.slug = 'kaarigari' and th.approved_version_id is null;

grant execute on function sfx_theme_install_set_active(uuid) to app;
grant execute on function sfx_kaarigari_publish(uuid) to app;
grant execute on function sfx_store_save(jsonb) to app;
grant execute on function public_sfx_store(text) to app;

-- STAGING NOTES (nothing below is run by this file)
--   Turn Kaarigari on for ONE internal store: update sfx_themes set enabled_tenants = array['<tenant uuid>']::uuid[] where slug = 'kaarigari';
--   Turn it off again for everyone:          update sfx_themes set enabled_tenants = '{}' where slug = 'kaarigari';
--   A merchant's rollback (their own store only): select sfx_theme_revert_active();   (same db/398 RPC, already generic)
-- FULL ROLLBACK of this migration (only if no store is on Kaarigari; check first: select count(*) from sfx_stores where theme = 'kaarigari'):
--   drop function public_sfx_store(text); alter function public_sfx_store_prekaarigari(text) rename to public_sfx_store;
--   drop function sfx_kaarigari_publish(uuid);
--   delete from sfx_theme_installs where theme_id = (select id from sfx_themes where slug = 'kaarigari');
--   delete from sfx_theme_versions where theme_id = (select id from sfx_themes where slug = 'kaarigari'); update sfx_themes set approved_version_id = null where slug = 'kaarigari'; delete from sfx_themes where slug = 'kaarigari';
--   alter table sfx_stores drop constraint sfx_stores_theme_check; alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic', 'studs'));
--   alter table sfx_themes drop constraint sfx_themes_base_chrome_check; alter table sfx_themes add constraint sfx_themes_base_chrome_check check (base_chrome is null or base_chrome in ('minimal', 'classic', 'studs'));
--   re-run db/398's definitions of sfx_theme_install_set_active / sfx_store_save to drop the 'kaarigari' exceptions added here.
