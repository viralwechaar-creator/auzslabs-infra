-- The owner designed the Minimal theme around the shared demo account's catalogue, hero image and
-- collection photos as they looked at design time. Since then that demo account's data moved onto the new
-- storefront platform (sfx_*, see db/372) and keeps changing day to day -- products added/removed, the
-- hero image swapped, the store opened/closed for unrelated testing -- and every one of those changes was
-- silently reflected in the Minimal template preview the instant it happened, making the template look
-- different from what was actually designed and approved. The owner asked for the Minimal template to
-- always look exactly as it does right now, regardless of any future edit to the demo account.
--
-- This takes one frozen copy of the demo account's current public storefront data
-- (public_sfx_store('demo') -- shop, config incl. heroImages, every product, every collection) right now,
-- at migration time, and stores it permanently. Minimal's own demo preview (store.html?demo=minimal) reads
-- ONLY this frozen copy from now on (app/public/store/store.js), never the live demo account -- so editing,
-- removing or even deleting every product on the real demo account can never change how the Minimal
-- template preview looks again. Classic/Studs/Kaarigari previews are untouched: they still follow the live
-- demo account exactly as before, since only Minimal was asked to be locked down this way.
create table if not exists sfx_frozen_theme_demos (
  theme text primary key,
  data jsonb not null,
  frozen_at timestamptz not null default now()
);
grant select on sfx_frozen_theme_demos to app;

-- One-time freeze, taken the moment this migration runs. If it's ever re-applied on a different database
-- (a fresh install) it freezes whatever that database's own demo account looks like at that moment, which
-- is the correct behaviour there too. Never overwrites an existing freeze.
insert into sfx_frozen_theme_demos (theme, data)
  select 'minimal', public_sfx_store('demo')
  where public_sfx_store('demo') is not null
  on conflict (theme) do nothing;

create or replace function public_frozen_theme_demo(p_theme text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select data from sfx_frozen_theme_demos where theme = p_theme;
$$;
