-- GST is off until AUZslab is GST-registered. When registered, turn it on with one line (no deploy):
--   update platform_flags set value = '18' where key = 'gst_rate_pct';
-- Setting it back to 0 removes GST from the cart, the pricing page and online payments.
insert into platform_flags (key, value) values ('gst_rate_pct', '0') on conflict (key) do nothing;
