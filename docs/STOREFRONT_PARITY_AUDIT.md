# Storefront dashboard: parity audit against the Codex design (commit 77f276a)

Reference: worktree of `codex/auzslab-launch-handoff` at `77f276a` (`ecosystem-preview/`). Compared with `main` as deployed (`app/public/storefront/`).
**Not available to this audit:** the Codex *working copy* with the newest pricing files (`site/pricing.html`, `pricing.css`, `pricing.js`). They are not in commit 77f276a or in any pushed branch, so nothing could be compared. They need to be committed and pushed (or pasted) first.
**Not possible from this environment:** a staging site, real owner and staff accounts, or a second production business. Everything below was checked only against the local test copy (`tests/run-local.mjs sfxonboarding|sfxcommerce`, plus throwaway browser scripts). Statuses are "built and tested locally", not "verified in production".

Status words: BUILT (works against the real API, tested locally) / PARTIAL / MISSING / NO BACKEND (the design shows it, no production data source exists).

## 1. Shell and navigation
| Area | Reference | Ours | Status |
|---|---|---|---|
| Sidebar, search (Ctrl/Cmd K), active tab and sub-tab, mobile menu, header actions, pinned Settings and store identity | ecosystem.js / ecosystem.css | adapted from the same files; header also has Sign out | BUILT (needs a side-by-side visual check on a real phone) |
| Settings sub-pages | Payments, Taxes and duties, Languages, Store policies, Customer privacy, Billing | Notifications, Store policies, Customer privacy, Billing, Sign-in and support (db/394) | PARTIAL. Still missing: Taxes and duties, Languages (NO BACKEND) |
| `/account.html` for owners | routes to the owner workspace | routes to the app they own; owners with several apps get a chooser (Style, Ledger, Salon, Online store); `?stay=1` keeps the old page | BUILT. Decision needed: always go to the store workspace? |

## 2. Workflows (route -> API -> permission)
Permissions: `sfx_view` read, `sfx_manage` write (owner, manager, or a role that ticks them). All functions are `sfx_*` SECURITY DEFINER RPCs in `server/src/data/rpc-registry.js`.
| Screen | Route | API | Status |
|---|---|---|---|
| Home | `#/home` | sfx_context, orders, products | PARTIAL: sales, to-fulfil, recent orders, trial banner. Acquisition and website sessions are on Analytics, not Home |
| Orders, order detail | `#/orders`, `#/orders/<id>` | sfx_order_list, sfx_order_set_status | BUILT |
| Drafts | `#/drafts` | sfx_draft_* | BUILT |
| Abandoned checkouts | `#/abandoned-checkouts` | sfx_abandoned_* | BUILT |
| Returns + detail | `#/returns`, `#/returns/<id>` | sfx_return_* (+ Razorpay refund route) | BUILT |
| Shipping | `#/shipping` | sfx_checkout_settings_save | PARTIAL (one delivery fee + free-over; no zones/carriers) |
| Products list, bulk edit, CSV | `#/products` | sfx_product_list, sfx_product_bulk | BUILT |
| Product editor | `#/products/<id>` | sfx_product_save, sfx_product_extra_save | BUILT (details, pricing, organization, SEO, media with main image, variants). MISSING: image upload from device, per-variant images, option builder |
| Collections | `#/collections` | sfx_collection_* | BUILT (manual only; no smart collections) |
| Inventory, Transfers, Locations | `#/inventory`, `#/transfers` | sfx_inventory_*, sfx_location_* | BUILT |
| Categories and tags | `#/categories` | sfx_category_list, sfx_product_tags | BUILT |
| Customers, Segments, Companies | `#/customers` ... | sfx_customer_*, sfx_segment_*, sfx_company_* | BUILT |
| Growth | `#/growth` | sfx_campaign_* | BUILT |
| Discounts | `#/discounts` | sfx_discount_* | BUILT |
| Content: Pages, Files, Custom data | `#/pages` `#/files` `#/data` | stored in store config (db/391) | BUILT. Custom data fields are stored but not yet shown on products |
| Markets | `#/markets` | store config | BUILT as planning only: checkout does not convert currency (NO BACKEND for multi-currency) |
| Analytics: Reports, Live view | `#/analytics` | analytics.js over sfx_* | BUILT (check charts against reference) |
| Online store: Theme, Themes, Pages, Domains, Payments | `#/builder` ... | sfx_theme_*, sfx_domain_*, sfx_store_set_razorpay | PARTIAL, see section 3 |
| Apps and plans | `#/apps` | sfx_status | PARTIAL: shows plan; no app launcher cards |
| Staff and access | `#/team` | Admin panes (staff, PIN reset, admin access) | BUILT |
| Roles | `#/roles` | roles table via sb.from | BUILT (two store permissions) |

## 3. Theme library and visual editor (the largest gap)
| Reference feature (theme-library.js, builder.js, store-design.js) | Ours | Status |
|---|---|---|
| Marketplace list, install, set active | themePage | BUILT |
| Draft customise, publish | editorPage: add / move / remove sections and edit fields, save draft, publish | BUILT (list form) |
| Version history + restore to draft | db/387 | BUILT |
| New theme from a starter, rename, duplicate, delete | db/395 | BUILT |
| Validated ZIP import | `auzslab-theme.json` in a ZIP (own format, not the Codex page-template format), checked in the browser and again in the database | BUILT |
| Page-template canvas, desktop/tablet/mobile preview, click-to-select editing | none | MISSING (needs a preview renderer that reads the draft) |
| Section and block controls, alternate page templates, navigation, footer, Stores page and cards | sections only | MISSING (needs a richer draft schema, `draftContent`) |
| Choose which products show in each homepage section, order, how many | none | MISSING (needs a draft field per section + public store reading it) |
| Draft appears in preview, survives reopening, public only after publish | draft/publish exist; no live preview | PARTIAL |

Changing the draft schema or the public renderer affects every published store. It needs a migration plan and a backward-compatible reader before building.

## 4. Public Themes and Pricing
- `site/themes.html` exists. Classic vs Minimal previews, Salon and Kiln destinations: not re-verified against the reference.
- **Pricing conflicts with an owner rule recorded in CLAUDE.md:** "AUZslab shows no prices to anyone; every client gets a quote" (db/260 dropped the price tables). Reference pricing pages would reintroduce prices. Needs an explicit owner decision.

## 5. Things the redesign would hide or change (supported backend that must stay reachable)
1. Salon Console, AUZsLedger, AUZsStyle and the old `account.html` (kept under `?stay=1`). Do not remove them from the sign-in chooser.
2. AUZsStyle Online store controls (`style/p-store.js`) and the AUZsStyle to storefront import (`sfx_import_from_style`).
3. Admin tab features (billing, WhatsApp, AI connectors, backup, staff PINs).
4. Public store routes that read `public_sfx_store` (pages, themes, cart, checkout).

## 6. Proposed order of work
1. Settings sub-pages that have a real data source (Store policies and Customer privacy can reuse the Pages mechanism; Taxes and Languages need a decision).
2. Home layout parity (add acquisition and website sessions from analytics; app shortcuts).
3. Theme library: rename, duplicate, new from starter, ZIP validation (RPCs first).
4. Visual editor: draft schema v2 + live preview canvas + per-section product pickers (the big one; own migration and its own review).
5. Public Themes page parity; Pricing only after the owner decides.
6. Staging checklist run by the owner against real accounts (owner, staff, two businesses).
