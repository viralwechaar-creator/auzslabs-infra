-- Showoff Salon service catalog + settings, transcribed from their
-- own seed.js (their real starting menu, 13 categories / 67 services)
-- and style.css (their exact brand palette + font).
--
-- NOT a schema migration -- deliberately kept out of db/ (which is
-- bind-mounted as docker-entrypoint-initdb.d and auto-runs every .sql
-- file alphabetically on a brand-new empty database; a one-off tenant
-- data seed in there would seed THIS salon's menu into every future
-- fresh install). Run this one by hand, once, after provisioning the
-- tenant via the normal admin onboarding flow (niche='salon', slug
-- 'showoffsalon' or whatever subdomain is actually chosen -- update
-- the slug below to match if it's different):
--
--   set -a; source .env; set +a
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db_data/showoff_salon_seed.sql
--
-- Safe to re-run (ON CONFLICT DO UPDATE / data merged, not replaced).
--
-- Reuses the SAME settings fields (siteTag/siteSub/siteAbout/siteHero/
-- siteInsta/siteHours/siteKicker/col/logo) that backoffice.html's
-- Settings -> Business/Website panes already edit for every other
-- niche's public site -- booking.html and i.html read those, not a
-- parallel set of salon-only fields. logo/siteHero are left unset
-- here (no real uploaded URL for the actual asset files exists yet --
-- upload them once through Settings -> Website/Booking after this runs).

do $$
declare tid uuid; cat_id text;
begin
  select id into tid from tenants where slug = 'showoffsalon';
  if tid is null then raise exception 'tenant with slug showoffsalon not found -- provision it first'; end if;

  insert into records (id, tenant_id, kind, data) values ('c-luxury-facial-all', tid, 'cat', '{"name": "Luxury facial", "n": 1}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-hydra', tid, 'item', '{"name": "Hydra", "desc": "Deep hydration facial that cleanses, exfoliates, and infuses skin with moisture for a glowing finish.", "price": 4000, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-save-the-date', tid, 'item', '{"name": "Save The Date", "desc": "Bridal-prep facial designed to give instant radiance and smooth, flawless skin for special occasions.", "price": 3500, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-fustu-kanpeki', tid, 'item', '{"name": "Fustu Kanpeki", "desc": "Advanced brightening facial that targets dullness and improves overall skin clarity and texture.", "price": 3300, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-korean-glass', tid, 'item', '{"name": "Korean Glass", "desc": "Glass-skin facial for ultra-smooth, dewy, and luminous skin inspired by Korean skincare.", "price": 3000, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-jeannot', tid, 'item', '{"name": "Jeannot", "desc": "Skin-rejuvenating facial that improves tone, texture, and natural glow.", "price": 3000, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-luxury-facial-all-u-tenfinity', tid, 'item', '{"name": "U Tenfinity", "desc": "Firming facial that lifts, tightens, and enhances skin elasticity.", "price": 2800, "sizes": [], "cat": "c-luxury-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-facial-all', tid, 'cat', '{"name": "Facial", "n": 2}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-facial-all-o3', tid, 'item', '{"name": "O3 +", "desc": "Oxygenating facial that detoxifies skin and boosts instant brightness.", "price": 2500, "sizes": [], "cat": "c-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-facial-all-radiant-glow', tid, 'item', '{"name": "Radiant Glow", "desc": "Glow-enhancing facial that refreshes dull skin and adds natural radiance.", "price": 1800, "sizes": [], "cat": "c-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-facial-all-vedic-line', tid, 'item', '{"name": "Vedic Line", "desc": "Herbal-based facial using natural ingredients to nourish and revitalize skin.", "price": 1500, "sizes": [], "cat": "c-facial-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-clean-up-all', tid, 'cat', '{"name": "Clean up", "n": 3}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-clean-up-all-o3-cleanup', tid, 'item', '{"name": "O3 + Cleanup", "desc": "Deep cleansing treatment that removes impurities and refreshes the skin.", "price": 1200, "sizes": [], "cat": "c-clean-up-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-clean-up-all-anti-tan-kanpeki', tid, 'item', '{"name": "Anti Tan Kanpeki", "desc": "Tan-removal cleanup that evens skin tone and restores brightness.", "price": 1000, "sizes": [], "cat": "c-clean-up-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-clean-up-all-lotus', tid, 'item', '{"name": "Lotus", "desc": "Gentle cleanup that hydrates and soothes the skin.", "price": 800, "sizes": [], "cat": "c-clean-up-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-clean-up-all-raaga', tid, 'item', '{"name": "Raaga", "desc": "Basic cleanup that refreshes and lightly cleanses the skin.", "price": 700, "sizes": [], "cat": "c-clean-up-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-clean-up-all-fresh-glow', tid, 'item', '{"name": "Fresh Glow", "desc": "Quick cleanup for instant freshness and a subtle glow.", "price": 550, "sizes": [], "cat": "c-clean-up-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-beauty-female', tid, 'cat', '{"name": "Beauty (Women)", "n": 4}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-full-face-wax', tid, 'item', '{"name": "Full Face Wax", "desc": "Removes unwanted hair from the entire face for smooth and clean skin.", "price": 400, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-side-locks-wax', tid, 'item', '{"name": "Side Locks Wax", "desc": "Eliminates hair from sideburns to give a neat and defined look.", "price": 150, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-forehead-wax', tid, 'item', '{"name": "Forehead Wax", "desc": "Cleans excess hair from the forehead for a smooth finish.", "price": 50, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-upper-lips-wax', tid, 'item', '{"name": "Upper Lips Wax", "desc": "Removes fine hair from the upper lip area for a clean appearance.", "price": 40, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-chin-wax', tid, 'item', '{"name": "Chin Wax", "desc": "Clears unwanted hair from the chin area for smoother skin.", "price": 40, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-eyebrows-threading', tid, 'item', '{"name": "Eyebrows Threading", "desc": "Shapes and defines eyebrows using precise threading technique.", "price": 50, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-forehead-threading', tid, 'item', '{"name": "Forehead Threading", "desc": "Removes fine hair from the forehead for a polished look.", "price": 30, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-upper-lips-threading', tid, 'item', '{"name": "Upper Lips Threading", "desc": "Gently removes upper lip hair using threading for smooth results.", "price": 20, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-female-chin-threading', tid, 'item', '{"name": "Chin Threading", "desc": "Targets and removes hair from the chin area with precision.", "price": 20, "sizes": [], "cat": "c-beauty-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-hair-colour-female', tid, 'cat', '{"name": "Hair colour (Women)", "n": 5}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-female-highlight', tid, 'item', '{"name": "Highlight", "desc": "Adds lighter strands to enhance dimension and give a stylish, modern look.", "price": 4500, "sizes": [], "cat": "c-hair-colour-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-female-ammonia-free-global-hair-colour', tid, 'item', '{"name": "Ammonia-Free Global Hair Colour", "desc": "Full hair coloring using gentle, ammonia-free formula for smooth and shiny results.", "price": 3000, "sizes": [], "cat": "c-hair-colour-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-female-global-hair-colour', tid, 'item', '{"name": "Global Hair Colour", "desc": "Even coloring applied to entire hair for a complete refreshed look.", "price": 2500, "sizes": [], "cat": "c-hair-colour-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-female-ammonia-free-root-touchup', tid, 'item', '{"name": "Ammonia-Free Root Touchup", "desc": "Covers regrowth using a gentle formula to match your existing hair color.", "price": 1000, "sizes": [], "cat": "c-hair-colour-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-female-root-touchup', tid, 'item', '{"name": "Root Touchup", "desc": "Covers visible roots to maintain a neat and consistent hair color.", "price": 800, "sizes": [], "cat": "c-hair-colour-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-hair-treatment-female', tid, 'cat', '{"name": "Hair treatment (Women)", "n": 6}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-treatment-female-nanoplastia', tid, 'item', '{"name": "Nanoplastia", "desc": "Deep repair treatment for smooth, frizz-free, glossy hair.", "price": 5500, "sizes": [], "cat": "c-hair-treatment-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-treatment-female-smoothing', tid, 'item', '{"name": "Smoothing", "desc": "Makes hair soft, straight, and easy to manage.", "price": 4000, "sizes": [], "cat": "c-hair-treatment-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-treatment-female-botox', tid, 'item', '{"name": "Botox", "desc": "Repairs damage and restores shine and softness.", "price": 4000, "sizes": [], "cat": "c-hair-treatment-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-treatment-female-keratin', tid, 'item', '{"name": "Keratin", "desc": "Reduces frizz and adds smoothness and shine.", "price": 3000, "sizes": [], "cat": "c-hair-treatment-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-hair-spa-female', tid, 'cat', '{"name": "Hair spa (Women)", "n": 7}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-spa-female-nourishment-hair-spa', tid, 'item', '{"name": "Nourishment hair spa", "desc": "Deep conditioning spa that nourishes dry hair and restores softness.", "price": 1200, "sizes": [], "cat": "c-hair-spa-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-spa-female-scalp-treatment-hair-fall', tid, 'item', '{"name": "Scalp treatment (hair fall)", "desc": "Targeted scalp care that helps reduce hair fall and keeps the scalp healthy.", "price": 1500, "sizes": [], "cat": "c-hair-spa-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-spa-female-ritual-hair-spa', tid, 'item', '{"name": "Ritual hair spa", "desc": "A relaxing spa ritual with massage for soft, shiny, refreshed hair.", "price": 2000, "sizes": [], "cat": "c-hair-spa-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-spa-female-plex-treatment', tid, 'item', '{"name": "Plex treatment", "desc": "Bond-repair treatment that strengthens damaged, over-processed hair.", "price": 3000, "sizes": [], "cat": "c-hair-spa-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-body-waxing-female', tid, 'cat', '{"name": "Body waxing (Women)", "n": 8}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-hand-waxing', tid, 'item', '{"name": "Hand waxing", "desc": "Removes hair from entire arms for smooth, even skin.", "price": 0, "sizes": [{"l": "Normal", "p": 200}, {"l": "Rica", "p": 350}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-half-leg-waxing', tid, 'item', '{"name": "Half-leg waxing", "desc": "Removes hair from lower or upper legs for a clean finish.", "price": 0, "sizes": [{"l": "Normal", "p": 150}, {"l": "Rica", "p": 350}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-full-leg-waxing', tid, 'item', '{"name": "Full-leg waxing", "desc": "Removes hair from entire legs for silky smooth skin.", "price": 0, "sizes": [{"l": "Normal", "p": 400}, {"l": "Rica", "p": 650}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-under-arms-waxing', tid, 'item', '{"name": "Under arms waxing", "desc": "Removes hair from underarms for smooth and hygienic skin.", "price": 0, "sizes": [{"l": "Normal", "p": 100}, {"l": "Rica", "p": 150}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-tummy-waxing', tid, 'item', '{"name": "Tummy waxing", "desc": "Removes unwanted hair from the stomach area for a clean finish.", "price": 0, "sizes": [{"l": "Normal", "p": 250}, {"l": "Rica", "p": 300}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-back-waxing-full', tid, 'item', '{"name": "Back waxing full", "desc": "Clears hair from the back for smooth and even skin.", "price": 0, "sizes": [{"l": "Normal", "p": 350}, {"l": "Rica", "p": 500}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-chest-waxing', tid, 'item', '{"name": "Chest waxing", "desc": "Removes hair from the chest area for a neat appearance.", "price": 0, "sizes": [{"l": "Normal", "p": 200}, {"l": "Rica", "p": 300}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-bikini-waxing-peel-off', tid, 'item', '{"name": "Bikini waxing (peel off)", "desc": "Removes hair around the bikini line for a clean look.", "price": 0, "sizes": [{"l": "Normal", "p": 2000}, {"l": "Rica", "p": 1200}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-female-full-body-waxing', tid, 'item', '{"name": "Full body waxing", "desc": "Complete hair removal for overall smooth and polished skin.", "price": 0, "sizes": [{"l": "Normal", "p": 1500}, {"l": "Rica", "p": 2500}], "cat": "c-body-waxing-female"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-beauty-male', tid, 'cat', '{"name": "Beauty (Men)", "n": 9}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-male-forehead-wax', tid, 'item', '{"name": "Forehead Wax", "desc": "Clears excess hair from the forehead for a neat appearance.", "price": 100, "sizes": [], "cat": "c-beauty-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-male-cheek-wax', tid, 'item', '{"name": "Cheek Wax", "desc": "Removes unwanted hair from cheeks for a clean, defined look.", "price": 200, "sizes": [], "cat": "c-beauty-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-beauty-male-neck-wax', tid, 'item', '{"name": "Neck Wax", "desc": "Removes hair from the neck area for a sharp and groomed finish.", "price": 200, "sizes": [], "cat": "c-beauty-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-hair-colour-male', tid, 'cat', '{"name": "Hair colour (Men)", "n": 10}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-male-highlight', tid, 'item', '{"name": "Highlight", "desc": "Adds subtle streaks to enhance style and give a modern look.", "price": 1500, "sizes": [], "cat": "c-hair-colour-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-male-ammonia-free-global-hair-colour', tid, 'item', '{"name": "Ammonia-Free Global Hair Colour", "desc": "Full hair coloring using gentle, ammonia-free formula for smooth and shiny results.", "price": 800, "sizes": [], "cat": "c-hair-colour-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-male-hair-colour', tid, 'item', '{"name": "Hair Colour", "desc": "Full hair colouring with a gentle formula for smooth, natural results.", "price": 500, "sizes": [], "cat": "c-hair-colour-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-hair-colour-male-beard-colour', tid, 'item', '{"name": "Beard colour", "desc": "Colours beard hair for a fuller and well-defined look.", "price": 300, "sizes": [], "cat": "c-hair-colour-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-body-waxing-male', tid, 'cat', '{"name": "Body waxing (Men)", "n": 11}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-male-hand-waxing', tid, 'item', '{"name": "Hand waxing", "desc": "Removes hair from entire arms for smooth, even skin.", "price": 600, "sizes": [], "cat": "c-body-waxing-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-male-half-leg-waxing', tid, 'item', '{"name": "Half-leg waxing", "desc": "Removes hair from lower or upper legs for a clean finish.", "price": 500, "sizes": [], "cat": "c-body-waxing-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-male-full-leg-waxing', tid, 'item', '{"name": "Full-leg waxing", "desc": "Removes hair from entire legs for silky smooth skin.", "price": 1000, "sizes": [], "cat": "c-body-waxing-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-male-chest-waxing', tid, 'item', '{"name": "Chest waxing", "desc": "Removes hair from the chest area for a neat appearance.", "price": 500, "sizes": [], "cat": "c-body-waxing-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-body-waxing-male-full-body-waxing', tid, 'item', '{"name": "Full body waxing", "desc": "Complete hair removal for overall smooth and polished skin.", "price": 2500, "sizes": [], "cat": "c-body-waxing-male"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-pedicure-all', tid, 'cat', '{"name": "Pedicure", "n": 12}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-pedicure-all-herbal-luxury-pedicure', tid, 'item', '{"name": "Herbal Luxury Pedicure", "desc": "Premium herbal treatment that deeply nourishes, relaxes, and rejuvenates tired feet.", "price": 1800, "sizes": [], "cat": "c-pedicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-pedicure-all-alege-pedicure', tid, 'item', '{"name": "Alege Pedicure", "desc": "Detoxifying pedicure enriched with algae extracts to cleanse and revitalize skin.", "price": 1500, "sizes": [], "cat": "c-pedicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-pedicure-all-bombini-ice-cream-pedicure', tid, 'item', '{"name": "Bombini Ice Cream Pedicure", "desc": "Indulgent pedicure with creamy textures for intense hydration and smoothness.", "price": 1200, "sizes": [], "cat": "c-pedicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-pedicure-all-crystal-pedicure', tid, 'item', '{"name": "Crystal Pedicure", "desc": "Brightening pedicure that adds shine and softness to dull feet.", "price": 800, "sizes": [], "cat": "c-pedicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-pedicure-all-fresh-feet-pedicure', tid, 'item', '{"name": "Fresh Feet Pedicure", "desc": "Basic pedicure for quick cleaning, grooming, and fresh-looking feet.", "price": 550, "sizes": [], "cat": "c-pedicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('c-manicure-all', tid, 'cat', '{"name": "Manicure", "n": 13}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-manicure-all-herbal-luxury-manicure', tid, 'item', '{"name": "Herbal Luxury manicure", "desc": "Deep nourishing manicure that hydrates and restores softness to hands.", "price": 1000, "sizes": [], "cat": "c-manicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-manicure-all-alege-manicure', tid, 'item', '{"name": "Alege manicure", "desc": "Detox manicure using algae-based products to refresh and rejuvenate skin.", "price": 900, "sizes": [], "cat": "c-manicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-manicure-all-bombini-ice-cream-manicure', tid, 'item', '{"name": "Bombini Ice Cream manicure", "desc": "Rich and creamy manicure for intense moisture and smooth hands.", "price": 700, "sizes": [], "cat": "c-manicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-manicure-all-crystal-manicure', tid, 'item', '{"name": "Crystal manicure", "desc": "Brightening manicure that enhances glow and smoothness.", "price": 500, "sizes": [], "cat": "c-manicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;
  insert into records (id, tenant_id, kind, data) values ('i-manicure-all-fresh-hands-manicure', tid, 'item', '{"name": "Fresh Hands manicure", "desc": "Basic manicure for clean, neat, and well-groomed hands.", "price": 400, "sizes": [], "cat": "c-manicure-all"}'::jsonb)
    on conflict (tenant_id, id) do update set data = excluded.data;

  -- settings: business info, the site.html-compatible public-page copy,
  -- booking hours/capacity, and the extended brand palette (their exact
  -- cream/gold/taupe/tint/line/muted + Hanken Grotesk font from
  -- style.css -- 'col' below is the primary plum colour, the same
  -- generic field every tenant already has). booking.html/i.html fall
  -- back to their own baked-in Showoff Salon defaults when `brand` is
  -- absent, so this is what makes both reusable for a *different*
  -- salon tenant later.
  update records set data = data || '{"name": "Showoff Salon", "addr": "Sardarpura, Jodhpur", "phone": "", "ftr": "Thank you for visiting Showoff Salon.", "col": "#391D21", "siteKicker": "Unisex salon", "siteTag": "Hair, skin and nails, taken seriously.", "siteSub": "Facials, hair colour and treatments, waxing, manicure and pedicure, with clear descriptions and fixed prices.", "siteAbout": "Every treatment on our menu has a plain description and a fixed price, so you know what to expect before you sit down.\nWe keep the studio calm and unhurried, whether you are in for a quick trim or a full spa afternoon.\nBook online in a minute, or call ahead if you would rather speak to someone first.", "siteHours": "10:00 \u2013 20:00, daily", "siteInsta": "https://instagram.com/showoff_unisex_salon_academy", "bookingOpen": "10:00", "bookingClose": "20:00", "bookingSlotMinutes": 30, "bookingSlotCapacity": 2, "brand": {"cream": "#F3E6C8", "gold": "#E8CF7F", "goldD": "#B8942F", "taupe": "#B9A79C", "tint": "#F7F3F0", "line": "#E4DCD6", "muted": "#74635F", "font": "Hanken Grotesk", "fontUrl": "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&display=swap"}}'::jsonb where tenant_id = tid and kind = 'settings' and id = 'settings';
end $$;
