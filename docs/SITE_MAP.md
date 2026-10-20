# Marketing site map (`site/`)

Plain static files served as-is. No build step, no framework. Deploy = `git pull`.
Last audit: 2026-10-13. Everything below was checked against every reference in the repo.

## Three asset sets (deliberate, do not merge)
| Folder | Used by | Why separate |
|---|---|---|
| `site/` root (`theme.css`, `site.js`, `sketch` via `tool/`) | most marketing pages | the current design |
| `site/kept/` | `pos.html`, `billing.html`, `business-cafes.html`, `products.html` | owner asked to keep their older scroll-scene look |
| `site/tool/` | account, admin, cart, signup, demo, pay, inv and other tool pages | own split mobile/desktop CSS and extra scripts (help, 2FA, my-data, scroll lock) |

The `site.js`, `theme.css` and `ui-kit.css` copies in these folders differ from each other,
so they are NOT duplicates to delete. Merging them would change how pages look.

## Page groups
- Product pages: `pos`, `qr-ordering`, `payroll`, `accounting`, `scan-and-bill`, `crm`, `billing`, `inventory`, `products`, `pricing`, `intelligence`
- Business pages: `business-cafes|clothing|retail|salons|mobile-repair`
- Company: `index`, `platform`, `contact`, `studio`, `ip-custom-development`, `learn`, `resources-*`, `live-demo`, `demo`
- Request flow: `cart` -> `pay` (client pays) -> `inv` (GST bill)
- Account tools: `account`, `admin`, `signup`, `signin`, `verify-email`, `confirm-email`, `delete-account`
- Legal: `terms`, `privacy`, `refund`, `cookies`, `security`, `acceptable-use`, `hardware-terms`
- Helpers: `404`, `sitemap.html`, `sitemap.xml`, `robots.txt`, `company.js` (phone, email, address), `orderterms.js` (terms and bank/UPI text for the bill)

## Kept on purpose, although nothing links to them
- `checkout.html`: redirects old bookmarks to `cart.html`.
- `native-version.json`: read by the native apps over the web for the force-update check.
- `open.html` / `open.js`: old shop picker used by earlier Android test builds. Current builds open `app.auzslab.in` directly. Safe to delete once no old test APK is installed.
- `design-system/nav-kit.html`: linked from the admin panel menu.

## Rules when changing the site
- Menu and footer blocks are repeated per page: change them with a script across all pages, never by hand on one.
- Bump the `?v=` on a stylesheet or script link whenever you edit it.
- Public pages never describe the backend (hosting, database, tenants).
