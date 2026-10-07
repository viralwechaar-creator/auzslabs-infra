-- Real pricing update from the owner's new pricing sheet (October 2026): AUZsPay and AUZsLedger
-- are cheaper than before, every individual product now has a yearly price (not just AUZsMob),
-- and the four bundles are completely replaced -- new names, new members, new prices. The sheet's
-- numbers were cross-checked by hand before writing this (every "Save Rs X/month" and "(was Rs Y)"
-- on the sheet matches sum-of-parts minus the bundle price, and monthly*12, exactly) -- see the
-- chat history for the arithmetic; nothing here is guessed.
--
-- Yearly pricing for every product now follows the same "roughly 10x monthly, rounded to a round
-- number" shape AUZsMob already used (db/101), not an exact 10x -- these are real quoted prices,
-- not a formula, so they are set explicitly per product/bundle rather than computed.

-- ---------- individual products ----------
-- AUZsPOS stays 999/mo; self_order (the "+QR" add-on, see db/072's own comment: AUZsPOS QR's
-- 1,299 = pos 999 + self_order 300) stays 300/mo -- neither changed on this sheet.
update product_prices set yearly_price = 9990 where key = 'pos';
update product_prices set yearly_price = 3000 where key = 'self_order';

-- AUZsPay: was 999/mo, now 499/mo.
update product_prices set monthly_price = 499, yearly_price = 4999 where key = 'payroll';

-- AUZsLedger: was 1,599/mo, now 1,399/mo.
update product_prices set monthly_price = 1399, yearly_price = 13990 where key = 'accounting';

-- AUZsMob (199/mo, 1999/yr, gst_exempt, setup_fee_exempt) is unchanged -- already set in db/101.

-- ---------- bundles: the old four are retired (kept, not deleted, in case anything still
-- references them), the new four take over ----------
update bundles set active = false where key in ('starter', 'growing', 'complete', 'complete_qr');

insert into bundles (key, label, feature_keys, monthly_price, list_price, yearly_price, badge, blurb, active, sort)
values
  ('hospitality_team', 'Hospitality Team (AUZsPOS + AUZsPay)', array['pos','payroll'], 1399, 1498, 13990,
    'Hospitality Team', 'Perfect for restaurants, cafes, hotels, bars and clubs.', true, 10),
  ('hospitality_qr_team', 'Hospitality QR Team (AUZsPOS + QR + AUZsPay)', array['pos','self_order','payroll'], 1599, 1798, 15990,
    'Hospitality QR Team', 'Best for hospitality businesses with QR ordering.', true, 20),
  ('retail_team', 'Retail Team (AUZsLedger + AUZsPay)', array['accounting','payroll'], 1699, 1898, 16990,
    'Retail Team', 'Ideal for retail stores and businesses.', true, 30),
  ('complete_business', 'Complete Business (AUZsPOS + AUZsPay + AUZsLedger)', array['pos','payroll','accounting'], 2499, 2897, 24990,
    'Complete Business', 'Operations, staff and accounting -- all in one.', true, 40)
on conflict (key) do update set
  label = excluded.label, feature_keys = excluded.feature_keys, monthly_price = excluded.monthly_price,
  list_price = excluded.list_price, yearly_price = excluded.yearly_price, badge = excluded.badge,
  blurb = excluded.blurb, active = excluded.active, sort = excluded.sort, updated_at = now();
