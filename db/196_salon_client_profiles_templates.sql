-- Birthday/anniversary greetings and membership-expiry reminders, for the new client-profile and
-- package/membership records added alongside this migration (server/src/salon/rules.js:
-- saveClientProfile, savePackageDef, sellPackage). Same 'shop'-audience, dormant-until-WhatsApp-
-- configured discipline as every other salon template (db/184/194/195).
insert into wa_templates (key, name, audience, title, body, params) values
  ('birthday_greeting',    'auzslab_birthday_greeting',    'shop', 'Birthday greeting',
   'Happy birthday {{1}}! Wishing you a wonderful day from everyone at {{2}}.', '{customer,shop}'),
  ('anniversary_greeting', 'auzslab_anniversary_greeting', 'shop', 'Anniversary greeting',
   'Happy anniversary {{1}}! Thank you for being a valued client of {{2}}.', '{customer,shop}'),
  ('membership_expiry',    'auzslab_membership_expiry',    'shop', 'Membership expiring soon',
   'Hi {{1}}, your {{2}} package at {{3}} expires on {{4}}. Visit us soon to make the most of it.', '{customer,package,shop,date}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title,
  body = excluded.body, params = excluded.params;
