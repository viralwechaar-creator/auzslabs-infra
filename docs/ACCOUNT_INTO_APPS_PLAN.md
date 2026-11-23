# Plan: retire the old account page, move its features into each app (owner request, 2026-11-23)

## What the owner asked for
- Signing in to AUZslab sends each client straight to the app they bought (AUZsStyle, AUZsLedger, Salon Console, then AUZsPOS, AUZsPay, AUZsMob, AUZsScan, AUZsFinance).
- Everything the old `site/account.html` does (profile, billing and plan, staff and roles, notifications, privacy and data, WhatsApp, AI connectors, help) moves into an **Admin tab inside each app**, in that app's own design.
- **Only the owner sees Admin.** Staff and managers do not, unless the owner approves it.
- Clients who chose the online store get the new storefront account page (the Codex dashboard design). The old page is removed only when every app has the Admin tab.
- Decision made by the owner: add the Admin tab to every app, built once as a shared piece, starting with AUZsStyle, AUZsLedger and Salon Console.

## Facts that shape the build (checked in the repo)
1. `site/account.html` (1,306 lines) + `ac5.js`, `ac5-views.js`, `ac4.js`, `ac2/ac4/ac5.css` render the panes and call RPCs (`my_dashboard`, `my_profile`, staff/roles RPCs, `wa_*`, `mcp_*`, privacy/DPDP RPCs, `my_subscription`).
2. Each app has its own address and its own browser session; an app address serves only that app's files (`one_app` and `shared_files` in the Caddyfile). So the account page cannot simply be framed inside an app: it lives on `auzslab.in`, the apps on `auzsstyle.auzslab.in` and so on.
3. The hub (`app.auzslab.in/start.html`, `start.js`) already decides where a person goes after sign-in; today a client with exactly one app is sent into it, others see tiles, and `account.html` is a tile.

## Approach (smallest safe path)
1. **One shared module `ds/admin-tab.js` (+ `ds/admin-tab.css`)** served from `/ds/*` on every app address. It draws the Admin panes with the app's own tokens, calls the same RPCs as today, and is only mounted when the signed-in role is `owner`. Server-side checks stay the real gate (every RPC already checks the owner role). Reuse the pane code from `ac5.js` rather than rewriting it.
2. **Owner approval for staff:** a setting on the business (`admin_access` list of user ids, owner-edited in Admin > Staff and roles). The tab is shown to a non-owner only if listed. Needs one small migration (a column or table + owner-only RPC) and the RPCs behind the tabs must honour it, not just the UI.
3. **Mount the tab app by app**, each a small PR: AUZsStyle, AUZsLedger (and AUZsScan, same shell), Salon Console, then AUZsPOS, AUZsPay, AUZsMob, AUZsFinance.
4. **Hub redirect:** `start.js` sends every client with an app straight into it; storefront clients go to the new account page; admins and prospects unchanged.
5. **Storefront account page:** adopt the Codex dashboard (Team, Roles, Apps and plans, Billing, Sign-in and support, Notifications, Account data, Settings) wired to the real RPCs, for storefront tenants only.
6. **Retire the old account page last:** keep `account.html` working (and redirecting) until all apps have the tab and a pilot client has used it; keep the old links as redirects for 30 days.

## Risks to check before each step
- Sessions are per address: hand-over uses the `#auz_gt` fragment, never a shared cookie.
- Billing and renewal (`ds/plan.js`, Razorpay/Cashfree auto-renew) and 2FA / device sign-out must keep working inside the tab.
- Salon Console has its own cookie session and owner password: its Admin tab needs its own bridge to the account RPCs.
- Staff who currently use account.html for their own profile or notifications lose that page: give them a minimal "My profile" inside the app.
- Rollback for any step: revert the PR; the old account page stays live until the last step.

## Suggested order of PRs
1. Migration + `ds/admin-tab.js` shell with owner-only gating and the Profile and Staff panes; mount in AUZsStyle only; pilot on the demo business.
2. Remaining panes (Billing, Notifications, Privacy, WhatsApp, Connectors, Help).
3. AUZsLedger/AUZsScan, then Salon Console.
4. The other apps.
5. Hub redirect, then the storefront account page, then retire account.html.
