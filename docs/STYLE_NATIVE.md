# AUZsStyle: converting to a native app later without losing UI or features

AUZsStyle is built so a Flutter (or Swift/Kotlin) app is a re-skin of the same product, not a rewrite.

1. **All rules live in the database, not the screens.** Pricing, tax, discounts, stock checks, returns, points, day close,
   permissions and analytics are SQL functions (`db/215-219`). The web UI only collects input and shows results, so a native
   app calls the exact same functions and cannot disagree with the website.
2. **One contract: `POST /rpc/<name>`.** The full list is the `sty_*` block of `server/src/data/rpc-registry.js`. Arguments
   are one jsonb `p` (send `{ "p": {...} }`) or plain ids. Replies are plain JSON (camelCase). Errors: HTTP 400 with
   `message` (codes `ST001`-`ST009`), 401 not signed in, 403 role not allowed.
3. **Idempotent writes.** `sty_sell`, `sty_return`, `sty_receive`, `sty_transfer`, `sty_hold_save` take a phone-made uuid
   (`p.id`); sending twice never double-posts. A native app keeps the same unsent queue (`style/data.js`: `sendOrQueue`,
   `flushQueue`) in SQLite and replays it when online.
4. **Same data shapes everywhere.** Catalogue = `sty_catalog` (styles -> variants with stock); a bill = `sty_sell` result.
   The native models are these two JSON shapes.
5. **Screens map one-to-one** (one file per screen in `app/public/style/`):
   Sell `p-sell.js` · Stock `p-stock.js` · Buy `p-buy.js` · Bills `p-bills.js` · People `p-people.js` · Overview and
   Analytics `p-reports.js` · Settings `p-settings.js`. Shared pieces: `lib.js` (bill maths mirror `calcBill`, receipt,
   filters, pickers), `barcode.js` (Code 128), `shell.js` (navigation/login), `i18n.js` (English text is the key, Hindi map).
6. **Design tokens** come from `ds/auz.css` (accent AUZslab wine, warm neutrals, radii 12/16/22, 44pt targets, dark mode);
   copy them into the app theme as the other native apps do (`native/*/lib/ui/theme.dart`).
7. **Sign in** is the shared `/auth/*` API (email, staff username+PIN, Google through `site/signin.html` deep link).
8. Hardware: barcode scanner (keyboard wedge or camera `mobile_scanner`), thermal printing via ESC/POS bytes (the web has
   `ds/escpos.js`; the native POS has `core/thermal.dart` to copy).

Product fields a native form must offer (all in `sty_save_style`): name, category, type (`subcategory`), brand, gender,
season, collection, fabric, wash care, weight (g), description, details, HSN, tax %, price, MRP, cost, photo link, colours,
sizes, opening stock. Grouping/filters: colour, type, fabric, collection (plus brand, gender in analytics).
