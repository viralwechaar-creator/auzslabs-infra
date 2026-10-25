-- AUZslab WhatsApp templates: shorter, organised, scannable -- not one long run-on sentence.
--
-- Owner feedback: every template built so far (db/184 onward) crammed a greeting, the facts and a closing line
-- into one continuous paragraph ("Hi {{1}}, your order {{2}} from {{3}} is confirmed. Total Rs {{4}}. You can
-- follow it any time here: {{5}} Thank you for shopping with us.") -- easy to write, hard to read on a phone.
-- Every body here is rewritten as a short heading/greeting line, then each real fact on its own line, then one
-- short closing line -- the format AUZslabs's own in-app bill-share text (waText() in app/public/style/lib.js)
-- already used, just not yet applied to the formal WhatsApp Business templates.
--
-- IMPORTANT, read before assuming a customer's message changed: `name`, `audience` and the exact `params` list
-- (and their order) are unchanged for every row here -- only `title` and the line breaks/wording inside `body`
-- moved. That matters because the *live* WhatsApp message a customer receives is the template already approved
-- under that same `name` in Meta's WhatsApp Business Manager (business-initiated WhatsApp messages must be a
-- pre-approved template, never free text -- see server/src/whatsapp.js's own comment) -- this table is AUZslab's
-- reference copy of what that approved template's text should say, used to look up `name`/`language` when
-- sending (server/src/whatsapp.js) and as the source to copy from when creating/editing a template in Meta's
-- console. Changing a row here does **not** by itself change what a customer receives: whoever manages the
-- auzslab WhatsApp Business Manager account must edit the matching template's body to this same wording (Meta
-- re-reviews a wording/formatting change, normally within a day; the template name and its {{1}}..{{n}} slot
-- count must stay exactly as registered, which this migration preserves for every row).
update wa_templates set title = 'AUZslab daily summary',
  body = E'AUZslab daily summary\n\nHi {{1}}:\nNew requests: {{2}}\nUnpaid quotes: {{3}}\nRenewals due this week: {{4}}'
  where key = 'admin_daily_summary';
update wa_templates set title = 'Payment received',
  body = E'Payment received, thank you {{1}}.\n\nGST bill {{2}}: {{3}}'
  where key = 'bill_paid';
update wa_templates set
  body = E'Hi {{1}}, your AUZslab quote is ready.\n\nReview and pay: {{2}}'
  where key = 'quote_payment_link';
update wa_templates set
  body = E'Renewal reminder\n\nHi {{1}}, {{2}}''s AUZslab plan renews in {{3}} days (on {{4}}).\n\nReply here if you need help.'
  where key = 'renewal_reminder';
update wa_templates set
  body = E'Hi {{1}}, thank you for reaching out about {{2}}.\n\nWe have it, and our team will contact you shortly.'
  where key = 'request_received';
update wa_templates set
  body = E'Request update\n\nHi {{1}}: {{2}}.'
  where key = 'request_update';
update wa_templates set
  body = E'Hi {{1}}, thanks for applying to join AUZslab.\n\nWe have your application and will be in touch soon.'
  where key = 'team_application_received';
update wa_templates set
  body = E'Welcome to AUZslab, {{1}}!\n\nYour business address: {{2}}\n\nWe''re here if you need anything.'
  where key = 'welcome';

update wa_templates set
  body = E'Happy anniversary {{1}}!\n\nThank you for being a valued client of {{2}}.'
  where key = 'anniversary_greeting';
update wa_templates set
  body = E'Happy birthday {{1}}!\n\nWishing you a wonderful day from everyone at {{2}}.'
  where key = 'birthday_greeting';
update wa_templates set title = 'Booking confirmed',
  body = E'Booking confirmed\n\nHi {{1}}, your booking at {{2}}:\n\nDate: {{3}}\nTime: {{4}}'
  where key = 'booking_confirmed';
update wa_templates set title = 'Booking reminder',
  body = E'Booking reminder\n\nHi {{1}}, your booking at {{2}}:\n\nDate: {{3}}\nTime: {{4}}\n\nSee you soon!'
  where key = 'booking_reminder';
update wa_templates set
  body = E'Hi {{1}}, thank you for shopping with {{2}}.\n\nBill: {{3}}\nAmount: Rs {{4}}\n\nView bill: {{5}}'
  where key = 'invoice_link';
update wa_templates set
  body = E'We miss you, {{1}}!\n\nIt has been a while since your last visit to {{2}}. Book your next appointment whenever suits you.'
  where key = 'lapsed_client';
update wa_templates set title = 'Membership expiring soon',
  body = E'Membership expiring soon\n\nHi {{1}}, your {{2}} package at {{3}} expires on {{4}}.\n\nVisit us soon to make the most of it.'
  where key = 'membership_expiry';
update wa_templates set title = 'Order ready',
  body = E'Order ready\n\nHi {{1}}, your order {{2}} at {{3}} is ready.'
  where key = 'order_ready';
update wa_templates set title = 'Order received',
  body = E'Order received\n\nHi {{1}}, {{2}} has your order {{3}}.\n\nWe will let you know when it is ready.'
  where key = 'order_received';
update wa_templates set
  body = E'Your day at {{1}}, {{2}}\n\nBookings: {{3}}\nBilled: Rs {{4}}\nNew clients: {{5}}\n\nHave a great day!'
  where key = 'owner_daily_summary';
update wa_templates set title = 'Payment reminder',
  body = E'Payment reminder\n\nHi {{1}}, a friendly reminder from {{2}}:\n\nAmount pending: Rs {{3}}'
  where key = 'payment_due';
update wa_templates set title = 'Payslip ready',
  body = E'Payslip ready\n\nHi {{1}}, your payslip for {{2}} from {{3}} is ready in the app.'
  where key = 'payslip_ready';
update wa_templates set title = 'Repair ready',
  body = E'Repair ready\n\nHi {{1}}, your {{2}} is repaired and ready to collect from {{3}}.'
  where key = 'repair_ready';
update wa_templates set
  body = E'Hi {{1}}, thank you for visiting {{2}}!\n\nA quick review would mean a lot: {{3}}'
  where key = 'review_request';
update wa_templates set
  body = E'Hi {{1}}, you left something in your bag at {{2}}.\n\nStill waiting for you: {{3}}\n\nNeed help? Just reply.'
  where key = 'style_abandoned_bag';
update wa_templates set title = 'Back in stock',
  body = E'Back in stock\n\nHi {{1}}, good news from {{2}}: {{3}} is back.\n\nOrder here: {{4}}'
  where key = 'style_back_in_stock';
update wa_templates set title = 'Order confirmed',
  body = E'Order confirmed\n\nHi {{1}}, order {{2}} from {{3}} is confirmed.\n\nTotal: Rs {{4}}\nTrack it: {{5}}'
  where key = 'style_order_confirmed';
update wa_templates set title = 'Order shipped',
  body = E'Order shipped\n\nHi {{1}}, order {{2}} from {{3}} is on its way with {{4}}.\n\nTrack it: {{5}}'
  where key = 'style_order_shipped';
update wa_templates set
  body = E'Hi {{1}}, good news from {{2}}:\n\nWe have ordered {{3}} for you. We will message you the moment it arrives.'
  where key = 'style_request_ordered';
update wa_templates set
  body = E'In stock: {{3}}\n\nHi {{1}}, the item you asked {{2}} for is now in stock. We are keeping it aside for you -- see you soon!'
  where key = 'style_request_ready';
update wa_templates set
  body = E'We miss you, {{1}}!\n\nIt has been a while since your last visit to {{2}}. Come see what is new -- we would love to see you again.'
  where key = 'style_winback';
