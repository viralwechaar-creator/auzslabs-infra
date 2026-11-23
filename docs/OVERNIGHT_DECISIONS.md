# Overnight build log (2026-11-23 to 2026-11-24): what was built and every decision made

The owner was asleep and asked for everything to be built without questions. Each item below says what was built, the decision taken, how it was checked, and what is still open. Nothing here was seen on a real phone.

## 1. Admin tab inside the apps (replaces the old account page, step by step)
- **Built:** `db/386_admin_tab_access.sql` (approval list, `admin_tab_status`, `admin_tab_staff`, `admin_tab_set`), the shared `app/public/ds/admin-tab.js`, an **Admin** page in AUZsStyle (`style/p-admin.js`) and AUZsLedger (`accounts/p-admin.js`).
- **Panes:** Profile, Staff access, Billing (opens the existing plan sheet), Notifications, WhatsApp on/off, Privacy (download my data, send a request), AI connectors (list, create read-only key, revoke), Help.
- **Decision (access rule):** the owner always sees Admin. A staff member sees it only if the owner switched "Admin: on" for them in Staff access. The check is on the server (`admin_tab_status`), the screen only follows it. The panes use the same server functions as the old account page, so those still enforce their own owner/manager checks.
- **Decision (scope):** only AUZsStyle, AUZsLedger, Salon Console and the online store remain (the other apps are deleted). AUZsScan shares the Ledger shell but its short menu does not list Admin.
- **Decision (Salon Console deferred):** it signs in with its own cookie session and sometimes a console password, not the AUZslab login, so it has no token to call the account functions. Giving it one needs a small, careful server bridge (owner session to a limited token). Not done tonight on purpose: it is a security decision.
- **Checked:** SQL scenario test (staff cannot list people or grant themselves access; owner can; owner access cannot be changed; outsiders refused), and a style-suite check (owner and approved staff see Admin, revoked staff do not). The style suite otherwise shows the same 5 failures as untouched `main`.

## 2. AUZsStyle Overview: Payments tab
- Overview now has Overview / Payments / Analytics. Payments splits what was received into **Cash** and **Online** (UPI, card, bank transfer, online) with totals, percentages and a list per mode. Credit and store credit are shown separately as "Not received yet".
- **Decision:** "online" means any non-cash money actually received. Uses the existing dashboard function, so no database change. Date range picker works like Overview.

## 3. Contact page (Codex design)
- Four-audience hub (Business owner, Developer or designer, Job seeker, Something else) with a form for each; bigger, labelled icon rail (it was tiny before); shortcut links to Careers and Submit a theme.
- **Decision (careers):** a job application goes into the **existing** SalesOS recruitment pipeline (`submit_job_application` plus résumé upload), not a second list. Business, developer and general enquiries go to admin **Leads** via `submit_contact` (db/385), tagged with a kind and details.
- New pages: `submit-theme.html` (how theme developers submit) and `join.html` (redirects to careers).

## 4. Theme library gap
- Codex's theme library has versions and rollback. **Built:** every publish is kept (last 20) in `sfx_theme_install_history` (db/387); in the store's theme editor a **Version history** button lists versions and **Restore to draft** copies one back into the draft (nothing goes live until you publish again).
- **Decision:** rollback goes to the draft, never straight live, so a mistake cannot hit customers.
- **Not built:** Codex's "starter templates and style directions" picker and renaming/duplicating installs. The real marketplace already covers choosing a theme.

## 5. Dead links
- The site pages have no broken file links. The 404s came from the live demo page offering demos of apps that were deleted (AUZsPOS, AUZsPay, AUZsMob, AUZsScan, AUZsFinance). Those cards and the "Explore more apps" button are removed; AUZsLedger, AUZsStyle and Salon remain.
- Still on the repo (not touched): `app/public/mob.html` and Caddy address entries for removed apps.

## 6. Platform admin can log in everywhere
- **Built:** Admin > Clients: each client card has **Open as owner...** (Style app, Ledger app, Online store hub, Salon console, Account page, only the ones the business has). Server route `POST /admin/login-as` (platform admin only, 60 per hour) calls `admin_login_as_context` (db/388), writes an audit entry, and returns a **limited 8-hour session** for the business owner, handed over in the URL fragment.
- **Decision:** limited session (cannot be refreshed), always audit-logged, owner account is used because the apps check the owner role. If a business has no owner login yet it says so.

## 7. Sign-in redirect and the storefront account
- **Built:** after sign-in on the website, an owner or manager is sent straight into their app with their session: AUZsStyle, else AUZsLedger, else Salon console, else the online store hub. Only on auzslab.in addresses (tests and localhost are left alone).
- **Decision:** the new storefront account experience for store-only clients is the store hub itself (its own Settings, Billing, Team and Domains pages), so no separate account page was built. `account.html` stays reachable and is not retired yet.

## 8. Admin panel links
- Website section now lists 17 live pages with open links (all exist). The admin panel already offered only the remaining apps (Ledger, Style, Salon) when onboarding.

## 9. Still open (needs the owner)
- Salon Console Admin tab (see section 1).
- Retiring `account.html` after the owner has tried the Admin tab on a pilot business.
- Cleanup of `app/public/mob.html` and Caddy entries for removed apps.
- Deploy: `bash tools/migrate.sh apply` (db/385 to 388), `docker compose up -d --build api`, `git pull origin main`.
- Known test failures that were already there on untouched `main`: 5 style-suite checks (till, store, buying intelligence) and 4-5 accounts-suite checks (POS/Mob sales sync, invoice screens, dark mode).
