-- =========================================================
-- Storefront theme marketplace: the built-in Salon and Kiln themes now carry the REAL copy and structure of
-- AUZslab's own designs (app/public/salon/ and app/public/site-kiln.html, text taken word for word), instead of the
-- paraphrased placeholder text db/376 used. A fifth built-in theme, "Kiln (Salon)", is Kiln's layout with the
-- food menu replaced by a services listing and the table reservation replaced by real appointment booking.
--
-- Existing installs are untouched: a store that already installed a theme has its own isolated copy
-- (sfx_theme_installs.draft_content). Only NEW installs start from the new version, which is added as version 2
-- (version 1 stays as history); the theme's approved version pointer moves to it.
-- =========================================================
insert into sfx_themes (name, slug, description, price_cents, status, is_builtin, base_chrome)
values ('Kiln (Salon)', 'kiln-salon', 'Kiln''s warm, editorial layout for salons and studios: your story, your services, and real appointment booking.', 0, 'approved', true, 'minimal')
on conflict (slug) do nothing;

with new_content(slug, content) as (values
('salon', $j${"sections":[
  {"id":"salon-note","type":"announcement","props":{"text":"Salon, Sardarpura, Jodhpur"}},
  {"id":"salon-hero","type":"hero","props":{"heading":"Hair, skin and nails, taken seriously.","sub":"Every treatment, grouped by category, with clear prices.","cta":"Book appointment","href":"#book"}},
  {"id":"salon-menu","type":"text","props":{"heading":"Treatment menu","body":"Every treatment, grouped by category, with clear prices."}},
  {"id":"salon-about","type":"text","props":{"heading":"About us","body":"Every treatment on our menu has a plain description and a fixed price, so you know what to expect before you sit down.\nWe keep the studio calm and unhurried, whether you are in for a quick trim or a full spa afternoon."}},
  {"id":"salon-gallery","type":"image","props":{"caption":"Gallery - add your own photo here"}},
  {"id":"salon-book","type":"booking","props":{"heading":"Book your appointment","note":"Tell us what you need and when, we'll confirm your slot."}}
]}$j$::jsonb),
('kiln', $j${"sections":[
  {"id":"kiln-note","type":"announcement","props":{"text":"Bread, pastry and coffee from one small oven near the Clock Tower."}},
  {"id":"kiln-hero","type":"hero","props":{"heading":"Good things take their time.","sub":"Small-batch bakes, carefully made coffee and a welcoming table in the heart of Jodhpur.","cta":"Order menu","href":"#"}},
  {"id":"kiln-story","type":"text","props":{"heading":"Made slowly, served warm","body":"A neighbourhood bakery and café built around thoughtful baking, good coffee and the pleasure of slowing down."}},
  {"id":"kiln-oven","type":"text","props":{"heading":"Oven times","body":"07:00 - Sourdough and country loaves. First bread out before we open the doors.\n08:30 - Croissants and morning pastry. Butter, chocolate and cardamom.\n11:00 - Focaccia and savoury bakes. Quiche, toasts and sandwiches start here.\n16:00 - Evening cakes and kachori danish. Cut fresh until we close."}},
  {"id":"kiln-gallery","type":"image","props":{"caption":"From the kitchen - add your own photo here"}},
  {"id":"kiln-matters","type":"text","props":{"heading":"What matters to us","body":"Made with care, never in a hurry.\nAt Kiln, the everyday things deserve attention: dough given time to rise, coffee made with care, seasonal bakes and a table where you can stay a little longer."}},
  {"id":"kiln-visit","type":"text","props":{"heading":"Visit or order","body":"Dine in: order from your phone, tell us your table number and we bring it over.\nTakeaway: choose a pickup time and collect at the counter. Name and mobile number are all we need."}},
  {"id":"kiln-cta","type":"button","props":{"text":"Order menu","href":"#"}}
]}$j$::jsonb),
('kiln-salon', $j${"sections":[
  {"id":"ks-note","type":"announcement","props":{"text":"Hair, skin and nails, taken seriously."}},
  {"id":"ks-hero","type":"hero","props":{"heading":"Good things take their time.","sub":"Every treatment, grouped by category, with clear prices.","cta":"Book appointment","href":"#book"}},
  {"id":"ks-story","type":"text","props":{"heading":"Made slowly, served warm","body":"A neighbourhood studio built around thoughtful care and the pleasure of slowing down."}},
  {"id":"ks-services","type":"text","props":{"heading":"Our services","body":"Every treatment on our menu has a plain description and a fixed price, so you know what to expect before you sit down. See the full list in your catalog below."}},
  {"id":"ks-gallery","type":"image","props":{"caption":"From the studio - add your own photo here"}},
  {"id":"ks-matters","type":"text","props":{"heading":"What matters to us","body":"Made with care, never in a hurry.\nWe keep the studio calm and unhurried, whether you are in for a quick trim or a full spa afternoon."}},
  {"id":"ks-book","type":"booking","props":{"heading":"Book your appointment","note":"Tell us what you need and when, we'll confirm your slot."}}
]}$j$::jsonb))
, ins as (
  insert into sfx_theme_versions (theme_id, version_number, content, frozen)
  select t.id, coalesce((select max(version_number) from sfx_theme_versions v where v.theme_id = t.id), 0) + 1, n.content, true
  from new_content n join sfx_themes t on t.slug = n.slug
  where not exists (select 1 from sfx_theme_versions v where v.theme_id = t.id and v.content = n.content)
  returning theme_id, id, version_number)
update sfx_themes th set approved_version_id = ins.id, updated_at = now() from ins where ins.theme_id = th.id;

-- Rollback: point sfx_themes.approved_version_id back at version 1 of salon/kiln; delete the kiln-salon theme (only while it has no installs).
