# AUZsPOS web-to-Android parity tracker

This tracks parity between the **AUZsPOS website app** (`app/public/index.html` +
`app/public/pos/*.js` for the operational POS, `app/public/console/*.js` for the
**in-app Owner/Admin Console**) and the **native Flutter AUZsPOS app**
(`native/auzspos/`). The native app has its OWN Owner/Admin Console
(`native/auzspos/lib/ui/console.dart` + `console_pages.dart` + `console_more.dart`)
— this is a different thing from the AUZs Lab marketing-site admin tool
(`site/admin.html`), which is out of scope for this tracker.

**Do not mark a row MATCHED on route existence or a passing unit test alone.**
A row is MATCHED only once the native screen has been read against the matching
website `PAGES[...]` function and found to compute the same data, with the same
filters/calculations/empty-states, and (where visual claims are made) confirmed
with an actual screenshot or device run — not assumed.

## Status vocabulary

- **MATCHED** — read both implementations side by side; calculation/data-source/
  behavior confirmed equivalent (code-level evidence, cited below). Visual parity
  only claimed where a real screenshot/device comparison backs it.
- **PARTIAL** — some but not all of the website's elements/behavior are present;
  the specific gap is named.
- **MISMATCH** — a concrete behavioral or data difference was found.
- **NOT VERIFIED** — route exists on both sides (or a counterpart is plausible)
  but no side-by-side code read has happened yet this mission.
- **BLOCKED** — cannot be verified in this sandbox (no Android SDK/emulator/
  device; see "Environment" below).

## Environment this tracker was built in

No Android SDK, emulator, or physical device exists in this sandbox (`adb`,
`sdkmanager` absent; `ANDROID_HOME` unset; no `/opt/android*`). A Flutter SDK
(3.47.7 stable) was downloaded to `/opt/flutter-sdk` and used for
`flutter analyze` / `flutter test` only — **no APK or AAB has been built**, no
emulator/device run has happened, and no real screenshot comparison has been
made. Every "visual parity" claim below is NOT VERIFIED unless stated
otherwise. `.github/workflows/native-pos.yml` builds a release APK/AAB and
auto-publishes a `--prerelease` GitHub release (`native-pos-latest`) on every
push touching `native/auzspos/**` — confirmed by reading the workflow file —
so nothing in this mission has been pushed.

## Priority A: Owner/Admin Console (`console_pages.dart` vs `app/public/console/*.js`)

### Dashboard (`dashboard`)

**Status: PARTIAL** (improved this session; gaps remain, named below).

Native: `_Overview`/`_OverviewState` in `lib/ui/console_pages.dart`. Website:
`PAGES.dashboard` in `app/public/console/p-dashboard.js`.

| Website element (p-dashboard.js) | Native equivalent | Status |
|---|---|---|
| Greeting header (`greeting()`, outlet-aware `allOutletsNote()`) | none | missing |
| Revenue hero card with vs-yesterday delta % + sparkline (`sparkline(cum...)`) | `Kpis('Revenue', ...)` — total + bill count + avg, no delta, no sparkline | PARTIAL |
| Total Orders card with mini-bars | folded into the `Kpis` tiles (count only, no chart) | PARTIAL |
| Payment mode breakdown (cash/card/UPI/other/unpaid/online) | "Payment modes" `Group` (cash/card/upi/other only; no explicit Unpaid/Online rows) | PARTIAL |
| Order Channels (Dine-in/Takeaway/Delivery) | none | missing |
| Online Orders Overview (per-platform table) | none | missing |
| Sales Trend (hourly line chart, Today/range toggle) | "Sales by day" bar list (day-granularity, not hourly) | PARTIAL — different granularity, not the same chart |
| Top Performing Items (Best Sellers / Low Performers tabs) | "Best sellers" list only, no Low Performers tab | PARTIAL |
| **Business Health** (target margin / avg margin / items below target, from `margins()` + `cfg().targetMargin`) | **added this session**: `_businessHealthSection()`, using `businessHealth()` in `lib/core/costing.dart` (ported verbatim from the website's `margins()`) | **MATCHED** for the calculation itself (same formula, same unitCost() already verified in `costing_test.dart`); native shows 3 summary lines rather than the website's full insight copy — acceptable simplification, not a data mismatch |
| Expenses & Cash Flow card (Expenses/Withdrawals/Cash Top Up, clickable) | Expenses folded into the `Kpis` tile ("Expenses") only; no Withdrawals/Cash Top Up breakdown, not clickable | PARTIAL |
| Revenue Leakage (KOTs/Cancelled/Modified/Shifted/Reprinted/Waived) | none | missing |
| Daily Snapshot (7-day stacked bar by order type) | none | missing |
| Quick Actions (Manage Menu / Run Reports / Staff Costs / Marketing shortcuts) | none | missing |

**Evidence**: full text of both `_Overview`/`_OverviewState` (native) and
`PAGES.dashboard` (website, 89-line file) read this session. The Business
Health addition was verified with 6 new unit tests (`costing_test.dart`,
`margins`/`businessHealth` groups) plus `flutter analyze`
(80 issues, unchanged baseline) and `flutter test` (305 passed, up from 299,
no regressions).

**Remaining Dashboard gaps** (not yet implemented, each would be its own
batch): vs-yesterday delta + sparkline, Order Channels, Online Orders
Overview, hourly Sales Trend + Low Performers tab, Revenue Leakage, Daily
Snapshot, Quick Actions, outlet-aware greeting.

### Every other Console route

**Status: NOT VERIFIED** (not yet read side-by-side this mission; route
existence only, which the mission explicitly says is not evidence of parity).

Native has 80 `case` routes in `consolePageFor()`; a corresponding `PAGES[...]`
entry exists on the website for most of them (73 distinct `PAGES[...]` keys
found by grep). Three route-ID naming differences were found and need
reconciliation/verification before they can be marked anything but NOT
VERIFIED — they may be cosmetic renames or real behavioral divergences, not
yet determined:

| Native route id | Likely website counterpart | Note |
|---|---|---|
| `rep/inventory` | `inv/reports` | website's `inv/reports` has a tabbed `invReportTabs()` structure (stock/purchases/waste/food cost...); not yet confirmed native's `_RepInventory` covers the same tabs |
| `mgmt/qr` | `qr/ordering` | website comment at `p-site.js:5` says this was split out of site settings into its own page; not yet confirmed native's QR page matches |
| `agg/platforms` | `agg/settings` | both labelled "Platform Settings" in their own nav; likely just a different route-id choice, not yet confirmed the page content matches |

Also native-only (no obvious website `PAGES[...]` match found by this grep;
may be sub-features of another website page rather than missing altogether,
not yet confirmed): `menu/bulk`, `menu/import`, `rep/daily`.

Full list of the other 76 native routes still needing a side-by-side read
(each is a `consolePageFor()` case in `console_pages.dart`): `daily/live`,
`daily/all`, `daily/online`, `daily/due`, `daily/kot`, `inv/raw`, `inv/stock`,
`inv/purchase`, `inv/vendors`, `inv/recipes`, `inv/consumption`, `rep/sales`,
`rep/orders`, `rep/items`, `rep/customers`, `rep/staff`, `rep/analytics`,
`rep/gst`, `menu/items`, `menu/categories`, `menu/variants`, `menu/addons`,
`menu/tables`, `menu/taxes`, `menu/discounts`, `crm/customers`,
`crm/giftcards`, `crm/membership`, `crm/support`, `team/users`,
`team/attendance`, `team/tasks`, `fin/expenses`, `fin/withdrawals`,
`fin/settlements`, `mkt/campaigns`, `mkt/segments`, `mkt/offers`,
`menu/overview`, `menu/preferences`, `menu/commission`, `mgmt/whatsapp`,
`mgmt/config`, `mgmt/website`, `mgmt/data`, `menu/physical`, `menu/images`,
`mgmt/reasons`, `mgmt/outlets`, `mgmt/devices`, `menu/bogo`,
`menu/availability`, `crm/loyalty`, `crm/feedback`, `team/payroll`,
`fin/cash`, `fin/accounting`, `fin/reconcile`, `mkt/whatsapp`,
`mkt/promotions`, `mkt/loyaltycamp`, `agg/swiggy`, `agg/zomato`, `agg/ondc`,
`agg/dunzo`, `agg/ubereats`, `int/apps`, `ql/favorites`, `ql/shortcuts`,
`mgmt/hardware`, `mgmt/audit`, `mgmt/logs`, `ql/custom`.

**Access/permissions note**: `_Purchases`'s `canOrders = h.s.role == 'owner' ||
h.s.role == 'manager'` (console_pages.dart) matches the server-side
`pos_kind_ok()` rule — confirmed and already audited in an earlier task this
session, not re-flagged as a new issue. The native app's role model is a
hardcoded owner/manager/staff literal check in several places; the website's
custom-role/menu-item permission model (per-permission checkboxes, not just
three fixed roles) has NOT been reconciled with this — flagged in an earlier
task as a product decision needed from the owner, still open, not resolved
this session.

## Priority B: Operational POS app

**Status: NOT VERIFIED this mission as a whole.** Substantial native work on
parts of this existed BEFORE this mission started (this session's own earlier
commits, same branch): gift cards (`lib/core/giftcard.dart`), split-bill
destinations, customer CRM (`lib/core/customer.dart`), cash/denomination
counting (`lib/core/cash.dart`), stock adjustment/transfer
(`lib/core/stock.dart`), line-key handling (`lib/core/linekey.dart`), each with
their own test files and (per their own commit messages) verified against the
website's exact field shapes at the time. These are NOT re-verified as part of
THIS specific parity-tracker pass — they are listed here as existing,
previously-tested work, not re-audited rows. A full Priority B route-by-route
pass (login/session/outlet selection, billing, split bills, inventory,
purchasing, register/day-close, staff, offline sync, settings) has not yet
been done this session and remains open.

## What this session actually did (honest summary)

1. Re-scoped correctly: the Owner/Admin Console is `native/auzspos/lib/ui/
   console*.dart`, not `site/admin.html`.
2. Read the native Dashboard (`_Overview`) and the website Dashboard
   (`PAGES.dashboard`) side by side in full; found and documented 9 missing/
   partial elements (table above).
3. Implemented ONE of those gaps — the Business Health card — using an
   already-existing, already-tested native building block (`unitCost()`),
   added a pure `margins()`/`businessHealth()` port with 6 new tests, wired it
   into the Dashboard, and verified with `flutter analyze` (80 issues,
   baseline-matching) and `flutter test` (305/305 passing, no regressions).
   Committed locally (not pushed).
4. Downloaded a Flutter SDK into this sandbox (none was present) so analyze/
   test could actually run, rather than being skipped.
5. Built this tracker scaffold: every native Console route enumerated, cross-
   referenced against the website's `PAGES[...]` keys, naming mismatches
   flagged for follow-up, and an honest NOT VERIFIED status left on every row
   not actually read this session — rather than marking them MATCHED on route-
   existence alone, which the mission explicitly prohibits.

## What remains (not done this session, for a future batch)

- The other 8 named Dashboard gaps.
- A side-by-side read of all 76 remaining Console routes, plus resolving the
  3 route-ID naming mismatches.
- A full Priority B pass over the operational POS screens.
- Resolving the custom-role/menu-permission mismatch (needs an owner
  decision, not a code fix — do not weaken server-side authorization to
  paper over it).
- Any real screenshot/device/emulator verification (BLOCKED in this sandbox;
  would need a real Android device or the GitHub Actions build artifact run
  somewhere with a device attached).
