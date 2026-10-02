# AUZslab staff apps: unified design system and responsive redesign

This covers the AUZslab POS and its back office: the billing POS (`index.html` + `pos/`), the admin console
(`dashboard.html` + `console/`) and Back Office (`backoffice.html`). It also covers AUZslab Payroll (`payroll.html`),
AUZslab Accounting (`accounts.html` + `accounts/`) and the Website Builder (`builder.html`).

The work was a presentation-layer redesign. No database schema, API contract, permission rule, calculation, numbering
or audit behaviour was changed: no SQL file, no `server/` file and no billing/posting code was touched.

## 1. Audit (before)

The apps were all plain HTML/CSS/JS with no build step, and they used five different visual systems.

| App | Look before | Navigation before | Problems found |
|---|---|---|---|
| POS | Apple HIG, own tokens in `pos.css`, `#f2f2f7` cool grey, business colour as accent | Sidebar (desktop) / tab bar (phone), one flat list | Tablet portrait showed the phone layout, so the cart was hidden behind a sheet. The 900-1199px sidebar plus three panes was cramped. No link to inventory or reports. No keyboard shortcuts. Tab labels were 10.5px. Inter was loaded but unused. |
| Admin console | Blue-accent dashboard (`#3d6df2`), Inter 14px, gradients, 10-11px labels, its own "AUZs LAB" name | 11 groups in one long sidebar | Did not look like the POS it belongs to. Its blue clashed with the business colour. No dark mode (hard-coded whites). Decorative gradient "planet" card. Text under 12px. Seven icon buttons crowded the phone top bar. |
| Back Office | Old ink theme: dark translucent top bar, Inter, plus the `hig.css` restyle layer | Hamburger drawer at every width | The drawer stayed hidden even on a wide desktop. The dark top bar matched no other app. |
| Payroll | Old ink theme plus `hig.css`, fixed wine `#800020` | Hamburger drawer at every width; no sidebar or tab bar | Accent ignored the business colour. Desktop had no visible navigation, and phones had no tab bar. |
| Accounting | Apple HIG, own tokens (`--tint` = wine, a lifted pink in dark mode) | Sidebar groups: Sales, Purchases, Inventory, Accounting, Tools | Different token names from the POS. Fixed wine accent. Tablet portrait used phone bottom sheets. No collapsible sidebar. |
| Website Builder | Old ink theme plus `hig.css` | Hamburger | Same as Back Office. |

Screenshots of every app before and after, at 390 / 768 / 1024 / 1440 px, can be regenerated at any time with
`node tests/shots.mjs <dir>` (set `SCHEME=dark` for dark mode, and `ONLY=pos,accounts` to limit the apps).

## 2. Shared design system

There is one token sheet, `app/public/ds/auz.css`, and every staff app loads it first. Apps keep their own component CSS, but
every colour, size, radius and shadow comes from these tokens. The business colour is applied by `app/public/ds/brand.js`.

| Token group | Values |
|---|---|
| Accent | `--accent` = the business colour (`settings.col`), else the niche default, else AUZslab wine `#800020`. Derived from it: `--accent-soft`, `--accent-soft2`, `--accent-line`, `--accent-text` (lifted in dark mode), `--on-accent`. |
| Surfaces | `--bg #f5f4f2` (warm neutral), `--bg2`, `--card #fff`, `--card2`, `--elev`, `--bar` (translucent bars), `--fill/2/3` |
| Text | `--label #1d1d1f` (charcoal), `--label2`, `--label3`; separators `--sep`, `--sep2` |
| State colours | `--green --orange --red --blue --purple --yellow --teal`, each with a `-bg` tint; `--veg --nonveg --egg`. Colour is used for state and action, not decoration. |
| Type | System font (`--font`) everywhere; Inter removed from POS, console and Accounting. Apple text-style scale `--fs-cap 12` … `--fs-large 34`. Nothing renders under 12px. |
| Space, shape, depth | `--s1`…`--s8` (4-32px), radii `--r1 8 / --r2 12 / --r3 16 / --r4 22`, shadows `--sh1/2/3`, `--ease` |
| Targets | `--hit` 44px on touch, 36px under a fine pointer; sidebar `--side-w 240px`, rail `--rail-w 72px` |
| Dark mode | Follows the system appearance. Same hues lifted for dark backgrounds, including the business colour (`--brand-dark`, `--brand-dark-text`). `<html data-theme=light>` opts a page out. |
| Motion | `prefers-reduced-motion` turns animation and transitions off everywhere |

How each app reads the tokens:
- **POS**: `pos.css` no longer defines tokens. `--tint`/`--tint2` became `--accent-soft`/`--accent-soft2`, and `applyTheme()` calls `auzBrand()`.
- **Accounting**: its own names are aliases (`--tint` → `--accent`, `--tint-text` → `--accent-text` for text, so dark mode
  uses the lifted colour for text and the solid colour for fills). It reads the business colour with
  `auzBrandLoad(sb)` (the one `settings` record), because Accounting does not sync records.
- **Admin console**: every hard-coded colour in `console.*.css` and its scripts (charts, tiles, inline styles) was mapped to
  a token by role: text, surface or line. Charts use `--accent`. Dine-in / takeaway / delivery use `--accent`
  / `--teal` / `--orange`. The gradient promo card is now a flat accent card. The name is now "AUZslab · Admin console",
  with the POS icon.
- **Back Office, Payroll, Website Builder**: `ds/legacy.css` loads last and points their old names (`--ink`, `--l`, `--g`,
  `--hig-*`, radii, shadows) at the tokens, flattens the dark top bar into the shared translucent bar, and makes the
  current sidebar item a soft tint as in the other apps. These three stay in light appearance (`data-theme=light`)
  until their remaining inline colours are moved to tokens (see section 6).

## 3. Information architecture (after)

Every feature that existed is still reachable. Nothing was removed; items were regrouped, and cross-app links were added.

**AUZslab POS (billing app sidebar)**
- *Service*: Tables, Sell, Orders, Kitchen, Reservations, Register
- *More*: KOT report, Token board, Staff & settings
- *Back office* (owner/manager): Overview, Inventory, Reports, Menu (deep links into the admin console), plus Payroll and
  Accounting when those add-ons are enabled
- Footer: outlet picker, keyboard shortcuts, signed-in user
- Phone tab bar: the first four Service destinations and More (unchanged rule)

**AUZslab POS admin console**
- *Overview*: the dashboard
- *POS & Orders*: Billing POS, Live orders, All orders, Online orders, KOT, Due payment
- *Inventory & reports*: Inventory (7 pages), Reports (9 pages including GST summary)
- *Manage*: Menu management, CRM, Team, Finance, Marketing, Integrations, Management, Quick links
- *Other apps*: Payroll, Accounting (only when entitled and switched on)

**AUZslab Accounting**
- *Home* (overview)
- *Sales*: Sales documents, Customers, Collect
- *Purchases*: Purchases, Suppliers, Pay suppliers, Expenses
- *Accounts*: Books (journals, ledgers, trial balance, chart of accounts), Bank and cash, Fixed assets
- *Financial reports*: Reports (P&L, balance sheet, …), GST
- *Inventory*: Products, Stock
- *Tools*: Import and export, Messages, Settings
- *Other apps*: POS, Payroll (owner/manager, when entitled)
- Phone tab bar: Home, Sales, Collect, Expenses, More (unchanged)

**AUZslab Payroll** (HR view)
- *People*: Employees, Attendance, Shifts, Leave, Holidays
- *Pay*: Payroll run, Reports
- Settings
- Footer: Admin console (owner/manager), Sign out
- Phone tab bar: Attendance, Employees, Payroll run, More (all sections)
- The employee self-service app (`empApp()`, used when a staff member signs in) is unchanged.

## 4. Layout tiers

| Width | POS | Accounting | Payroll | Admin console | Back Office |
|---|---|---|---|---|---|
| < 600 compact | Tab bar; single-column selling screen with cart bar; bottom sheets | Tab bar; large titles; lists; bottom sheets | Tab bar + More | Trimmed top bar (menu, outlet, search, alerts) | Drawer |
| 600-899 medium | Tab bar with side-by-side labels; **items and the order side by side**; centred sheets; 4-up stat strip | Wider gutters; two-column cards; centred sheets; 12-column invoice lines | Tab bar | Wider gutters | Drawer |
| 900-1199 expanded | **72px icon rail**; items + order (categories as chips) | **72px icon rail** | **72px icon rail** | Full sidebar (own collapse button) | Drawer |
| ≥ 1200 wide | 240px grouped sidebar; categories, items and order in three panes | 240px grouped sidebar | 240px grouped sidebar | Full sidebar | **Drawer pinned as a sidebar** |

- **Collapsible sidebar.** POS and Accounting have a sidebar toggle. The choice is remembered (`pos.side` / `acc.side` in localStorage) and overrides the automatic rail at either tier.
- **Keyboard.**
  - POS: `?` lists the shortcuts, `/` searches items, `N` starts a new order, `Alt+1…9` jumps to a section, `Esc` closes sheets.
  - Accounting: the existing `⌘K` palette and shortcuts sheet.
  - Console: the existing `/` and `⌘K` palette.
- **Foldables.** Layout follows the available window width (a folded phone is compact, an open book-style foldable is
  medium or expanded). Hinge-aware layouts (`env(viewport-segment-*)`) are not implemented; see section 6.

## 5. Feature-parity register

Status key:
- **verified**: a test drives the feature end to end and checks the result in the database.
- **renders**: a test opens it at phone and desktop width, checks there are no errors, layout breaks or undefined values, and clicks its navigation.
- **unchanged**: code not touched by this work.

| ID | App / module | Feature | Location after | Status | Test |
|---|---|---|---|---|---|
| P1 | POS | Sign in, tables floor, table states, cleaning | Service > Tables | verified | `pos.mjs` |
| P2 | POS | Sell: categories, search, veg filter, add-ons, notes, covers, captains | Service > Sell | verified | `pos.mjs` |
| P3 | POS | KOT numbering, kitchen display, recall | Service > Kitchen | verified | `pos.mjs` |
| P4 | POS | Payment: cash/UPI/card/gift card, splits, tips, credit | Sell > Pay | verified | `pos.mjs` |
| P5 | POS | Refund, void, return with manager PIN approval | Orders > bill | verified | `pos.mjs` |
| P6 | POS | Move, merge, split bill | Sell > order menu | verified | `pos.mjs` |
| P7 | POS | Service, packing, delivery charges; tax-inclusive prices; round off | Billing math (`tot()`) | verified | `pos.mjs` |
| P8 | POS | Reservations, waitlist, double booking refused | Service > Reservations | verified | `pos.mjs` |
| P9 | POS | Register: float, cash in/out, count, variance | Service > Register | verified | `pos.mjs` |
| P10 | POS | QR guest orders (claim once) | Banner on every screen | verified | `pos.mjs`, `cafe.mjs` |
| P11 | POS | Server refusals (unapproved discount, paid-bill rewrite, settings overwrite) | Database | verified | `pos.mjs` |
| P12 | POS | KOT report, token board, staff & settings, approval PIN, outlet picker | More / footer | renders | `apps.mjs` |
| P13 | POS | Links to console Overview / Inventory / Reports / Menu, Payroll, Accounting | Sidebar > Back office | verified | `design.mjs` |
| P14 | POS | Layout tiers, sidebar toggle, keyboard shortcuts | Shell | verified | `design.mjs` |
| C1 | Console | Dashboard cards (revenue, channels, online, trend, items, health, leakage, snapshot, quick actions) | Overview | renders | `apps.mjs` |
| C2 | Console | Daily operations (live, all, online, KOT, due) | POS & Orders | renders | `apps.mjs` |
| C3 | Console | All 70+ pages across menu, inventory, finance, reports, team, CRM, marketing, integrations, management, quick links | Grouped sidebar | renders (every page) | `apps.mjs` |
| C4 | Console | Multi-outlet filtering, records created through the outbox | Outlet switcher | verified | `apps.mjs` |
| C5 | Console | Search / command palette, quick add, alerts, page tools, CSV | Top bar, page header | renders | `apps.mjs` |
| C6 | Console | Server audit log | Manage > Management > Audit trail | verified | `pos.mjs` |
| B1 | Back Office | Reports (day report, custom, analytics, activity log), cash drawer, close day | Reports | verified (cash drawer, price audit) / renders | `pos.mjs`, `apps.mjs` |
| B2 | Back Office | Staff, stock, customers, memberships, support, tasks, purchases | Drawer (pinned ≥ 1200) | renders | `apps.mjs` |
| B3 | Back Office | Menu editor incl. bulk price change | Menu | verified | `pos.mjs` |
| B4 | Back Office | Settings panes (business, tables, reasons, coupons, hardware, manual, website, booking) | Settings | renders | `apps.mjs` |
| Y1 | Payroll | Employees, attendance, shifts, leave, holidays, payroll run, reports, settings | Grouped sidebar / tab bar | renders | `apps.mjs`, `design.mjs` |
| Y2 | Payroll | Salon staff clock-in gating | Salon console | verified | `salon.mjs` |
| Y3 | Payroll | Employee self-service app | Staff login | unchanged | none |
| A1 | Accounting | Entitlement and role gates, owner switch | Server | verified | `accounts.mjs` |
| A2 | Accounting | Invoices, credit notes, bills, expenses, posting, cancel, numbering | Sales / Purchases | verified | `accounts.mjs` |
| A3 | Accounting | Payments and allocation, receipts | Sales > Collect, Purchases > Pay suppliers | verified | `accounts.mjs` |
| A4 | Accounting | Journals, ledgers, trial balance, books health check | Accounts > Books | verified | `accounts.mjs` |
| A5 | Accounting | GST working papers, e-invoice / e-way payloads | Financial reports > GST | verified | `accounts.mjs` |
| A6 | Accounting | Stock, weighted average, warehouses | Inventory | verified | `accounts.mjs` |
| A7 | Accounting | Bank import and reconciliation, fixed assets and depreciation | Accounts | verified | `accounts.mjs` |
| A8 | Accounting | Import/export (CSV, XLSX), recurring documents, messages | Tools | verified | `accounts.mjs` |
| A9 | Accounting | Public bill link | `bill.html` | verified | `accounts.mjs` |
| A10 | Accounting | Layout tiers, sidebar toggle, groups | Shell | verified | `design.mjs` |
| W1 | Website Builder | Editor tabs | Drawer | renders | `apps.mjs` |
| D1 | All | Shared tokens, same accent per business, system font, warm-neutral page | `ds/auz.css`, `ds/brand.js` | verified | `design.mjs` |
| D2 | All | No sideways scroll at 360 / 600 / 768 / 900 / 1024 / 1200 / 1440 | Every app | verified | `design.mjs` |
| D3 | POS, console, Accounting | Dark mode dark and readable (contrast ≥ 4.5:1, no light panels) | Tokens | verified | `design.mjs` |
| D4 | POS, console, Accounting | Phone text ≥ 12px, controls ≥ 44px | Tokens and CSS | verified | `design.mjs` |

## 6. Known gaps (not done)

- **Dark mode in Back Office, Payroll and the Website Builder.** These are locked to light appearance. Their inline `<style>` blocks
  still contain hard-coded light colours. The next step is to retoken them the way the console was retokened.
- **Older screens inside Back Office, Payroll and the Builder.** These are re-coloured and re-typed through the tokens, but their components (cards,
  tables, modals) are still the older markup. The full component rebuild has been done for the POS and Accounting only.
- **Admin console at 900-1199px.** It keeps its full sidebar and its own hide button. There is no automatic icon rail there yet.
- **Foldables.** Hinge-aware layouts (`env(viewport-segment-*)`, the Device Posture API) are not implemented. Layouts respond to
  window width only.
- **Saved views.** Pinned modules, saved filters and table column choice exist only in the console (favourites, quick links). The POS and Accounting do not
  have them yet.
- **Visual regression.** Visual regression runs as a screenshot record (`tests/shots.mjs`), not a pixel-diff gate in CI. There is no CI in this repository.

## 7. Release and rollback checklist

Before release:
1. Run `node tests/run-local.mjs` and confirm 0 critical and 0 major failures (the suites include `design`).
2. Run `node --check` on every changed script: `app/public/pos/*.js`, `app/public/accounts/*.js`, `app/public/console/*.js`
   and `app/public/ds/*.js`. Also check the inline scripts of `payroll.html` and `backoffice.html` (see CLAUDE.md for how).
3. Optionally, `node tests/shots.mjs` (light and `SCHEME=dark`), then review the 390 / 768 / 1024 / 1440 screenshots.

Deploy:
- Static files only, so `git pull origin main` on the VPS is the whole deploy. There is no migration and no API rebuild.
- The service worker version is bumped (`pos-v17`), so installed POS apps pick up the new files on their next load.

Rollback:
- Revert the merge commit, then `git pull` on the VPS.
- No data was migrated and no schema changed, so a rollback has no data step.
