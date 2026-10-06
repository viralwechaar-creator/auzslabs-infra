# Launch checklist

Tick these in order. "You" = the owner, "Partner" = registration/tax/bank, "Dev" = code (already done unless noted).

## A. Server health (you, 20 minutes)
- [ ] `cd ~/auzslabs-infra && git pull origin main && git log -1 --oneline` (note the commit)
- [ ] Apply any new `db/` files in order (`db/099`, `db/100` are the latest at the time of writing) and `docker compose up -d --build api`
- [ ] `curl -s https://api.auzslab.in/health` shows `"ok":true`
- [ ] `bash tools/restore-test.sh` prints PASS (send the last lines to the developer if FAIL)
- [ ] Server has the latest system updates and has been restarted once (`apt update && apt upgrade -y`, then `reboot`, then check the line above again)
- [ ] Uptime Kuma (`status.auzslab.in`) sends you a message when the site goes down. Test by pausing a monitor
- [ ] Sentry receives errors (open the project; make one test error if needed)

## B. Keys and accounts (you)
- [ ] Replace any key that was ever shown in a screenshot or chat: Resend, GoDaddy API key/secret, Backblaze, Razorpay (key and webhook secret). Put the new values in `.env`, then `docker compose up -d --build api`
- [ ] Two-step login on: GitHub, Google, GoDaddy, Resend, Razorpay, server provider
- [ ] Server login by SSH key only (no password), firewall allows only 22, 80, 443
- [ ] Google Cloud OAuth client lists `https://auzslab.in/signin.html` as a redirect address and the consent screen is Published

## C. Money (you + partner)
- [ ] Until Razorpay is live, customers pay by the UPI QR on the cart page (`CFG.upiId` in `site/cart.html`; replace the personal id with the business id before public launch). Match each payment's UTR in your bank app, then Approve the request in the platform admin
- [ ] AUZsMob is Rs 199 a month or Rs 1,999 for the first year (Rs 1,599 from year two), no GST, no setup fee
- [ ] Razorpay account approved (KYC), live keys in `.env`, webhook URL `https://api.auzslab.in/payments/webhook` with its secret in `.env`
- [ ] One real small payment made end to end: the business activates by itself and a receipt is available
- [ ] Prices in the platform admin (Pricing and payments) match the pricing page. GST 18% and the Rs 2,179 setup fee are in `server/src/payments.js`
- [ ] GST invoice process for what you charge customers decided with the partner

## D. Legal (partner details, then dev)
- [ ] Terms, Privacy and Refund pages with the company name, address, GST number, grievance contact and refund rules
- [ ] A line in Privacy about what data is kept and how long, and how a customer deletes their account (the account page already has Delete account)

## E. The fake-customer test (you, on your phone, 30 minutes)
Use a brand-new Google account that has never used AUZslab.
1. [ ] Open auzslab.in, tap Sign up, Continue with Google. You land on the homepage, signed in.
2. [ ] Open Products or Pricing, add AuzsPOS, go to the cart. The bill shows subscription + 18% GST + Rs 2,179 setup fee.
3. [ ] Pay (use a real small amount or Razorpay Test Mode). Within a minute the business exists.
4. [ ] Open `<your-shop>.auzslab.in`. Sign in with Google. The POS opens.
5. [ ] Add a menu item, make a bill, print or share it. Open the bill link in a private tab.
6. [ ] Add a staff member with a username and PIN. Sign in as them in a second browser. They can bill but cannot open settings.
7. [ ] Forgot password on a password account: the email arrives, the link opens `auzslab.in`, a new password works.
8. [ ] Delete the test business afterwards (platform admin).
Write down every step that confused you. Those are the fixes to make before real customers.

## F. Real phones (you)
Open each on an iPhone and an Android, signed in as owner and as staff: POS, Payroll, Accounting, AUZsMob, salon console (`/salon/admin/`). Add each app to the home screen (delete the old icon first). Screenshot anything odd.

## G. Support and people (you)
- [ ] One WhatsApp number or email on the site for help, and someone who answers within a day
- [ ] A short "first day" guide for a new customer (the Getting started page already exists: check it matches reality)
- [ ] Who gets called if the server is down at night

## H. Known limits to tell customers or plan for
- Renewals are followed up by hand (no automatic recurring billing yet)
- No customer two-step login; no Zomato/Swiggy link; no direct GST-portal filing; POS sales are not posted into Accounting automatically
- One server: if it is down, everything is down. Backups are nightly and copied off-site
- Email from Resend free plan: 100 a day
