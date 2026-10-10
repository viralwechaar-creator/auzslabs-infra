-- Owner's "New Pricing List" (proposed rates, GST 18% extra, yearly = 10 months).
-- "AUZsPOS QR" is POS + the QR add-on (key self_order), so the add-on is 1,490 - 1,090 = 400 a month.
-- AUZsMob keeps its own rules (gst_exempt, no setup fee) from db/101; only its prices change.
update product_prices set monthly_price = 1090, yearly_price = 10900 where key = 'pos';
update product_prices set monthly_price = 400,  yearly_price = 4000  where key = 'self_order';
update product_prices set monthly_price = 590,  yearly_price = 5900  where key = 'payroll';
update product_prices set monthly_price = 1490, yearly_price = 14900 where key = 'accounting';
update product_prices set monthly_price = 249,  yearly_price = 2490, renewal_yearly_price = 2490 where key = 'mobile';
update product_prices set monthly_price = 1490, yearly_price = 14900 where key = 'salon';

update bundles set active = false where key in ('hospitality_team','hospitality_qr_team','retail_team','complete_business');

insert into bundles (key, label, feature_keys, monthly_price, list_price, yearly_price, badge, blurb, active, sort)
values
  ('hospitality_essentials', 'Hospitality Essentials (AUZsPOS + AUZsPay)', array['pos','payroll'], 1490, 1680, 14900,
    'Hospitality Essentials', 'Billing and staff payroll for cafes, restaurants and bars.', true, 10),
  ('digital_restaurant', 'Digital Restaurant (AUZsPOS + QR + AUZsPay)', array['pos','self_order','payroll'], 1990, 2080, 19900,
    'Digital Restaurant', 'Billing, QR table ordering and staff payroll.', true, 20),
  ('retail_operations', 'Retail Operations (AUZsLedger + AUZsPay)', array['accounting','payroll'], 1790, 2080, 17900,
    'Retail Operations', 'Accounting and staff payroll for retail businesses.', true, 30)
on conflict (key) do update set
  label = excluded.label, feature_keys = excluded.feature_keys, monthly_price = excluded.monthly_price,
  list_price = excluded.list_price, yearly_price = excluded.yearly_price, badge = excluded.badge,
  blurb = excluded.blurb, active = excluded.active, sort = excluded.sort, updated_at = now();
