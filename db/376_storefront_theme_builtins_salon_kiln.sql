-- =========================================================
-- Storefront theme marketplace: the other 2 of Codex's original 4 built-in themes (ecosystem-preview/
-- data.js on codex/auzslab-launch-handoff, 77f276a) -- 375 only migrated in Minimal and Classic; the
-- owner has now confirmed the real design called for 4. Salon and Kiln join them as real, approved,
-- FREE (price_cents = 0, same as Minimal/Classic -- the owner was explicit this is not the time for
-- real per-theme pricing) sfx_themes rows, so any store owner can install and switch between any of
-- the 4 freely.
--
-- These are genuinely adapted, not literal ports of Codex's mockup OR of this codebase's own real
-- client sites (app/public/salon/ is a specific real salon's branding; app/public/site-kiln.html is a
-- specific real café's copy and photography) -- taking real layout/design-language inspiration from
-- both (hero + services/team for Salon's services-first layout; editorial hero + story + "visit or
-- order" for Kiln's photography-led bakery layout) and writing new, generic copy for a marketplace
-- theme any business can install, same as the rest of this project's "adapt the gap, don't clone the
-- client" rule.
--
-- Rendering: same section-editor/install/customize/publish pipeline as every other theme (hero/text/
-- image/button/announcement sections, sfx_theme_installs' own per-store draft/published copy -- same
-- isolation guarantee already verified for Minimal/Classic). The one new piece: which of the two
-- existing hand-built CSS chromes (store.js's 'minimal'/'classic' branches, see 375's own comment on
-- why a full page-chrome swap is out of scope) a BUILT-IN theme switches a store to when installed and
-- made active. Salon leans on Classic's structured, catalog-first navigation (closer to a services
-- menu); Kiln leans on Minimal's image-led, editorial layout (closer to a bakery's photography-led
-- site). Their own section content is what actually carries their distinct identity.
alter table sfx_themes add column base_chrome text check (base_chrome in ('minimal', 'classic'));
update sfx_themes set base_chrome = slug where slug in ('minimal', 'classic');

create or replace function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.base_chrome is not null then
    update sfx_stores set theme = th.base_chrome where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

insert into sfx_themes (name, slug, description, price_cents, status, is_builtin, base_chrome)
values
  ('Salon', 'salon', 'A services-first storefront: a hero, your services and team, and a clear way to book -- built for salons, spas and clinics.', 0, 'approved', true, 'classic'),
  ('Kiln', 'kiln', 'An editorial, photography-led storefront for cafés and bakeries: a big story section, a gallery, and a simple way to visit or order.', 0, 'approved', true, 'minimal')
on conflict (slug) do nothing;

insert into sfx_theme_versions (theme_id, version_number, content, frozen)
select id, 1, case slug
  when 'salon' then jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('id', 'salon-hero', 'type', 'hero', 'props', jsonb_build_object(
      'heading', 'Hair, skin and care, taken seriously.', 'sub', 'Book your next appointment in minutes.', 'cta', 'Book an appointment', 'href', '#')),
    jsonb_build_object('id', 'salon-note', 'type', 'announcement', 'props', jsonb_build_object('text', 'Walk-ins welcome -- appointments get priority')),
    jsonb_build_object('id', 'salon-services', 'type', 'text', 'props', jsonb_build_object(
      'heading', 'Our services', 'body', 'Hair styling, skincare treatments, nail care and more -- browse the full list in your catalog below.')),
    jsonb_build_object('id', 'salon-team', 'type', 'text', 'props', jsonb_build_object(
      'heading', 'Meet the team', 'body', 'Every stylist and therapist on our team brings real experience to your appointment.')),
    jsonb_build_object('id', 'salon-gallery', 'type', 'image', 'props', jsonb_build_object('caption', 'A look inside -- add your own gallery photo here')),
    jsonb_build_object('id', 'salon-book', 'type', 'button', 'props', jsonb_build_object('text', 'Book an appointment', 'href', '#'))
  ))
  when 'kiln' then jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('id', 'kiln-hero', 'type', 'hero', 'props', jsonb_build_object(
      'heading', 'Good things take their time.', 'sub', 'Small-batch bakes, carefully made coffee, and a table worth staying at.', 'cta', 'See the menu', 'href', '#')),
    jsonb_build_object('id', 'kiln-note', 'type', 'announcement', 'props', jsonb_build_object('text', 'Fresh bakes every morning')),
    jsonb_build_object('id', 'kiln-story', 'type', 'text', 'props', jsonb_build_object(
      'heading', 'A little about us', 'body', 'We bake in small batches, pour coffee with care, and keep a table open for anyone who wants to slow down for a while.')),
    jsonb_build_object('id', 'kiln-gallery', 'type', 'image', 'props', jsonb_build_object('caption', 'From the kitchen -- add your own photo here')),
    jsonb_build_object('id', 'kiln-visit', 'type', 'text', 'props', jsonb_build_object(
      'heading', 'Visit or order', 'body', 'Dine in, takeaway, or order online -- whatever suits you today.')),
    jsonb_build_object('id', 'kiln-cta', 'type', 'button', 'props', jsonb_build_object('text', 'View the menu', 'href', '#'))
  ))
end, true
from sfx_themes where slug in ('salon', 'kiln')
  and not exists (select 1 from sfx_theme_versions v where v.theme_id = sfx_themes.id);

update sfx_themes th set approved_version_id = (select id from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1)
where th.slug in ('salon', 'kiln') and th.approved_version_id is null;

grant execute on function sfx_theme_install_set_active(uuid) to app;
