# Google Play listing: ready-to-paste text and files

Files (all made for you, in `store/`):
- `store/icons/<app>.png` : 512x512 app icon for each app (hub, pos, mob, payroll, accounts).
- `store/banners/<app>.png` : 1024x500 feature graphic for each app.
- `store/screenshots/<app>/*.png` : phone screenshots, 1080x1919 (about 9:16), taken from the demo data. Play needs 2 to 8 per app.
  Re-take them any time with the demo shop open on a phone-size window if you want fresher data.

Suggested plan: publish **one combined app first ("AUZslab", `hub`)**, which asks for the shop name and opens any of the apps. Add the single-app listings later.

## Reviewer login (Play asks for a test account)
- Shop name: `demo`
- Email: `demo@auzslab.in`  Password: `Auzslab@Demo`  (staff: username + PIN on the Staff tab)
- Salon demo: shop `demo-salon`, staff `priya.demo-salon` / PIN `1234`

## AUZslab (combined app)
- App name: **AUZslab**
- Short description (80): Run your shop: billing, stock, staff pay, accounts and bookings in one place.
- Full description:
  AUZslab is business software for Indian shops, cafes, salons and mobile-phone stores.
  Bill customers, track stock, manage staff attendance and salary, keep your accounts and take bookings, from your phone.
  What you get (depending on your plan): AuzsPOS for billing, kitchen and customers; AuzsPay for attendance and payroll;
  AuzsLedger for accounting and GST books; AUZsMob for mobile shops (stock, sales, repairs); AUZslab Salon for bookings, billing and your own website.
  Works with poor internet: billing and mobile-shop entries are saved on the phone and sent when you are back online.
  Your data is private to your business. Staff sign in with their own username and PIN.
  You need an AUZslab account. Start with the free demo at auzslab.in.
- Category: Business. Tags: Business, Productivity, Finance.
- Contact email: helloauzslab@gmail.com. Website: https://auzslab.in
- Privacy policy URL: https://auzslab.in/privacy.html
- Account deletion URL (Play requires it): https://auzslab.in/delete-account.html

## Single-app names (later)
- AuzsPOS: "Billing, kitchen, stock and customers"
- AUZsMob: "Stock, sales and repairs for mobile shops" (English and Hindi)
- AuzsPay: "Attendance and payroll made simple"
- AuzsLedger: "Accounting and GST books"

## Data safety form (answers)
- Collects: name, email, phone number (account and customer records the shop enters); financial info the shop enters (bills, expenses, payroll); photos only if the shop uploads logos or item pictures.
- Shared with third parties: no sale of data. Processors: hosting server, Resend (email), Razorpay (payments, when enabled), Google (sign-in).
- Encrypted in transit: yes. Users can request deletion: yes (delete-account page and in-app Delete account).
- Location: only for staff clock-in if the shop turns it on. No ads. No advertising ID.

## Content rating and targeting
- Business app, no user-generated public content, no ads, no gambling. Target age 18+ (not for children).
- Declare: app contains in-app payments? No (subscriptions are paid on the website). Financial features: yes, bookkeeping tool, not a bank.

## Before you submit (owner side)
1. Create the Play Console account (organisation account is best once the company is registered; personal accounts need 12 testers for 14 days first).
2. Fill `site/company.js` once the company name and address are final, so the policy pages show them.
3. Upload the app bundle (AAB) built by the "Android build" workflow, and let Play manage the signing key (Play App Signing).
4. Paste the text above, upload icon, banner and screenshots, answer Data safety, submit for review.
