-- Kitchen (KDS) as its own selectable module that requires AUZsPOS. Additive; follows db/263.
-- What the `kds` feature key does today (verified in code): it only decides whether the POS shows the Kitchen and KOT-report
-- screens (app/public/pos/shell.js: featureOn('kds')). Kitchen data (order.kstat, kotlog) are ordinary POS records that the
-- existing POS entitlement (records_entitled('pos'), pos_kind_ok) already protects. There is NO separate server-side check for
-- kds, and this migration does not add one (that would change security-sensitive guards). So "Kitchen on" means the screens are
-- entitled and shown, exactly as for the cafe preset (db/001), and "Kitchen off" is a screen-level choice, not a data wall.
-- POS alone does NOT switch kds on: the pos trial block still carries {pos,crm,billing,inventory}.

insert into trial_blocks (key, label, blurb, features, price_month, sort) values
  ('kitchen', 'Kitchen screen', 'Send orders to a kitchen screen and track them until ready. Needs AUZsPOS.', '{kds}', 0, 15)
on conflict (key) do nothing;

insert into module_catalogue (key, label, description, family, niches, requires, conflicts, features, status, templates, sort, screens) values
  ('kitchen', 'Kitchen screen', 'Orders from the counter and QR ordering appear on a kitchen screen with timers, and the KOT report. Needs AUZsPOS, so it is added with it.', 'Sell',
   '{cafe}', '{pos}', '{}', '{kds}', 'available', '{classic,modern}', 15,
   '[{"id":"kitchen","label":"Kitchen orders","url":"/index.html?tab=kitchen","g":"bars"}]'::jsonb)
on conflict (key) do nothing;

-- the Kitchen screen now belongs to the kitchen module, not to the POS module (a screen id must be offered once)
update module_catalogue
   set screens = coalesce((select jsonb_agg(s) from jsonb_array_elements(screens) s where s->>'id' <> 'kitchen'), '[]'::jsonb)
 where key = 'pos' and screens @> '[{"id":"kitchen"}]'::jsonb;

-- ROLLBACK (manual): delete from module_catalogue where key = 'kitchen'; delete from trial_blocks where key = 'kitchen';
--   and put the screen back on pos: update module_catalogue set screens = screens || '[{"id":"kitchen","label":"Kitchen orders","url":"/index.html?tab=kitchen","g":"bars"}]'::jsonb where key = 'pos';
-- Trials already started with Kitchen keep their features; they would need the kds key removed by hand if wanted.
