# AUZslab application inventory

Backs the owner's "Global Change Engine" master prompt (CLAUDE.md, "Global Change Engine"
section) — a map of every app, its entry point, who uses it, what it depends on, and what
actually tests it, so a `/global-fix` search has a concrete list to walk instead of guessing.
This is a map into CLAUDE.md and the other `docs/*.md` files, not a replacement for them: when
in doubt, read the named section of CLAUDE.md for the real detail and the most recent gotchas.

**Keep this updated** when an app, route or major workflow changes — the same standing rule
CLAUDE.md gives itself ("Keep it updated... a stale brief is worse than none").

## Web surfaces

| App | Entry point | Who | Build | Routes/screens doc | Backend deps | Tests |
|---|---|---|---|---|---|---|
| Marketing site | `site/*.html` | public | static, `git pull` | `docs/SITE_MAP.md` | `public_*` RPCs, `leads`, `client_orders` | `marketing`, `responsive` |
| Account + cart + requests | `site/account.html`, `cart.html`, `pay.html`, `inv.html` | signed-in customer/owner | static | `docs/SITE_MAP.md` ("Request flow") | `client_orders`, `user_profiles`, `my_subscription` | `orders`, `journeys`, `dpdp` |
| Platform admin panel | `site/admin.html` | platform admin only | static | CLAUDE.md "Admin panel round 3" + Team/Money/Requests sections | `admin_*` RPCs (see `server/src/routes/admin.js`) | `journeys`, `team`, `orders` |
| Team workspace | `app/public/salesman.html` | salesman / setup / support / manager | static, online-only | CLAUDE.md "AUZslab team" + "Team workspace" sections | `team_*` RPCs | `team` |
| Hub (web) | `app/public/start.html` + `start.js` | everyone (routes by role) | static | CLAUDE.md "The hub app (phase 1)" onward | `hub_me`, `team_probe`, `my_client_orders` | `team` |
| POS | `app/public/index.html` + `pos/*.js` | tenant staff | static, offline-first | `docs/POS_AUDIT.md` | `records` (kind-gated), `pos_*` RPCs | `pos` |
| Admin console (tenant back-office) | `app/public/dashboard.html` + `console/*.js` | owner/manager | static | CLAUDE.md "Admin console" section | `records`, console-specific RPCs | `apps` |
| Payroll / AUZsPay | `app/public/payroll.html` + `payroll/*.js` | HR + employee self-service | static, mostly server-authoritative (offline clock-in only) | `docs/PAYROLL.md` | `pay_*` RPCs | `payroll` |
| Accounting / AUZsLedger + AUZsScan | `app/public/accounts.html`, `scan.html` + `accounts/*.js` | owner/manager/cashier | static, AUZsScan is offline-first | CLAUDE.md "AUZslab Accounting", "Scan to bill" sections | `acc_*` RPCs | `accounts`, `scan`, `accoffline` |
| AUZsMob | `app/public/mob.html` + `mob/*.js` | mobile-shop staff | static, offline-first | `docs/MOBILE.md` | `mob_*` RPCs | `mobile` |
| Salon suite | `app/public/salon/*` | salon tenants | static (Showoff-style design, not `ds/auz.css`) | CLAUDE.md "Salon Suite" sections | `server/src/salon/*.js`, `salon_store` | `salon`, `salongeneric` |
| Website Builder | `app/public/builder.html` / `w.html` | owner (editor) / public (renderer) | static | CLAUDE.md "Website Builder" section | `public_page`, `push_record` kind `sitepage` | `apps` |
| Chapter One (bespoke) | `app/public/chapterone/*` | one real client | static, one-off | CLAUDE.md "Chapter One" section | `public_menu`, `place_order` | (manual) |

Offline/security/misc cross-cutting suites: `offline`, `docread`, `signup`, `design`, `security`,
`load`, `loadmob`, `whatsapp`. Full list and run order: `tests/run-local.mjs`'s `suites` array —
run one at a time (shared test database), `service postgresql start` first.

## Native apps (Flutter, Android builds only unless noted — see `docs/DESIGN_SYSTEM.md` for why they're separate copies of the same foundations)

| App | Package id | Directory | Parity with web | Tests |
|---|---|---|---|---|
| AUZsPOS | `app.auzslab.pos` | `native/auzspos/` | Furthest along — tables, kitchen, offers, approvals, printing, multi-outlet, admin console in-app, push (POS only), dark mode, Hindi. Round-by-round history in CLAUDE.md. | `flutter test` |
| AUZsMob | `app.auzslab.mob` | `native/auzsmob/` | Sell/purchase/repairs/stock/dues/reports/settings, offline sync ported from `mob/sync.js`. No push alerts, no day-close-with-cash-count gap closed in a later round. | `flutter test` |
| AUZsScan | `app.auzslab.scan` | `native/auzsscan/` | Scan-to-sell/add-stock, offline queue, products. | `flutter test` |
| AUZsPay | `app.auzslab.pay` | `native/auzspay/` | Employee self-service + HR read side + run payroll + kiosk/documents/tax (second gaps round). Push wired (only native app besides POS that registers). | `flutter test` |
| AUZsLedger | `app.auzslab.ledger` | `native/auzsledger/` | Home/Sell/Documents/Products + receipts/payments/credit notes/banking/journals/GST returns/import (second gaps round). Still web-only: fixed assets, budgets, recurring docs, e-invoice/e-way. | `flutter test` |
| Hub | `in.auzslab.app` | `native/auzshub/` | Sign-in, role-based home, My requests, cart/pay/bill, Team workspace, Admin panel, AND the entire marketing site rendered from an extracted `pages.json` (see CLAUDE.md "Native hub: the whole marketing site" + two follow-up passes). | `flutter test` + `flutter analyze` |

**None of the six native apps have been run on a real device from this sandbox** (no Android
SDK, no Flutter SDK pre-installed — though CLAUDE.md notes a Flutter SDK CAN be downloaded here
for `analyze`/`test`). The GitHub Actions workflows (`native-pos.yml`, `native-mob.yml`,
`native-scan.yml`, `native-pay.yml`, `native-ledger.yml`, `native-hub.yml`) are the first real
build check for each; owner device screenshots are the first real UI check. State this plainly
in any report rather than implying otherwise.

## Wrapper / desktop

| App | Directory | What it is |
|---|---|---|
| Android WebView wrapper | `mobile/` (Capacitor) | Loads the live website; `apps.json` lists which app each wrapped build opens. Separate from the six native Flutter apps above — predates them, kept for apps without a native build yet. |
| Desktop | `desktop/` (Electron) | Same principle, loads the live site. |
| iOS (website/hub) | `mobile/build-ios.mjs` | Shell only; see `docs/HUB_APP_RELEASE.md`. |

## Backend

| Module | File(s) | Covers |
|---|---|---|
| Routing | `server/src/index.js` (thin dispatcher) + `server/src/routes/*.js` | See `docs/BACKEND_MAP.md` for the exact split. |
| Auth | `server/src/auth.js` (re-export shim) + `server/src/auth/*.js` | Sessions, 2FA, password, email, identity (Google/Apple/phone), staff PIN. |
| Salon | `server/src/salon.js` (re-export shim) + `server/src/salon/*.js` | Router, session, rules, brand, storage, util. |
| RPC allow-list | `server/src/data/rpc-registry.js` | **Every new public Postgres function must be added here or it 404s** — this exact mistake has shipped broken more than once; check it on every migration that adds a function. |
| Generic table access | `server/src/data/tables.js` | The `/db/:table` whitelist (RLS-protected tables only). |
| Push | `server/src/push.js`, `server/src/fcm.js` | Web Push (VAPID) + FCM, tenant-wide and targeted (`notify_push_users`), plus platform-wide alerts for admin/team (`notify_platform_push`). |
| WhatsApp | `server/src/whatsapp.js` | Template-only Cloud API sender/worker, see `docs/WHATSAPP.md`. |
| Database | `db/*.sql`, applied in filename order (`ls db/*.sql | sort -V`, never a `0*` glob — see CLAUDE.md's own documented mistake with this exact glob) | One `records` generic engine (POS/CRM/etc) + dedicated table sets per product (`pay_*`, `acc_*`, `mob_*`, `client_orders`, `team_*`, ...). |

## Role model (who can reach what)

- **Platform admin** (`platform_admins` / `is_platform_admin()`) — `site/admin.html`, no 2FA by
  design (see CLAUDE.md's 2FA section for why).
- **Team** (`platform_salesmen`, roles `salesman | setup | support | manager`) — `salesman.html`
  / the hub's Team workspace; `is_team_member()`/`team_role()`/`team_can_manage()`.
- **Tenant owner/manager** — every staff app's full feature set, gated by `tenant_settings`
  entitlement AND the owner's own on/off switch (`featureOn(k)` pattern, repeated per app).
- **Tenant staff (role-based or username+PIN)** — narrower `records`-kind and RPC permission
  sets per app (`pos_kind_ok`, `acc_guard`, `mob_*` permission flags, `pay_perm`).
- **Customer / prospect with no business yet** — `account.html`'s light "My profile"/"My cart"
  dashboard, the hub's customer tiles, `client_orders` request flow.

## Known cross-cutting gaps (don't re-discover these — check here first)

- Native apps: no real-device verification of push, camera, Bluetooth printing, or Hindi
  wording review, across all five product apps + the hub.
- No native iOS build yet for the five product apps.
- Back Office / Website Builder: no dark mode (still `ds/legacy.css`-bridged).
- WhatsApp automation: several template events exist but are not wired to fire yet (see
  CLAUDE.md "WhatsApp automation" — bill links from POS/Scan/Ledger/Mob sales, order ready,
  booking reminders, renewal reminders, payslips, welcome).
- Salon console bookings live in `salon_store` JSON, not the `bookings` table — anything built
  against `bookings` (WhatsApp triggers, native parity) doesn't reach salon tenants yet.
