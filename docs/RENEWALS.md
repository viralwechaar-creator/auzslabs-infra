# Renewals, plans in every app, and new-account links (db/098)

- **Renewal date** is `tenants.renewal_date` (set per client in the admin panel > Clients). Demo businesses are ignored.
- **Daily job** (`runRenewals()` in `server/src/maintenance.js`, runs 1 minute after the API starts and every 24 h): `renewal_notify_run()` creates ONE
  in-app notification per stage for each business (7 days, 3 days, 1 day, due today, expired) plus one for the platform admin, and the API emails each
  owner (`sendRenewalEmail`, needs `RESEND_API_KEY`; without it only the in-app notices are created). Re-running never repeats a stage (`renewal_notices`).
  Owners see the notice under account.html > Notifications.
- **In every app** (`app/public/ds/plan.js`, `data-app` on its script tag): a floating reminder when the plan ends within 7 days or has expired
  (dismissible for a day, hidden for demos), a "Plan & account" row (POS Staff & settings, Payroll/Accounting/AUZsMob More, Back Office menu, Console side nav,
  Builder header) opening `auzPlan.open(sb)`: plan, renewal date, included products, Renew now / See all plans / Create a new account.
- **New customers**: every app's sign-in screen gets "Create an account / See plans" links to `https://auzslab.in/cart.html?add=<product>&from=<app>`
  and `pricing.html`. `cart.html` pre-selects the product (`?add=`), and its normal signup flow creates the client request in AUZslab admin.
- API: `my_subscription()` (registered in `RPC`). `renewal_notify_run()` is deliberately NOT registered.
- Deploy: `psql ... -v ON_ERROR_STOP=1 < db/098_subscription_renewals.sql`, `docker compose up -d --build api`.
