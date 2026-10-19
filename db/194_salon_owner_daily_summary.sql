-- A salon owner's own end-of-day WhatsApp summary (bookings, billed, new clients), alongside the
-- customer-facing templates db/184 already seeded. Sent to the salon's own business number
-- (settings.phone, the same number shown to customers on the public site / invoices) -- there is no
-- separate "owner's personal WhatsApp" field anywhere in this schema, so this is the one number that
-- actually exists to send it to. Uses the SAME wa_tenant_settings.enabled/events opt-out every other
-- shop-audience template already respects (events->>'owner_daily_summary' = 'false' turns just this
-- one off, same mechanism db/184's own comment documents). Audience 'shop': sent from the shop's own
-- connected number if they have one, else the AUZslab number only if the platform admin allowed it --
-- identical trust level to every other shop-audience template.
insert into wa_templates (key, name, audience, title, body, params) values
  ('owner_daily_summary', 'auzslab_owner_daily_summary', 'shop', 'Your day at a glance',
   'Hi {{1}}, your summary for {{2}}: {{3}} bookings, Rs {{4}} billed, {{5}} new clients. Have a great day!',
   '{shop,date,bookings,revenue,new_clients}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title,
  body = excluded.body, params = excluded.params;
