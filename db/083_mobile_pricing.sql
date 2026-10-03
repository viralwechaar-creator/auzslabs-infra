-- =========================================================
-- AUZsMob: list it as a real, priceable product -- same "starts at 0, a platform admin sets the real
-- number from admin.html's Pricing panel" discipline every other product follows (see db/070's own
-- comment). Nothing here enables it for anyone; tenant_settings.features.mobile is still the only gate.
-- =========================================================
insert into product_prices (key, label) values ('mobile', 'AUZsMob')
  on conflict (key) do nothing;
