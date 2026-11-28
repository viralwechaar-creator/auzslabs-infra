-- Outpace: a new built-in storefront theme (footwear/sneaker storefront: after-hours sale hero, style tabs,
-- limited drops, early-access signup, FAQ). Integrated the same way Studs/Kaarigari were (db/398, db/467): a
-- fully bespoke, separately coded chrome (app/public/store/outpace.js + outpace.css), not a generic-section
-- theme. The current theme registry (db/468) made adding a new bespoke theme a small, mechanical change:
-- is_bespoke_chrome is computed automatically for any base_chrome outside ('minimal','classic'), and
-- sfx_theme_install_set_active / sfx_store_save already read that column generically -- neither needed to be
-- touched again here, unlike db/398/db/467 before the registry existed.
--
-- CHECKOUT: unlike Kaarigari, the approved handoff (theme-handoffs/outpace/CLAUDE.md) explicitly asked to
-- "keep live checkout on the existing server-backed flow" -- Outpace does NOT own checkout. It gets the
-- default capabilities.checkoutOwnership = 'header_footer' every bespoke theme starts with (db/468's own
-- update statement below), the same as Studs: it frames the shared checkout/account/orders/policies pages
-- with its own header/footer and never re-themes the checkout form itself.
--
-- Outpace is an approved built-in theme offered to every store (enabled_tenants = null). Installing creates a
--   DRAFT only; a store goes live on it only when its owner presses Publish, and can roll back for that store
--   alone. To restrict it: set enabled_tenants to '{}' or to a list of tenant ids.
--   * No store's theme, active install, products, collections, URL, checkout or account settings are touched.
--   * Installing Outpace only creates a DRAFT copy (sfx_theme_installs, published_content = null).
--   * Only sfx_theme_install_set_active / sfx_outpace_publish (the merchant's explicit Publish) make it live.
--
-- PRICE: price_cents = 0 (free), matching every other built-in theme so far. The approved handoff does not
--   specify a price -- flagged for the owner to correct if Outpace was meant to be a paid theme.
--
-- SETTINGS: no owner-editable settings object yet, same as Kaarigari -- the approved look (hero, style tabs,
--   drops, signup, FAQ) is a fixed bespoke layout with the merchant's own catalogue/collections dropped in.

alter table sfx_stores drop constraint if exists sfx_stores_theme_check;
alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic', 'studs', 'kaarigari', 'outpace'));
alter table sfx_themes drop constraint if exists sfx_themes_base_chrome_check;
alter table sfx_themes add constraint sfx_themes_base_chrome_check check (base_chrome is null or base_chrome in ('minimal', 'classic', 'studs', 'kaarigari', 'outpace'));

-- explicit Publish of an Outpace draft: same shape as sfx_studs_publish / sfx_kaarigari_publish
create or replace function sfx_outpace_publish(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  if th.base_chrome is distinct from 'outpace' then raise exception 'This is not an Outpace theme'; end if;
  update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  perform sfx_theme_install_set_active(p_install_id);
  return jsonb_build_object('ok', true);
end $$;

-- the theme itself. enabled_tenants = null: offered to every store. Installing still only creates a draft; a
-- store goes live on it only when its owner presses Publish.
insert into sfx_themes (name, slug, description, price_cents, status, is_builtin, base_chrome, enabled_tenants, preview_image_url)
values ('Outpace', 'outpace',
  'A footwear storefront: an after-hours sale hero, style tabs, limited drops and an early-access signup, built for sneakers and streetwear.',
  0, 'approved', true, 'outpace', null, '/store/outpace/hero.jpg')
on conflict (slug) do nothing;
insert into sfx_theme_versions (theme_id, version_number, content, frozen)
select id, 1, '{"kind":"outpace","sections":[],"settings":{}}'::jsonb, true from sfx_themes where slug = 'outpace'
  and not exists (select 1 from sfx_theme_versions v where v.theme_id = sfx_themes.id);
update sfx_themes th set approved_version_id = (select id from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1)
 where th.slug = 'outpace' and th.approved_version_id is null;

-- declared capabilities: the default header/footer-only checkout ownership every bespoke theme starts with
-- (db/468's own backfill only ran for rows that existed at that time -- this covers the new one explicitly).
update sfx_themes set capabilities = jsonb_build_object('checkoutOwnership', 'header_footer')
  where slug = 'outpace' and not (capabilities ? 'checkoutOwnership');

grant execute on function sfx_outpace_publish(uuid) to app;

-- STAGING NOTES (nothing below is run by this file)
--   Turn Outpace on for ONE internal store: update sfx_themes set enabled_tenants = array['<tenant uuid>']::uuid[] where slug = 'outpace';
--   Turn it off again for everyone:         update sfx_themes set enabled_tenants = '{}' where slug = 'outpace';
--   A merchant's rollback (their own store only): select sfx_theme_revert_active();
-- FULL ROLLBACK of this migration (only if no store is on Outpace; check first: select count(*) from sfx_stores where theme = 'outpace'):
--   drop function sfx_outpace_publish(uuid);
--   delete from sfx_theme_installs where theme_id = (select id from sfx_themes where slug = 'outpace');
--   delete from sfx_theme_versions where theme_id = (select id from sfx_themes where slug = 'outpace'); update sfx_themes set approved_version_id = null where slug = 'outpace'; delete from sfx_themes where slug = 'outpace';
--   alter table sfx_stores drop constraint sfx_stores_theme_check; alter table sfx_stores add constraint sfx_stores_theme_check check (theme in ('minimal', 'classic', 'studs', 'kaarigari'));
--   alter table sfx_themes drop constraint sfx_themes_base_chrome_check; alter table sfx_themes add constraint sfx_themes_base_chrome_check check (base_chrome is null or base_chrome in ('minimal', 'classic', 'studs', 'kaarigari'));
