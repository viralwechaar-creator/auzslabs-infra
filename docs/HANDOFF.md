# Handoff: AUZslab storefront platform build (read this first)

Paste everything below into a fresh Claude session to resume exactly where this one stopped.
Written 2026-11-23. All background work was paused mid-task at the owner's request and
checkpointed to pushed branches — nothing is sitting only on a local disk that could be lost.

## What this whole effort is

The owner wants a new, flagship, Shopify-style storefront platform — separate from the
existing AUZsStyle/AUZsLedger/AUZslab Salon apps, which keep running exactly as they are.
A different AI session ("Codex") built a non-functional visual prototype of the owner-hub
UI + marketing-site refresh on branch `codex/auzslab-launch-handoff` (commit `77f276a`) under
`docs/AUZSLAB_LAUNCH_HANDOFF.md` + `ecosystem-preview/` (every data source in it is hardcoded
mock data — read `ecosystem-preview/server.mjs` to see exactly how fake it is). This session's
job has been: build the REAL backend for that design, carrying over Codex's actual frontend
files (not redesigning them), replacing the mock data layer with real RPCs, real auth, real
tenant isolation.

**Standing rule established and repeatedly confirmed by the owner this session: every visible
tab/button/control must either really work, or be visibly, explicitly marked "Coming soon" —
never a dead control that silently does nothing.** Every PR below follows this.

## Decisions already made by the owner (do not re-ask, do not re-litigate)

1. **This is a new, separate flagship product**, not a replacement for AUZsStyle/Ledger/Salon.
2. **Developer theme commission: 64% developer / 36% platform, manual payout only** — the
   ledger calculates and displays what's owed; the owner pays by bank transfer/UPI by hand.
   Do NOT build any automatic payout-to-developer-bank-account mechanism.
3. **Team (sales/dev staff) login: same sign-in screen as customers, smart redirect after** —
   not a separate "Team sign-in" page. This already works today (the SalesOS redirect pattern
   in `account.html`'s `boot()`), confirmed sufficient, no new work needed here.
4. **Storefront plan pricing: real, fixed price, automatic Razorpay checkout** — an explicit,
   scoped exception to this codebase's platform-wide "no prices shown" rule
   (`db/260_quote_only_no_prices.sql`). The owner will share the actual price later; it starts
   at ₹0/unset until then (same "dormant until configured" discipline as every other payment
   feature in this codebase).
5. **The original "basic dashboard" design was WRONG and has been scrapped.** See the Path A
   section below for the corrected design.
6. **All 4 built-in themes (Minimal, Classic, Salon, Kiln) are AUZslab's own real, pre-existing
   designs** (`app/public/store.html`'s existing templates, `app/public/salon/`,
   `app/public/site-kiln.html`) — Codex only referenced them, it didn't design them. Use the
   REAL literal content/structure from these real pages, not paraphrased/reimagined copy.
7. **All 4 built-in themes are free (₹0)** — store owners can install/switch between any of
   them freely. Paid third-party developer themes are a real, separate, working path (not
   wired to checkout yet — see Phase 2 gaps below).
8. **A 5th theme is wanted**: "Kiln (Salon)" — Kiln's café/editorial layout, adapted for a
   salon business: its food-menu section becomes a service-menu listing, a few internal links
   get fixed for salon context, and it's wired to the REAL salon booking system
   (`public_salon_page`/`public_salon_slots`/`public_create_booking` — the same system
   `app/public/salon/` already uses), not a new booking system. **In progress, not finished —
   see Phase 2 status below.**

## The branches/PRs, in dependency order

```
main
 ├─ PR #1098  feature/marketing-seo-brand-refresh          MERGED-READY, reviewed, not yet merged
 ├─ PR #1100  feature/storefront-platform-phase1            OPEN, real + tested, base for everything below
 │   ├─ PR #1101  feature/storefront-theme-marketplace       OPEN + 1 WIP checkpoint commit on top
 │   │              (needs more work — see Phase 2 below)
 │   ├─ feature/storefront-commerce-essentials (Phase 3)     NOT YET A PR — 1 WIP checkpoint commit only
 │   └─ feature/storefront-onboarding-reconciled              NOT YET A PR — 1 WIP checkpoint commit,
 │                                                             supersedes PR #1099 (close #1099 once this lands)
 └─ PR #1099  feature/two-path-onboarding-basic-dashboard    OPEN but SUPERSEDED — do not merge, see above
```

Every PR was opened via `gh api repos/viralwechaar-creator/auzslabs-infra/pulls -f ...` (the
REST form) because `gh pr create`'s GraphQL path is blocked in this environment — use the same
REST form, not `gh pr create`. Every commit/PR this session used this attribution:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UHkg6DUkkwRyXLGuZ4v1C9
```
(a fresh session should use its own session URL instead, obviously).

## Known migration-number collision — fix this first

Two branches independently used **`db/376`** for different content:
- `feature/storefront-theme-marketplace`: `db/376_storefront_theme_builtins_salon_kiln.sql`
  (Salon/Kiln built-in theme rows)
- `feature/storefront-commerce-essentials`: `db/376_storefront_commerce_essentials.sql`
  (customers/discounts schema)

One of these needs renumbering (to 377 or whatever's next free once everything is gathered)
before both can exist on the same tree. Check `git log --all --name-only -- 'db/37*'` across
all the branches above to find the true highest number in use before picking a new one.

## PR #1098 — Marketing site refresh (status: ready for review)

Adopted Codex's SEO/brand copy across 39 pages + 3 new ones (`about.html`, `developers.html`,
`themes.html`). Verified: the salon subdomain fix, Showoff-branding removal, and the
POS/Payroll/Scan/Finance retirement all survived the merge. **Important finding**: Codex's
branch deletes `careers.html` — this was investigated and found to be a mistake, not an
intentional move (Codex's `contact.html` has no real job-application path, no resume upload).
`careers.html` was kept and re-linked in the footer. Flagged, not fixed: `live-demo.html`
still advertises live demos for the 4 *retired* apps (AUZsPOS/Pay/Scan/Finance) — pre-existing
on `main`, a real claims-vs-capability gap, needs an owner decision on whether to prune those
demo cards from `live-demo.html` entirely. Fully Playwright-verified across 36 pages, zero
console errors, zero dead links.

## PR #1100 — Storefront platform phase 1 (status: real, fully verified, base for everything)

Own dedicated `sfx_*` tables (not the generic `records` engine): stores, products, variants,
collections, orders, reviews, domains. Every access through `sfx_guard(perm)`-gated SECURITY
DEFINER functions, all registered in `server/src/data/rpc-registry.js`. Public storefront
reuses AUZsStyle's existing proven renderer (`app/public/store.html`+`store/*`), generalized
with a fallback (`public_sty_store` → `public_sfx_store`), zero risk to AUZsStyle. Real
checkout (store's own Razorpay keys, HMAC-verified, cash-on-delivery always available). Real
DNS-TXT domain-ownership verification (actual serving on that domain is a later phase — the
Caddy site-block/on-demand-TLS work for it hasn't been built). Codex's real frontend files
carried over (`ecosystem-preview/{ecosystem,workspace,data,domains,analytics}.js` +
`ecosystem.css`), rewired to a real `api.js` instead of the original mock/localStorage layer.
`builder.js`/`theme-library.js` (the deep visual editor/marketplace) were deliberately NOT
carried over in phase 1 — that became phase 2 below. New owner-hub app:
`app/public/storefront.html` + `app/public/storefront/`, its own Caddy address `auzsshop`.
38 raw-psql assertions + a full real Playwright pass, zero console errors. **Two real bugs
found and fixed along the way**: a double-module-instantiation bug (query-string mismatch
between `<script src=".../ecosystem.js?v=1">` and an internal `import './ecosystem.js'` with
no query loaded two separate module instances, causing every click to double-fire — fixed by
dropping the query string) and a missing `SF` errcode prefix in
`server/src/lib/http.js`'s HTTP-status-mapping regex (fixed, one line).

**Deploy**: apply `db/372_storefront_platform.sql` after everything before it, restart the API
process (same server, new route handlers picked up on restart), redeploy Caddy config (new
`auzsshop` address block). To onboard a tenant right now (no self-serve flow exists yet without
the onboarding-reconciled branch): `tenant_settings.features->>'storefront' = 'true'`.

**Recommended next phase per this PR's own report**: real custom-domain *serving* (the
verification half is done; the Caddy wiring to actually serve on a verified external domain is
not) — this has NOT been started by any later phase, it's still open.

## PR #1101 — Theme marketplace (status: real schema/flow, +1 WIP checkpoint on top, not finished)

Base PR (`34265844`): own tables (`sfx_themes`, `sfx_theme_versions` frozen-on-submit,
`sfx_theme_installs` per-store isolated copies, `sfx_theme_purchases`,
`sfx_dev_commission_ledger` with a manual `paid_out`/`paid_out_note` checkbox, nothing
automatic). Developer portal at `app/public/theme-dev.html` (deliberately standalone, not
inside the owner-hub SPA, since a developer may run no store). Admin review queue in
`site/admin.html` ("Theme submissions": approve/reject with a required reason). Store owner
side: real marketplace browse/install/customize (hero/text/image/button/announcement
sections)/publish. Verified: a developer can't approve their own theme; a rejected theme is
never purchasable/visible; **critically, two different stores installing the same theme get
fully isolated copies — proven, one store's customization never leaks into another's**; 64/36
commission math paisa-exact. **Gap flagged honestly in the base PR**: paid theme purchasing is
NOT wired (refuses with a clear error, no fake checkout) — free themes work fully. No live
Playwright browser pass was done in the base PR either (database-level only) — the owner said
this is fine, they'll verify visually themselves once it's deployed; don't block on it.

Follow-up commit `8586c6e6` (already on this branch): added Salon and Kiln as the 3rd/4th
built-in free themes (₹0, approved, `is_builtin=true`), with a new `sfx_themes.base_chrome`
column deciding which existing hand-built CSS chrome (`minimal`|`classic`) a built-in theme
switches a store to. **However**, per the owner's correction (point 6 above), this round used
"new generic copy, not a clone" for Salon/Kiln rather than the real literal content from
`app/public/salon/`/`app/public/site-kiln.html` — **this needs to be redone with the real
content**, per the owner's explicit instruction that these are AUZslab's own real designs to
use directly, not something to avoid copying.

**WIP checkpoint commit `52555473` (uncommitted-turned-committed just now, NOT YET addressing
the above)**: added a real `booking` section type (wired to the real
`public_salon_page`/`public_salon_slots`/`public_create_booking` RPCs) to `store.js` (public
renderer), `storefront/workspace.js` (owner-hub editor), and `theme-dev.html`'s label map —
**but `theme-dev.html`'s actual section-type editor FORM case for `booking` was not added yet**
(label map only). This was the very next step when the pause arrived.

**What's left to finish PR #1101**, in order:
1. Add the `booking` section-type form case to `theme-dev.html` (developer-side editor).
2. Rewrite Salon's and Kiln's `sfx_theme_versions` default content to use the real, literal
   structure/copy from `app/public/salon/` and `app/public/site-kiln.html` (per point 6 above)
   — not paraphrased.
3. Build the 5th theme, "Kiln (Salon)" (per point 8 above): Kiln's layout, food-menu section
   replaced with a service-menu listing, internal links fixed for salon context, `booking`
   section wired in place of Kiln's original café-reservation flow. New `sfx_themes` row,
   `is_builtin=true`, `price_cents=0`.
4. Re-run the full psql verification suite against the updated/new theme content.
5. Update the PR description to reflect this whole round.
6. Commit (properly, not as WIP) and push.

## feature/storefront-onboarding-reconciled (status: real, extensive, 1 WIP checkpoint, NOT YET A PR)

Supersedes PR #1099 entirely — once this is finished and a PR is opened, close #1099 without
merging it. This branch reconciles PR #1099's two-path signup gate onto PR #1100's real schema,
AND incorporates the owner's major mid-task correction that scrapped the "basic dashboard"
concept. Read `db/373_two_path_onboarding.sql`, `db/374_storefront_plan_pricing.sql`,
`db/383_path_a_apps_direct.sql` for the real implementation. Summary of the corrected design:

**Path A ("Get apps")**: `choose-path.html`'s "AUZslab apps" option is now a plain link to
`live-demo.html`. A new "Get this app" button appears on `live-demo.html`'s featured-app card,
**only for the 3 still-sellable apps** (AUZsLedger/AUZsStyle/AUZslab Salon — tagged via a new
`sell` key in that page's JSON data block) — never on a retired product (AUZsPOS/Pay/Scan/
Finance) or AUZsMob. It links to `cart.html?add=<key>&lane=basic`, reusing `cart.html`'s
existing `?add=` preselect mechanism, with the `lane=basic` flag persisted through sign-in.
This flows into the **existing, already-tested** `client_orders` quote/payment-link mechanism
(`submit_client_order` → `admin_save_order_quote`/`admin_set_order_status` → `pay.html` or cash
→ `admin_confirm_order_payment`) — NOT a second, new request/approval system. Once payment is
confirmed, `account.html`'s `boot()` redirects a Path-A tenant (`onboarding_path='basic'`)
straight into its one owned app (AUZsLedger/AUZsStyle/Salon console) **before any dashboard
content ever renders** — a direct generalization of the existing SalesOS redirect already in
that function. All business/renewal/staff details live inside that app's own existing settings
screens. **`site/ac5.js` was reverted byte-for-byte to its original state** — the "basic
dashboard" trimmed-SECTIONS code is gone entirely, confirmed via diff against the merge-base.

**Path B (storefront platform)**: unchanged from PR #1099's original design — immediate 3-day
trial via `start_storefront_trial`, now correctly provisioning a row in the REAL `sfx_stores`
table (not a placeholder) with `trial_started_at`/`trial_ends_at`/`plan_status`. `sfx_guard`
refuses writes once paused/expired-unpaid; reads still work. Real fixed pricing
(`db/374_storefront_plan_pricing.sql`): revives `product_prices` but scoped in CODE to exactly
the `'storefront'` key only (`admin_set_product_price` refuses every other key) — a deliberate,
narrow, owner-confirmed exception to `db/260`'s platform-wide "no prices shown" rule. Real
Razorpay checkout wired (`createStorefrontPlanOrder`, `/payments/sfx/plan/create`, webhook
branch, `provision_storefront_from_payment`) — only activates once a real price (>0) is set;
until then, falls back to the existing manual-admin-approval path (same "dormant until
configured" discipline as every other payment feature here). `site/admin.html` got a minimal
"Storefront plan price" control (there's no literal "Pricing & payments screen" left in this
codebase since db/260 removed the old one — this adds the smallest addition in the same UI
style rather than inventing a parallel screen).

**Verified so far**: full `db/000`..`375` migration chain applies clean on a fresh scratch
Postgres DB. `node --check` clean on every touched file. `tests/run-local.mjs signup`: 13/13
passed. `tests/suites/local/journeys.mjs` was rewritten (added a positive two-path-gate-redirect
test, a full Path-A end-to-end test, fixed 3 real pre-existing bugs found along the way — see
below) and was **mid-run, not yet seen to pass or fail**, when the pause arrived.

**Real bugs found and fixed while writing tests (not guessed — each confirmed by an actual
failing run)**:
1. `a4.js` only reads `location.hash` once at load (no `hashchange` listener) — chained
   `goto()`s to the same path with only the hash differing don't reload in Chromium. Fixed by
   hopping through `about:blank` between them in the test.
2. A `page.route('https://*.auzslab.in/**')` glob added for a new test was shadowing the
   pre-existing `https://api.auzslab.in` handler (Playwright: routes added later take
   priority) — broke every RPC call on that page. Fixed with an explicit `route.fallback()`
   for the api subdomain.
3. A real pre-existing dual-render quirk: `account.html`'s old light-DOM profile form AND
   `ac5-views.js`'s shadow-DOM profile view both leave a `#pfName` node in the DOM, only one of
   which actually paints — fixed the test with a `:visible`-qualified locator (the underlying
   dual-render itself is pre-existing on `main`, not introduced by this branch — worth a
   separate cleanup ticket someday, not blocking).

**What's left to finish this branch**, in order:
1. Re-run `tests/run-local.mjs journeys` to its actual conclusion (it was mid-flight when
   paused) and fix anything still red.
2. Raw psql tests (not yet run) proving: Path B trial creates a usable `sfx_stores` row; trial
   expiry pauses writes via `sfx_guard`; a real price + test-mode Razorpay payment reactivates
   it; Path A's flow is unaffected.
3. A Playwright pass for the Path B journey specifically (signup → choose Path B → real
   storefront owner hub → add a product → public storefront → COD checkout) — note PR #1100
   itself shipped with zero Playwright coverage of its own feature, so this is new test-writing,
   not a re-run of something that already exists.
4. Delete any throwaway debug scripts under `tests/_debug*` if any remain (most were already
   cleaned up).
5. Commit properly (not as WIP) and push.
6. Open the PR against `main`, explicitly noting it supersedes #1099.
7. **One deliberately deferred piece, flagged not forgotten**: there's no in-app "pay to
   reactivate" button yet inside the storefront owner hub's own billing page
   (`app/public/storefront/workspace.js` still stubs it "coming in a later release") — the
   backend (DB functions, `payments.js`, the route) is fully wired and reachable by direct API
   call, just no UI button calls it yet. Build this before considering Path B's payment loop
   fully closed.

## feature/storefront-commerce-essentials (Phase 3) — status: schema-only, barely started

**Honest scope reality**: this phase covers 6 feature areas (Customers, Segments/Companies,
Discounts, Growth, Inventory/Transfers/Categories, Orders' Drafts/Returns/Shipping/Abandoned-
checkouts). Only the DATABASE SCHEMA for 2 of these — **Customers and Discounts** — exists, in
the WIP checkpoint commit (`cd9633e4`, `db/376_storefront_commerce_essentials.sql` — **note the
376 collision flagged above, this file needs renumbering**). This includes: `sfx_customers`,
`sfx_discounts` tables; discount columns on `sfx_orders`; owner RPCs
(`sfx_customer_list/save/delete`, `sfx_discount_list/save/set_status`); checkout-facing RPCs
(`sfx_discount_check`/`sfx_discount_amount`/`sfx_discount_claim`, the claim being atomic — a
`WHERE` clause re-checks status/usage-limit at commit time so two concurrent checkouts racing
the last use of a limited code cannot both succeed); `public_sfx_coupon_check`/
`public_sfx_place_order` rewritten from phase-1 honest no-op stubs into real discount
application. Registered in `rpc-registry.js`. Confirmed: the full migration chain applies clean
on a scratch DB and the new tables/functions exist with the right columns/constraints.

**NONE of the following has been done**: no scenario tests (no tenant-isolation test, no
paisa-exact discount-math test, no expired/over-limit-refusal test, no customer-list-merge
test — only schema *existence* was checked, not behavior). No UI wiring at all — `workspace.js`
still shows "Coming soon" for Customers/Discounts (and Segments/Companies/Growth). No
`node --check` run. No Playwright. Segments, Companies, Growth, Inventory/Transfers/Categories,
and all 4 Orders sub-features (Drafts/Returns/Shipping/Abandoned-checkouts) — not started, not
even scoped into the migration file yet. No `npm ci` run in `server/` for this branch. Read
`app/public/storefront/workspace.js`'s `comingSoon(...)` calls to see exactly which panels still
need replacing (same technique used to scope every other phase).

**Recommended approach for a fresh session**: given the real size here, don't try to do all 6
areas at once. Finish Customers + Discounts first (schema → scenario tests → UI wiring →
Playwright → commit) as one fully-verified slice, then tackle Inventory/Categories next (the
Products-page gaps), then the Orders sub-features, then Segments/Companies/Growth last (lowest
business value of the six). This mirrors how every other phase in this project was scoped and
verified — build a small real slice, verify it completely, then expand, rather than touching
all 6 areas shallowly.

## Established engineering conventions this whole project follows (do not deviate)

- **Database**: a product this large/distinct gets its own dedicated tables (the `sfx_*`
  convention here, matching how Accounting/Payroll/AUZsMob were each built) — never the generic
  `records` engine. RLS enabled, zero policies — all access through a `<prefix>_guard(perm)`
  SECURITY DEFINER function. **New tables need an explicit `grant ... to app` in the SAME
  migration that creates them** (see `db/015`'s own comment for why — this has bitten this
  project before). **Every new RPC must be registered in
  `server/src/data/rpc-registry.js` or it 404s** — this has also bitten this project before
  (see the Website Builder section of `CLAUDE.md`).
- **Frontend**: Codex's actual `ecosystem-preview/` files are the real design to carry over —
  adapt the data layer, do not redesign the UI. Apple-HIG-ish conventions (44pt touch targets,
  no emoji, single-stroke `createElementNS`-built SVG icons) throughout.
- **"Everything must work or be visibly Coming soon"** — the hard rule repeated throughout this
  document. Do a deliberate click-through of every tab/button before calling any phase done, not
  just the main golden-path flow.
- **Verification discipline, every phase**: raw psql tests of every new RPC's permission
  boundary and tenant-isolation guarantee BEFORE building UI against it; `node --check` every
  touched/new `.js` file (extract inline `<script>` blocks from `.html` files per `CLAUDE.md`'s
  documented technique); a real Playwright pass, not just code review; delete throwaway test
  scripts/screenshots before committing (`tests/_tmp_*`/`tests/_debug*` convention — never
  commit these).
- **Git workflow**: isolated `git worktree add /tmp/wt-<name> -b <branch> origin/<base>` for any
  work running concurrently with other background work — never share one working directory
  between concurrent tasks (this bit an earlier session hard: a background fork's `git
  checkout -b` silently changed the parent's checked-out branch too, since they share one
  filesystem when not using separate worktrees).
- **PRs**: opened via `gh api repos/.../pulls -f title=... -f head=... -f base=... -f body=...`
  (the REST form) — `gh pr create`'s GraphQL path is blocked in this environment, confirmed
  repeatedly. Merging is explicitly left to the human owner in every case.
- **Migration numbering**: before writing a new migration file, check EVERY in-flight branch's
  `db/` directory for the true highest number in use, not just the local worktree's — this
  project has hit real numbering collisions twice already (see the 376 collision above, and an
  earlier 372 collision between PR #1099 and PR #1100 that required a dedicated reconciliation
  pass).

## Quick orientation for a fresh session

1. Read this whole file first.
2. `git fetch origin` everything, then `git log --oneline --all -- 'db/37*'` to see the true
   current state of every migration number in flight.
3. Pick up work in this order: (a) finish `feature/storefront-onboarding-reconciled`'s
   remaining test-verification and open its PR, closing #1099 — this is the most complete and
   closest to done; (b) finish PR #1101's remaining theme-marketplace items (real Salon/Kiln
   content + the booking-editor-form gap + the Kiln-Salon 5th theme); (c) resolve the 376
   migration-number collision between (b) and `feature/storefront-commerce-essentials`; (d)
   continue Phase 3 (commerce essentials) from its schema-only state, one fully-verified
   feature area at a time; (e) start the not-yet-begun custom-domain-serving phase.
4. The owner's standing preference throughout this whole project: build extensively, talk
   minimally, one summary at a time, ask only when genuinely blocked on a decision only they can
   make — not on implementation details you can reason through from this document and the
   existing codebase's own established patterns.
