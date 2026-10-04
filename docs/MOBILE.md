# AUZsMob

A standalone, offline-first app for mobile phone retail and repair shops (`app/public/mob.html` + `app/public/mob/`) and its database (`db/080`-`084`). Built like Payroll v2 and Accounting: its own real `mob_*` tables, not the generic `records` engine, with every read and write going through a SECURITY DEFINER function. Feature key: `mobile`.

## The flow

**buy stock or a used phone → it goes on the shelf → sell it or fix it → settle the due → the owner sees everything, staff see their own**

| Step | Where in the app | Server |
|---|---|---|
| Catalog | Stock → catalog, vendors | `mob_save_item`, `mob_save_vendor` |
| Buying stock | Home → Add purchase / Buy used phone | `mob_push_purchase` |
| Selling | Home → New sale → cart → checkout | `mob_push_sale`, `mob_void_sale` |
| Repairs | Home → New repair, Repairs → job | `mob_create_repair`, `mob_push_repair_event` |
| Settling a due | Dues → customer/vendor → settle | `mob_push_payment` |
| Reports | Reports (owner/manager) | `mob_report_dashboard`, `mob_report_activity`, `mob_report_ledger` |
| Settings | Settings (shop details, language, staff rates, staff, data health, export) | `mob_save_settings`, `mob_integrity_check`, `mob_export_all` |
| Sync | automatic, with a status pill | `mob_sync_pull` |

## Offline-first, for real

Every phone keeps its own copy in IndexedDB (database `mob1`: items, units, vendors, customers, purchases, sales, repairs, repair events, payments, stock movements) plus an outbox.

- **A write shows up instantly.** `localPush()` (`app/public/mob/sync.js`) writes to IndexedDB first — the screen updates immediately, "Saved on phone" — then queues the real RPC call. It never claims "saved to server" before the call has actually succeeded (the same lesson the POS sync bug taught, see `CLAUDE.md`). Buying a serialized phone or a second-hand phone also writes the resulting stock unit and movement into IndexedDB immediately, so it can be sold again with no internet, before the purchase has even synced.
- **Every entry is idempotent.** A sale, purchase, repair event or payment carries a client-generated id. The matching `mob_push_*` function checks `if exists (...) then return {ok:true, already:true}` before inserting, so a retried outbox item is always a safe no-op — never a duplicate.
- **Stock is a sum, never a counter.** `mob_stock_movements(qty signed, type, ref_id, ...)`; "how many in stock" is always `sum(qty)`. Two phones changing the same item's stock offline can never lose an update, and `mob_integrity_check()` proves no item's stock has gone negative.
- **Corrections are new entries or owner actions, never silent edits.** A sale cannot be un-sold by editing it — `mob_void_sale` is the only way, and it is append-only (writes `voided`/`void_reason`, restores stock, logged to `mob_audit`). Catalog items and vendors are the exception: they use the platform's normal optimistic-concurrency upsert (`p_base`), the same contract as `push_record`.

## Access (`mob_perm`, `mob_guard`)

- Owner: everything.
- Manager: everything by default (`mob_view`, `mob_sell`, `mob_purchase`, `mob_repair`, `mob_reports`, `mob_manage`).
- Plain staff: `mob_view`, `mob_sell`, `mob_purchase`, `mob_repair` only — never `mob_reports` (every staffer's figures) or `mob_manage` (catalog/vendors/settings/void/stock adjustments).
- A custom role (`profiles.role_id` → `roles.permissions`) gets exactly the `mob_*` boxes ticked on the account page.
- There are **no RLS policies at all** on any `mob_*` table (RLS is on, with zero policies — a direct `select` returns nothing, a direct `insert`/`update` is rejected). The only way in is a `mob_*` function, and `mob_guard(k)` is the first line of every one that writes.
- **Staff isolation is enforced in `mob_sync_pull`, not just hidden in the UI.** Everyone gets the shared catalog (items, units, vendors, customers); purchases, sales, repairs, repair events and payments are filtered to `staff_id = app_uid()` for anyone without `mob_reports`, server-side. A staffer's own IndexedDB cache never receives another staffer's rows in the first place.
- `staff_see_purchase_rates` (Settings) is one owner switch: on, plain staff can see cost price and profit figures; off (the default), they see quantity and selling price only, never cost.

## Other rules that hold everywhere

- **Day close.** `mob_settings.day_close_date` + `mob_day_locked()`: any entry dated on or before the lock date is refused (`MB003`) at the top of every `mob_push_*` function.
- **Duplicate IMEI is refused by the database**, not just the UI: partial unique indexes on `(tenant_id, imei)` / `(tenant_id, imei2)` where the unit hasn't been returned — scoped per tenant, so two unrelated shops can each have the "same" real-world IMEI in their own books.
- **Bill numbers** reuse the platform's existing `invoice_counters` + `mob_next_bill_no`, not a new counter table.
- **Audit log** (`mob_audit`) is append-only; every correction (item edit, void, stock adjustment) writes a before/after row.
- **Second-hand phones** live in the same `mob_item_units` table as new serialized stock, distinguished by `source` (`'new'`/`'secondhand'`), with seller name/phone/ID-proof/accessories columns populated only for second-hand intake.
- `mob_integrity_check()` (Settings → Data health check) proves: every sold unit has exactly one matching stock movement, every sale's total equals subtotal minus discount, bill numbers are unique, and no item's stock has gone negative. It runs after every step in the test suite.

## The staff accountability ledger

The owner's stated reason this app exists at all: in a real shop, the staffer running the counter can buy
stock cheap and tell the owner they paid more, or sell high and tell the owner they sold for less — pocketing
the gap either way. Reports → **Staff ledger** (`mob_report_ledger`, `p-reports.js`'s `renderLedger`) is the
direct answer: one row per unit sold, the whole chain in one place — who bought it, from whom, for how much;
who sold it, to whom, for how much; the profit that chain actually produced — with a staff filter and a grand
total (total sales / total cost / total profit) at the top. Nothing in it is staff-editable after the fact:
every figure is read straight from the append-only `mob_sales`/`mob_purchases` rows, and `costPrice` is a
server-side snapshot taken by `mob_push_sale` at the moment of sale, never something a staffer can later change.

Serialized units (phones, by IMEI) trace exactly: `mob_purchases.unit_id` links back to the one purchase that
brought that exact unit in, so the vendor and the staffer who entered the purchase show up alongside the
staffer who made the sale and the customer. Non-serialized stock (accessories, bought in fungible batches) has
no single matching purchase, so those rows show "Loose stock (no single vendor)" instead of a vendor/bought-by
— but the cost figure is still the real snapshot, never blank. Tapping a row (phone) opens the full breakdown
as a sheet; the desktop table shows every column at once.

## The screens

Apple HIG, same discipline as Payroll v2 and Accounting: plain words, 44 pt touch targets, segmented controls, bottom sheets, a tab bar on phones and a sidebar from 1200 px, dark mode, the business's own accent colour (`ds/brand.js`), no emoji, `h()` never uses `innerHTML`.

Home is four big thumb-friendly actions (New sale, Add purchase, New repair, Buy used phone) plus "My work today" for everyone, and the live shop dashboard for owner/manager. Hindi and English are both first-class (`mob/i18n.js`, real everyday-shop Hindi, not transliteration) — the language switch always shows each language's own name ("English" / "हिंदी"), never translated into whichever language is currently active.

## Files

- `db/080_mobile_schema.sql`: the `mobile` niche, 13 `mob_*` tables (RLS on, no policies), the IMEI unique indexes.
- `db/081_mobile_engine.sql`: permissions, context/bootstrap, catalog saves, purchase, sale, void, repairs, payments, stock adjustment, staff directory.
- `db/082_mobile_sync_reports.sql`: `mob_sync_pull`, owner reports, the integrity check, export, the demo seed (original).
- `db/083_mobile_pricing.sql`: lists AUZsMob in `product_prices` (starts at ₹0 — "not priced yet" — a platform admin sets the real number).
- `db/084_mobile_demo.sql`: folds AUZsMob into the one consolidated demo tenant, with a richer seed (a phone in stock, one sold on credit, an open repair job) and the 12-hour auto-refresh check inside `mob_context()`.
- `db/086_mobile_staff_ledger.sql`: `mob_report_ledger(p_from, p_to, p_staff_id)`, the staff accountability ledger above.
- `server/src/index.js`: every public `mob_*` function is in the `RPC` list.
- `app/public/mob/`:
  - `i18n.js`: the English/Hindi dictionary and `t()`.
  - `core.js`: DOM helpers, icons, formatting, the UI kit.
  - `sync.js`: IndexedDB, the outbox, `localPush`, `trySync`, `pull`.
  - `shell.js`: sign-in, navigation, router, the "More" sheet, cross-links to the other apps the business owns.
  - `p-home.js`, `p-sell.js`, `p-purchase.js`, `p-repairs.js`, `p-stock.js`, `p-dues.js`, `p-reports.js`, `p-settings.js`.

## Deploy

```bash
cd auzslabs-infra && git pull origin main
set -a; source .env; set +a
for f in db/080_mobile_schema.sql db/081_mobile_engine.sql db/082_mobile_sync_reports.sql db/083_mobile_pricing.sql db/084_mobile_demo.sql db/086_mobile_staff_ledger.sql; do
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f" || break
done
docker compose up -d --build api
docker compose restart caddy
```

Verify: `git log -1 --oneline` should show this change, and `https://<a client's slug>.auzslab.in/mob.html` should load a sign-in screen once the `mobile` feature is turned on for that tenant (platform admin's client editor, or `update tenant_settings set features = features || '{"mobile":true}'::jsonb where tenant_id = (select id from tenants where slug='<slug>');`).

The public demo is `https://demo.auzslab.in/mob.html` (same login as the POS/Payroll/Accounting demo: `demo@auzslab.in` / `Auzslab@Demo`), and the console/POS/Payroll/Accounting sidebars now cross-link to it once a tenant has the feature.

## Tests

`node tests/run-local.mjs mobile` runs 31 checks: access for logged-out users and another business, catalog, purchase (idempotency and duplicate-IMEI rejection), sell and void (and the stock move back), staff isolation through `mob_sync_pull` (not just the RPC access checks), repairs (parts decrementing stock, authorization by job owner or `mob_reports`), dues and reports, the `staff_see_purchase_rates` switch, day close, export, the integrity check, and every screen on phone and desktop for the owner and for staff — including a real Save button flow (Add purchase, end to end through the actual UI) and the Hindi/English toggle. It is also in the `design` suite's app list (tokens, accent, layout tiers, dark mode, 12 px/44 px sizing).

## Known limits (honest list)

- **Camera barcode/IMEI scanning is not built.** IMEI entry is manual only; the spec allows this as a v1 gap.
- **WhatsApp-share and printed/PDF bills are not built.** The data (bill number, totals) exists; there is no share/print button yet.
- **Spreadsheet import of items is not built** (the spec marks this optional).
- **No first-run setup guide** (Payroll's five-question guide has no AUZsMob equivalent yet).
- **No Bluetooth-printer hook** (the spec says this is fine for v1 — just leave room for it later; nothing currently assumes a printer).
- **Vendor dues are an aggregate, not a per-purchase balance.** `mob_purchases` carries no paid/balance columns of its own; a vendor's due is `sum(purchases.total) − sum(payments where kind='vendor_due')` for that vendor. This is correct in total but cannot show which specific purchase is still owed.
- No real background jobs: the demo's 12-hour refresh runs lazily, the next time anyone with `mob_reports` opens AUZsMob on that tenant (same pattern as every other demo tenant's reset).
