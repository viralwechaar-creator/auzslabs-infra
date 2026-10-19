-- Phase 2 salon automations: lapsed-client win-back and the post-visit review request.
-- Same 'shop'-audience, dormant-until-WhatsApp-configured discipline as every template in db/184/194.
insert into wa_templates (key, name, audience, title, body, params) values
  ('lapsed_client',  'auzslab_lapsed_client',  'shop', 'We miss you',
   'Hi {{1}}, it has been a while since your last visit to {{2}}. We would love to see you again -- book your next appointment whenever suits you.', '{customer,shop}'),
  ('review_request', 'auzslab_review_request', 'shop', 'How was your visit?',
   'Hi {{1}}, thank you for visiting {{2}}! If you have a moment, we would really appreciate a quick review: {{3}}', '{customer,shop,link}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title,
  body = excluded.body, params = excluded.params;
