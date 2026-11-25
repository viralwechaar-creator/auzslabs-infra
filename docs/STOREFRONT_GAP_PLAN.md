# Storefront dashboard gap plan (verified against current code, branch `storefront-gaps`)

Verified against `app/public/storefront/*`, `db/*` and `server/src/data/rpc-registry.js` on current `main`. The older `docs/STOREFRONT_PARITY_AUDIT.md` predates several fixes.
Status: **Works** (real data, tested) / **Fix** (code change, no new provider) / **New backend** (needs new tables or functions) / **Provider** (needs an outside service or a business decision).

| # | Area | Current state (verified) | Status | This branch |
|---|---|---|---|---|
| 1 | Home visitor summary and traffic chart | Visits ARE tracked (`sfx_web_events`, db/401, used by Live view). Home still showed "not recorded yet" | Fix + small new SQL | **Done** (db/410 `sfx_visitor_summary`, Home + Analytics panels, tested) |
| 1 | Campaign acquisition visual | Table only | Fix | **Done** (bar charts on Home and Analytics) |
| 1 | "Local preview" label | Present in `analytics.js` | Fix | **Done** ("Live data from your store") |
| 1 | Events update counters; zero vs unavailable | Counters existed for Live view only | Fix | **Done** (suite `sfxvisitors`) |
| 2 | Details, Media, Variants inside Add product; draft save/resume | Editor exists for saved products; Add product is one form (details only) | Fix | Next round |
| 2 | Rich-text description, gallery reorder, per-variant image | None; `sfx_variants` has an `image` column | Fix + small SQL | Next round |
| 2 | Per-channel publishing | No channel field on products | New backend | Needs design (which channels can the public store enforce?) |
| 2 | Segments and Companies in Customers | Sub-items exist under Customers in the sidebar; not linked from the Customers page | Fix | Next round |
| 3 | Multi-page overview, section/block selection, spacing, link picker, live preview | Editor has header/footer/pages (PR #1196) and a preview frame; no click-to-select, no spacing controls | Fix + schema | Needs migration plan (theme draft schema v2) |
| 3 | Stores directory, footer blocks | None | New backend | Needs design |
| 3 | Pages: search, filters, bulk, menu editor, schedule | Pages stored in store config; basic list | Fix | Next round |
| 4 | Bring-your-own domain | Works (db/sfx_domain) | Works | Untouched |
| 4 | Domain search, purchase, renewal, transfer | None | Provider | Needs a registrar (GoDaddy/Namecheap API), pricing and ownership rules (decision) |
| 4 | Shipping zones and rate rules | One flat fee and free-over | New backend | Needs tables + checkout change |
| 4 | Live carrier rates | None | Provider | Separate integration (Shiprocket, Delhivery...) |
| 4 | Apps and plans hub | Shows plan only | Fix | Next round |
| 4 | Taxes and duties, Languages | Not present | New backend (+ provider for automatic tax rates / translation) | Needs design |
| 5 | Dashboard UI baseline (dark mode, focus, mobile reach) | Adapted from the approved preview; not re-audited per tab | Fix | Per-tab pass/fail after each round |

## Rollback
- Round 1 is additive: db/410 adds one function. Rollback: `drop function sfx_visitor_summary(int);` and `git revert` the branch; nothing existing is changed.
- Deploy only after review: `git pull`, `bash tools/migrate.sh apply`, `docker compose up -d --build api`.

## What cannot be done from this environment
No staging site, no real owner/staff accounts, no DNS or carrier credentials. All tests ran on a local copy with test tenants; screenshots are from that copy.
