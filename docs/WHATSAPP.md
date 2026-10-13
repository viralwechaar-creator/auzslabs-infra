# WhatsApp automation (owner guide)

Messages go out by themselves through the official WhatsApp Business route. Nothing is sent until you do the steps below.

## What is built
- One sending queue for every app. Each message is logged with its status (queued, sent, delivered, read, failed, skipped).
- **AUZslab's own messages** (from the AUZslab number): "request update", "quote and payment link", "GST bill after payment". Switched on by you in Admin -> WhatsApp ("Send AUZslab's own messages automatically"). While it is on, do not also use the tap-to-send buttons in Client requests for the same client, or they get two copies.
- **Client shops' customer messages**: booking confirmed (salon / reservations), repair ready (AUZsMob). Bill link, order ready, payment due, booking reminder and payslip templates exist and are ready to be connected next.
- **Which number sends for a shop**: the shop's own number if the owner connected it (Admin console -> Management -> WhatsApp); otherwise the AUZslab number, only if you ticked "allow" for that shop in Admin -> WhatsApp; otherwise nothing is sent (the message shows as "skipped") and the old tap-to-send buttons still work.
- A customer who replies STOP is never messaged again by that sender.

## One-time setup for the AUZslab number
1. In Meta Business Suite create a WhatsApp Business Account and add the AUZslab number (it can no longer be used in the normal WhatsApp app). Verify the business (a day or two).
2. In developers.facebook.com create an app, add the WhatsApp product, note the **Phone number ID**.
3. In Business settings -> System users create a system user, give it the WhatsApp account, and generate a **permanent token** (permissions whatsapp_business_messaging and whatsapp_business_management).
4. Put in the server `.env`: `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET` (app secret), `WA_VERIFY_TOKEN` (any long text). Then `docker compose up -d --force-recreate api`.
5. Meta -> WhatsApp -> Configuration -> Webhook: URL `https://api.auzslab.in/whatsapp/webhook`, Verify token = your `WA_VERIFY_TOKEN`, subscribe to **messages**.
6. WhatsApp Manager -> Message templates: create each template listed in Admin -> WhatsApp (exact name, English, exact text). Approval is usually minutes.
7. Admin -> WhatsApp: check "Connected on the server", then press Turn on.

## For a client shop with its own number
The shop owner does steps 1-3 and 6 for their own WhatsApp account, then pastes the Phone number ID and token in Admin console -> Management -> WhatsApp. The token is checked with Meta, stored encrypted and never shown again. Meta bills the shop directly.

## Costs and rules (Meta's, not ours)
Each business-started conversation is charged by Meta (a few paise to about a rupee depending on type). Only approved templates can start a conversation. Do not message people who have not agreed to hear from you.
