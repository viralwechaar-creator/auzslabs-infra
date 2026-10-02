# AUZslab restaurant POS: audit, gap matrix and build log

Prepared against the owner's "Restaurant POS Master Audit Build Prompt" (42 areas). Every row below was checked in
the code, not inferred from screen labels. File references are relative to the repository root.

Status codes: **EXISTS** (works end to end), **PARTIAL** (some layers or cases missing), **UI ONLY** (setting or
screen exists, nothing acts on it), **BACKEND ONLY** (data/function exists, no usable screen), **BROKEN** (fails a
defined workflow or a rule), **MISSING**, **N/A**.

The "After" column is the state after the POS rebuild in this change (see section 6, "Build log"). Where it still
says PARTIAL or MISSING, the gap is real and is listed in the backlog: nothing here is marked done without code and
a test behind it.

---

## 1. Repository architecture (as found)

| Layer | What it is | Evidence |
|---|---|---|
| POS client | One offline-first page, `app/public/index.html` (870 lines, inline CSS and JS). Vanilla JS, `h()` DOM helper, hash-free tab state in `S.tab`. | `app/public/index.html` |
| Local store | IndexedDB `pos3` (`rec`, `out`, `meta`). Every write goes to `rec` + an outbox, then `push_record`. | `index.html` `save()`, `doSync()` |
| Sync | `push_record(rid, rkind, rdata, rdeleted, base, force)`: optimistic concurrency on `records.updated_at`; on conflict the client re-pushes with `force:true` (last write wins). Pull = `records` where `updated_at >= since`. Realtime = Postgres LISTEN/NOTIFY over WebSocket triggers a sync. | `db/058_admin_console_kinds.sql`, `server/src/index.js` |
| Data model | Generic `records` table (`kind` + `data` jsonb). Orders, KOT logs, items, tables, ingredients, cash moves, shifts, customers, coupons, settings all live here. Real tables only for `bookings`, `guest_orders`, accounting (`acc_*`). | `db/002_core_engine.sql` |
| API | Hand-rolled Node server: whitelisted tables (`TABLES`), whitelisted RPCs (`RPC`), JWT auth, in-memory rate limiting, `/storage`. | `server/src/index.js` |
| Back office | `backoffice.html` (reports, day report, cash drawer, stock, CRM, memberships, tasks, purchases, settings) and the admin console `dashboard.html` + `console/*.js` (70+ pages). | `app/public/backoffice.html`, `app/public/console/` |
| Accounting | Separate double-entry system (`acc_*` tables, `accounts.html`). Not connected to POS sales. | `db/059`–`067` |
| Customer surfaces | QR ordering `site.html` (`place_order` RPC), public invoice `i.html` (`public_invoice`). | `db/028_inventory_purchasing.sql` |
| Hardware | Browser printing through a hidden iframe (receipt 58/80 mm, A4 invoice, KOT); keyboard-wedge barcode scanner; token display screen. No ESC/POS, no drawer kick. | `index.html` `prn()`, `prnInv()` |
| Ops | Docker Compose, Caddy, nightly `pg_dump` backups kept locally plus a Backblaze B2 off-site copy. | `docker-compose.yml`, `README.md` |
| Tests | Playwright suites run locally against a disposable database: `pos`, `cafe`, `apps`, `responsive`, `security`, `load`, `salon`, `accounts`, `marketing`, `journeys`. No CI. | `tests/` |

## 2. Critical blockers found during the audit

1. **BROKEN, security: any staff login could overwrite any record.** `push_record` authorised a write by the
   *new* kind only. A cashier could push `rid='settings', rkind='order'` and replace the business settings (or turn
   a menu item into an "order"). Fixed in this change (`db/068`): the stored kind is checked too, and only the owner
   may change a record's kind.
2. **BROKEN, financial integrity: paid bills were editable and deletable by any staff session.** Payments, totals
   and lines of a paid order could be rewritten by a stale device copy (force-push) or by a direct RPC call; refunds
   and voids were "manager only" in the UI alone. Fixed in this change: a server trigger freezes the financial
   fields of paid and void orders, keeps refunds/exchanges append-only, and refuses void/refund/delete from roles
   without billing permission.
3. **MISSING: no server-side audit trail.** The "Audit Trail" page was derived on the client from editable
   records. Fixed: append-only `pos_audit` table written by a database trigger (actor, role, time, before/after).
4. **UI ONLY: charges and rules saved in the console were ignored by billing.** Service charge, packing charge,
   delivery charge, round-off, "require phone", tip prompt, auto KOT print, discount approval limit, coupon minimum
   bill. Fixed: the rebuilt POS applies all of them.
5. **PARTIAL, data correctness: stock is a number overwritten by each device**, not a ledger (`ing.qty` with a
   200-entry `usage` array). Two tills selling at once can lose a deduction under last-write-wins sync. Not fixed in
   this change (needs a server stock ledger, see backlog P1).
6. **MISSING: POS sales never reach Accounting.** Backlog P1.

## 3. Feature-gap matrix

| # | Area | Before | Evidence (before) | After | What changed / what is left |
|---|---|---|---|---|---|
| 1 | Organisation, outlet setup | PARTIAL | Tenant + `settings` record (name, address, GSTIN, tax, prefix); outlets in console; one invoice series per tenant (`next_invoice_no`); no KOT numbering; INR and browser time zone only | PARTIAL | KOT numbers per day added (`next_kot_no`). Left: per-outlet/per-FY invoice series, per-outlet GSTIN on bills |
| 2 | Users, roles, security | PARTIAL | Owner/manager/cashier + custom roles (`roles.permissions`); email+password only; permission checks client-side; no approvals | PARTIAL | Manager PIN approval for discounts above the limit, voids, refunds, returns, credit, complimentary bills and post-KOT cancellations (`pos_verify_pin`, throttled); the server refuses these without billing permission or a signed approval. Left: PIN login for staff, MFA, device binding |
| 3 | Floors, sections, tables | PARTIAL | Sections, tiles with live status (placed/KOT/preparing/ready/served/cleaning), occupancy minutes | PARTIAL | Seats/covers, capacity, reserved state, move table, merge tables, split items to another table/bill. Left: drag-and-drop floor layout, table history report |
| 4 | Menu and items | PARTIAL | Categories, items, sizes, add-ons, combos, images, availability (sold out, schedule, channel), station, tax, HSN, barcode, short code | PARTIAL | POS search now matches short codes and barcodes. Left: subcategories, price lists per channel |
| 5 | Recipes, food cost | PARTIAL | `item.rec` "Ingredient:qty" text, deducted at payment; no units, yield, versions, sub-recipes | PARTIAL | Unchanged in this change. Backlog P2 (recipe versions, units, yield) |
| 6 | Modifiers | PARTIAL | Add-on groups exist but min/max are not enforced; flat checkbox list | PARTIAL | Add-on sheet enforces group minimum/maximum, free-text item note. Left: "less/no" modifiers with inventory effect |
| 7 | Order engine | PARTIAL | Open/held/paid/due/void; reason-coded post-KOT cancellation with wastage; UUID ids make creation idempotent | PARTIAL | Item notes, move/merge/split, covers, cancellation KOT. Left: order event history table |
| 8 | Order types, channels | PARTIAL | Dine-in, takeaway, delivery (+source), retail sale, QR table orders, advance orders | PARTIAL | Delivery address/rider/ETA on the order. Left: drive-through, room service, catering |
| 9 | KOT, kitchen routing | PARTIAL | KOT print grouped by station, `kotlog` per batch; no KOT numbers, no reprint, kitchen never told about cancellations | PARTIAL | Daily KOT numbers, KOT reprint, cancellation slips printed and shown in the kitchen. Left: per-station printers (needs a print bridge) |
| 10 | KDS | PARTIAL | Live queue, station and type filters, timers, 15-min overdue flag, bump to ready | PARTIAL | Recall (undo ready) and configurable target minutes. Left: item-level bump |
| 11 | Billing, invoices | PARTIAL | Numbering, discount, CGST/SGST, round off, duplicate reprint, void | PARTIAL | Service/packing/delivery charges (taxed), tax-inclusive prices, customer GSTIN on invoice. Left: credit-note numbering |
| 12 | Split/merge/transfer billing | PARTIAL | Equal and item "split" only pre-fill the amount on one bill | PARTIAL | Split by items into a separate bill, equal shares tracked, merge bills, move items. Left: per-seat bills |
| 13 | Discounts, promotions | PARTIAL | Bill discount (manager only), coupons (expiry, max uses), loyalty redeem; coupon minimum bill ignored; approval limit ignored | PARTIAL | Cashier discounts up to the limit, PIN approval above it, coupon minimum bill, every discount audited. Left: BOGO/happy-hour rules engine |
| 14 | GST/tax | PARTIAL | Per-item tax master + default rate, equal CGST/SGST; inclusive flag ignored | PARTIAL | Tax-inclusive items and business setting honoured; tax on charges; GST breakup by rate on the invoice. Left: effective-dated rates, IGST for inter-state |
| 15 | Payments | PARTIAL | Cash (denominations, change), UPI, card, other, multi-tender, credit/due | PARTIAL | Gift-card tender redeemed atomically on the server (`redeem_giftcard`), tips, refund method recorded. Left: gateway/terminal integration |
| 16 | Settlement, reconciliation | PARTIAL | Console settlements (aggregators), payment reconciliation page, day expected cash | PARTIAL | Register close compares counted cash with expected cash and lists UPI, card, gift card and other totals to check against the terminal and bank. Left: statement imports |
| 17 | Cash drawer, shifts | PARTIAL | Cash top-up/withdrawal (`cashmove`), day close, attendance shifts; no per-cashier float or count | PARTIAL | Cash register sessions: opening float, cash in/out, closing count by denomination, variance, printed summary (`register`). Left: blind close option |
| 18 | Staff operations | PARTIAL | Clock in/out, captain attribution, payroll app | PARTIAL | Tips recorded per order. Left: tip pooling, staff commission |
| 19 | Inventory | PARTIAL | Ingredients, purchases, wastage, adjustments, transfers, closing counts | PARTIAL | Unchanged. Backlog P1 (ledger) |
| 20 | Stock movements, controls | PARTIAL | Quantity overwritten per device, not a ledger | PARTIAL | Unchanged. Backlog P1 |
| 21 | Purchasing, suppliers | PARTIAL | Vendors, POs, purchase receipts in back office/console | PARTIAL | Unchanged. Accounting module has full purchasing; bridge in backlog |
| 22 | Wastage, stock count | PARTIAL | Reason-coded waste, closing counts | PARTIAL | Unchanged |
| 23 | Central kitchen, production | MISSING | Nothing | MISSING | Backlog P3 |
| 24 | Multi-outlet | PARTIAL | Outlet picker, per-outlet kinds, prices, availability; outlet isolation is UI filtering | PARTIAL | Register sessions and reservations are per outlet. Left: per-outlet permissions |
| 25 | Customers, CRM | EXISTS | Profiles by phone (email, birthday, anniversary, tags, opt-out), history, spend, segments | EXISTS | Customer GSTIN added for B2B invoices |
| 26 | Loyalty, membership | PARTIAL | Points recomputed from history (no ledger), memberships, gift cards issued in console | PARTIAL | Gift cards redeemable at the till. Left: points ledger with expiry |
| 27 | Reservations, waitlist | BACKEND ONLY | `bookings` table with a real no-overlap constraint, unused by restaurants | EXISTS | New Reservations screen on `bookings` (party size, table, no-show, seat → opens the order) and a walk-in waitlist with queue numbers and quoted wait |
| 28 | Online ordering, QR | PARTIAL | `place_order` validates items, stock, feature flag, rate limit; table id in plain URL | PARTIAL | Accepting a guest order is now claimed atomically (no duplicates from two tills). Left: signed table tokens, online payment |
| 29 | Delivery | PARTIAL | Delivery type, source, dispatched/delivered | PARTIAL | Address, rider, promised time, delivery charge. Left: zones, rider app |
| 30 | Combos | PARTIAL | Combo items, KOT expansion, component stock deduction | PARTIAL | Unchanged |
| 31 | Accounting integration | MISSING | POS sales not posted to `acc_*` | MISSING | Backlog P1 |
| 32 | Expenses | PARTIAL | Categories, console pages | PARTIAL | Register cash-out can record a paid-out expense |
| 33 | Reports | PARTIAL | Day/custom/analytics, console reports, GST summary, KOT report | PARTIAL | Register summary, covers. Left: documented KPI dictionary in-app |
| 34 | Dashboard | PARTIAL | Console dashboard with filters | PARTIAL | Unchanged |
| 35 | Printing, hardware | PARTIAL | Browser print only | PARTIAL | KOT/cancel/register slips; reprint. Left: ESC/POS bridge, drawer kick |
| 36 | Offline, sync | PARTIAL | IndexedDB + outbox; offline bills get a device-unique provisional number (ending in ~), replaced by a server number if the bill is paid online; realtime pulls; conflicts force-overwrite | PARTIAL | Paid bills can no longer be overwritten by a stale copy (server keeps the authoritative fields). Left: per-field merge for open orders |
| 37 | Import/export | PARTIAL | CSV exports | PARTIAL | Unchanged |
| 38 | Notifications | PARTIAL | Web push for new orders, WhatsApp share links | PARTIAL | Reservation confirmation by WhatsApp link |
| 39 | API, integrations | PARTIAL | Whitelisted REST/RPC, no API keys or webhooks | PARTIAL | Unchanged |
| 40 | End of day | PARTIAL | Day close in back office | PARTIAL | Close-register checks open orders and unsent KOTs first |
| 41 | Security, audit, backup | PARTIAL | RLS tenant isolation, JWT, rate limits, nightly + off-site backups | PARTIAL | Kind-change hole closed, paid-bill guard, append-only audit log. Left: MFA, restore drill |
| 42 | Testing | PARTIAL | Local Playwright suites, no CI | PARTIAL | POS suite extended (charges, approvals, table moves, split, reservations, register, server guards, audit). Left: CI |

## 4. Dependency order used for the build

1. Server foundation (`db/068`): kind-change fix, paid-order guard, audit log, new kinds, PIN approvals, KOT
   numbers, guest-order claim, gift-card redemption, reservation columns.
2. POS core (sync engine kept byte-for-byte compatible; same record shapes so back office, console, dashboard and
   invoices keep working).
3. Billing math (charges, inclusive tax) and the order engine (notes, covers, move/merge/split).
4. Kitchen (KOT numbers, cancellations, recall).
5. Payments (tenders, gift cards, tips, refunds with approval).
6. Register sessions, reservations, waitlist, delivery details.
7. Apple HIG interface across every POS screen, phone and desktop.

## 5. Backlog (prioritised by dependency and risk)

- **P1 Stock ledger on the server**: immutable `stock_moves` for POS ingredients written by an RPC at payment, so
  concurrent tills cannot lose deductions; recipe consumption vs physical count variance.
- **P1 POS → Accounting bridge**: post each closed day (sales by tax rate, payments by method, refunds) into the
  accounting journal.
- **P2 Recipes**: units and conversion, yield, versions, sub-recipes.
- **P2 Promotions engine**: BOGO, happy hour, item-level rules with priority and stacking rules.
- **P2 Printing bridge**: local ESC/POS service for per-station printers and cash-drawer kick.
- **P3 Central kitchen, production batches; signed QR table tokens; online payments; MFA; CI pipeline.**

## 6. Build log

### Server (`db/068_pos_rebuild.sql`, `server/src/index.js`, `server/src/db.js`)

- **Write authorisation.** `push_record` now reads the stored row first: a non-owner cannot save a record under a
  different kind, and `pos_kind_ok(kind, data, old, deleted)` decides per role (used by `push_record` and by the
  `r_ins`/`r_upd` RLS policies). Staff kinds gained `register` and `waitlist`. Two narrow staff exceptions are
  field-level, not kind-level: a cashier may mark a table clean (only `cleaned*`, plus the outlet stamp), and may change
  a retail variant's stock (`variants[].qty/usage`) when selling or taking a return.
- **Order guard** (`records_order_guard` trigger on `kind='order'`). Paid and void bills are frozen (lines, totals,
  payments, number, customer, discount and the other money fields); refunds and exchanges are append-only and capped
  at the bill total; void, refund and return need billing permission or a signed manager approval; on open orders,
  removing items already sent to the kitchen needs billing or an approval unless a `moves` entry (split) covers it;
  credit, complimentary and manual discounts above `maxDiscountPct` need billing or an approval (coupons and loyalty
  are exempt).
- **Manager approvals.** Each owner/manager can set a 4 to 8 digit PIN (`pos_set_pin`, bcrypt). `pos_verify_pin`
  (5 wrong tries per 5 minutes) returns an approval `{id, name, role, action, exp, token}`; the token is an HMAC over
  approver, action, record id and expiry with a per-tenant secret, so it cannot be forged or reused on another bill.
  A manager approving their own action gets the same object from `pos_sign_approval`. The order guard checks
  `voidApprovedBy`, `refunds[].approvedBy`, `returnApprovedBy`, `lastCancelApprovedBy`, `creditApprovedBy`,
  `compApprovedBy` and `disc.approvedBy`.
- **Audit log.** `pos_audit` is append-only (update/delete blocked by trigger) and written by a trigger on
  `records`: bills paid/credit/void/merged/deleted, refunds, returns, discounts, complimentary bills, reprints, table
  moves, item moves, kitchen cancellations, settings changes, item add/delete/price change, coupons, gift cards, tax
  codes, cash in/out, register open/close, day close/reopen. Each row has actor, role, amount, reason, approver,
  outlet and before/after. If writing the audit row fails, an `audit_error` row is written instead and the sale still
  goes through. Owners and managers read it in the console (Management > Audit log).
- **KOT numbers** (`next_kot_no(day, outlet)`, one counter per day and outlet), **guest-order claim**
  (`claim_guest_order`: only one till can accept or reject a QR order), **gift-card redemption** (`redeem_giftcard`:
  row lock, expiry, balance, idempotent per order and amount).
- **Reservations** reuse `bookings`: new `party_size`, `note`, `source`, `outlet` columns, statuses `seated` and
  `no_show`, and the existing no-overlap constraint ignores cancelled, no-show and completed bookings. A clash returns
  HTTP 409.
- `server/src/db.js`: Postgres `date` values are returned as `'YYYY-MM-DD'` strings (they used to become a UTC
  midnight timestamp, which moved reservation days in Indian time).

### POS client (`app/public/index.html` + `app/public/pos/`)

The 870-line single file was replaced by a 42-line shell and one script per area. Record shapes, the IndexedDB
store (`pos3`) and the sync protocol are unchanged, so the back office, console, dashboard, QR ordering and public
invoice keep reading the same data.

| File | Role |
|---|---|
| `core.js` | State, `h()`/`icon()`, records and outlets, settings defaults, permissions, IndexedDB + outbox sync (a 400/403/409 rejection drops the change, reloads the server copy and tells the cashier "Not saved: ..."), numbering, billing math (`tot`: line tax rates, inclusive prices, service/packing/delivery charges, round off), order helpers, stock deduction |
| `ui.js` | HIG kit: sheets (bottom sheet on phones, centred on desktop), alerts, toasts, segmented controls, steppers, switches, list rows, keypad, reason picker, manager PIN approval (`approve()`) |
| `print.js` | KOT, cancellation slip, customer invoice and provisional bill, per-rate CGST/SGST, WhatsApp link |
| `sell.js` | Selling screen (categories, search by name/short code/barcode, veg filter, ticket), options sheet (sizes, add-on groups with min/max, notes), order menu (discount, coupon, complimentary, customer and GSTIN, schedule, captain, covers, delivery details, move, merge, split, reprints, cancel), send to kitchen, hold |
| `pay.js` | Tenders (cash with change and denominations, UPI, card, gift card, other), equal shares, tips, credit with approval, completion and printing, refunds, cancelling a paid bill, retail return/exchange |
| `tables.js` | Floor with live states (ordering, in kitchen, ready, bill pending, reserved, cleaning), seats, move/merge, split by items to a new bill, another table or takeaway |
| `kitchen.js` | KDS by station and order type, timers against the target, cancellations shown, start/ready/recall, ready and dispatched banners, KOT report, token screen |
| `orders.js` | Live counts, open/advance/credit/delivery/paid/cancelled/all bills, order detail sheet |
| `reserve.js` | Reservations on `bookings` (party size, table, source, seat, no-show, WhatsApp confirmation) and the walk-in waitlist |
| `register.js` | Register sessions: opening float, cash in/out (optionally as an expense), closing count by denomination, variance, printed summary |
| `staff.js` | Attendance, approval PIN, outlet, device, recipes, business tools, sign out |
| `shell.js` | Navigation (sidebar on desktop, tab bar on phones), banners, QR guest orders, alerts, sign in, first-run seed, boot |

Interface: Apple Human Interface Guidelines throughout. System font, 44pt targets, large titles, grouped lists,
segmented controls, sheets, alerts instead of `prompt()`/`confirm()`, light and dark appearance, the business's
own colour as the single accent (lifted to the same hue in dark mode so a deep colour stays readable), no emoji.
`pos.css` holds the tokens and components, `pos.mobile.css` (0-899px) and `pos.desktop.css` (900px and up) the
layouts. It does not link `hig.css`: it is its own HIG implementation.

Console: Order preferences gained "Menu prices include GST", "Print the bill when paid", kitchen target minutes and
reservation length; the discount limit text explains the manager PIN; tax codes gained an "inclusive" flag;
Management > Audit log reads `pos_audit`. Public invoice (`i.html`): customer GSTIN, item notes, service, packing and
delivery charges, GST by rate, refunds.

### Tests

- `tests/suites/local/pos.mjs` was rewritten for the new interface: 26 checks covering sign-in, KOT numbers and
  sync, kitchen flow, cash payment and its audit row, QR claim, advance orders, service and packing charges, table
  move, split after KOT (logged as a move, not a cancellation), reservations (double booking refused, seating),
  register (float, cash in/out, variance), gift-card tender, manager PIN (wrong PIN refused, cashier discount
  approved and audited), server refusals by direct RPC (unapproved discount, settings overwrite, paid-bill rewrite,
  unapproved refund), cashier table cleaning, phone layout on every tab, back-office cash drawer and bulk price
  change with its audit row, and no JavaScript errors.
- Run: `node tests/run-local.mjs pos` (or the whole set with `node tests/run-local.mjs`).

### Deploy

Needs `db/065` to `db/067` applied first (they are on `main` already). Then:

```bash
cd auzslabs-infra
git pull origin main
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db/068_pos_rebuild.sql
docker compose up -d --build api
git log -1 --oneline
```

After deploying, each owner or manager sets an approval PIN once (POS > Staff & settings > Approval PIN). Until
someone has a PIN, cashiers cannot apply manual discounts, credit or complimentary bills, or cancel items already
sent to the kitchen (the owner and managers can, as before).

### Still open

Everything marked PARTIAL or MISSING in the matrix above, in the order of section 5. The most important two are the
server stock ledger (stock is still a number each device overwrites) and posting POS sales into Accounting.
