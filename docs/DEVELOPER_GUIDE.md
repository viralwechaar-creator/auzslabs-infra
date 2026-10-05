# Developer guide

For someone new who has to change AUZslab. Plain steps first, depth in `CLAUDE.md`.

## 1. How it fits together

- **Caddy** (reverse proxy, HTTPS) serves `site/` for `auzslab.in`, and `app/public/` for every `<shop>.auzslab.in`. It forwards `api.auzslab.in` to the Node API and `/api/*` on a salon's address to the salon part of the API.
- **API** (`server/src/index.js`) is one hand-written HTTP server. Routes are `if (url.pathname === '/x' && req.method === 'POST')` blocks. There is no framework. Database functions called from the apps are listed in the `RPC` object in the same file: a new SQL function that is not listed there answers 404.
- **Postgres** holds everything. Customers' data is isolated by `tenant_id` and row-level security. Most of the POS data lives in one generic table, `records` (a `kind` column says what each row is). Payroll (`pay_*`), Accounting (`acc_*`) and AUZsMob (`mob_*`) have real tables that can only be reached through SECURITY DEFINER functions.
- **Salon suite** (`server/src/salon.js`, `app/public/salon/`) is a separate app with its own JSON storage (`salon_store`).
- **Front ends** are plain files: no build, no bundler. `h(tag, props, ...children)` builds DOM and never uses innerHTML (this is the XSS defence: keep it).

## 2. Making a change

1. Branch from `main`: `git checkout -b my-change origin/main`.
2. Edit. Change phone and desktop CSS separately where a stylesheet is split (`*.mobile.css` / `*.desktop.css`).
3. Run the suites that touch what you changed (see README). Every `app/public/pos/*.js` file can be syntax-checked with `node --check`.
4. When you change a file the service worker caches, bump its `?v=` in the HTML and the `V` in `app/public/sw.js`.
5. Open a pull request. Tests must pass.

**Rule: a change is not done until everything linked to it is changed.** Search the whole repo for the old behaviour: marketing and demo pages, demo accounts and seed data, tests, docs, `CLAUDE.md`.

## 3. Database changes

- Add the next numbered file in `db/` (check `ls db/` first: two people may pick the same number).
- A new table needs its own `grant ... to app`. On the live server `999_app_grants.sql` ran long ago and does not cover new tables.
- Functions that touch `pay_`, `mob_` or `acc_` tables must be SECURITY DEFINER, including trigger functions.
- Test on a scratch database first: create it, apply every migration in order, then your file, then try it.
- Apply on the live server by hand (see README). There is no automatic migration runner.

## 4. Email, payments, sign-in

- **Email** (`server/src/mail.js`): Resend. Every email uses `emailLayout()`. Needs `RESEND_API_KEY` and `MAIL_FROM` in `.env`. Sending is skipped quietly without a key.
- **Sign-in**: Google (central page `site/signin.html`), email + password (login only; sign-up is Google only, switch `platform_flags.password_signup`), staff username + PIN. Tokens are signed by the API and individually revocable (`auth_sessions`).
- **Payments** (`server/src/payments.js`): Razorpay. Only a signature-verified webhook marks a payment paid. Prices are rows in `product_prices`, `bundles` and `addon_price_overrides`, editable in the platform admin.
- **Errors**: Sentry, dormant until a DSN is set.

## 5. Where to look

| I want to change | Look in |
|---|---|
| A marketing page | `site/<page>.html`, shared style `site/theme.css`, desktop balance `site/balance.css` |
| Sign-in or sign-up page | `site/signup.html`, `site/signin.html` |
| POS | `app/public/pos/*.js`, database rules in `db/068_pos_rebuild.sql` |
| Payroll | `app/public/payroll/`, `docs/PAYROLL.md` |
| Accounting | `app/public/accounts/`, SQL `db/059`-`067` |
| Mobile shops (AUZsMob) | `app/public/mob/`, `docs/MOBILE.md` |
| Salon suite | `app/public/salon/`, `server/src/salon.js` |
| Admin console | `app/public/console/` |
| Platform admin | `site/admin.html` |
| Plan and renewals | `docs/RENEWALS.md`, `app/public/ds/plan.js` |
| Server routes | `server/src/index.js` |

## 6. Secrets

Never commit `.env`. Keys live only on the server. If a key was ever pasted in a chat, screenshot or commit, replace it: Resend, GoDaddy DNS, Backblaze, Razorpay, Google client secret, the database password, `SESSION_SECRET`.
