# AUZslab — project brief for Claude

Read this before touching anything. It exists so a fresh Claude session
(any account) has the context that would otherwise only live in past chat
history. Keep it updated as the project changes — it goes stale fast
otherwise, and a stale brief is worse than none (see "README.md is stale"
below for exactly that failure mode already happening once).

## What this is

AUZslab is a self-hosted, multi-tenant SaaS: point-of-sale, CRM, billing,
inventory, QR self-ordering and a bookings module, sold to individual
businesses (cafes, salons, gyms, retail). One codebase, one VPS, every
client is a row in `tenants` — no per-client deployment, no per-client
infra. It replaces what would normally be a Supabase + Vercel stack with
plain self-hosted equivalents, on purpose (owner wanted no dependency on a
managed vendor).

There are three separate front-facing surfaces:
- **`site/`** — the public marketing site at `auzslab.in` (product pages,
  pricing, signup/cart flow, and `admin.html` / `account.html`, the
  platform-admin and client dashboards, also served from here).
- **`app/public/`** — the actual product the client's staff uses day to
  day: `index.html` is the POS/CRM/inventory/staff/reports app, `site.html`
  is that one tenant's own public-facing mini-website (which QR codes on
  tables also point to, doubling as the self-order ordering page), `order.html`
  is the public invoice/receipt view, `payroll.html` is the standalone
  Payroll app, `builder.html`/`w.html` are the Website Builder editor and
  its public renderer (see "Website Builder" below). Served on every
  tenant's own subdomain (`<slug>.auzslab.in`) — same files for every
  tenant, the active one is resolved client-side from the subdomain
  (`tenant.js`) or server-side from the logged-in staff member's own
  profile.
- **`server/`** — the API: auth, a generic data API, RPC endpoints, file
  storage, realtime (WebSocket + Postgres LISTEN/NOTIFY), Web Push. This
  is what stands in for "Supabase" — see `db/000_own_auth.sql`'s own
  comment for the full rationale.

## Stack

Plain Postgres 16 + a hand-rolled Node API (`server/`) + Docker Compose +
Caddy (reverse proxy, automatic HTTPS incl. a wildcard cert for
`*.auzslab.in` via GoDaddy DNS-01). No Supabase, no Vercel, no ORM. The
marketing site and the POS app are both plain static HTML/CSS/vanilla JS —
no build step, no framework, no bundler. `site/` and `app/public/` are
bind-mounted straight into the Caddy container (see `docker-compose.yml`),
so editing those files and deploying is just `git pull` on the VPS — no
rebuild, no restart.

**Design system**: `site/theme.css` is the single source of truth for the
whole product's visual identity — ink/accent palette (`--ink:#171717`,
`--accent:#800020`), the SF Pro/system-ui display stack + Inter (body) +
Space Mono (labels/mono), the thick-ink-border-and-card language. (Fraunces
was fully removed in favor of an iOS-style system font stack — don't
reintroduce it.) `app/public/index.html` (the POS) has its own inline
`<style>` reusing the *same tokens* but a lighter, more minimal component
language (no borders on plain buttons, borders reserved for real
containers) — a dense working tool reads differently from a landing page,
but the palette/typography must always match. If you're building new
internal tooling, match this, don't reinvent it.

Every `site/*.html` page also loads `site/design-system/ui-kit.css`
(`.uk-kit` components: accordion, bento tiles, linklist, etc.) alongside
`theme.css`. It's a second token set (`--uk-ink`, `--uk-accent`,
`--uk-font-display`, ...) that must be kept in sync with `theme.css`'s
tokens by hand — nothing enforces this automatically. If you change a
color or font in `theme.css`, check `ui-kit.css`'s `:root` block too, or
`.uk-kit` components will silently drift (this already happened once:
`--uk-font-display`/`--uk-font-body` pointed at Google Fonts that were
never actually `<link>`ed on any real page, so every `.uk-kit` component
on 18 pages silently rendered in a fallback font instead of the intended
one).

## Deploying (the actual command sequence)

```bash
cd auzslabs-infra
git pull origin main
```

That alone is the entire deploy for any change to `site/` or `app/public/`
— both are bind-mounted read-only into Caddy. If a change also touched
`db/`, additionally run the new migration file(s) **in filename order**:

```bash
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/0NN_whatever.sql
```

Two mistakes that have actually happened, more than once:
- Using `-f db/0NN.sql` instead of `< db/0NN.sql`. `-f` opens the path
  *inside the container's own filesystem*, which doesn't have `db/`
  mounted there — always use shell redirection (`<`), not `-f`.
- Forgetting `set -a; source .env; set +a` first. Without it,
  `$POSTGRES_USER`/`$POSTGRES_DB` are empty and psql falls back to the
  OS user, which fails with `role "root" does not exist`.

If `server/` (the API) changed, that one *does* need a rebuild:
`docker compose up -d --build api`.

## Database migrations: the one gotcha that bit us

`db/*.sql` files auto-run once, in filename order, only on a brand-new
empty database. This database has been live since early on and every
migration after the first was applied by hand, one at a time, as features
shipped — so **`db/999_app_grants.sql`'s blanket `grant ... on all tables
in schema public to app` only covers tables that existed the moment it
last ran**. Any migration that `create table`s something new needs its own
explicit grant, or the API server (which connects as the `app` role, never
as `$POSTGRES_USER`) gets `permission denied for table X` even though RLS
policies look fine. `db/015_regrant_app_role.sql` is the fix-after-the-fact
example and doc comment for exactly this. New tables: grant `app` access
in the same migration that creates them.

Functions don't have this problem — Postgres grants `EXECUTE` to `PUBLIC`
by default at creation time.

## Verify locally before shipping a migration

Postgres runs locally in this environment. Before trusting any schema
change against the real (live, paying-customer) database, apply the full
migration chain to a disposable local database first, seed realistic data,
and functionally test — including reproducing the bug against the *old*
schema first, to confirm the diagnosis before confirming the fix:

```bash
sudo -u postgres createdb scratch_test
for f in db/000_own_auth.sql db/001_*.sql db/002_*.sql ... db/0NN_new.sql db/999_app_grants.sql; do
  sudo -u postgres psql -d scratch_test -v ON_ERROR_STOP=1 -f "$f"
done
# ...seed + test with real psql inserts/selects...
sudo -u postgres dropdb scratch_test
```

## The `records` table (the generic engine)

Orders, expenses, shifts, menu items, categories, tables, inventory, waste,
void log, settings overrides — almost everything is one table (`records`)
with a `kind` text column as the discriminator, keyed by
`(tenant_id, id)`. A new niche's concept (a salon's stylist, a gym's
trainer) is just a new `kind` value, never a new table. The one thing
that *is* real tables: `bookings` (actual scheduling with date/time
columns, for niches that need real slot-conflict checking).

**The business settings record is `kind='settings', id='settings'`**, one
per tenant, read by `cfg()` in `index.html` and by `public_menu()` /
`public_invoice()` server-side. This exact string match is load-bearing —
`db/017_fix_settings_kind_typo.sql` is the story of what happens when the
client's own save button silently wrote a different `kind` string: the
dashboard still *looked* saved (it reads its own local copy by id, not
kind), but every public-facing surface that queries `where kind='settings'`
saw nothing, silently. If a "my save isn't taking effect anywhere else"
bug ever recurs, suspect this pattern first: local state fooling the UI
into looking correct while the server-side write went somewhere the
readers don't look.

## Feature flags: two layers, and both must actually gate something

`tenant_settings.features` = what a tenant is *entitled to* (AUZlab-
controlled, set at provisioning). `tenant_settings.enabled_features` =
what the *owner* has self-service toggled off among their entitled set
(`update_my_features` RPC, clamped so a client can never enable something
they're not entitled to). The combined check, used consistently as
`featureOn(k)` in `index.html`:

```js
const featureOn = k => !S.features || (S.features[k]===true && S.enabledFeatures[k]!==false);
```

**A feature flag is not real until every layer that matters checks it.**
`db/018_enforce_self_order_feature.sql` is the cautionary tale: turning
"Self-order (QR)" off only ever hid the staff-side guest-order inbox
(`getG()` in the POS) — the actual customer-facing entry point
(`place_order` RPC, `site.html`'s ordering UI) had zero enforcement, so
customers could keep ordering through an already-printed table QR code
after the owner turned the feature off, and those orders landed in the
database invisible to staff. When wiring up a new toggle, check it in
*every* place that feature's behavior surfaces — client UI, the public
page, and the RPC itself (server-side, so it can't be bypassed by calling
the RPC directly) — not just the one place that was easiest to gate.

## Website Builder

A sellable product (`website_builder` feature key) like Payroll — its own
standalone app on the tenant's own login, not a tab inside `index.html`:

- **`app/public/builder.html`** — the drag-and-drop editor (owner-only;
  gated client-side on `featureOn('website_builder')`, checked via
  `my_dashboard` the same way `index.html` does). Pages are just another
  `records` kind, `'sitepage'`, keyed by slug (`'home'`, `'about'`, ...) —
  not a new table, matching the generic-engine philosophy in "The
  `records` table" above. A page's `data.blocks` is the working draft
  (synced continuously via the normal `push_record` path); `data.publishedBlocks`
  is a snapshot copied from `blocks` only when the owner clicks Publish.
  Block reordering is native HTML5 drag-and-drop (no library). Uses the
  same offline-sync engine as `payroll.html`/`index.html` (own IndexedDB
  namespace `builder1`), even though editing a website isn't really an
  offline workflow — consistency with the rest of the codebase mattered
  more than trimming unused code paths here.
- **`app/public/w.html`** — the public renderer. Resolves the tenant from
  the subdomain (`tenant.js`) and the page from `?page=slug` (default
  `home`), then calls the `public_page(tenant_slug, page_slug)` RPC (same
  SECURITY DEFINER pattern as `public_menu`/`public_invoice`, since RLS
  requires a logged-in tenant member and a visitor has no session).
  **Only ever reads `publishedBlocks`, never `blocks`** — a half-finished
  edit can never go live by accident.
- No RLS/`push_record` changes were needed for the write side: the
  `(me()->>'role') = 'owner'` catch-all in `push_record` (db/028's
  version) and the `r_read`/`r_ins`/`r_upd` policies already authorize an
  owner to read/write *any* kind, `'sitepage'` included, for free. This is
  deliberately owner-only — if staff ever need write access, add
  `'sitepage'` to the explicit kind allow-lists the same way
  `db/019_allow_kotlog_kind.sql` added `'kotlog'`.
- **Every new public RPC needs registering in `server/src/index.js`'s
  `RPC` object, or every call 404s with "unknown function."** This isn't
  hypothetical — the entire add-on-request feature (`submit_addon_request`
  and friends) shipped broken this way and went unnoticed until a real
  client hit it, because the Postgres function existed and worked fine in
  isolation; only the HTTP-layer allow-list was missing. `public_page` was
  added to that list in the same migration.

## Local-first sync (the POS app specifically)

The POS (`app/public/index.html`, code in `app/public/pos/core.js` since the
rebuild) is offline-first: writes go to IndexedDB first
(`save()`), then an outbox syncs to the server via the `push_record` RPC
(optimistic concurrency, conflict-resolves by re-pushing with `force:true`
on a version mismatch) — see `doSync()`. `sync()` is fire-and-forget, not
awaited by the UI, so a "Saved" alert firing does **not** mean the server
write actually succeeded; check `push_record`'s error handling / the
`syncErr` counter, not just what the button said. Since db/068 the server
can refuse a write outright (400/403/409, e.g. an unapproved discount or a
change to a paid bill): the POS then drops that outbox item, reloads the
server's copy and shows "Not saved: ..." (`rejectLocal()` in `core.js`),
instead of retrying it forever.

## Known stale doc

`README.md` at the repo root describes an earlier planned architecture
(Next.js in `app/`, `supabase/functions/`) that was never built this way —
the real thing is the plain static-HTML + Node-API stack described above.
Don't trust `README.md` for anything architectural; this file supersedes
it. (Worth fixing/removing the stale parts of README.md at some point —
just flagging it hasn't happened yet.)

## Working style the owner has actually asked for

Two standing instructions given directly in chat, not written down
anywhere else until now — a fresh session should follow both without
being re-asked:

- **Build extensively, talk minimally.** The owner does not want a
  narrated play-by-play of tool calls or a running commentary. Do the
  work, ship it (commit → PR → merge, see below), and only surface a
  message when input is genuinely needed or a batch of work is ready to
  report — one summary at the end, not a message per file edited.
- **PetPooja screenshots are reference, not a spec.** The owner
  periodically shares screenshots of PetPooja (a competitor POS) UI —
  explicitly "for reference purpose only, do not exact copy everything."
  The job each time is: find the genuine functional/UX gap the
  screenshot reveals (not already covered by something AUZslab already
  has), then implement it adapted into AUZslab's own ink/maroon design
  language (see "Design system" above) and existing architecture (the
  `records` table, `push_record`, `featureOn`, etc.) — never clone
  PetPooja's literal layout or copy. When a screenshot turns out to be
  something AUZslab already does (this has happened repeatedly — Split
  Bill, Part Payment, self-order waiter-calling, item recipes/add-ons
  all already existed and just weren't obvious/discoverable), say so and
  point at where it already lives instead of building a duplicate.

## No emoji in the UI — use the icon() helper

`index.html`, `backoffice.html` and `payroll.html` each carry their own
small `ICONS` map + `icon(name, size)` helper (duplicated per file — see
"no shared JS modules" in the file-split note above) that renders a
single-stroke inline SVG line icon (a `<span>` with its `innerHTML` set
to raw SVG, since `document.createElement('svg')` is the wrong
namespace and silently fails to render). This replaced every emoji that
used to sit in button/label text (🔔🍳🍽️🧹📝🔥👤💬📲🚚🎁⭐🔴🟢🟡…) —
emoji render as full-color platform pictograms with wildly inconsistent
style across devices/fonts, which clashed with the flat ink/mono design
the rest of the product uses. **Do not introduce a new emoji character
into any button/label/card.** Adding a new icon means adding an SVG path
string to that file's own `ICONS` map and calling `icon('name')` as a
child alongside the text, not writing an emoji into the string.
The rebuilt POS keeps its `ICONS` map and `icon()` in `app/public/pos/core.js`
(built with `createElementNS`, so it is a real `<svg>`). Color-coding (veg/non-veg, order type, table status) uses `swatch(color)`
(a small colored square) or a `border-left` stripe on the row/card, never
a colored emoji dot. One case wasn't just a rendering choice: `db/045`'s
`call_waiter()` RPC used to store the literal string `'🔔 Waiter called'`
in `guest_orders.note` as its own dedupe marker — `db/048` replaced it
with plain `'Waiter called'`; if you ever match against a `guest_orders`
note string, match the plain-text version.

## Desktop layout: `.g1`, not inline `grid-template-columns:1fr`

Both `index.html` and `backoffice.html` define a `.g1` CSS class
(`display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr))`)
that every full-width dashboard/list screen should use as its container
class. The old pattern — `h('div',{class:'g',style:'grid-template-columns:1fr'},...)`
— forces a single full-viewport-wide column, which looks fine on a
phone but wastes most of the screen on a real desktop monitor (a
two-line "Gross sales ₹7,662" card a few hundred pixels wide with a
huge gutter of empty background next to it). `.g1` lets independent
cards flow into 2–3 columns on wide screens while a single wide card
(or a wide chart/table) still fills the full width, since CSS grid's
`auto-fit` collapses unused tracks; it still collapses to one column on
phones with no media query needed. A chart or table card that needs the
full row regardless of column count gets an explicit
`style:'grid-column:1/-1'` alongside `class:'card'`.

`backoffice.html` also has a small zero-dependency chart kit for
Analytics-style views — `barRow` (horizontal bar), `lineChart`,
`donutChart`, `stackedBarChart`, all in the same raw-SVG-via-innerHTML
style as `icon()`. Reuse these for any new chart rather than reaching
for a charting library; this codebase has a hard "no build step, no
bundler" rule (see "Stack" above) that a library like Chart.js would
break.

## Testing an `app/public/*.html` change before committing

These are single-file HTML documents with one big inline `<script>` —
`node --check` can't run against the `.html` file directly. Extract the
script first, then check it:

```bash
python3 -c "
import re
html = open('app/public/index.html').read()
scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
open('/tmp/idx_check.js','w').write(scripts[-1] if scripts else '')
"
node --check /tmp/idx_check.js
```

The POS is the exception since the rebuild: its code is plain files in
`app/public/pos/`, so check them directly with
`for f in app/public/pos/*.js; do node --check "$f"; done`.

Do this for every file touched (`backoffice.html`,
`payroll.html`, `builder.html`/`w.html`, etc.) before every commit — a
syntax error in one of these ships straight to production the moment
someone runs `git pull` on the VPS, with no build/CI step to catch it
first.

## Recurring git workflow: squash-merge SHA divergence on PRs

Every PR opened from a long-lived feature branch in this repo fails
`merge_pull_request` on the *first* attempt with a GitHub API 405
"Pull Request has merge conflicts" — even when the branch's content is
a clean superset of `main` with zero real conflicts. This happens
because earlier PRs from the same branch were squash-merged, which
creates a new commit on `main` that the branch's own history doesn't
recognize as a descendant, so GitHub's fast-forward/merge check fails
even though there's no actual conflicting change. The fix, every time:

```bash
git fetch origin main
git merge origin/main -m "Merge origin/main (squash-merge SHA divergence)"
# resolve any conflicts -- in practice these are always trivial, a
# single line each, and HEAD's side is the correct superset; keep HEAD
git add <resolved files>
git commit --no-edit   # or with a message if you didn't use --no-edit above
git push
# retry the PR merge -- it now succeeds
```

Don't be surprised by this and don't try to force-push or rebase around
it — merging `origin/main` into the branch (never the reverse) and
resolving in favor of HEAD is the established, repeatable fix.

## Onboarding a real client's menu/inventory via a data-import migration

`db/049`→`052` (Mannat Cafe) is the reference case for "client sends a
PDF/spreadsheet of their real menu and ingredients, import it as a
one-time migration" (same category as `db/010`'s OG Book Cafe import,
but for a brand-new tenant instead of a Supabase migration). Three
things bit this specific import, all worth checking before the next one:

- **Check whether the tenant already exists before assuming your
  migration is the one creating it.** The admin onboarding flow (or a
  platform admin manually) can create a tenant with the target slug
  before your import migration ever runs — `provision_tenant` being
  idempotent (see above) means a second onboarding attempt doesn't
  error, it just silently reuses/updates the existing row. Mannat's
  import script correctly detected this (`if exists (select 1 from
  tenants where slug = ...)`) and refused rather than risk a
  duplicate — but that meant the actual menu import had to become a
  *second* migration (`db/050`) against the pre-existing tenant,
  retiring (soft-deleting, never hard-deleting) whatever placeholder
  content was already there rather than assuming a clean slate.
- **`index.html`'s `seed()` auto-populates a placeholder menu ("Tea"
  category, Masala Tea ₹25 / Coffee ₹49, tables T1–T6) the first time
  any owner opens the POS with zero categories.** If a client's tenant
  was created before their real menu was ready, expect this
  placeholder content to already be sitting there by the time you
  import the real thing — find it by its exact seeded prices (25/49)
  before deleting, so a client's own genuine "Masala Tea" added later
  is never caught by the same cleanup.
- **The `item` record schema has grown fields since `db/049` was first
  written that a bulk-import migration must set explicitly, or every
  item silently gets the default.** `veg` (`'veg'|'nonveg'|'egg'`,
  defaults to `'veg'` when absent — `db/051` is the fix-after-the-fact
  for six chicken dishes that imported with no `veg` key and therefore
  showed under the Veg filter) is the one that's bitten so far; check
  `index.html`'s item editor (search for `i.veg||`, `i.photo`, etc.)
  for the current full field list before writing the next import,
  since this list will keep growing.
- **A tenant's `tenant_settings.features` entitlement can be missing
  a flag the niche preset says it should have**, independent of
  anything an import migration touches — `db/052` (Mannat missing
  `kds`, which hid the Kitchen/KOT tabs) traced back to whatever
  process originally provisioned the tenant, not to the menu import at
  all. If a client reports a whole tab/section missing (not just wrong
  data), check `tenant_settings.features`/`enabled_features` directly
  before assuming it's a code bug — `featureOn()`'s definition is
  above ("Feature flags: two layers").

## Salon niche: a real client (Showoff Salon) migrated from their own Vercel site

The owner's previous client, Showoff Salon (a unisex salon in Jodhpur),
had its own standalone Vercel + Blob-storage site/booking/CRM app —
**`viralwechaar-creator/showoff-salon`** on GitHub is that real app's
source, still there for reference (their exact copy text, `seed.js`
starter menu, `style.css` palette). They were migrated onto AUZslab as
the first real `'salon'` niche tenant, and "Salon" was built as a
reusable niche (not a one-off fork) in the process — the next salon
client reuses all of this with zero new code, just their own settings.

- **A salon tenant's real front door is `app/public/booking.html`, not
  `index.html`.** A salon/gym has no dine-in floor plan or KOT — its
  customer-facing surface is a public booking page, not the staff POS.
  `app/public/land.html` is the niche-aware router the Caddyfile's
  subdomain-root fallback now points at (`try_files {path} /land.html`,
  changed from `/index.html`) — it calls the existing `public_menu` RPC
  to read `cfg.bizType`, then redirects to `LANDING[bizType]` (currently
  just `{salon:'/booking.html'}`) or `/index.html` otherwise. A request
  for a real file (`index.html`, `booking.html`, ...) never reaches
  `land.html` at all — Caddy serves it directly; only the bare
  subdomain root (or a genuinely unknown path) falls through to it. A
  future niche with its own customer-facing front door: add its page to
  `LANDING` here, nothing else, no Caddyfile change needed.
- **`bizType` must actually be set, or every tenant silently defaults to
  `'restaurant'`.** `cfg()` in `index.html` hardcodes that default;
  `niche_presets.default_business_rules` (db/001) never set a `bizType`
  key for any niche until `db/050_fix_biztype_by_niche.sql` fixed it
  (preset going forward + a backfill for already-provisioned tenants,
  gated on `bizType is null` so a deliberately hand-picked value is
  never overwritten). This is what actually caused "salon redirects to
  the staff POS login" the first time a real salon tenant went live —
  the `land.html` router above only works once this field is real.
- **`public_salon_page(tenant_slug)` / `public_salon_slots(tenant_slug,
  date)` / `public_create_booking(...)`** (db/049_salon_public_booking.sql)
  are the anon-callable RPCs `booking.html` runs on — same
  SECURITY DEFINER / tenant-resolved-from-slug pattern as
  `public_menu`/`place_order`. Services/categories are the same
  `kind='item'`/`kind='cat'` records every niche's menu already uses
  (no new table), just with salon-specific optional fields: `cat.gender`
  (`'all'|'female'|'male'`, drives `booking.html`'s Everyone/Women/Men
  filter), `cat.priceLabels` (e.g. `['Normal','Rica']` for a two-column
  price display), `item.price2` + `item.popular`. A booking is a real
  `bookings` row (db/003's dedicated table, not `records` — the one
  deliberate non-generic-engine exception, for real date/time
  slot-conflict checking), with `bookingOpen`/`bookingClose`/
  `bookingSlotMinutes`/`bookingSlotCapacity` read from the tenant's own
  `settings` record (defaults `10:00`/`19:00`/`30`/`1`).
- **`booking.html`'s look is Showoff Salon's exact plum/cream/gold
  palette + Hanken Grotesk *by default*, overridden at runtime from
  `settings.brand`** (`{cream,gold,goldD,taupe,tint,line,muted,font,
  fontUrl}` — deliberately not `plum`/`logo`/`hero`, which reuse the
  already-generic `col`/`logo`/`siteHero` fields every tenant has) —
  so a brand-new salon tenant with no `brand` set still looks
  intentional instead of a blank placeholder, and a *different* salon
  client gets their own full palette just by filling in Settings →
  Booking. `i.html` (the public invoice) reads the same `brand` object,
  gated strictly on `brand` being present (not on `col` alone) so it
  never silently re-themes every pre-existing tenant's invoice that
  happens to have `col` set for an unrelated reason.
- **Reuses existing generic site-settings fields — never invent a
  parallel set.** `siteKicker`/`siteTag`/`siteSub`/`siteAbout`/
  `siteHours`/`siteInsta`/`siteHero`/`siteGallery`(comma-joined URL
  string)/`logo` are the *same* fields `site.html`'s own Settings →
  Website pane already edits for every other niche — `booking.html`
  and the booking-hours/brand-palette fields just add a new Settings →
  Booking pane (shown only when `bizType=='salon'`, via
  `settingsTabs()` in `backoffice.html`) on top of that, not a
  second admin screen.
- **A one-off real client's data seed goes in `db_data/`, never
  `db/`.** `db_data/showoff_salon_seed.sql` (their real 67-service
  menu, transcribed from their own `seed.js`/`style.css` — regenerate
  it from there again if it's ever found incomplete, don't hand-guess
  fields) is deliberately kept out of `db/` (which auto-runs on every
  fresh install — a one-off tenant's menu seeded into every future
  install would be wrong). Apply it by hand, once, the same way as any
  migration but from `db_data/`:
  ```bash
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db_data/showoff_salon_seed.sql
  ```
  Safe to re-run (every insert is `on conflict do update`).
- **The menu editor in `backoffice.html`'s Menu tab must expose every
  field the public booking page can read, or the owner can't actually
  maintain their own menu.** Category creation used to be a bare
  `prompt()` with no edit action afterward at all; `catModal()` now
  covers name + (salon-only) gender/priceLabels/note, and the item
  modal grew a (salon-only) price2/popular pair — both gated on
  `cfg().bizType=='salon'` so every other niche's menu editor is
  untouched. If a new salon-specific field is ever added to
  `public_salon_page`'s RPC output, add it to these modals in the same
  change, or it becomes another thing only a one-off SQL script can set.
- **Historical data migration (their real past bookings/clients/
  invoices) is still unstarted, and genuinely blocked** — the zip/repo
  access available is their application *code* (including `seed.js`,
  which happened to double as real starter menu data), not an export of
  their live Vercel Blob store's actual runtime data. Needs a real data
  export from the owner before this can proceed.
- **Numbering collision, not yet cleaned up:** `db/049_salon_public_booking.sql`
  /`db/050_fix_biztype_by_niche.sql` (this work) and
  `db/049_import_mannat_cafe.sql`/`db/050_mannat_cafe_real_menu.sql`
  (see the Mannat Cafe section above) landed on `main` with duplicate
  numbers from two different sessions' work. Not actually broken (both
  run, in alphabetical sub-order, on a fresh install) but worth
  renumbering one set for clarity before it happens a third time.

## Salon Suite: Showoff Salon's original app, run as-is (supersedes booking.html)

The `booking.html` approach above never reproduced the real site (no
gallery, logo, admin, nav, animations), so salon tenants now run the
**original Showoff Salon app verbatim**: `app/public/salon/` is a copy of
the Vercel repo's `public/` (home, `/menu/`, `/admin/`, `invoice.html`,
`assets/`), with only absolute URLs rewritten to the `/salon/` prefix.
Everything else (typography, palette, nav overlay, admin console,
invoice design) is the original code. To change how it looks, edit it
like the original repo; don't rebuild it in `booking.html`.

- **Routing:** `land.html` sends `bizType=salon` to `/salon/`. Caddy's
  wildcard block also maps `/api/*` to `api:3000/salon-api/*` (tenant
  resolved from the Host subdomain), `/i/<token>` to `/salon/invoice.html`
  (public WhatsApp invoice links), and `/uploads/*` to the uploads volume.
- **API:** `server/src/salon.js` is the original `api/[...path].js`
  ported, multi-tenant. `db/053_salon_store.sql`: one JSON document per
  tenant in `salon_store` (`key='db'`, same shape as the old Blob, plus
  `key='admin'` for lockout state / console password), mutated under a
  row lock. `salon_tenant()` / `salon_owner_hashes()` are SECURITY
  DEFINER lookups restricted to `tenants.niche='salon'`. Deploy: apply
  053 by hand, `docker compose up -d --build api`, `docker compose restart caddy`.
- **Console login** (`https://<slug>.auzslab.in/salon/admin/`): the
  tenant owner's normal AUZslab password works until the owner sets a
  console password via Settings -> Change password.
- **Data:** a salon's first API hit seeds the original `seed.js` menu
  (`server/src/salon-seed.js`). Historical Vercel data: export from
  `/api/admin/export` on the old site, then write that JSON to
  `salon_store` (`key='db'`) for the tenant.
- `booking.html` and the `public_salon_*` RPCs are left in place but unused.

**Storage layout (salon data split, Steps 1 + 2):** a salon's data is two
`salon_store` rows, not one: `'site'` (settings, menu, content, stylists,
gallery, `seededAt`: small, public) and `'data'` (bookings, invoices, expenses,
counters: grows daily). `loadSite()` serves the public pages from a 30 s
in-memory cache that every write clears (`dropCaches`; generation counters stop
a read that raced a write from being cached), and `bookingCounts()` caches
booked-slot counts for the slot picker; concurrent cache misses share one read
(`once()`). `mutate(tenant, fn, parts, write)` reads the halves a handler needs
and locks/saves only the halves it may change (site edits never rewrite bookings
and vice versa). Handlers still see one combined object. Legacy single-`'db'`
salons are split on first use by `initStorage()` (old row kept as `'db_backup'`).
The cache is per process: if the API is ever run as more than one instance, it
needs a shared invalidation (or drop the cache) first. Not done yet (Step 3):
bookings/invoices as individual rows, so a save no longer rewrites the whole
`'data'` row. Measured on a salon with 6,000 bookings + 6,000 bills (4 MB): public
`/site` 22 -> ~700 req/s, `/slots` 23 -> ~750 req/s (20 concurrent, p95 ~1 s -> <0.15 s).

### Salon Suite part 2: staff logins, payroll link, template, demo

- **Staff logins** (`salon_store` key `'staff'`, managed by the owner under
  the console's new **Staff** tab). A staff member signs in on the same
  `/salon/admin/` page via "Staff sign in" (phone number + the password the
  owner set). The session cookie carries `role: 'staff'`. **Enforcement is
  server-side in `salon.js`**: `admin()` (owner only) is the default for every
  endpoint, and only `member()` endpoints are open to staff: `GET /admin/data`
  (filtered: no expenses / website text / gallery, and only their own bills, so
  no revenue totals), bookings create + status change, invoice create, punch,
  own password. No deleting bookings, no voiding bills, no menu / settings /
  uploads / export. The UI hiding the other tabs (`allowed()` in `admin.js`)
  is only the cosmetic half; when adding an endpoint, it is owner-only unless
  you explicitly call `member()`.
- **Payroll link** (`db/054_salon_staff_payroll.sql`): a new staff login is
  attached to an `hr_employee` record (created with zero salary, or linked to
  an existing one) via `salon_hr_ensure()`. Clock in/out on the staff Today tab
  calls `salon_punch()`, which writes the exact `hr_attendance` shape
  `payroll.html` writes (`{empId,date,in,out}`), so hours appear in Payroll's
  attendance and pay run. Salary is set in Payroll -> Employees. All these
  SECURITY DEFINER functions are restricted to `niche='salon'` tenants.
- **Template**: a salon other than `showoffsalon` starts from
  `makeTemplate()` in `server/src/salon-seed.js` (same design, neutral copy,
  compact sample menu, placeholder logo/hero SVGs in `assets/template-*.svg`).
  Branding is per tenant in Settings -> Branding (`settings.logo`,
  `logoLight`, `heroPhoto`, `theme.{plum,gold,cream}`), applied by
  `applyBrand()` in `assets/dom.js` on every page. Limitation: static `<meta>`
  og/twitter tags, the favicon and manifest icons are still Showoff's (they
  can't be per-tenant without server-rendered HTML).
- **Demo** (`db/055_demo_salon.sql`): tenant `demo-salon` (is_demo) with
  owner login `demo-salon@auzslab.in` / `Auzslab@Demo` (same as the other
  demos) and a staff login `priya.demo-salon` / PIN `1234` (db/099). `makeDemo()` adds a
  week of sample bookings, bills and expenses dated relative to today; `salon.js`
  re-seeds the demo (plus its staff login and payroll employee) every 12 h. Demo
  tenants cannot upload files, change passwords, or add staff. Linked from
  `site/business-salons.html` and `site/demo.html`.
- **Deploy** (in order): pull the branch, then
  `psql ... < db/054_salon_staff_payroll.sql`, `psql ... < db/055_demo_salon.sql`,
  `docker compose up -d --build api`, `docker compose restart caddy`.

### Salon Suite part 3: AUZslab Salon as a product, everything else as add-ons

- `salon` is a feature key (the base product; `db/056_salon_product_addons.sql`:
  preset + backfill + `approve_signup_request` now merges
  `{salon,booking,crm,billing}` for niche `salon`, which it used to skip, so a
  salon that bought only Payroll got no base features). It is a cart product
  on `site/products.html` (card 08).
- Payroll, Website Builder, POS, inventory etc. are ordinary add-ons through
  the existing `submit_addon_request` / `approve_addon_request` flow (db/027,
  niche-agnostic). `site/account.html` uses `SALON_SERVICE_GROUPS` for salon
  tenants (AUZslab Salon / POS / Payroll / Website Builder), has an "Add more
  products" card, and a second nav link for the POS add-on.
- The salon console checks the **Payroll add-on** before linking staff:
  `payrollOn()` in `salon.js` (via `salon_features()`, entitled AND not switched
  off by the owner). Without it, staff are created unlinked and cannot clock in;
  the Staff tab shows an "add-ons" prompt; once Payroll is on, each unlinked
  staff member gets a **Link to payroll** button (`PATCH /admin/staff/:id`
  `{linkPayroll:true}`). Switching Payroll off pauses clock-ins but keeps links.
- Deploy: pull, `psql ... < db/056_salon_product_addons.sql`,
  `docker compose up -d --build api`. Static `site/` and `app/public/` changes
  need no restart.

## Marketing site: FX scroll worlds (fx-worlds)

The marketing pages (everything in `site/` except the account tools) are scroll-driven scenes, not stacks of cards.
Plain static files, no library: `fx.css` (layout + type), `fx.js` (engine), `fx-canvas.js` (pencil-particle field +
cursor trail), `fx-phys.js` (draggable bubbles), `fx-ui.js` (pricing stack builder), `fx-art.js` (drawing library),
`fx-pages.css` (per-page scene styling). `sketch.js` still owns the intro loader and sets `html.fx-live`.

- **A scene** is `<div class="fx-scene" data-scene style="--len:6">` (6 screens tall) with a sticky `.fx-stage`
  inside. Children with class `k` are actors: `data-k="p:prop value,...; p:..."` keyframes against scene progress
  0..1 (props `x y` in vw/vh, `z`, `r rx ry`, `s sx sy`, `o`; any other name becomes a CSS variable `--name`, which is how
  drawings scrub `--d` and charts grow `--gy`). `data-km` overrides on phones. A prop not yet mentioned holds its default
  (0, or 1 for `o`/`s`), then holds its last value.
- **Gotchas that cost time:** page rules that position an actor must beat `html.fx-live .k` (prefix with `html`, e.g.
  `html .pd-pos .l1`); actors left/right-anchored need `translate:0 -50%` (the base `.k` centres itself); `sy`/`sx` are
  transform props, so use a different name (`gy`) when you want a CSS variable; world items are selected by
  `[data-xyz]`, not by class (the drawing library already uses `.f`); the camera layers must stay `pointer-events:none`
  or they swallow clicks on the hero buttons; the floating header (z 40) must stay below the menu drawer (z 44).
- **Pages** are generated from the original copy: every page's real text, links, cart buttons (`data-add`/`data-product`)
  and demo credentials are kept; only the layout changed. Account/admin/cart/signup/terms/privacy keep the plain layout.
- **Fallbacks:** with `prefers-reduced-motion` (or no JS) `html.fx-live` is absent and each stage is a normal column of
  the same content; `tests/suites/local/fx.mjs` checks this and scrolls every page end to end.
- **No pinned/scrubbed scenes any more: every width uses the flowing layout inside stacked panels.** `sketch.js` sets
  `html.fx-flow` (`FLOW_MAX` is 99999; `fx-live` only exists if someone lowers it); `fx.js` runs `bootFlow()` (reveal via
  IntersectionObserver `.in`, marquee, counters, split text, draw-in; no scene engine, no particle canvas) and `fx-flow.css`
  lays each scene's actors out top to bottom (desktop proportions in its `@media (min-width:900px)` block). The same sheet
  (`html:not(.fx-live)`) is the reduced-motion / no-JS layout. A new stage-only actor (backdrop, scanning line, duplicate CTA)
  must be hidden in `fx-flow.css`. `data-k` keyframes are ignored in flow.
- **Homepage (`site/index.html`, `body[data-no-stack]`)** is hand-built, not generated: hero (`.hero2`, ends in the big pixel `logo.png`), then **page 2 `.hx`**
  (a pinned stage: How we work, "Eight modules, one login", 8 floating module cards, CTA, with the previous sheet's edge under the header and the next sheets' edges at the
  bottom), **page 3 `.vw`** (four floating "doors"), `.tk` (Let's talk) and the dark CONNECT footer. Styles in `fx-hx.css`. **All scroll motion is CSS scroll-linked
  animation** (`view-timeline: --hx`, `animation-timeline`): the sideways slide, card float/tilt (`--r0/--r1/--dir` per card), progress line and the door float (`--fk`). It runs on the
  compositor; there is deliberately NO scroll listener or per-frame JS (a JS-driven transform lagged behind iOS momentum scrolling and looked like vibration).
  `fx-hx.js` only measures once (`--hx-dist`, card windows) and adds `html.fx-hx`. Browsers without `animation-timeline`, and reduced motion, get a swipeable row
  (`html:not(.fx-hx)`). One type scale, black/white/wine only. Don't add scroll handlers back.
- **Every other marketing page** is wrapped by `fx-stack.js` into layered panels (`.stack-panel.fx-panel`, big tab word, rounded top sliding over the previous
  panel) but **nothing is sticky**: pinned/sticky stacks made the previous panels shake while scrolling on phones, and splitting them didn't help. The fx suite
  fails if a sticky `.fx-panel` comes back. Don't reintroduce `position:sticky` panels.
  On phones: no `mix-blend-mode`, no SVG filters, no fixed full-screen overlays (they cost frames on iOS).
- **Depth + colour:** homepage sheets are off-white hero -> ink page 2 (`.hx`, rounded top sheet edge via `.hx::before`) -> wine page 3 (`.vw`) -> off-white `.tk` -> ink footer; other pages' layered panels cycle off-white / warm grey / wine tint (`fx-flow.css`, `html.fx-stacked`). Depth effects use CSS scroll-driven animations (`animation-timeline: view()`, compositor only, skipped where unsupported). `fx-hx.js` must never read layout (`getBoundingClientRect`) inside the scroll loop: geometry is cached in `measure()`.
- **Intro retired:** the cube loader/blast no longer runs (`SHOW_INTRO = false` in `sketch.js`); the page just opens.
- **Intro blast (old):** `sketch.js` flies particles to elements marked `[data-blast]` (falls back to headings/buttons).

## Staff apps: Apple HIG layer (`app/public/hig.css`)

Back Office and Website Builder link `/hig.css` right after their own inline `<style>` (the POS and Payroll did too until their rebuilds; both now have their own HIG system, see "Restaurant POS rebuild" and "AUZslab Payroll v2" below). It is a restyle only
(no markup or behaviour): system typeface and a real type scale (body 16, nothing under 12), 44pt minimum hit targets on buttons/inputs/tabs,
segmented-control tabs, grouped rounded cards with hairline separators, a bottom-sheet for `.md` modals on phones, soft spring motion,
visible focus rings, reduced-motion support. It was built from Apple's Human Interface Guidelines (repo `NutshellEngineering/apple-design-skill`,
`references/foundations/typography.md`, `components/menus-and-actions/buttons.md`). Tenant colours (`--accent`/`--g`) are untouched. The
marketing site (`site/`) deliberately does NOT use it.

**Standing rule (extended by the design system at the bottom of this file: every staff app also loads `/ds/auz.css` first and `/ds/legacy.css` last when it still uses hig.css): every staff-facing app, current or future (POS, Back Office, Payroll, Website Builder, and any new software the owner adds), links `/hig.css`
after its own `<style>` and is built to the HIG from the start: 44pt hit targets, body 16+, sentence-case labels in the system font (no tiny mono
uppercase), segmented controls for tabs, bottom sheets for modals on phones, no light/heavy weights. When starting a new app, copy the link tags from
`backoffice.html` (or build on `app/public/pos/pos.css` the way the POS does), then check it on a phone-width screenshot. Exceptions: the marketing site and the Showoff-style salon console (`app/public/salon/`, a client's own design). Customer-facing pages (`site.html`, `booking.html`, `order.html`, `i.html`) don't either.

## POS hand-over rules (cashier <-> kitchen <-> sync)

Found by `tests/suites/local/pos.mjs`; keep them true:
- **`records.updated_at` is the concurrency token** (`push_record` compares it for exact equality), so `GET /db/records` serves it as a microsecond ISO string (`handleSelect` in `server/src/index.js`).
  node-pg's default Date (milliseconds) made every pulled record look "changed elsewhere" and pushes were force-overwritten. Never return it as a JS Date.
- **Sync requests that arrive while a sync is running are remembered** (`syncAgain` in `pos/core.js`), not dropped: back-to-back saves (order then kotlog) used to leave the second one waiting up to 30 s.
- **The cart (`S.cur`) is a clone**, the kitchen edits the same order record: `freshCur()` copies the kitchen-owned fields (`kstat`, `preparingAt`, `readyAt`, `dispatchAt`, `deliveredAt`, `servedAt`) into it before pay / KOT / render.
  Otherwise paying wrote the stale clone over the kitchen's state and a paid order re-appeared in the kitchen queue. Any new kitchen-owned field goes in `KFIELDS`.
- The POS never redraws on a timer while someone may be tapping (taps were swallowed): kitchen clocks tick via `data-kt` text nodes and table/occupancy minutes via `data-since`; the only timed `render()` is the 2-minute reservations refresh on Tables/Reservations, skipped while typing.
- Guest orders: a "Waiter called" alert (empty `items`) is only acknowledged, never turned into an order; accepting a guest order refreshes the cashier's open cart if it is the same order.
- Cash payment has one-tap "Exact" / round-note buttons above the denomination counter.

## App logos (AUZslab POS / AUZslab Payroll)

Owner-supplied marks (a slanted stroke plus two stepped pixel squares), recoloured to the brand: POS = ink tile, white mark, bright-wine last square (`#c2183f`);
Payroll = off-white tile, ink mark, wine last square (`#800020`). Files in `app/public/`: `logo-pos.svg|png` / `logo-payroll.svg|png` (horizontal lockup: tile + "Auzslab" + POS/PAYROLL,
`-light` variants for dark backgrounds), `icon-pos.svg` / `icon-payroll.svg` (rounded favicons), `icon-512.png` (POS) / `icon-payroll-512.png` (full-bleed square for
apple-touch/manifest; iOS rounds it). `manifest.json` (POS) and `manifest-payroll.json`. Shown on each app's login card and in the POS side menu. The earlier retro pixel
wordmark lockups were replaced by these; the marketing site keeps the pixel `site/logo.png`.

## Non-technical owner, deploy over SSH from a phone

The person operating this project deploys by pasting commands into
Termius (SSH client) on an iPhone, not from a dev machine. When giving
deploy instructions: give the *exact* copy-pasteable commands, in order,
one command block at a time isn't necessary but don't assume familiarity
with flags, `cd`-ing to the right directory, or that a failed command's
output means what it looks like it means (e.g. `cd: auzslabs-infra: No
such file or directory` usually means they were already inside that
directory, not that it's missing). Always give a concrete way to verify a
deploy actually landed (e.g. `git log -1 --oneline`) rather than just
trusting "I ran it."

### Homepage scroll rules (final, iPhone shake fix)

- Touch devices get **zero scroll-linked motion**: page 2 (`.hx`) is a native swipe row there. The pinned sideways slide and card float
  (CSS `animation-timeline`) exist only inside `@media (hover:hover) and (pointer:fine)`; `fx-hx.js` returns early otherwise.
- The marquee is a CSS animation (`--mq-w`/`--mq-dur` set once in `measure()`), and flow mode runs no rAF loop. Do not add scroll listeners,
  per-frame `getBoundingClientRect`, fixed full-screen layers, or `will-change` sprinkling.
- Every homepage sheet shares `--sheet-r:28px` (rounded top, 28px overlap, shadow). No extra edge bars or `::before` overlaps (they cut the hero logo).
- Sheets are folder-cut with `clip-path: polygon()` on `.hx/.vw/.tk` (straight diagonal shoulder + chamfered corners, `--cut`, `--ch`, `--nx`; no border-radius, no cutter pseudo-elements). The previous sheet must extend under the cut, so each sheet overlaps it by `--cut + --ch` (and `.hero2` pads its bottom by the same). No progress bar on page 2. Static, no scroll motion, no box-shadow.

- **Update (pin on every device):** page 2 (`.hx`) pins and slides sideways on phones too (owner request: first scroll stops "Build" mid-screen, scrolling slides it sideways, then the page continues down). Still pure CSS `animation-timeline` (no scroll listener / rAF); iOS without `animation-timeline` falls back to the swipe row. Card tilt and door float stay mouse-only. `.hx-foot` (inside the stage, shown only when pinned) paints the wine sheet's folder cut at the stage bottom so there is no blank space and the downward scroll continues from exactly that edge; its polygon must match `.vw` (`--nx:62%`). If the shake returns on iPhone, revert by wrapping the pinned block back in `@media (hover:hover) and (pointer:fine)` and restoring the `fine` check in `fx-hx.js`.
- **Card deck (replaces the sideways track while pinned):** with `html.fx-hx`, every child of `.hx-track` (How panel, intro panel, 8 cards, end panel) is stacked in the centre and each one slides off to the left in turn as the user scrolls down (the cards behind sit offset up-right and shuffle forward, like the stacked-cards reference). `fx-hx.js` writes one `@keyframes hxd<i>` per item into a `<style>` (once, in `measure()`) driven by `animation-timeline:--hx`; the pinned scroll length is `(N-1) * 0.5 * viewport height`. Without `animation-timeline`/with reduced motion, the plain swipe row remains. No swipe is needed: scroll down only.
- **Sheet stacking (supersedes the deck/pin notes above where they differ):** "How we work" is its own sheet `.hw` (original look, not a card). With `html.fx-hx`, `.hw` and `.vw` are `position:sticky` with `top: min(0, 100svh - height)` (`--pin`, set once in `fx-hx.js` `pins()`), so they stay pinned while later sheets overlay them. `.hx` (the card deck, N = intro panel + 8 cards + end panel) is transparent, so the deck rises over the pinned How page; then `.vw` (four doors) rises over everything and pauses, then `.tk` overlays it. Sticky is only enabled with `html.fx-hx` (tall sticky sheets are unreachable otherwise). `--sl` must stay on `:root` (the `.hx-foot` clip uses it).
- The pinned `.hw` sheet sticks at `top:104px` (not 0) so its folder cut stays visible under the fixed header instead of hiding behind it.

## POS workflow study (PetPooja PDF) -> what was added, and what already existed

The owner's `Pos_workflow.pdf` (a reverse-engineering study of PetPooja) was compared against what AUZslab already had; most of it already existed (reports, day close, expenses, shifts, wastage, stock adjust/transfer, purchase orders, vendors, memberships, CRM, KOT report, variants, combos, recipes). Added (db/057 + POS + Back Office):
- **Cash drawer** (`kind='cashmove'`, `{d,type:'in'|'out',who,amt,note,by,at}`, db/057 allow-lists it): Back Office -> Reports -> Day report -> "Cash drawer". Expected cash = cash sales + top-ups - expenses - withdrawals, used by the day report and Day close.
- **Activity log** (Reports -> Activity log): merged, filterable, exportable feed of voids, cash movements, day closes, expenses, wastage and stock changes. No new kind; it reads existing records.
- **Advance orders**: POS order card -> "Schedule for later" sets `order.adv` (ISO time); held orders with `adv` list under "Advance orders" on the Orders screen (not in "Open orders") and "Start now" opens them in the cart.
- **Live strip** on Orders: running orders/tables, in kitchen, ready, out for delivery, advance.
- **Bulk menu actions** (Back Office -> Menu -> Select): price +/-% or +/-rupees (also sizes, price2), sold out / available, veg / non-veg / egg.
- **Apple HIG**: iOS tab bar on phones in the POS (superseded by the POS rebuild: `tabBar()` in `pos/shell.js`, `.tabbar` in `pos/pos.mobile.css`).
- Not built (needs aggregator integrations or multi-outlet): Zomato/Swiggy channels and commissions, per-channel menus and area prices, multi-outlet / device mapping, production masters, 2FA. If asked, plan them as separate pieces.
Deploy: `psql ... < db/057_cash_drawer_moves.sql` (no API rebuild; static files only).
- **Sheets, final model (owner screenshots):** `html.fx-hx` pins the three folder-cut sheets `.hw` (How we work), `.vw` (four doors) and `.tk` (Let's talk) with `position:sticky; top:var(--pin)` (`--pin` = 20% of the viewport, 120-200px, set in `fx-hx.js`), so their cuts stack at one place under the header and each new sheet covers the previous. `.hx` (the card deck) is pulled up by `100svh` so its transparent stage is already pinned over `.hw`; cards travel across the screen one at a time (enter from the RIGHT, cross the centre, leave left, partial overlap, last stays centred). The four-door cards do the same from the LEFT inside `.vw` (`.vw-pin` spacer after `.vw` supplies the scroll length). All keyframes are generated once by `deckCss()` in `fx-hx.js` and driven by `animation-timeline: scroll(root block)` with pixel ranges (A..B) computed in `measure()`; there is no scroll listener or per-frame JS. Anything that changes layout above these sheets must keep `measure()` re-running (it already runs on resize, load and fonts ready).

- **POS app shell (superseded by the POS rebuild; kept for history):** `render()` in the old `index.html` built `.shell` = fixed `.top-bar` + scrolling `.shell-body` + `.ios-tabs`, a `100dvh` flex column, instead of fixed-positioning the bar over a page that scrolls (on iPhone the fixed bar floated above the bottom edge). The scroll position of `.shell-body` is saved and restored across `render()`. The cart bar is `position:sticky` inside the body, not fixed. Don't add `position:fixed; bottom:0` elements to the POS; put them in the shell.
- **Fix (owner screenshots):** the "One login for all of it" call to action now lives inside the pinned `.hw` sheet (`.hw-cta`), every deck card leaves at the end (`deckCss(..., exitAll)`), and `.hx-foot` is hidden: anything left on the `.hx` stage scrolls up with it when it unpins and looked like a folder cut going upward. `.tk` has its own warm-grey tone (`#e9e4df`) so its cut reads against the page background, and the footer (`.stack-panel-dark`, z 6, min-height viewport minus `--pin`) rises over and hides all pinned cuts.

## Admin dashboard (`app/public/dashboard.html`) — separate from the billing POS

The owner's "AUZS LAB POS" admin dashboard design (reference screenshot + clickable prototype) is its own standalone app at `/dashboard.html` (owner/manager only; reached from the POS drawer's "Admin Dashboard" and the Back Office). It is read-only: its own IndexedDB (`dash1`, so it never moves the POS's sync cursor) pulls `records` the same way the other apps do, and everything on the Dashboard is computed live from orders / items / exp / cashmove / voidlog (today's revenue vs yesterday, payment split, channels, online orders by `order.src`, sales trend by hour, top / low items, margins from recipe costs, expenses and cash flow, revenue leakage, 7-day snapshot). Daily Operations pages (Live Orders, All Orders, Online Orders, KOT, Due Payment) are real; the other sidebar groups link into the existing Back Office tabs. The look follows the owner's reference (soft off-white page, blue accent, pastel icon tiles), deliberately NOT the marketing palette; it has its own CSS, no hig.css. Not tracked, so they show 0: shifted orders, reprinted bills; "Target Margin" reads `settings.targetMargin` (default 70). The billing POS (`index.html`) is the next separate piece the owner will redesign.
- **Desktop (>= 900px wide) skips the pinned deck entirely** (`measure()` in `fx-hx.js` returns early, so no `html.fx-hx`): How we work in three columns, the eight modules as a 4-column grid, the four doors in a row, Let's talk, all as plain stacked folder-cut sheets with just the reveal fade. The deck/sticky stacking is for phones and tablets only; on a laptop it left a single card in a huge empty area and the How text peeking between cards.

## Admin console (`app/public/dashboard.html` + `app/public/console/`) — full back-office in the owner's reference design

`dashboard.html` is now only a shell; the app is `console/` (`console.css` + plain scripts, no build): `core.js` (state `S`/`R`, `PAGES` registry, `NAV`, hash routing, UI kit: `formModal` with field types incl. `node`/`multi`/`chips`/`image`, `table`, `kpis`, charts, outlet switcher, sync engine) and one module per sidebar group: `p-dashboard` (Dashboard + Daily Operations), `p-menu`, `p-inventory`, `p-finance`, `p-reports`, `p-team`, `p-crm`, `p-marketing` (Marketing + Aggregator centre + Integrations), `p-mgmt` (Management + Quick Links). A page = `PAGES['group/name']=()=>[nodes]`; add it to `NAV` in `core.js`. Owner/manager only. Look follows the owner's reference layout, but SUPERSEDED for colour: the console now uses the shared design-system tokens and the business accent (no blue theme), see the design-system section at the bottom.
- **Own IndexedDB `dash2`** (rec/out/meta) with an outbox that pushes through `push_record` (same as the POS) so it never moves the POS's sync cursor. Everything is `records` kinds; settings writes (`saveSettings`) are owner-only.
- **Multi-outlet:** `OUTK` lists per-outlet kinds (order, kotlog, exp, cashmove, waste, adjustment, transfer, ing, po, purchase, shift, dayclose, table, voidlog, closing). They carry `data.outlet` (`'main'` when absent). `L(kind)` filters by `localStorage.outlet` (`'all'` = unfiltered), `rawL` never does, `save` stamps the outlet. Outlets are `kind='outlet'`; items can override per outlet with `outletPrice{}`/`outletOff{}`. The POS (`index.html`) and Back Office carry the same `OUTK`/`L`/`save` logic and the POS has an outlet picker in its drawer. New per-outlet kind: add it to `OUTK` in all three files.
- **db/058_admin_console_kinds.sql** allow-lists the new kinds for managers (outlet, variant, po, device, addongrp, tax, settlement, platform, giftcard, segment, campaign, closing, quicklink). Deploy: `git pull`, run 058 with the `< file` redirect form; no API rebuild.
- **Aggregators and marketing are manual-but-real:** no Zomato/Swiggy API. Staff enter online orders (`onlineOrderForm`, an `order` with `src` = platform, `extRef`), commission % lives in `kind='platform'` and feeds settlements/reports. Campaigns/segments send nothing server-side: `sendCenter` opens `wa.me` / `sms:` links one customer at a time. Gift cards, memberships, tickets, tasks, attendance (`shift`) and payroll links reuse existing kinds.
- Test: `tests/suites/local/apps.mjs` opens every `flatNav()` page, checks for `undefined`/`NaN`, and checks outlet filtering.
- **Extras layer (`console/p-extras.js`, loaded last):** wraps `render`/`topBar` (reassigned function declarations), so every page gets Star/Print/Share page tools, click-to-sort headers and a CSV button on every table card, plus a top-bar search/command palette (`/` or Ctrl/Cmd+K), Quick add, and an Alerts panel (`alerts()`: low stock, expiring, dues, overdue tasks, tickets, memberships, sold-out, birthdays, unsynced). `extend(pageId, fn)` appends cards to an existing page without editing its module; use it for new per-tab tools. Also owns `rep/gst` (GST summary).

## Homepage Apple HIG layer (`site/hig-home.css`, homepage only)

Owner asked for the marketing homepage to follow Apple's HIG header to footer (this supersedes the earlier "marketing site does not use HIG" note, for `index.html` only). It is a restyle layer loaded last, scoped to `body.home`: translucent hairline header, 44pt controls, filled/tinted pill buttons (the `.btn::before` outline is hidden), sentence-case 15pt eyebrows instead of mono capitals, body 17-19, tight display tracking, 28pt cards with one soft shadow, 44pt footer links, focus rings, reduced motion. The folder-cut sheets, pinned deck and palette (white/ink/wine) are unchanged. Other marketing pages are not restyled.

## Marketing subpages: Apple calm layer + folder-cut sheets (`site/hig-site.css`, `site/hig-site.js`)

Every `body.fx` page except the homepage loads `hig-site.css` (last in `<head>`) and `hig-site.js` (deferred, after `fx-stack.js`). It restyles only: translucent hairline header, filled/tinted pills, sentence-case labels, medium-weight type at phone sizes (no giant caps, no outlined text, no letter-by-letter split animation), 44pt footer links, and the **homepage's folder-cut sheets for every stacked panel** (`html.fx-stacked .fx-panel`: clip-path cut, 58px overlap, `--nx` cycles 40/62/22%, NOT sticky). Colours: off-white / warm grey alternating, the closing panel (`.stack-panel-dark.fx-panel`) is wine with white type, the footer panel is ink with a visible CONNECT word. The JS adds `.hig-soft` (soft rounded card) to anything that had a hard offset shadow or a 2px+ border (not `.k` illustration actors), removes text strokes, and cuts long plain paragraphs to their first sentence (full text kept in `title`; skipped inside faq/details/footer/forms/demo/legal and anything with `.keep`). To keep a paragraph whole, add `data-keep` or `class="keep"`.
- Homepage on phones: sheets use `100lvh` min-height (svh left a gap when Safari's toolbar collapsed); the first door card is centred when the doors sheet pins (`deckCss(..., centreFirst)`); Let's talk rises 9svh under the last door; the Knock button is a 52px round icon (font-size 0) on phones.
- POS (old single-file version, superseded by the POS rebuild): `.shell` was `position:fixed; inset:0`, a floating pill tab bar and a drawer. The rebuilt POS keeps `.shell{position:fixed;inset:0}` and its `h()` skips `null` children.

## Separate phone and desktop designs: every stylesheet is two files (`*.mobile.css` / `*.desktop.css`)

**Every stylesheet named elsewhere in this file (`theme.css`, `fx.css`, `fx-flow.css`, `fx-hx.css`, `fx-pages.css`, `sketch.css`, `hig-home.css`, `hig-site.css`, `app/public/hig.css`, `app/public/console/console.css`) no longer exists as one file.** Each is now `<name>.mobile.css` (0-899px: phones and tablet portrait) and `<name>.desktop.css` (900px and up), linked with `media="(max-width:899px)"` / `media="(min-width:900px)"`. The same split was applied to every inline `<style>` block in the site and app pages (two `<style media=...>` tags). They are independent copies: **edit the phone file for phone changes and the desktop file for desktop changes; never expect an edit in one to reach the other.** Width media queries were resolved per device (rules that can never apply were dropped; partial ranges such as `max-width:700px` or `min-width:1100px` were kept), so output was pixel-identical at the time of the split (checked with screenshot hashes of every marketing page at 390, 820 and 1440 wide).
- New CSS: add it to both files, or to the one device it is for. A stylesheet with no width-specific rules stays a single file. `site/design-system/ui-kit.css` was left whole (the nav-kit demo page links it directly).
- `tools/split-css.mjs` is the one-off splitter (idempotent; skips already-split pages). Only re-run it on a page that still has a combined `<link>`/`<style>`.
- The service worker precaches `/hig.mobile.css` and `/hig.desktop.css`.
- Desktop marketing design lives in `site/hig-site.desktop.css` (type scale, three-column card grids, plain pricing cards, larger folder cuts); phone design in `site/hig-site.mobile.css` + `hig-home.mobile.css` (homepage). Product pages' "What's included" lists (`.featsec.orbit .ring`) were hidden on every device by the `.ring` decorative-actor rule in `fx-flow`; both hig-site files now force them visible.
- Not yet redesigned per device: Back Office, Builder and console have separate phone/desktop files but still share today's layout; their desktop-specific design is the next step (screenshot-driven). The POS has its own phone and desktop layouts since its rebuild (`pos.mobile.css` / `pos.desktop.css`).

### Subpage sheets pause and cards float in from the side (phones)
Owner request: on phones every stacked sheet after the hero is `position:sticky` (`hig-site.mobile.css`) with `top:min(var(--pin), 100lvh - var(--h))`, so the next folder-cut sheet slides up over a paused one (a sheet taller than the screen scrolls until its bottom shows, then pauses). `hig-site.js` `pins()` writes each sheet's `--h` once (load, fonts ready, width change; no scroll listener). Cards (`.sw-card`, marked by `cards()` in `hig-site.js`) float in from alternating sides with a CSS scroll-driven animation (`swIn`, `animation-timeline:view()`, compositor only, skipped under reduced motion). Desktop keeps plain stacked sheets (the fx suite now asserts pinned on phones, not pinned on desktop; the old "never sticky" rule is superseded). If iPhone scrolling shakes again, remove the `position:sticky` rule from `hig-site.mobile.css` and nothing else.
- **Smooth-scroll rules for the pinned sheets (owner reported vibration on iPhone):** never `clip-path` a tall or sticky sheet. The folder-cut tab is a small pseudo-element (`::before` on `.fx-panel`, `::after` on the footer panel; on the homepage `.hw/.vw/.tk` use `::before` = clipped tab, `::after` = flat body, both `z-index:-1` with `isolation:isolate`) and the sheet itself is a plain rectangle. `.stack-panel{overflow:hidden}` from theme.css must stay overridden (`overflow:visible; overflow-x:clip`) or the tabs are cut off. The fixed header has no `backdrop-filter` blur (re-filtered every frame over moving sheets). Don't add `will-change`, filters, blend modes or scroll listeners here.
- **Swipe rows + contrast:** `cards()` in `hig-site.js` wraps 3+ cards in one container into `.sw-row` (a horizontal scroll-snap row, cards 78% wide) on phones; the `swIn` float-in only applies to cards that are not in a row. Alternate sheet colour is `#e2dad2` (clearly darker than `#f6f4f1`) and each sheet has a 1px top hairline so the folder cuts read at a glance. Pages without `.fx-panel` (account, admin, cart, demo, signup, terms, privacy) are tool pages and keep the plain layout.

### Homepage on phones: `fx-stk` (supersedes the pinned card deck on phones)
Owner reported continuous vibration on the homepage on iPhone. On widths < 900 `fx-hx.js` no longer runs the scroll-linked card deck (no `html.fx-hx`, no `deckCss`, no `.vw-pin`); it adds `html.fx-stk` and writes `--pin` and each sheet's `--h` once. The four homepage sheets `.hw` (ink), `.hx` (wine, modules as a swipe row), `.vw` (ink, doors as a swipe row), `.tk` (cream) are CSS-sticky with `top:min(var(--pin),100lvh - var(--h))`, flat rectangles plus a small clipped tab pseudo-element (see smooth-scroll rules above), and contain **no scroll-linked animation at all**. Desktop (>= 900) is unchanged. The old `html.fx-hx` rules in `fx-hx.mobile.css` are now dead on phones. Subpage sections inside a sheet have only 14px of their own vertical padding (was ~100px) so there are no big gaps between sheets.
- POS bottom tab bar is attached to the bottom edge, not floating: a floating bar left a grey strip under it on iPhone (still true in the rebuilt POS: `.tabbar` is the last row of the `.shell` flex column).

## Marketing site reverted to the PR #79 design (owner request); what is kept
Owner asked to undo every marketing-site design change made after PR #79 (FX worlds, stacked folder-cut sheets, Apple HIG layers, split stylesheets, desktop layer) while leaving all software untouched. **The `site/` folder is now the PR #79 state** (single `theme.css` etc., plain pages), except:
- `pos.html`, `billing.html`, `business-cafes.html`, `products.html` are restored to their last pre-Apple scroll-scene versions (till receipt, tax invoice, KOT ticket, "Pairs well with", the physics Products page with every product on one page). Their private copies of CSS/JS live in `site/kept/` (do not merge them into the root files: the root `theme.css` is the #79 one).
- Tool pages `account/admin/cart/signup/terms/privacy/demo` keep their current feature code and use current asset copies in `site/tool/` (split `theme.mobile/desktop.css`, etc.).
- The `fx` test suite was removed (`tests/suites/local/fx.mjs`); `marketing.mjs` is the #79 version. Everything under `app/`, `server/`, `db/` is unchanged (POS, Payroll, console, Back Office keep all current design). The notes above about FX worlds, homepage sheets, hig-site/hig-home and subpage stacking describe code that is no longer on the live site; it remains in git history (before PR for branch `revert-site`).

## AUZslab Accounting (feature key `accounting`): a real double-entry system, not the `records` engine

Built from the owner's "Complete Accounting Software Architecture and Master Prompt" PDF. Standalone staff app at `app/public/accounts.html`
(+ `app/public/accounts/`), public share page `app/public/bill.html`. Needs a connection (it is NOT offline-first: posting is server-authoritative).
- **Database (db/059-065)** uses real tables, not `records`: `acc_org`, `acc_fy`, `acc_accounts` (chart of accounts, posting engine finds accounts by `system_key`),
  `acc_parties` (customers + suppliers), `acc_products`, `acc_documents` + `acc_doc_lines` (invoice, credit_note, bill, debit_note, expense; non-posting quotation,
  sales_order, delivery_challan, purchase_request/order, goods_receipt), `acc_journals` + `acc_journal_lines`, `acc_payments` + `acc_allocations`, `acc_stock_moves`,
  bank (`acc_bank_txns`, `acc_recons`), `acc_fixed_assets`, `acc_einvoice`/`acc_eway`/`acc_gst_periods`/`acc_gst_recon`, `acc_audit`, `acc_recurring`, ...
  Money is `numeric(16,2)`, qty `numeric(16,3)`, never floats. All tables are tenant-scoped with read-only RLS; **nothing is written except through SECURITY DEFINER
  functions**, each starting with `acc_guard(perm)` (re-checks entitlement `features.accounting` AND the owner's `enabled_features` switch AND the role: lesson from db/018).
- **Posting is one transaction**: `acc_save_document` -> `acc_do_post` builds the journal, stock moves, COGS, GST lines, allocations; any failure rolls everything back.
  A deferred constraint trigger requires every journal to balance; triggers make journals, journal lines, stock moves, audit and depreciation rows append-only and
  stop edits to posted documents. Cancel = reversing journal (`acc_cancel_document`), never delete. Draft posting documents get `DRAFT-xxxx` and take the gapless
  number (`INV/2026-27/00001`) only when posted. Period lock (`acc_org.lock_date`), closed years and GST return periods marked filed all refuse postings.
- **GST is configuration**: rates come from `acc_taxcodes`; every line stores the rate it used. Intra vs inter-state from org/branch state vs place of supply; reverse charge,
  ITC eligibility, composition/unregistered orgs (no tax), overseas (zero tax). Reports are working papers; AUZslab does not call the GST portal. E-invoice/e-way: the DB
  builds the NIC JSON payload and records the IRN/EWB you paste back (idempotent, cannot be overwritten); no provider is called.
- **Inventory** is perpetual, moving weighted-average cost across warehouses; the inventory ledger account moves only with stock (manual journals to it are refused).
  `acc_integrity_check()` (Settings > Books health check) proves: journals balance, ledgers tie to documents, AR/AP control = party outstanding, inventory = stock valuation,
  output GST reproduces from documents. The test suite runs it after every scenario.
- **Permissions** (`acc_perm`): owner all; manager all but `acc_admin`; default cashier `acc_view`+`acc_sales`; a custom role (profiles.role_id -> roles.permissions) gets exactly
  the `acc_*` keys ticked (keys added to `PERM_KEYS` in site/account.html). Approval limit: `settings.approval_threshold`.
- **API**: every `acc_*` function is registered in `server/src/index.js`'s `RPC` object (generated from the SQL signatures; `defaults` carries SQL defaults because callRpc sends
  null for missing args). Add a new function => add it there or it 404s. Internal helpers (`acc_do_post`, `acc_post_journal`, ...) are deliberately NOT registered.
  Business-rule errors (SQLSTATE P0001/ACxxx/22/23) now return HTTP 400 (42501 -> 403, 28000 -> 401), not 500. Attachments: `POST/GET /storage/acc` (private, tenant from session).
  Public RPC `public_acc_document(token)` backs `bill.html` (unguessable share link, revocable).
- **Imports** are `acc_import(entity, rows, commit, strict)`: the dry run is the same code path rolled back (`AC999`), strict mode is all-or-nothing. XLSX is read/written in the browser
  (`core.js`, zip via DecompressionStream), CSV likewise. No background worker exists: imports are synchronous (chunked by the UI), recurring documents are created when someone
  opens Accounting (or "Run due now"), reminders/emails open WhatsApp or the mail app and are logged in `acc_comms` (no SMTP is configured, so nothing claims "sent").
- **Demo**: db/064 creates tenant `demo-accounts` (demo-accounts@auzslab.in / Auzslab@Demo), seeded through the real engine with clearly marked demo data; `acc_bootstrap()` rebuilds it
  every 12 h (`acc_reset_demo`, the only code allowed to delete from the append-only tables, and only for `is_demo` tenants).
- **UI** is Apple HIG from the start (it does not link `hig.css`; it has its own tokens): `accounts.css` (tokens, components, dark mode, print) + `accounts.mobile.css` (tab bar, bottom sheets,
  large titles, lists instead of tables) + `accounts.desktop.css` (sidebar, toolbar, tables, centred sheets). 44px targets on touch (40px under a pointer), nothing under 12px, sentence case,
  segmented controls, sheets, alerts for irreversible actions (post/cancel ask first). Pages register with `page(id, {title, icon, perm, render(view)})` in `p-*.js`; `dataView()` renders a
  sortable table on desktop and a grouped list on phones; `h()` never uses innerHTML.
- **Deploy**: `git pull`; then `psql ... < db/059_accounting_schema.sql` ... through `065` IN ORDER (use `<`, not `-f`); `docker compose up -d --build api` (server changed);
  enable per tenant: `update tenant_settings set features = features || '{"accounting":true}' where tenant_id = (select id from tenants where slug='<slug>');` (or tick Accounting in the platform
  admin's client editor). The tenant owner opens `https://<slug>.auzslab.in/accounts.html` once to set it up.
- **Known limits (honest list)**: no MFA; no real background jobs or outbound email; no GST-portal/IRP calls; no multi-currency; bank feeds are statement-file imports; the demo-account
  bootstrap and the 12 h reset run lazily on the next visit; tests: `node tests/run-local.mjs accounts` (49 checks including the integrity invariants, permissions, GST, import, phone/desktop/dark screens).

- **Business identity on documents (Accounting):** Settings -> Organisation holds `acc_org.settings.brand` = `{logo, signature, stamp (small PNG data URLs, shrunk in the browser), upi, website, bank:{holder,name,account,ifsc,branch}, regs:[{k,v}]}`. It is drawn by `invoiceSheetNode()` / `identityFoot()` in `p-docs.js` (print) and by `bill.js` (public link; `public_acc_document` returns `org.brand`, db/067). The UPI pay-now QR (balance due filled in) uses the vendored `app/public/vendor/qrcode.js` (qrcode-generator, MIT), no CDN. Images live inside the org row on purpose so the logged-out share link can show them.

## Restaurant POS rebuild (`app/public/pos/`, db/068)

Built from the owner's "Restaurant POS Master Audit Build Prompt" with an Apple HIG look ("easy, minimal, premium").
The full audit, the 42-area gap matrix (before/after with evidence), the build log and the backlog are in
`docs/POS_AUDIT.md`: read it before changing the POS, and keep its "After" column honest when you close a gap.

- **Files.** `app/public/index.html` is now a 42-line shell; the code is one plain script per area in `app/public/pos/`
  (no modules, no build; loaded in order, sharing globals): `core.js` (state, `h()`, `icon()`, records/outlets, settings
  defaults, permissions, IndexedDB `pos3` + outbox sync, numbering, `tot()` billing math, order helpers), `ui.js` (sheets,
  alerts, toasts, segmented controls, steppers, keypad, `approve()` manager PIN), `print.js`, `sell.js`, `pay.js`,
  `tables.js`, `kitchen.js`, `orders.js`, `reserve.js`, `register.js`, `staff.js`, `shell.js` (navigation, banners, QR
  guest orders, sign in, boot). Record shapes and the sync protocol did not change, so Back Office, the console,
  the dashboard, QR ordering and `i.html` read the same data. Bump the `?v=` on the script/CSS tags in `index.html`
  and the `V` version in `sw.js` when you change these files (the service worker precaches them).
- **Design.** `pos/pos.css` (tokens, light and dark, every component) + `pos.mobile.css` (0-899px: tab bar, single-column
  selling screen with a cart bar, bottom sheets) + `pos.desktop.css` (sidebar, three-pane selling screen, centred
  sheets). It does NOT link `hig.css`: it is its own HIG implementation. The business colour is set as `--brand`
  (`applyTheme()` in `core.js`); CSS derives `--accent` from it, and dark mode uses `--brand-dark`/`--brand-dark-text`
  (same hue, lifted) so deep colours stay readable on black. No `prompt()`/`confirm()`/`alert()`: use `sheet()`,
  `alertBox()`, `confirmBox()`, `promptBox()`. No emoji.
- **Server rules (db/068), enforced in the database, not the UI:**
  - `push_record` checks the stored kind as well as the new one (only the owner may change a record's kind) and asks
    `pos_kind_ok()` per role (the RLS insert/update policies use it too). New staff kinds: `register`, `waitlist`.
    Staff field-level exceptions: marking a table clean, and retail variant stock (`variants[].qty/usage`).
  - Trigger `records_order_guard`: paid and void bills are frozen; refunds/exchanges are append-only and capped at
    the bill; void, refund, return, credit, complimentary, manual discount above `maxDiscountPct` (0 = every manual
    discount) and removing items already sent to the kitchen need billing permission or a signed approval. Splits
    are allowed because they log a `moves` entry. The approval fields it reads: `voidApprovedBy`,
    `refunds[].approvedBy`, `returnApprovedBy`, `lastCancelApprovedBy`, `creditApprovedBy`, `compApprovedBy`,
    `disc.approvedBy`. A new money action on orders needs a field here and a check in the trigger, not just a UI gate.
  - Approvals: `pos_set_pin` (owner/manager, 4-8 digits, bcrypt), `pos_verify_pin` (throttled 5 per 5 min) and
    `pos_sign_approval` return `{id,name,role,action,exp,token}`; the token is an HMAC over approver, action, record id
    and expiry with a per-tenant secret (`pos_secrets`). `pos_pin_status()` tells the POS whether anyone has a PIN.
  - `pos_audit` is append-only and filled by a trigger on `records` (bills, refunds, discounts, voids, moves, kitchen
    cancellations, settings, prices, coupons, gift cards, cash, registers, day close). A failure to audit writes an
    `audit_error` row instead of blocking the sale. Console: Management > Audit log.
  - `next_kot_no(day, outlet)`, `claim_guest_order(id, status)` (one till wins), `redeem_giftcard(code, amount, order)`
    (row lock, idempotent per order + amount). All registered in `server/src/index.js` `RPC`.
  - Reservations use `bookings` (+ `party_size`, `note`, `source`, `outlet`; statuses `seated`, `no_show`); the
    overlap constraint ignores cancelled/no-show/completed; a clash is HTTP 409. `server/src/db.js` returns Postgres
    `date` as `'YYYY-MM-DD'` (a JS Date shifted reservation days in IST).
- **Billing math** lives in one place, `tot()` in `core.js`: line tax from the tax master (or the default rate),
  inclusive prices (`tax.inclusive` or `settings.taxInclusive`), service charge on dine-in (`serviceChargePct`, removable
  per bill), packing on takeaway/delivery, delivery charge, all taxed at `chargesTax ?? tax`, round off unless
  `roundOff === false`. Returns `{sub,d,tax,round,total,net,rates,svc,pack,deliv}`; `i.html` and `rcpt()` print the
  same fields.
- **Test:** `node tests/run-local.mjs pos` (26 checks: workflow, approvals, server refusals by direct RPC, phone layout
  on every tab, audit rows). Before committing, `node --check` every file in `app/public/pos/`.
- **Deploy:** `git pull`, then `psql ... -v ON_ERROR_STOP=1 < db/068_pos_rebuild.sql` (after 065-067), then
  `docker compose up -d --build api`. Each owner/manager then sets an approval PIN once (POS > Staff & settings).


## AUZslab design system for the staff apps (`app/public/ds/`): one look for POS, console, Back Office, Payroll, Accounting

Owner request: one consistent, minimal, Apple-HIG experience across the POS, Payroll and Accounting, with consistent colour.
Full audit, navigation map, layout tiers, the feature-parity register and the known gaps are in `docs/UI_REDESIGN.md`.
- **`ds/auz.css` holds every token** (accent, warm-neutral surfaces `--bg #f5f4f2`, charcoal `--label`, state colours,
  type scale, spacing, radii, shadows, `--hit`, `--side-w`/`--rail-w`, dark mode). Every staff page loads it first. App CSS
  must not define its own colours: use the tokens, and add a token there if one is missing.
- **The accent is the business colour.** `ds/brand.js` exposes `auzBrand(colour)`, `auzBrandFrom(settings)` (colour, else
  the niche default, else wine `#800020`) and `auzBrandLoad(sb)` (reads the `settings` record, for Accounting). It remembers
  the last colour in `localStorage['auz.brand']`. POS, console, Back Office and Payroll call it from their settings, so a
  business sees the same accent in every app. The design suite asserts this.
- **Each app maps its own names to the tokens.** POS: none left. Accounting: `--tint` (fill) / `--tint-text` (text, lifted
  in dark mode). Console: `retoken`ed (no hex colours left in `console/*.css|js` except the logo). Back Office and
  Builder: `ds/legacy.css` (loaded last) maps `--ink`, `--l`, `--g`, `--hig-*` and adds the shared shell. These three are
  `<html data-theme=light>` until their inline colours are retokened.
- **Layout tiers:** compact < 600, medium 600-899 (tablet split views: the POS shows items and the order side by side),
  expanded 900-1199 (72px icon rail), wide >= 1200 (240px grouped sidebar). The POS and Accounting have a sidebar toggle
  (`pos.side` / `acc.side`). The files are still split at 900 (`*.mobile.css` / `*.desktop.css`), and the 600 and 1200 tiers
  are `@media` blocks inside them.
- **Navigation is grouped by task.**
  - POS: Service / More / Back office (deep links to console Overview, Inventory, Reports, Menu, plus Payroll and Accounting).
  - Console: Overview / POS & Orders / Inventory & reports / Manage / Other apps (`['href',...]` NAV entries are plain links).
  - Accounting: Sales / Purchases / Accounts / Financial reports / Inventory / Tools / Other apps.
  - Payroll (v2, `shell.js`): HR `NAV_HR` = Today / People (People, Time, Leave) / Pay (Payroll, Advances and loans, Expense claims, Government dues) / More (Reports, Settings); staff `NAV_ME` = Today, My time, My leave, My pay, Profile, My team.
- **POS keyboard:** `?` shortcuts, `/` item search, `N` new order, `Alt+1..9` sections.
- **Tests:** `node tests/run-local.mjs design` (tokens, the same accent across apps, no sideways scroll at 7 widths, tiers,
  dark-mode contrast, 12px text and 44px targets on phones, POS shortcuts). Screenshots of every app at four widths:
  `node tests/shots.mjs <dir>` (`SCHEME=dark`, `ONLY=pos,accounts`).
- When you bump `pos/*` or `ds/*` files, bump their `?v=` in the HTML and the `V` version plus file list in `sw.js`.


## SESSION LOG (read this first when you open the repo on a new account): everything done in the POS rebuild + design-system session

Order of work, with PRs on `main` (all squash-merged; deploy for every one of them is just `git pull origin main` unless a DB step is named):

1. **POS audit and rebuild (PR #115, `db/068_pos_rebuild.sql`).** Owner's "Restaurant POS Master Audit Build Prompt" PDF: audit 42 areas, gap matrix,
   build highest-value gaps, Apple-HIG "easy, minimal, premium" UI on phone and desktop. Result: `app/public/index.html` is a 42-line shell; code is in
   `app/public/pos/` (core, ui, print, sell, pay, tables, kitchen, orders, reserve, register, staff, shell + `pos.css/.mobile.css/.desktop.css`).
   Server rules in db/068 (kind-change check in `push_record`, `records_order_guard` trigger freezing paid/void bills, manager PIN approvals with HMAC tokens,
   append-only `pos_audit`, `next_kot_no`, `claim_guest_order`, `redeem_giftcard`, reservations on `bookings`). Settings that used to be saved-but-ignored now apply
   (service/packing/delivery charges, tax-inclusive prices, round off, require phone, tip prompt, discount limit). Full details: "Restaurant POS rebuild" section above and
   `docs/POS_AUDIT.md`. **Deploy needs `psql ... -v ON_ERROR_STOP=1 < db/068_pos_rebuild.sql`, `docker compose up -d --build api`, then each owner/manager sets an approval PIN
   (POS > Staff & settings) or cashiers cannot give discounts/cancel/credit.** Tests: `node tests/run-local.mjs pos` (26 checks).
   Features checked as still present after the rebuild (owner asked): table clean marking, QR guest orders, kitchen, reservations, register, gift cards. The public
   website/QR ordering page (`site.html`) is separate from the POS and unchanged.
2. **Unified design system (PR #116).** Owner: "theme consistency, Apple HIG, design POS + Payroll + Accounting, keep colour consistent", plus a long master prompt
   (audit, parity register, shared tokens, 4 breakpoints, no business-logic changes). Done: `app/public/ds/auz.css` (all tokens), `ds/brand.js` (business accent via `auzBrand*`),
   `ds/legacy.css` (bridge for Back Office / Payroll / Builder). Console retokened (no blue theme), nav grouped by task in every app, POS tablet split view, 72px icon rail
   at 900-1199px, 240px sidebar from 1200px, sidebar toggles, POS keyboard shortcuts, Payroll grouped sidebar + phone tab bar. Docs: `docs/UI_REDESIGN.md` (audit, IA,
   tiers, feature-parity register, known gaps, release/rollback). Tests: `tests/suites/local/design.mjs`; screenshots: `node tests/shots.mjs <dir>`.
3. **iPhone home-screen fixes (owner sends screenshots from a real iPhone; no device is available here, so say what is unverified).**
   - PR #117: slimmer phone header/tab bars (POS navbar 44px, title hidden where a big page title exists except on Sell; tab bars shorter, bottom padding
     `max(2px, env(safe-area-inset-bottom) - 14px)`; Payroll lost its duplicate hamburger and floating "Powered by" strip).
   - PR #118: `ds/lock.js` pins the page behind any open sheet/dialog/menu/scrim (iOS-safe `body{position:fixed}` + restore scroll) and sheets use
     `overscroll-behavior:contain`; Accounting phone menu sits above the tab bar; Back Office menu rebuilt (header, Open POS / Sign out under it, scrolling list,
     collapsible Settings accordion, no clipped first item: the old `.drawer::before` sticky white block was the cause, no stuck dim layer, no `backdrop-filter` on the top bar).
   - PR #119: Payroll More button did nothing because my Back Office drawer CSS was global (now scoped to `html.ax-bo`); the blank strip under bottom bars on Payroll/Back Office/Builder came
     from `hig.css` `min-height:-webkit-fill-available` on html/body (switched off in `ds/legacy.css`; POS/Accounting never loaded hig.css, which is why only these had it).
   - After deploying, the owner must delete the app from the iPhone home screen and add it again (old cached copy). Current `main` after these PRs: `104584a`.
4. **Deploy habit.** Owner deploys from an iPhone over SSH (Termius), server `auzslab-app-1`, repo at `/root/auzslabs-infra`: `cd auzslabs-infra && git pull origin main && git log -1 --oneline`. Always give exact commands and the
   expected last commit so the owner can verify. Static changes need no restart; `server/` changes need `docker compose up -d --build api`; `db/` changes need the migration run by hand with `<`.

### Lessons that cost time (do not relearn them)
- **Verify with the real stack:** `node tests/run-local.mjs [suite]` builds a scratch DB, starts the API and a Caddy-like static server, drives Chromium. Needs Postgres running (`service postgresql start`).
  Full run is about 10 minutes (use `run_in_background` and wait for the notification; do not poll with sleeps). Suites: marketing, responsive, journeys, salon, cafe, pos, apps, accounts, design, security, load.
  Last full run: 560 passed, 0 failed, then design 24/24 and apps 28/28 after the Payroll fix.
- **Run two suites at once and they fight over the one test database.** Run them one after another.
- **Staff apps that load hig.css (Back Office, Builder; Payroll until v2) behave differently from POS/Accounting.** Anything global you put in `ds/legacy.css` hits all three; scope with `html.ax-bo` (Back Office) or `html:not(.ax-bo)`.
  `ds/lock.js` selectors: the console has a permanent `#ov` element, so it is matched as `#ov.show` only.
- **Staff apps still locked to light appearance** (`data-theme=light`): Back Office and Builder (Payroll v2 has dark mode), until their inline colours are retokened (listed in `docs/UI_REDESIGN.md`, "Known gaps").
- **Never claim an iPhone fix works from a desktop screenshot alone.** State what the tests assert and what only the owner can confirm on the device.
- **Git:** work on a branch from `origin/main`, commit with the attribution lines the session reminder gives, push, open a PR with the GitHub MCP tools, then squash-merge. The "squash-merge SHA divergence" note above applies to long-lived branches only; fresh
  branches from `origin/main` merge cleanly. A stop-hook asks for committed + pushed work at the end of every turn.
- **Owner preferences (standing):** build a lot, talk little; one summary at the end; plain language (the owner is not a developer); give copy-paste deploy commands; ask before inventing features; reference screenshots are references, not specs.

### Open items (nothing blocked on code, all need the owner or a decision)
- Retoken Back Office / Builder inline colours so they can follow dark mode and drop `ds/legacy.css` overrides.
- Console has no automatic icon rail at 900-1199px; no hinge-aware foldable layouts; no saved views / pinned modules in POS or Accounting.
- Real-device confirmation of the iPhone fixes above (blank strip, scroll lock, menus). Ask for a new screenshot if anything still looks wrong.
- From earlier in the project and still open: historical Showoff Salon data import (needs an export from the owner), Zomato/Swiggy API integration, server-side stock ledger and posting POS sales into Accounting (POS_AUDIT backlog), renumber the duplicate db/049 / db/050 files.

## Real sign-in providers: Google, Apple, phone/OTP, password reset, account deletion (db/069)

Until this, `auth_users` had exactly one way in (email + password) and exactly one way to fix a forgotten one (a platform admin resets it by hand, shares the new one over WhatsApp). The owner asked for real Google/Apple/phone login specifically because an app-store submission was being planned, and Apple Guideline 5.1.1(v) flatly requires self-service account deletion before that can even be considered — so this landed as one migration rather than four separate ones.

- **One `auth_users` row, many ways in.** `auth_identities` (`provider` in `google`/`apple`/`phone`, `provider_id`, `email`) links external identities to an account; a password is just `auth_users.password_hash` being non-null, not a row here. `findOrCreateIdentityUser()` in `server/src/auth.js` is the one place that decides which of three things is happening, in order: (1) already linked to this exact identity — returning user; (2) not linked yet, but the provider handed back a *verified* email matching an existing account — link it, don't duplicate (so signing up with a password then later tapping "Continue with Google" on the same address merges into one account); (3) neither — a brand-new account, same bare "no tenant yet" shape `/auth/signup` already produces (`on_signup`'s trigger skips the `profiles` row when `app_metadata` has no `tenant_id`), becoming a real tenant owner the same way any other self-signup does. All three branches are exercised by `tests` — see below.
- **Account deletion is a soft delete, not a cascade.** Hard-deleting a tenant *owner's* row would destroy their whole business's data with no recovery window, so `auth_users.deleted_at` just blocks login and gets recorded in `account_deletions` (an audit trail for a platform admin to follow up the actual data purge by hand) — the data itself is untouched until a human acts on it.
- **The gotcha that cost real time: `app_uid()` now has to look up `auth_users` to check `deleted_at` — and `auth_users` itself has an RLS policy (`au_self_or_admin`) that calls `app_uid()`.** Redefining `app_uid()` as a plain `language sql stable` function recurses forever ("stack depth limit exceeded", reliably reproduced while testing this locally before it ever reached production). The fix is `security definer` on `app_uid()` itself — its internal lookup then runs as the function owner (`POSTGRES_USER`), bypassing RLS for that one query and breaking the cycle. If `app_uid()` or any policy on `auth_users` is ever touched again, re-check this doesn't come back.
- **One function, every RLS policy.** Because every policy in the system reads `app_uid()`, making it return `null` for a deleted user revokes *data* access everywhere at once the instant `deleted_at` is set — proven by testing against a real HTTP call: a JWT issued seconds before deletion still passes `verifyToken()` (that's pure signature verification, stateless, unaffected by any of this), but the exact same token hitting `/db/profiles` afterward gets `{"data":[]}`, not the row. There's still no way to revoke a single session before its 7-day JWT naturally expires (no refresh-token rotation, no per-session store) — flagged, not built; next if asked.
- **Phone OTP, same discipline as a password:** the code is bcrypt-hashed in `phone_otps`, never stored or logged raw; capped at 5 guess attempts per sent code on top of the per-IP rate limit on `/auth/phone/verify`.
- **Every provider is independently optional and fails closed, never broken.** No `GOOGLE_CLIENT_ID` → `/auth/google` replies "not configured yet" and `signup.html` never renders the button in the first place (same pattern `mail.js`'s missing `RESEND_API_KEY` already used, extended to `server/src/sms.js` for Twilio). Nothing about email/password changes if none of this is ever configured.
- **Credentials:** every provider's exact console-by-console setup steps live in `.env.example` (`GOOGLE_CLIENT_ID`; `APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_CLIENT_ID`/`APPLE_PRIVATE_KEY`; `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`) — `docker-compose.yml` passes the whole `.env` through (`env_file: .env`), so nothing else needs touching once they're set. `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` additionally have to be pasted into `window.CFG` inline in `site/signup.html` (and anywhere else the buttons get added later) since those two are public, client-side values by design — unlike every other secret in `.env`.
- **Frontend:** both `sb-client.js` copies (`site/` and `app/public/`, intentionally separate files — see "no shared JS modules" elsewhere in this doc) grew matching `auth.signInWithGoogle/Apple`, `sendPhoneOtp`/`verifyPhoneOtp`, `forgotPassword`/`resetPassword`, `deleteAccount` methods, same `{data,error}` shape as the existing `signInWithPassword`/`signUp` so a page can't tell the difference once signed in. `site/signup.html` is also the password-reset *landing* page — a reset link points back at `signup.html?token=...`, which swaps in a "set new password" form instead of the normal one. `site/account.html` got a "Delete account" card (password-confirmed for an account that has one; an OAuth/phone-only account just needs its current session).
- The same Google/Apple/phone/forgot-password/delete-account UI was added to the POS, Payroll and Accounting login screens too (each app's own `.seg`/`aria-selected` segmented-control convention reused for the Email/Phone toggle, per Apple HIG feedback — not a new ad-hoc toggle), plus a "Delete my account" row in each app's own settings/more surface. No DB/server change — same `/auth/*` endpoints, same dormant-until-configured pattern.

## Online payment: Razorpay, auto-activation on payment (db/070)

The cart page (`site/cart.html`) used to have exactly one outcome: fill in the form, a platform admin reviews it by hand and clicks Approve. The owner asked for a client to be able to pay and get auto-activated instead. Same dormant-until-configured discipline as every other optional integration (mail.js, sms.js, the sign-in providers above): with no `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` set, nothing here is reachable and the manual request-then-approve flow (db/007/db/027) is completely unchanged — this sits alongside it, never replaces it.

- **No real prices existed anywhere before this.** Every product page on the marketing site has only ever said "contact us" — there was no number to charge. Rather than invent one, `product_prices` (one row per feature key, seeded at ₹0 = "not priced yet") is now a platform-admin-editable table (`admin.html` → **Pricing & payments**, calling `admin_set_product_price`). A product only gets a "Pay & activate instantly" button on the cart page once it actually has a real price — the owner turns this on product by product, whenever they're ready, with zero code changes needed.
- **`payments`** is one row per Razorpay order (exactly one of `signup_request_id`/`addon_request_id` is set — a new-tenant signup or an existing client's add-on purchase). No RLS: like `auth_users`/`phone_otps`, it's never exposed through the generic `/db/:table` whitelist — only `server/src/payments.js` (raw `pool` queries, often with no logged-in caller at all, since the webhook is server-to-server) and two ownership-checked SECURITY DEFINER RPCs (`payment_status`, `admin_list_payments`) ever touch it.
- **`public_product_prices()`/`payment_status()`/`admin_list_payments()` return `jsonb`, not `returns table`.** This bit the first draft: callRpc's `select fnName(...) as result` / `rows[0]?.result` convention (see `list_clients`'s own comment, db/006) silently expands a `returns table` function's rows into multiple SQL result rows and drops everything but the first — caught by the local test script before it ever reached the API layer, not by inspection.
- **The webhook, signature-verified, is the only thing that can ever mark a payment paid — the client's own Razorpay Checkout success callback is never trusted on its own.** `server/src/payments.js`'s `verifyWebhookSignature()` computes HMAC-SHA256 over the *raw* request body (never the re-serialized JSON — Razorpay signs the exact bytes it sent) and compares with `crypto.timingSafeEqual`. `POST /payments/webhook` in `index.js` reads the body with `readRawBody`, not `readJsonBody`, specifically so those raw bytes are still available for the signature check before anything gets parsed. The cart page's own flow after opening Checkout is just: wait for the modal's handler to fire (a UI hint, nothing more), then poll `payment_status` for up to 45s for the webhook to land.
- **`provision_from_payment`/`provision_addon_from_payment` are deliberately NOT registered in `index.js`'s `RPC` allow-list.** They do the exact same work `approve_signup_request`/`approve_addon_request` already do, just without the `is_platform_admin()` check those require — trusting instead that the only caller is the webhook handler, which already verified real money was captured. Registering them would let anyone free-provision a tenant by POSTing a fake payment id to `/rpc/provision_from_payment` (same discipline as Accounting's internal `acc_do_post`/`acc_post_journal`).
- **Idempotent against Razorpay's at-least-once webhook delivery, proven by test, not assumed:** replaying the identical signed webhook payload a second time (`node` script against a real running server) left exactly one tenant, not two — `provision_from_payment` returns the already-provisioned tenant's id instead of erroring when the `signup_request` is no longer `pending`.
- **Credentials:** `.env.example`'s `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` section has the exact console-by-console setup steps (including that KYC can take a day or two, but Test Mode keys work immediately). `RAZORPAY_KEY_ID` (not the secret) is also returned by the public `GET /payments/config` endpoint — that's by design, Razorpay's Checkout.js needs it client-side, same as `GOOGLE_CLIENT_ID` above.
- **Known limit, flagged not built:** this charges the first month upfront to activate instantly; it does not set up a recurring Razorpay Subscription, so renewal billing still works exactly as it does today (the owner follows up, `tenants.monthly_fee`/`renewal_date`). Automating recurring billing needs real Razorpay Plans and a decision on billing cycle/proration — a owner decision, not something to invent.
- **Deploy:** `git pull`, then `psql ... -v ON_ERROR_STOP=1 < db/070_razorpay_payments.sql`, then `docker compose up -d --build api` (server changed). Static-only until real Razorpay keys are added to `.env` and the container rebuilt.

## Real pricing: AUZsPOS/AUZsPOS QR/AUZsPay/AUZsLedger + bundles (db/072)

The owner supplied an actual pricing sheet (four individual products, four discounted bundles, annual rates, a one-time setup fee, custom software as a separate quoted line) and asked for it live. Two things landed from this:

- **`site/pricing.html` was rewritten** from a "no listed price, write in for a quote" page into one that actually shows the real numbers: AUZsPOS ₹999, AUZsPOS QR ₹1,299, AUZsPay ₹999, AUZsLedger ₹1,599 (all /month + GST), four bundle cards (Starter ₹2,398, Growing ₹2,698, Complete ₹3,499 with the ₹3,997 list price struck through, Complete QR ₹3,799 likewise), an annual-rate table, setup/onboarding, a custom-software callout, and a 20-clause T&Cs accordion (reusing the existing `uk-accordion`/`grid-2`/`card` components site-wide, no new CSS). Each plan/bundle button calls `window.AUZcart.add(key)` for its product key(s) (the same `localStorage` cart every `site/*/site.js` copy reads — verified to use the identical `CART_KEY` across `site/site.js`, `site/kept/site.js` and `site/tool/site.js`) and sends the visitor to `cart.html` — no new add-to-cart mechanism invented. Annual billing and the setup fee are **not** wired into automated checkout (see the Razorpay section's own "known limit" on recurring billing) — both stay "write in," matching how the business already operates.
- **The pricing engine itself had to learn two things it couldn't express before:** a *bundle* isn't a sum of its parts (`bundles`, exact feature-key-set match, checked before the flat per-product sum in `payments.js`'s `priceFeatures()`), and *one* product can cost a different amount depending on what the buyer already owns (`addon_price_overrides` — AUZsPay is ₹999 standalone but ₹1,399 as an add-on for an existing AUZsPOS tenant, since Starter's ₹2,398 = ₹999 + ₹1,399, not ₹999 + ₹999). Both are admin-editable from `admin.html` → **Pricing & payments** → **Bundles** (`admin_set_bundle_price`), same pattern as individual prices. `cart.html`'s own price preview mirrors this exact logic client-side (`public_bundles()`/`public_addon_price_overrides()`) so what a visitor sees is what Razorpay will actually charge, not a naive sum that happens to be wrong for a bundle combination.
- **A real, pre-existing bug was caught building this, not introduced by it — fixed before anything shipped.** `payments.js`'s `createOrder()` read `signup_requests`/`addon_requests` through a bare `pool.query()` that never set `app.uid`. Both tables' RLS policies key off `app_uid()` (`user_id = app_uid()`, db/007/db/027) — with it unset, every real caller's own pending request was invisible, not just an attacker's: **every Razorpay checkout attempt since db/070 shipped would have failed** with "that request was not found, is not yours, or has already been handled," 100% of the time, for every real customer. It went unnoticed because every earlier test either stayed on the dormant (`RAZORPAY_KEY_ID` unset) path, which never reaches this query, or exercised `payments`/provisioning directly via raw SQL rather than through `createOrder()` itself. Caught only once this session configured *fake-but-present* Razorpay keys and drove the real `createOrder()` function end to end. Fixed by reading through `withAuth(userId, ...)` instead of the bare pool — and a second, structural half of the same bug: `tenant_settings` (needed for the addon-override check above) has **no owner-read RLS policy at all**, admin-only (db/006), so no amount of setting `app.uid` would ever let a plain `pool.query` join see it. Fixed with a dedicated SECURITY DEFINER helper, `addon_request_pricing_context()` (checks `ar.user_id = app_uid()` itself, same "deliberately unregistered in the RPC allow-list, trusted-backend-only" discipline as `provision_from_payment`). **Lesson for next time:** a payments/RLS test that only ever exercises the dormant branch, or bypasses the real function to simulate state via direct SQL, can hide exactly this kind of bug — test the actual code path with real-shaped (even if fake) credentials before trusting it.
- **Verified, after the fix:** a dedicated script monkey-patches `global.fetch` to intercept the outbound call to `api.razorpay.com` (captures the exact amount `createOrder()` computed without hitting the real network) and drives all three pricing branches through the *real* `createOrder()` function — a bundle match, a non-bundle flat sum, and the addon override — each landing on the exact right paisa amount. A second script drives the *real* HTTP routes end to end with fake-but-present Razorpay keys: confirms `create-order` now gets past the RLS read (fails only on the fake credentials being rejected by Razorpay's real API, not on "not found"), then completes the rest of the pipeline with a correctly-signed webhook, landing on a tenant provisioned at the exact Starter-bundle price.
- **crm/billing/inventory/website_builder/salon stay unpriced (₹0)** — they aren't part of this particular pricing sheet (folded into AUZsPOS, or a separate product line/pricing exercise entirely) and stay on the existing manual request-and-approve flow; `products.html` still sells them as separate a-la-carte cards, unchanged.
- **Deploy:** `git pull`, then `psql ... -v ON_ERROR_STOP=1 < db/072_real_pricing_and_bundles.sql` (after 070/071), then `docker compose up -d --build api` (payments.js changed). Static files (`pricing.html`, `cart.html`, `admin.html`) need no restart.

## Security hardening pass (browser headers, rate limits)

A general pass, not tied to one feature — see `tests/suites/local/security.mjs` for the baseline this builds on (tenant isolation, SQL-injection resistance, auth-enumeration resistance, stack-trace leakage, oversized-body rejection — all already solid before this pass).

- **Every site in the Caddyfile now sends `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a `Permissions-Policy`** (camera/mic/payment/usb/etc off; `geolocation=(self)` left on because Payroll's clock-in uses it) **and `Content-Security-Policy: frame-ancestors 'self'`** (verified safe first: zero `<iframe>` tags anywhere in `site/` or `app/public/`). Defined once as a Caddy snippet (`security_headers`), imported into every site block. Validated with the stock `caddy validate`/`caddy fmt` binary (no Docker daemon needed) — the only error it can report locally is the GoDaddy DNS plugin module not being compiled into the stock binary, which is expected outside the real image build.
- **`/auth/signup` never enforced a minimum password length** — only `/auth/reset` did. A 1-character account password was possible. Now both require 8+ characters.
- **`/auth/delete-account` had no rate limit at all**, unlike every other password-checking endpoint in this file. A leaked/stolen JWT could brute-force the password confirmation unlimited times. Added the same per-caller throttle every other sensitive endpoint already has.
- Both fixes verified against a *real* running server with rate limiting actually enabled (the normal test harness sets `DISABLE_RATE_LIMIT=1` for speed, which would have hidden this) — an ad hoc script confirmed the short-password rejection and the exact 429-after-N-attempts behavior.

## Single-device session revocation (db/071)

db/069's own comment flagged this as a known gap the day real auth shipped: a JWT was valid for its full 7-day life no matter what, so a lost phone or an ex-employee's device meant either waiting out the week or changing the password — which logs out *every* device, not just the one that matters.

- **`auth_sessions` is one thin row per issued token**, not a full session store. `verifyToken()` in `auth.js` stays the stateless, no-DB-hit operation it was deliberately built as (db/069's own comment explains why): it checks an in-memory `Set` of revoked `jti`s, loaded once at boot (`select jti from auth_sessions where revoked_at is not null and revoked_at > now() - interval '8 days'` — nothing older is worth holding, that token already expired on its own) and updated synchronously the instant `revokeSession()` runs — never a query per request.
- **`signToken(user, meta)` is now async** (it inserts the session row before signing) — every real call site (`login`, `identitySession` used by Google/Apple/phone, `/auth/signup`) threads `meta = {ip, userAgent}` through from `index.js`. `meta` is optional on purpose: a token signed without it just has no `jti` and is valid exactly as every token was before this migration (not individually revocable) — so existing code paths nobody remembered to update don't break, they just don't get this feature.
- **`device_label`** ("Chrome on Windows", "Safari on iPhone") is parsed from the request's own `User-Agent` by a small heuristic (`describeDevice()`) — good enough for someone to recognise "that's my laptop" vs "that's not me," not a precise fingerprint.
- **`last_seen_at` is throttled to once per 5 minutes per session**, fire-and-forget, inside `verifyToken()` — this runs on *every* authenticated request, so an unthrottled `UPDATE` on each one would turn a read into a write storm for a UI detail nobody needs to the second.
- **UI lives in one place: `site/account.html`** ("Where you're signed in" card, listing every session with a Sign out button, the current one badged). This is enough — POS, Payroll, Accounting and every other app all authenticate against the same `/auth/*` endpoints, so a session created from any of them shows up and can be revoked from this one page regardless of which app created it. No per-app duplicate UI was built.
- **Verified against a real running server** (not just the DB layer): logging in from two different `User-Agent`s, listing sessions from each and confirming the *other* one is marked current from its own point of view, revoking one device's session from the other, confirming the revoked token gets 401 on its very next request while the device that did the revoking keeps working — and that a completely different account can't revoke (404, not 200) a session that isn't theirs. Revoking your own *current* session also correctly logs you out (401 on the next call) — no special-casing needed, it just falls out of the same code path.
- **Still not built, flagged not invented:** nothing cleans up old non-revoked rows for an account that's been deleted or a token that long since expired — `auth_sessions` will grow unbounded over months. A cheap periodic `delete from auth_sessions where created_at < now() - interval '30 days'` is the obvious fix whenever that matters in practice.

## Error tracking (Sentry), dormant until a DSN is added

Same dormant-until-configured discipline as every other optional integration (`mail.js`, `sms.js`, `payments.js`, the sign-in providers). With no `SENTRY_DSN`, nothing changes — a bug just gets logged to the console exactly as it always has.

- **Server-side (`server/src/errors.js`, `@sentry/node`):** `initErrorTracking()` is a no-op without `SENTRY_DSN` — it doesn't even register `process.on('uncaughtException'/'unhandledRejection')` handlers when dormant, so there is genuinely zero behavior change, not just "Sentry calls fail silently." `index.js`'s one top-level catch block calls `captureError(err, {method, path, user_id})` only for genuine 500s — a 400/401/403/404/409/429 is a normal business outcome (wrong password, insufficient stock, a rate limit), not a bug worth an alert. `salon.js` has its own separate request handler (`handleSalon`, not routed through `index.js`'s catch block) and gets the same treatment in its own `catch` — note its `method`/`p` variables are declared *inside* the `try` block there (block-scoped, invisible to `catch`), so that capture call re-derives `{method, path}` straight from `req` instead of reaching into a scope it can't see.
- **Client-side (`app/public/ds/errors.js`):** a tiny snippet that only injects the Sentry Browser CDN bundle and calls `Sentry.init()` when `window.CFG.sentryDsn` is actually set — otherwise it does nothing, not even a network request. Wired into the six staff-facing app shells where a JS crash actually blocks someone's real work: POS (`index.html`), Payroll, Accounting, Back Office, the admin console (`dashboard.html`) and Builder. Deliberately *not* added to every marketing page — a JS error on a public landing page rarely blocks a sale, and touching dozens of `site/` pages for that would be a lot of surface for little value; revisit if that judgement call turns out wrong.
- **Two places hold the DSN client-side**, matching the existing `googleClientId`/`appleClientId` split: `app/public/config.js` (shared by POS/Back Office/console/Accounting) and payroll.html/builder.html's own inline `window.CFG` (each keeps its own copy — see "no shared JS modules" elsewhere in this file). `.env.example` spells out pasting the same DSN into both places.
- Error-only on both sides (`tracesSampleRate: 0`) — no session replay or performance tracing, which would burn through Sentry's free-tier quota for little benefit on a small product.
- `app/public/sw.js`'s precache list and `V` were bumped (`pos-v24`) to include the new `ds/errors.js` file, per this file's own "bump `?v=` and `sw.js`'s `V`" rule.

## AUZslab Payroll v2 (`app/public/payroll/`, db/073-077): rebuilt from the AUZsPay specification

Owner request: "rebuild complete payroll software, Apple design guidelines, ultra minimal, easy even for a starter", with a 106-section HR + payroll specification. Full write-up: `docs/PAYROLL.md`.
- **Real tables, not `records`**: 41 `pay_*` tables (RLS on, no policies, nothing granted); every read and write goes through a SECURITY DEFINER `pay_*` function that starts with `pay_guard(perm)` / `pay_tenant()`. Employment and salary are effective-dated; finalised payrolls, their lines, punches, ledgers and `pay_audit` are append-only or frozen by triggers. Corrections are adjustments in a later payroll (arrears), never edits.
- **Statutory values are rows in `pay_stat_rules`** (dated, versioned, with source and checked-on date), never constants in code. Add a new row with a later `eff_from` when a rule changes.
- **Permissions**: `pay_view, pay_people, pay_time, pay_salary, pay_run, pay_approve, pay_pay, pay_reports, pay_admin, pay_audit` (`pay_perm`). Managers never see salary/bank/PAN unless `settings.access.manager_salary`; staff only reach `pay_me_*`; line managers via `pay_jobs.manager_id`. The keys are in `PERM_KEYS` on `site/account.html`.
- **New public function => add it to `RPC` in `server/src/index.js`** (they are all there now; helpers are deliberately not). `PYxxx` errors are HTTP 400.
- **Old Payroll data** (`hr_*` records) is imported by `pay_import_legacy` (idempotent, incremental, keeps ids; runs from the migration, on open and before every calculation). Imported businesses keep the old flat rates (`stat_mode='flat'`) until the owner switches to official rules. The salon console's `salon_hr_*` / `salon_punch` keep their db/054 signatures on the new tables; POS clock-ins (`kind='shift'`) are mirrored into `pay_punches`.
- **UI**: Apple HIG, its own CSS on `ds/auz.css` tokens (no `hig.css`, no `legacy.css`), dark mode, business accent, tab bar on phones, rail 900-1199, sidebar 1200+. Pages register with `page(id, {title, icon, perm | ess | manager | any, render(v)})`; HR navigation `NAV_HR`, self-service `NAV_ME` in `shell.js`. Bump `?v=` in `payroll.html` and the list + `V` in `sw.js` when changing these files.
- **Tests**: `node tests/run-local.mjs payroll` (32 checks: money invariants after every step, access, isolation, every screen on phone and desktop). `pay_integrity_check()` is the in-app health check.
- **Deploy**: pull, run 073 to 077 in order with `<` and `-v ON_ERROR_STOP=1`, then `docker compose up -d --build api`. Owner re-adds the Payroll home-screen icon on the iPhone.
- Bug found by the tests and fixed before shipping: an ambiguous `days` variable in `pay_leave_decide` (plpgsql variables must not share a name with a column used in the same UPDATE; prefix them `v_`).

## One consolidated demo tenant (db/078): `demo@auzslab.in`, not three separate logins

Owner request: one single demo account that shows off POS, Payroll and Accounting together, instead of three separate demo tenants each showing one thing. `demo-salon` is a different product entirely (its own front-end app, `app/public/salon/`) and was deliberately left alone — "three" meant `demo-cafe` + `demo-retail` + `demo-accounts`.

- **Reused the `demo-cafe` tenant row** (renamed `slug`→`demo`, `name`→`AUZslab Demo`) rather than building a new tenant from scratch — it already had the richest POS catalog (tables, KOT-ready categories). `self_order`/`payroll`/`accounting` were merged into its `tenant_settings.features`; two of `demo-retail`'s variant-stock items (Classic Tee, Slim Jeans, under a new "Apparel" category) were copied in so retail-flavoured marketing pages still have something relevant to point at. New login: **`demo@auzslab.in` / `Auzslab@Demo`** (same shared demo password hash as every other demo tenant). The old `demo-cafe@auzslab.in` login was deleted — one login per demo tenant now, not two.
- **`demo-retail` and `demo-accounts` were deleted outright** — tenant row and all. Every frontend reference to the old three-tenant setup (`live-demo.html`, `billing/crm/inventory/payroll/pos/qr-ordering/accounting.html`, `demo.html`'s niche-based slug resolver, `business-cafes/clothing/retail.html`) now points at `demo.auzslab.in` / `demo@auzslab.in`; `demo-salon`'s own references were untouched. `tests/run-live.mjs`'s default `DEMO_TENANTS` list was updated the same way.
- **`records`, `guest_orders`, `invoice_counters` and `push_subs` have no `ON DELETE CASCADE` from `tenants`** (see "The `records` table" above for `records` specifically — the other three share the same gap) — deleting a tenant row outright, not just resetting its data, needs these deleted by hand first or the `DELETE FROM tenants` itself fails on a leftover FK reference.
- **The real trap: `acc_*`/`pay_*` append-only guard triggers check `is_demo` on `tenants` themselves, and that check cannot see a true cascade coming.** Postgres implements `ON DELETE CASCADE` as an *AFTER DELETE* trigger on the referenced table (`tenants`) that deletes the referencing rows — by the time it reaches `acc_documents`/`pay_emp_events`, the `tenants` row is already gone, so `acc_doc_guard()`/`pay_block_change()`'s own `exists (select 1 from tenants where id = ... and is_demo)` lookup finds nothing and fails closed with "cannot be deleted; cancel it instead" / "permanent history." These two modules' demo data has to be wiped by a **direct** delete (while the tenant row still exists and the is_demo check still passes) before the tenant row itself goes — `pay_reset_demo(tid)` already does exactly this and was safe to call as-is; `acc_reset_demo(tid)`'s delete list was inlined instead of calling the function directly, because the function's own last line reseeds fresh demo data (right for keeping a *live* demo fresh, wrong immediately before deleting the tenant — the reseeded rows would hit the exact same cascade trap a moment later).
- **`acc_seed_demo(tid)` used to resolve its posting identity by looking up the hardcoded `demo-accounts@auzslab.in` login** (`select id into uid from auth_users where email = 'demo-accounts@auzslab.in'`) — which was about to be deleted. Generalised to resolve any tenant's own owner instead (`select id into uid from profiles where tenant_id = tid and role = 'owner' limit 1`), the same way every other `acc_*`/`pay_*` caller already does. `acc_reset_demo`/`acc_bootstrap`'s 12-hour auto-refresh of a *live* demo tenant needed no change — they already call `acc_seed_demo` by `tid`, not by this tenant's email.
- **A real bug this surfaced, unrelated to the consolidation itself but caught while exercising `pay_demo_seed` for the first time against a tenant that already had legacy-imported employees**: `pay_demo_seed`'s own `reg` variable was declared `uuid` but assigned from `pay_employees.id` (a `text` column, e.g. `'demo-pay-4'`) — a guaranteed crash ("invalid input syntax for type uuid") on every single call, it just happened never to have been exercised in production yet (payroll's demo-reseed only fires lazily, the first time someone with `pay_run` opens Payroll on a demo tenant). Fixed by declaring it `text` to match the column (`reg` was dead code either way — never read after being assigned). **Lesson, same shape as the Razorpay bug found earlier this session: a function that's only ever exercised lazily/on a schedule can ship with a guaranteed crash and nobody notices until something finally calls it for real — test the actual call path, not just that the file parses.**
- **Verified against a full local scratch-DB rebuild** of the entire migration chain (db/000 through db/078, in order): one `demo` tenant with all three features on and a non-empty catalog/payroll run/accounting books, zero orphaned rows in any table, `demo-retail`/`demo-accounts` and their logins fully gone, `demo-salon` completely untouched.
- **Deploy:** `git pull`, then `psql ... -v ON_ERROR_STOP=1 < db/078_consolidate_demo_tenant.sql` (after 077). No API rebuild (the function changes are SQL-only); static `site/*.html` changes need no restart either.

### SESSION LOG, continued: Payroll v2 session (PR #120, PR #121)

5. **CLAUDE.md session log (PR #120).** Owner asked for one file describing everything, so a second Claude account can carry on.
6. **Payroll v2 (PR #121, squash-merged as `d42d327`).** Owner: "Rebuild complete payroll software, Apple design, ultra minimal, easy even for a starter", plus the 106-section AUZsPay HR + payroll specification. Details are in the "AUZslab Payroll v2" section above and `docs/PAYROLL.md`. Summary:
   - Database `db/073`-`077` (schema, engines, payroll run, API, self-service + kiosk + reports + old-Payroll import + salon/POS hooks + demo). 41 `pay_*` tables, all access through `pay_*` SECURITY DEFINER functions, all registered in `server/src/index.js`.
   - New app: `app/public/payroll.html` (shell) + `app/public/payroll/` (`core.js`, `shell.js`, `p-home.js`, `p-people.js`, `p-time.js`, `p-pay.js`, `p-reports.js`, `p-settings.js`, `p-me.js`, `payroll.css`/`.mobile.css`/`.desktop.css`). The old single-file Payroll is gone (still in git history).
   - Console `team/payroll` page now reads `pay_console_summary()`; `site/account.html` `PERM_KEYS` gained the ten `pay_*` keys.
   - Tests: new suite `node tests/run-local.mjs payroll` (32 checks); `tests/lib/db.mjs` seeds tenant `testpay` with logins `owner-pay@`, `manager-pay@`, `staff-pay@`, `staff2-pay@test.local`; design suite updated for the new layout. Full run after merging main: **596 passed, 0 failed**.
   - Owner deploy (in this order; 069-072 are the other session's sign-in/payments/sessions/pricing migrations and must go first if not yet applied):
     ```bash
     cd auzslabs-infra && git pull origin main && git log -1 --oneline
     set -a; source .env; set +a
     for f in db/069_real_auth_providers.sql db/070_razorpay_payments.sql db/071_session_revocation.sql db/072_real_pricing_and_bundles.sql db/073_payroll_schema.sql db/074_payroll_engine.sql db/075_payroll_run.sql db/076_payroll_api.sql db/077_payroll_ess.sql; do docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f" || break; done
     docker compose up -d --build api
     ```
     Then delete Payroll from the iPhone home screen and add it again. Not yet confirmed by the owner that this deploy was run.

### Lessons from the Payroll v2 session
- **Two sessions can work on `main` at once.** While Payroll v2 was being built, another session merged sign-in providers, Razorpay, session revocation and pricing (db/069-072). Before opening a PR: `git fetch origin main`, merge it in, and check for **migration number clashes** (`ls db/`). The Payroll files were renumbered from 069-073 to 073-077 for this reason. Pick the next free number at merge time, not at start.
- **After merging main, run `npm ci` in `server/`** if `server/package.json` changed (the test stack failed to start with `ERR_MODULE_NOT_FOUND: google-auth-library` until it was).
- **Payroll opens a five-question setup guide on first visit** for an owner whose `pay_org.setup_done` is false. UI tests that tap buttons must close it first (press Escape), or the sheet's scrim swallows the click (this caused two design-suite timeouts).
- **plpgsql variables must not share a name with a column used in the same statement** (`days` in `pay_leave_decide` made approving leave fail with "column reference is ambiguous"). Prefix variables with `v_`.
- **Screenshots of real sample data catch what tests miss.** A throwaway script that seeds `testpay` through the RPCs and screenshots key pages at 390 and 1440 px (light and dark) found the overflowing phone action bar, a per-person "month not over" warning on every payslip, empty sections and stretched segmented controls. Delete such scripts before committing.

### Open items after Payroll v2
- Owner to run the deploy above and send iPhone screenshots of Payroll (owner view and a staff login) for real-device checks.
- Gratuity and bonus rule values in `pay_stat_rules` have not been re-checked against the current Acts; verify before relying on them. No labour welfare fund rule is seeded for any state (a business adds its own).
- Not built (needs outside services or an owner decision): filing directly with EPFO/ESIC/TRACES, biometric devices, real background jobs (accrual and demo reset run when someone opens the app), cleaning up old `hr_*` records after the import.

## Homepage footer: CONNECT panel is no longer sticky

Every homepage section (`.stack-panel`) pins with `position:sticky` as you scroll, so the next section's giant `data-tab` word visibly slides up and over it -- an intentional, extensively-tuned effect used on every marketing page. The dark footer (`.stack-panel-dark`, `data-tab="CONNECT"`) used the exact same sticky mechanism even though it's the *last* section with nothing after it to justify pinning -- the only visible effect was the giant "CONNECT" word looking cut off mid-scroll (the owner's own screenshots caught this repeatedly; a settled/scrolled-into-place render was always correct, confirmed by direct measurement before this fix). Removed `position:sticky`/`top` from `.stack-panel.stack-panel-dark` (both the base rule and the `>=861px` override in `site/theme.css`) -- it now just flows into view like ordinary content. Every other section's sticky-stacking is untouched.

## Cart bill: GST + mandatory flat one-time setup fee (₹2,179, no GST on the fee)

Owner request: the cart should show a complete bill (GST, mandatory setup fee, total due) right next to the item list -- not buried past a whole signup form -- and individually-added products should still price as their matching bundle automatically. The bundle auto-match already existed (`priceTotal()` in `cart.html` / `priceFeatures()` in `payments.js`, db/072 -- an exact feature-key-set match against `bundles`, checked before any flat sum, regardless of the order products were added in). What was missing: GST was advertised everywhere ("+GST" on every price in `pricing.html`) but never actually calculated or charged anywhere, there was no setup fee in the real checkout flow at all, and the one total line that did exist was buried inside the signup form, past every field.

- **`server/src/payments.js`**: `GST_RATE = 0.18` (standard rate for software services in India, subscription only) and `SETUP_FEE = 2179` are plain constants (not yet admin-editable -- same bar as `addon_price_overrides`' original seed values). `billFor(subtotal, { isSignup })` computes `{subtotal, subtotalGst, setupFee, monthlyTotal, dueToday}` -- **the setup fee is flat, no GST is added to it** (owner was explicit: "no gst only just 2179"), and it's **only ever non-zero for a `signup_request`** (a brand-new tenant), never for an `addon_request` (an existing tenant was already set up once). `createOrder()` charges `bill.dueToday` via Razorpay (subtotal + its GST + flat setup fee, for a new signup; subtotal + its GST only, for an addon) instead of the bare base price, and stores the breakdown in the order's `notes` for reconciliation. `payments.amount` now holds the true total charged, not just the subscription price.
- **`site/cart.html`**: mirrors `billFor()` exactly (same formula, same rounding) so the preview shown before paying is what Razorpay actually charges -- this project's own established discipline after the earlier Razorpay RLS bug this session. **A new "Your complete bill" card sits directly under the item list** (`#billSummarySection`), visible the instant every item in the cart is priced -- before sign-in, before the form, regardless of whether Razorpay is even configured (the preview is pure arithmetic; `priceTotal()` no longer needs `PAY.enabled` to compute it, only the actual "Pay & activate instantly" *button* still does). It switches context automatically: signed-out or mid-signup shows the full new-account bill (subscription + GST + flat setup fee); once signed in to an existing tenant (`DASH` loaded) it switches to addon pricing on just the not-yet-owned items (no setup fee row at all). The smaller boxes still inside the pay-button area now just repeat the final "Due today" figure, not the whole breakdown again.
- **Bundle match is now visible, not just correct**: `matchedBundleNote(keys)` shows a pill ("Bundle applied -- Starter business (AUZsPOS + AUZsPay)") whenever the cart's current combination (added in any order) matches a bundle. **It only adds a "you're saving ₹X/mo" claim when that's actually true against the flat per-item sum** -- caught while building this that the seeded Starter/Growing bundle prices (db/072) are *higher* than the flat simultaneous sum of their components (Starter ₹2,398 vs. ₹1,998 flat; Growing ₹2,698 vs. ₹2,298 flat -- both match the *sequential addon-override* price instead, e.g. ₹999 pos + ₹1,399 payroll-as-addon = ₹2,398). Complete and Complete QR are genuine discounts (₹98/mo each) and show the real savings figure. The bundle prices themselves were left untouched (a pricing decision, not a bug to silently fix) -- flagged to the owner directly; the UI just never claims a saving that isn't real.
- **Verified against the real `createOrder()` function** (fake-but-present Razorpay keys, `global.fetch` intercepted to capture the exact amount, a real scratch database): a Starter-bundle signup (₹2,398 base) correctly charged ₹5,400.86 at first (subtotal + GST + setup fee + GST-on-setup-fee) -- corrected after the owner clarified the setup fee carries no GST, now charges subtotal + GST + flat ₹2,179 only; an addon purchase on an existing tenant (Payroll at its ₹1,399 addon-override price) correctly charges ₹1,650.82 with no setup fee.
- **`site/pricing.html`**'s own "Setup & onboarding" card was updated from the old ₹999 figure to ₹2,179 (no GST), marked mandatory, for consistency with the cart.
- **Deploy**: static files only (`cart.html`, `pricing.html`, `theme.css`) need no restart; `server/src/payments.js` changed, so `docker compose up -d --build api` is required for the GST/setup-fee charge to actually take effect (the display-only parts of `cart.html`/`pricing.html` work immediately on `git pull` either way).

## AUZsMob (`app/public/mob/`, db/080-084): a real product for mobile phone retail & repair shops

Owner request, after an earlier attempt landed wrong ("a restaurant POS with phone words on it"): rebuild it completely, the way Payroll v2 and Accounting were built — its own real `mob_*` tables (not the generic `records` engine), its own SECURITY DEFINER functions, genuinely offline-first, Hindi and English, Apple HIG. Full write-up: `docs/MOBILE.md`; a short bilingual how-to for a shop owner: `docs/MOBILE_OWNER_GUIDE.md`. Summary:

- **Database** `db/080`-`084`: schema (13 `mob_*` tables, RLS on with zero policies, IMEI unique indexes scoped per tenant), the engine (permissions, catalog, purchase, sale, void, repairs, payments, stock adjustment), sync + reports + integrity check + export, real pricing (`product_prices`), and folding into the one consolidated demo tenant with a 12-hour auto-refresh. Feature key `mobile`; niche preset `mobile` (`db/080`) turns it on automatically for a tenant provisioned with that niche.
- **Offline-first for real**: IndexedDB (`mob1`) + an outbox (`app/public/mob/sync.js`), optimistic local writes before the network call, idempotent server functions keyed by a client-generated id, stock as `sum(movements)` never a counter. Buying a serialized phone writes the resulting unit into IndexedDB immediately, so it can be resold with no internet before the purchase has even synced — this was *not* true in the first draft (see lessons below).
- **Staff isolation is enforced in `mob_sync_pull`** (the one read path every phone uses to catch up), not just hidden in the UI: owner/manager (`mob_reports`) get every staffer's purchases/sales/repairs; everyone else only their own. The shared catalog (items/units/vendors/customers) is always visible to everyone, since staff need it to sell offline.
- **New app**: `app/public/mob.html` (shell) + `app/public/mob/` (`i18n.js`, `core.js`, `sync.js`, `shell.js`, `p-home.js`, `p-sell.js`, `p-purchase.js`, `p-repairs.js`, `p-stock.js`, `p-dues.js`, `p-reports.js`, `p-settings.js`, `mob.css`/`.mobile.css`/`.desktop.css`), icon/logo reusing the earlier AUZsGSM mark (ink tile, white phone silhouette, wine stepped squares — `icon-mob.svg`, `icon-mob-512.png`).
- **Platform wiring**: `product_prices`/admin.html `FEATURE_LABEL`/cart.html `PRODUCT_LABEL` all list it as `AUZsMob`; `account.html` gained the `mob_*` `PERM_KEYS`, an `AUZsMob` service group and an "Open AUZsMob" link; the console, POS, Payroll and Accounting sidebars cross-link to it (and back) the same way they already do to each other, gated on the tenant actually owning the feature; `sw.js` precaches it. `site/demo.html`'s per-lead module list now includes AUZsMob when a signup request picked it.
- **Deliberately separate from `gsm` / AUZsGSM.** An earlier, different piece of work listed a standalone external app (`https://gsm.auzslab.in`, its own deployment, manual setup) under the `gsm` feature key on the marketing site, admin client editor and account page — that is a different, already-shipped product and was left completely untouched. AUZsMob is a second, in-platform product for the same kind of shop; whether to eventually retire the `gsm` listing in favour of this one is a business call for the owner, not made here.
- **Tests**: `node tests/run-local.mjs mobile` (31 checks — catalog, purchase idempotency, duplicate-IMEI rejection, sell/void and the stock move, staff isolation through `mob_sync_pull`, repairs and authorization, dues/reports, the staff-rates switch, day close, export, the integrity check, every screen on phone and desktop including a real Save-button flow and the Hindi/English toggle); `testmob` tenant + owner/manager/2-staff logins in `tests/lib/db.mjs`; also added to the `design` suite's app list.

### Lessons from the AUZsMob build (worth re-reading before touching this module)
- **Native `Element.append()` stringifies `null`/`undefined` to the literal text "null"**, unlike this project's own `add()`/`h()` helpers which filter falsy children. `v.root.append(sectionA, cond ? sectionB : null)` is a real, recurring bug class here (first found in the earlier, discarded AUZsGSM attempt; recurred three more times in this build: `p-reports.js`, `p-repairs.js`, `p-home.js`'s owner dashboard). Rule: never call the native `.append()`/`.innerHTML`-free DOM append directly with a conditional expression that can be `null` — use `add(el, [...])` instead, same as `h()` does internally. The same bug, worse: in `p-purchase.js` the Save button was conditionally passed to a one-time `v.root.append()` call, so it was never in the DOM at all until an item was picked, by which point the append had already run — fixed by always appending the real node and toggling a `hidden` class instead.
- **A route whose own render function opens a modal sheet is unsafe.** `repairs/new` used to render `repairSheet()` directly as its page content. Any background `mob:pulled` re-render (fired after every `localPush`, including ones mid-flight while the sheet is still open) re-invokes that render function and silently stacks a second, blank sheet on top of the one the user is filling in — closing the top one leaves the one underneath stuck, with an invisible scrim blocking the whole UI. Fixed by opening the sheet directly from the action handler instead (the same convention `itemSheet`/`vendorSheet` already used), never from a route.
- **`money()` returns a DOM node** (`h('span', {class:'money'}, ...)`), not a string. `money(a) + ' / ' + money(b)` string-concatenates two nodes via their default `toString()`, rendering the literal text `[object HTMLSpanElement] / [object HTMLSpanElement]` — found on the Stock catalog price column, visible to every owner/manager. Wrap multiple `money()` calls in an `h('span', null, money(a), ' / ', money(b))` instead.
- **A function awaited across a navigation must check it's still on the right page before touching the DOM.** `p-home.js`'s owner-dashboard fetch and `p-settings.js`'s staff-list/integrity-check fetches write into a `#owner-dash`/`#staff-box` node *after* an `await` — if the user has already navigated away by the time it resolves, that node is gone and `clear(null)` throws. Fixed with a `root.isConnected` guard before each late write; this is a recurring shape (see `renderHome`), not a one-off.
- **Reassigning a search/filter variable before it's also used as the thing being saved is a real data-quality bug.** `p-purchase.js`'s "New: ..." quick-add forced every newly created item's name to lowercase, because the function lowercased its own `q` parameter for case-insensitive matching and then reused that same lowercased value as the new item's `name`. Keep the raw user input and the lowercased search key as two separate variables.
- **A language switcher must show each language's own name (an autonym), never a translation of it.** `t('languageHindi')` looked up the *current* UI language's word for "Hindi" — so viewed in English it correctly showed "Hindi", but was architecturally wrong (and the one place it was used inconsistently with the rest of the app): every other language toggle in this codebase (shell.js's login screen, the sidebar) just hardcodes `'English'` / `'हिंदी'` directly. Settings' language switch was the one place still calling `t()` for this; fixed to match.
- **A correlated subquery combined with a plain aggregate and no `GROUP BY` fails in Postgres** unless the correlated reference is itself inside the aggregate's argument: `select sum(balance) - (select ... where s.id = ...) from mob_sales s` throws "subquery uses ungrouped column s.id from outer query" (hit in `mob_report_dashboard`'s `customer_dues`). Fix: `select sum(balance - (select ... where s.id = ...)) from mob_sales s` — move the whole per-row expression inside `sum()`.
- **Two independent verification layers each caught real bugs the other layer could not see.** A raw-SQL scratch-DB script connecting *as the `app` role* (never superuser) proved the RLS-zero-policies design actually blocks a direct write while a direct `select` just silently returns nothing (not an error) — a distinction worth asserting on explicitly rather than assuming. A real-browser Playwright smoke test, with its `pageerror`/console listeners wired up and a debug script dumping actual rendered HTML, caught every one of the DOM-append and stale-navigation bugs above — none of which a raw API/SQL test could ever see, since they only exist in rendered markup.

### Open items after AUZsMob
- Camera barcode/IMEI scanning, WhatsApp-share/printed bills, spreadsheet item import, a first-run setup guide and a Bluetooth-printer hook are flagged, not built — see `docs/MOBILE.md`'s "Known limits".
- No marketing landing page (business-type page + `products.html` slab) was built for AUZsMob, specifically because `business-mobile-repair.html`/`products.html`'s existing `gsm` slab already markets a different, already-shipped product to the exact same audience (mobile phone shops) — adding a second, competing listing for the same audience without the owner's steer on how the two should coexist (replace it, run both, merge the copy) felt likely to create a confusing storefront rather than fix anything. Needs an owner decision before it's built.
- Vendor dues are an aggregate (`sum(purchases) - sum(payments)` per vendor), not traceable to one specific unpaid purchase — a known simplification, not a bug.
- Deploy not yet confirmed run by the owner.

## SESSION LOG, continued: AUZsMob staff-accountability + admin panel redesign session (PR #130-136)

Order of work, with PRs on `main` (all squash-merged unless noted; deploy for each is `git pull origin main` plus any DB/API step named):

1. **AUZsMob staff accountability ledger (PR #130, `db/086_mobile_staff_ledger.sql`).** Owner: "the main purpose of this app must be focus of staff work like work purchased what from whom, of how much, and sold of how much, in a single entry and in the end a total sum of thier profit, at a single place in table format." Added a per-staff ledger (`mob_report_ledger` RPC) to Reports, and a "Staff updates" tab (`mob_report_activity`, moved out of the Dashboard tab into its own space) in `p-reports.js`.
2. **Admin modal scroll + Products page bubble layout (PR #131).** Owner screenshots: the admin client-onboarding "services to allow" checklist modal couldn't be scrolled on phone (background scrolled instead), and `products.html`'s physics-bubble layout was broken. Fixed the modal scroll-lock and the bubble flow-mode CSS.
3. **Mobile UX glitch batch (PR #132).** Several screenshot reports in quick succession: a mobile-shop tenant was shown the POS option it was never entitled to (role-selection list wasn't filtered by what the tenant actually owns); the client menu footer had a dead gap below the nav links (`.sidebar-foot{margin-top:auto}` pushed it to the very bottom of a full-height flex column instead of sitting right after the content — changed to `margin-top:28px` in all four theme files); the admin onboarding products-selection modal still didn't scroll correctly on phone even after PR #131's partial fix; `account.html`'s `openPosLink` and `backoffice.html`'s drawer "Open POS" quick link were showing even when the tenant didn't have the `pos` feature (not gated on `featureOn()`); `PERM_KEYS` on the Roles tab was never filtered by entitlement at all, so a tenant only given AUZsMob still saw every other software's permission checkboxes. Also added `site/tool/lock.js` (an iOS-safe scroll-lock script for the marketing/tool pages, mirroring `app/public/ds/lock.js`'s pattern but watching `class` attribute changes via `MutationObserver` instead of childList, since the tool pages' `.sidebar`/`.modal-overlay` are toggled by class, not inserted/removed).
4. **AUZsMob sell/purchase: stock enforcement + staff new-item-entry (PR #133, two commits, `db/088_mob_staff_new_item_entry.sql`).** Two rounds on the same branch, same underlying area of the app:
   - Round one, bug report "There is no button to add new sale / no restriction to seel item which are not in inventory": `p-sell.js`'s `computeStock()` referenced a `movements` array that was never fetched, crashing the search for any non-serialized item. The real root cause of "no restriction on overselling": the server already refuses an oversold sale (`mob_push_sale`'s `sum(movements) >= qty` check), but `sync.js`'s outbox handler silently dropped a refused item with just a `console.warn` — the optimistic local write (the sale row, and for a serialized phone, the unit flipped to `sold`) stayed in IndexedDB looking saved forever, with no rollback and no notice. Added `rejectLocal(fn, args)` to `sync.js`, undoing the specific local write `mob_push_sale`/`mob_push_purchase` made, plus a "Not saved: ..." toast — the same "POS sync lesson" CLAUDE.md already documents for the old POS's `rejectLocal()`, which AUZsMob's sync engine had never actually implemented.
   - Round two, follow-up request "Allow staff and everyone to purchase new item custom new item ... and also allow them to sell new item which are not in entry": `mob_save_item` required `mob_manage` (owner/manager only) unconditionally — so a plain staffer's existing "New: ..." quick-add in Add purchase could never actually reach the server (it queued locally, looked saved, then got silently rejected — or after the round-one fix, rolled back with a toast). `db/088` splits the permission: creating a genuinely *new* item (`cur.id is null`) only needs `mob_purchase`/`mob_sell` (every staffer already has these by default, the same trust `mob_save_vendor` already extended to adding a vendor on the fly); editing an item that already exists still requires `mob_manage`, unchanged. Added the same "New: ..." quick-add to the **Sell** screen (`quickAddSellSheet` in `p-sell.js`), which had none before — picking it opens a small sheet (name/selling price/cost/qty in hand), creates the item *and* a real `mob_push_purchase` entry (so it shows up in Purchases/Reports with a real cost basis, not an untracked stock-less sale), then drops it straight into the cart. Verified end to end as a plain staff login (not owner/manager) against the real API: search → no match → "New: ..." → fill → save → lands in cart → checkout; server-side after, the item/purchase/sale all exist correctly and stock movements show +1 (purchase) then -1 (sale), net zero.
5. **Contact button clipped by the phone's rounded screen corner (PR #134, open, not yet merged as of this writing).** The floating "Knock, we'll answer" button sat at `right:16px;bottom:16px` — close enough to a real iPhone's physical corner curvature that the screen itself visually clips it (confirmed not a DOM/layout bug first: zero horizontal overflow, zero ancestor transforms, in a headless render at 375-430px). Pushed to `right:20px;bottom:22px` plus `env(safe-area-inset-*)` in the three shared stylesheets every marketing/product page loads from (`site/theme.css`, `site/kept/theme.css` — products/pos/billing/business-cafes — and `site/tool/theme.mobile.css`).
6. **Admin panel Apple-HIG redesign + Users directory/audit log (PR #135, `db/087_admin_users_audit.sql`).** Owner: "continue admin pannel work and rebuild whole desgin / Follow apple desgin guideline take less scroll and space for mobile." Rebuilt `site/admin.html`'s shell to the same tab-bar (phone: Leads/Clients/Pricing/Users/More)/sidebar (desktop: all ten sections flat)/bottom-sheet pattern the real staff apps already use, with responsive tables (`data-label` attributes on every `<td>`) — see the next entry for why that attribute alone wasn't enough. Resumed a previously-paused module: `admin_list_users`/`admin_user_detail`/`admin_set_user_disabled` (refuses self-suspension)/`admin_list_audit`, an `admin_audit` table (RLS on, zero policies — reads only through the SECURITY DEFINER function, same discipline as `pos_audit`/`acc_audit`), and `auth_users.disabled_at` wired into `app_uid()` so a suspended user's JWT stops passing *any* RLS check platform-wide the instant they're suspended, not just login. New endpoints `GET /admin/users/:id/sessions` / `POST /admin/users/:id/revoke-sessions` let an admin view and force-sign-out a user's active sessions. Two regressions were caught and fixed during verification, not present on `main` before this branch: the topbar title became a plain `<div>` during the rewrite (no `<h1>` on the page at all — caught by the marketing test suite); `checkSession()` set the sidebar/tab-bar visibility with inline `style.display`, which permanently outranks the `@media(min-width:900px)` rules meant to switch between them, so both stayed visible together at every width until fixed by dropping the inline style instead of hardcoding a value.
7. **Admin tables collapse to cards; drawer menus full height with curvy edges (PR #136).** Two more screenshot reports: admin.html's tables (Leads, Clients, Pricing, Users) had the `data-label` attributes from PR #135 on every `<td>`, but **no CSS anywhere actually read them** — so on phone the tables just overflowed sideways with each row stretched tall and mostly empty, instead of collapsing into the intended stacked cards. Added the missing `@media(max-width:639px)` rule (hides the header row — there's no `<thead>`, just a plain first `<tr><th>`, so it's hidden by position — stacks each `<td>` as its own block with the `data-label` as a small caption above the value). Separately, the owner first asked for the full-screen `account.html`/marketing-site hamburger drawer to shrink-wrap to its content (no dead space below "Sign out"), then explicitly reversed that: "I want full complete head to foot with curvy edge menu bar not half screen menu" — reverted to full height but added a rounded leading edge (16px inset on the left revealing the dimmed page behind it through rounded corners), scoped to phone widths only (the desktop fixed-width sidebar panel explicitly resets `border-radius:0`).

### Lessons from this session (worth re-reading before touching admin.html, AUZsMob's sell/purchase flow, or the shared drawer CSS)
- **A `data-label` attribute with no corresponding CSS rule is a silent no-op, not an error.** PR #135 shipped every admin table with `data-label="X"` on each `<td>`, explicitly intending the standard "hide the header, stack each cell with its label on phone" responsive-table pattern — but the actual `@media` rule reading `attr(data-label)` was never written, and nothing caught this (the attributes don't *do* anything by themselves, so there's no error, just a table that still overflows). If you add `data-label` to a new table, grep for `attr(data-label)` in the same file afterward to confirm the collapse rule actually exists — don't assume adding the attribute was the whole job.
- **Setting `el.style.display = 'value'` from JS permanently outranks a CSS `@media` rule meant to toggle that same element**, for as long as the inline style stays set — this is normal CSS specificity (inline always wins over any stylesheet rule), not a browser bug, but it's an easy trap when a login/boot function reveals a nav element once and never revisits it. `checkSession()` in admin.html did exactly this for `#adminSide`/`#adminTabbar`, so resizing the window after login never re-triggered the desktop-vs-phone switch. Fix: `el.removeAttribute('style')` (or toggle a class) instead of `el.style.display = '...'`, so the CSS media query regains control for the rest of the session.
- **A headless-browser render that looks perfect can still miss a real-device-only bug, and vice versa — always root-cause which one you're looking at before "fixing" it.** Two cases this session: (1) the "Knock, we'll answer" button's corner-clipping only exists on a real iPhone's physically-rounded display, confirmed by first proving zero DOM overflow in Chromium — the fix (more margin) was still correct, but guessing "it must be a layout bug" first would have wasted time hunting for a CSS overflow that didn't exist. (2) A seemingly reproducible drawer-width discrepancy between `account.html` (70px inset, 26px radius) and `products.html` (16px inset, 20px radius) looked like a bug for several debugging rounds, until directly inspecting the matched CSS rules showed `account.html` has its own pre-existing inline `#sidebarDrawer` style (an ID selector, correctly outranking the shared class rule) from earlier work — not a bug at all, just two valid, coexisting implementations. Don't assume a visual discrepancy is necessarily the thing you just touched; check what's actually winning the cascade before writing a "fix" for something that already works as intended.
- **An outbox sync engine that silently drops a server-refused write without rolling back the optimistic local change will always eventually look like "there's no restriction/validation" to whoever reports the bug** — even when the validation is real and correct server-side. This is the second time this exact shape has bitten AUZsMob (the stock-enforcement bug in PR #133) after already being documented for the old POS's sync engine (see "Local-first sync (the POS app specifically)" above) — if a new offline-first module's outbox `catch` block only does `console.warn` and moves on, that is the bug, not whatever the user thinks is missing on the server.
- **Reading a long, highly-detailed "master prompt" from a non-technical owner is still worth doing in full before reacting** — in this session the owner sent an extensive, 30-section implementation spec for AUZsMob's new-item-creation flow, almost all of which (new item from Sell, new item from Purchase, optional vendor, real stock movements, staff permission, IMEI/serial compatibility) was *already implemented and merged* two messages earlier. The actual, narrow gap the owner's own screenshots revealed was just a discoverability problem (the "New: ..." option only appears after typing a non-matching search query, with no static always-visible button) — identifying that precisely, rather than re-implementing the already-done 90%, is what the owner's own "do not rebuild, reuse existing architecture" instruction in that same prompt was asking for.

### Open items after this session
- **PR #134 (knock-btn corner-clipping fix) was still open, not yet merged, as of this writing** — everything else in this log (PR #130-133, #135, #136) is merged to `main`.
- A static, always-visible "+ New product" / "+ Quick purchase" button (not just the search-driven "New: ..." row) for AUZsMob's Sell and Add purchase screens was requested but not yet built — the underlying create-and-add flow already works end to end (see entry 4 above); this is purely a discoverability/UI addition on top of it.

## SESSION LOG, continued again: AUZsMob repairs/ledger/language + admin panel polish + Payroll kiosk fixes (PR #138-140)

A rapid sequence of screenshot bug reports across three different apps, each diagnosed to a real, confirmed root cause (never guessed/patched blind) and shipped as three separate PRs, each with its own real-browser and/or SQL-level verification plus the relevant regression suite green before merging. By the time this entry was written, PR #134 was still separately open (unrelated to this session, pre-existing), and `main` had also picked up two unrelated changes from outside this session (PR #141 enabling the Sentry DSN, and a commit reworking the drawer nav/knock-button/page-transition) — neither is covered by this log since neither was this session's work.

1. **AUZsMob: repair status label, staff-ledger cards, CSV export, language follow-through (PR #138, `db/090_mob_language_followthrough.sql`).**
   - Owner screenshot: the Repairs detail page's status segmented control showed the literal text `statusIn_repair` as a button label instead of "In repair". Root cause: `t('status' + cap1(st))` built its i18n lookup key by capitalizing only the first letter of the raw status (`cap1('in_repair')` → `'In_repair'`, underscore left in), but the dictionary key is camelCase (`statusInRepair`) — the built key never matched, so `t()` fell back to printing the raw key. Fixed with an explicit `STATUS_KEY` map in `p-repairs.js` instead of string-building the lookup key.
   - Owner: "Staff update should be in card format which contain Item name, Qty, Purchase price, Selling price, And profit — At once not separately." The Staff ledger tab's `dataView()` (the same generic table-on-desktop/list-on-phone component used across AUZsMob) only ever shows 4 of its 9 columns on phone (title/sub/value/badge slots) — qty and purchase price were stuck behind a tap into the detail sheet. Replaced the generic `dataView()` call for this one screen with a purpose-built `ledgerCards()` showing all five figures in a 2x2 grid per card; the full vendor/customer/staff chain is still one tap away in the existing `ledgerDetailSheet()`.
   - Owner: "final download report should be in excel sheet format not in codes format." The Reports page's "Export data" button called `mob_export_all()` (a raw JSON dump of every table — UUIDs, snake_case columns, nested item arrays — an owner-only full backup, not a readable report) and downloaded it as `.json`. Replaced with a CSV built from the same `mob_report_ledger` data the Staff ledger tab already shows (names already resolved, totals included, plain English headers), with a UTF-8 BOM so Excel renders the ₹ symbol and any Hindi names correctly. Left `mob_export_all()` itself untouched server-side (still a valid full-backup RPC, just no longer what the button calls).
   - Owner: "i want whole app to be in hindi and english langauge not just loginpage." Investigation found AUZsMob's internal pages were *already* fully wired through `t()`/`S_LANG` (zero hardcoded English strings found across all 8 `p-*.js` files) — the real bug was narrower: `shell.js`'s `boot()` unconditionally ran `setLang(ctx.my_language || 'en')` *after* login, discarding whatever language had just been picked at the pre-login sign-in screen (a purely local choice, since there's no account yet to save it against) the moment the real session loaded. `ctx.my_language` itself defaulted to `'en'` until someone explicitly visited Settings, because `mob_settings.language` was `not null default 'en'` — a shop that had never touched the setting was indistinguishable from one that had explicitly chosen English. `db/090` drops that default/not-null constraint (NULL now genuinely means "never set") and adds `mob_context().my_language_set`, so `boot()` can safely carry the login-screen pick through on a staffer's first login without ever clobbering a real, deliberate choice made later. Also added a one-tap EN/HI switch to the "More" sheet (previously only reachable through Settings, itself two taps deep from the tab bar).
   - Verified: `node tests/run-local.mjs mobile` (31/31) and `responsive` (288/288); `db/090` applied cleanly on a from-scratch migration chain; confirmed at the SQL level that `mob_context()->'my_language_set'` is `false` before any explicit save and `true` immediately after a real `mob_save_my_language('hi')` call.

2. **Admin panel: card layout, scroll-reset, blank gap below the tab bar (PR #139).** Three more screenshot reports, all in `site/admin.html`:
   - "Shift details along both sides of card to take less space." Leads/Clients/Users/etc. cards (the phone-collapse pattern from PR #136) stacked every field on its own full-width line. Changed the `@media(max-width:639px)` collapse rule from `display:block` stacking to a 2-column CSS grid, with known free-text fields (`Message`/`Note`/`Address`/`Problem`/`Description`/`Business`) explicitly spanning both columns via `td[data-label=...]` selectors so they don't get squeezed unreadably — roughly halves a typical card's height.
   - "Header is not appropriate, lines and text and buttons are overlapping" / "across all pages... same blank spacing." A Pricing-page screenshot showed its eyebrow label (`.label`) scrolled up under the sticky top bar while a Users-page screenshot (same markup shape: `.label` + `h2.h-2` + `p.p`) looked fine. Root cause: `openSection()`'s tab switch did `document.getElementById('aMain').scrollTop = 0`, which can lose to iOS Safari's own momentum scrolling if the tab is tapped while the previous page is still decelerating from a fling — the browser's inertia resumes right after the JS reset and re-applies a few pixels of scroll, tucking the new page's first line under the header. Fixed with the standard "toggle `overflow` off, reset, toggle back on next frame" workaround (`resetMainScroll()`), which kills the in-flight momentum before the reset so it actually sticks.
   - "Below nav bar there is blank space, remove it." `body.admin-shell` sized itself with the static `height:100%` while `.a-shell` (the flex column ending in the tab bar) used the dynamic `height:100dvh` — those two viewport metrics genuinely differ on iOS Safari whenever its own toolbar is showing, so `.a-shell` could come up shorter than `body`, exposing a sliver of `body`'s own background below the tab bar. Fixed by only giving `body` the explicit viewport-relative height and having `.a-shell` just flex to fill it — one measurement, nothing left to disagree with it.
   - Verified: `node tests/run-local.mjs journeys` (7/7, logs into admin.html) and `responsive` (288/288); a real headless-browser check confirmed the lead card renders as a 157px/157px two-column grid and `.a-tabbar`'s bottom edge exactly matches `window.innerHeight`.

3. **Payroll: kiosk back-navigation stuck, accidental-clock-out lockout (PR #140, `db/089_payroll_punch_duplicate_window.sql`).**
   - Owner: "in payroll kiosk clock page i am not able to go back, if i go back it automatically puts me back on same page." `openKiosk()` (`p-me.js`) builds a raw full-screen `position:fixed` overlay appended straight to `document.body` from a button's `onclick` — it is not a route, so `location.hash` stays on `#/kiosk` for as long as it's open. A phone's swipe-back gesture still changes the hash underneath it though, silently re-rendering the page behind the still-visible, still-opaque overlay — which reads as "pressing back does nothing." Since leaving the kiosk is deliberately password-gated (a shared device shouldn't let anyone swipe their way back into the real app), the fix is a `hashchange` guard that snaps the hash back to `#/kiosk` with a `toast()` explaining why, instead of silently doing nothing.
   - Owner, same thread: "employees are not able to clock in once they by mistake punch out and try to punch again." `pay_me_punch`/`pay_kiosk_punch` both blocked *any* punch within 60 seconds of the previous one as a double-tap guard, with no check that the new punch was actually repeating the same action — clock in/out always flips (computed fresh from the current open/closed state), so a genuine "wrong button, let me fix it" correction made 10-59 seconds after a mistaken punch was silently swallowed identically to a real double-tap, with the UI just showing `duplicate:true` and nothing happening. Shrunk the window from 60s to 8s — comfortably past what a real double-tap or a client network retry actually needs (both happen within a couple of seconds), while leaving a same-minute correction free to go through.
   - Verified: `node tests/run-local.mjs payroll` (32/32); `db/089` applied cleanly on a from-scratch migration chain; at the SQL level (a demo-tenant employee's `user_id` linked for the test), a punch sent 9 seconds after the first — past the new 8s window, still inside the old buggy 60s one — correctly opened a new clock-in instead of returning `duplicate:true`, while an immediate repeat was still correctly blocked; a real headless-browser check confirmed the kiosk overlay stays open and the hash snaps back with a toast when the hash changes underneath it.

### Lessons from this session
- **A naive string-built i18n key (`'status' + cap1(rawValue)`) silently breaks the moment the dictionary's naming convention doesn't match the raw value's shape** (snake_case source data, camelCase dictionary keys) — `t()`'s fallback-to-the-raw-key behavior means this fails *silently and visibly* (a broken-looking key shown right on screen) rather than throwing, so it reads to a non-technical owner as "the feature is broken," not "a label is wrong." An explicit status→key map removes the guesswork entirely; prefer that over any naming-convention-matching cleverness whenever the two namespaces don't provably line up.
- **A migration that does `create or replace function` on something that's already been `create or replace`'d by a *later* file than the one you remembered must be re-diffed against the actual latest definition, not the one you have in your head.** `mob_context()` was defined in `db/081`, then redefined in `db/084` to add the demo-tenant auto-reseed block — a first draft of `db/090` reproduced `081`'s body (forgetting `084` existed), which would have silently deleted the auto-reseed logic for every demo tenant the moment it shipped. Caught only by noticing the file's own docstring referenced the auto-reseed behavior and grepping for every other `create or replace function mob_context` in `db/` before finalizing the migration — always do that grep for any function with more than one definition in the migration history.
- **A boolean/flag column that's meant to answer "was this ever explicitly set" cannot be backed by a `not null default` column** — `mob_settings.language` being `not null default 'en'` meant every tenant's shop-wide language setting looked identical whether the owner deliberately chose English or had simply never opened Settings, making any "is this explicit" signal derived from it meaningless. The fix had to touch the schema itself (drop the `not null`/`default`, let `NULL` genuinely mean "unset"), not just add a new computed field on top of the existing column.
- **`scrollTop = 0` is not a guaranteed reset on iOS Safari if a momentum/fling scroll from a previous gesture is still decelerating** — the browser's own inertia can re-apply a few pixels of scroll on the very next frame after a plain synchronous reset, silently undoing it. The robust fix is the known workaround (toggle `overflow` off to kill the momentum, reset `scrollTop`, restore `overflow` on the next animation frame), not a plain `el.scrollTop = 0`.
- **Two sibling elements each computing "fill the viewport" independently, one via a static unit (`height:100%`, ultimately resolving against the same metric as `100vh`) and the other via a dynamic one (`100dvh`), can disagree by exactly the height of a mobile browser's own retractable toolbar.** Whenever a layout needs "fill the real visible viewport," give exactly one ancestor in the chain an explicit `100dvh` (or equivalent) and have everything below it fill via flex/`height:100%` relative to *that* ancestor — never give two different elements in the same chain two different viewport-relative units and assume they'll agree.
- **A repeated "Stop hook feedback: branch has unpushed commits" warning, even checked and found false multiple times in a row, is worth re-verifying against the actual remote (`git ls-remote origin refs/heads/<branch>` compared to local `git rev-parse <branch>`, or the PR's `head.sha` via the GitHub API) every single time rather than assumed-still-false from memory** — in this session the hook kept firing after work was not only pushed but already merged into `main`, confirmed independently via `git merge-base --is-ancestor <branch> origin/main`. This repo's local git config only fetches `refs/heads/main` (`+refs/heads/main:refs/remotes/origin/main`), so `@{upstream}`-based tracking info for every other branch is unreliable here specifically — a known, repo-specific quirk, not a general git behavior to expect elsewhere.
- **The VPS deploy's two most common real failure modes are both already documented in this file and both recurred this session**: forgetting `set -a; source .env; set +a` before a migration (`$POSTGRES_USER` empty → psql falls back to the OS user `root`, `role "root" does not exist`), and using `-f db/0NN.sql` instead of `< db/0NN.sql` (the container's filesystem doesn't have `db/` mounted). When giving deploy commands to the non-technical owner, always include the `source .env` line explicitly rather than assuming a previous session already taught them to do it first.

### Open items after this session
- PR #134 (knock-btn corner-clipping fix) was reported still open as of the PRs in this log, but `main` has since separately picked up a different, unrelated commit touching the same button ("hide knock button while open") from outside this session — worth checking PR #134's diff against current `main` before merging it, in case it now conflicts with or duplicates that later change.
- The owner asked about a "red line glitch" across the whole AUZsMob app with no screenshot attached; a follow-up screenshot clarified it was the owner's own red-pen screenshot annotation, not an actual rendering bug — nothing was changed for this report.

## App identity: icons, manifests and the launch animation (`tools/make-icons.mjs`)

Every staff app has its **own** manifest (own `id`, `start_url`, `scope`), own touch icon and own launch animation. Before this, Back Office, the console and the Builder all linked the POS manifest (`/manifest.json`, `start_url:"/"`) and POS icon, so a home-screen icon added from them opened the POS. Apps: POS (`manifest.json`), Payroll, Accounting, AUZsMob, Back Office, Console (`dashboard.html`), Builder: `manifest-<app>.json`, `icon-<app>-512.png` / `-180.png` (full-bleed square: the OS rounds it; a pre-rounded PNG shows black corners), `icon-<app>.svg` (rounded, for tabs).
- **`node tools/make-icons.mjs` regenerates all icons AND `app/public/ds/launch.js`** from one definition (the marks), so icon and animation stay identical. Edit the marks there, never the generated files.
- **`ds/launch.js`** (`<script src="/ds/launch.js?v=1" data-app="mob">` first thing in `<head>`): draws the mark piece by piece on ink, glow, name letters, then lifts away once `#app` has content (min 1.5 s, max 4 s, 0.3 s under reduced motion). It replaced the old `boot-splash.css/js`.
- Deploy: static only. Owners must delete the old home-screen icon and add it again (iOS caches the old icon/manifest). Add the icon from the app's own address (`<slug>.auzslab.in/mob.html`), not from the bare shop address.
- Test note: in the sandbox the `apps` suite shows 2 failures from the Sentry CDN being unreachable (`ERR_TUNNEL_CONNECTION_FAIL`); that is the network, not the app.

## Clean-up wipe + owner Backup/Export/Clear (db/097)
See `docs/DATA_WIPE.md`. `db_data/wipe_all_but_demo.sql` (dry run by default, `-v confirm=yes` to delete) removed all clients except `showoffsalon`, `demo-salon`, `demo`.
`my_data_export` / `my_data_clear` (owner only, demo refused, typed slug + forced backup in the UI `ds/mydata.js`) are in every staff app and `account.html`.
Clear keeps logins, settings/setup and audit tables; it bypasses append-only guards via `session_replication_role = replica` inside a SECURITY DEFINER function.
## Production grants differ from a fresh test build (db/094)

In production `999_app_grants.sql` ran long before the `pay_*`, `mob_*` and `acc_*` tables existed, so the `app` role has **no rights on those tables** (they are only reachable through SECURITY DEFINER functions). In a fresh test build 999 runs last and grants everything, which hid a real bug: the deferred trigger `pay_check_balanced()` (not SECURITY DEFINER) read `pay_journal_lines` at COMMIT as `app` and failed with "permission denied for table pay_journal_lines" (Payroll would not open / finalise). `tests/lib/db.mjs` now revokes `app` on those tables after the build so tests behave like production. **Every trigger function (especially deferred constraint triggers) and helper that touches a pay_/mob_/acc_ table must be SECURITY DEFINER.** `db/094_fix_trigger_definer.sql` fixes all existing ones.
## Staff sign in with username + PIN (db/096) and adding staff without a custom role (db/095)

Owners/managers sign in with email, Google or phone as before. **Shop staff can sign in with a username + PIN** (no email): the owner adds them under client dashboard -> Staff ("How will they sign in? Username + PIN"), `staff_create` makes the username `<name>.<company slug>` (so no other company can ever hold it; a clash within a company gets a number) and a random PIN (4 digits, 6 for managers / roles with settings or mob_manage). The PIN is shown once; the owner can reset it (`staff_reset_pin`, also clears a lockout), turn the login off/on (`staff_set_active`, `profiles.login_off`) or set the outlet (`profiles.outlet_id`; the POS applies it as `localStorage.outlet` for non-owners).
- **Server:** `POST /auth/staff-login {username, pin}` -> `staffLogin()` in `server/src/auth.js`. Same reply shape and session (jti, revocable) as `/auth/login`. Lockout: 5 wrong PINs for a username = locked 15 min, stored in `staff_pin_fails` (survives restarts, not dodgeable by switching network), plus 40 attempts / 15 min per IP; unknown usernames do the same work and give the same "Wrong username or PIN". PIN staff have no password (`password_hash` null), so a PIN can never be used at `/auth/login`; their synthetic email is `<username>@staff.auzslab.in` (never mailed).
- **PIN uniqueness:** only within one company (`auth_users_pin_fp_idx`, sha256 of tenant+PIN); 10,000 values cannot be unique worldwide and the PIN is only ever checked together with the username.
- **Apps:** every staff app login (POS, Payroll, Accounting, AUZsMob) has a third "Staff" tab built by `ds/staffpin.js` (`auzStaffPinForm`, button text is "Continue" on purpose: tests click the last button matching /sign in/). `sb.auth.signInWithStaffPin` exists in both `sb-client.js` copies. A PIN login for another company's username is refused by the apps' existing tenant check.
- **No custom role needed (db/095):** `invite_staff` / `staff_create` accept no role = standard staff (`cashier`) or `p_builtin='manager'`. A new business has no roles, which used to disable the Add staff button entirely.
- `profiles` columns exposed to the API are whitelisted in `server/src/index.js` (`username`, `outlet_id`, `login_off` added); a new column the apps read must be added there or the request is a 400.
- Deploy: pull, `psql ... < db/095_staff_default_role.sql` then `db/096_staff_username_pin.sql`, `docker compose up -d --build api`.
- Tests: mobile suite (staff_create, sign in, lockout, reset, turn off, manager 6 digits, other company, Staff tab on the AUZsMob login). Note: `tests/suites/local/pos.mjs` used `on conflict (email)` which stopped matching after db/085 made the email index partial; it is `on conflict do nothing` now.

## Sign-up safety and launch operations (db/092, `docs/LAUNCH_DIGITAL.md`)

Owner request: the sign-up had no real email check (a fake address worked everywhere), so before real shops arrive: verification, a CAPTCHA, monitoring and proven backups. The owner's partner handles registration, tax and the bank; everything digital is in `docs/LAUNCH_DIGITAL.md` (read it: it holds the click-by-click steps for the things only the owner can do).

- **Email verification.** `auth_users.email_verified_at`; every account that existed at migration time is grandfathered as verified. A password signup starts unverified and gets a one-time link (`email_verifications`, only the SHA-256 is stored, 24 h, bound to the address that was mailed) to `site/verify-email.html`. Google, Apple and phone accounts are verified by their provider. Admin-provisioned users are created with `verified: true`.
- **The requirement is a runtime switch, not a deploy.** `platform_flags.require_email_verification` ('off' by default). While off, nothing is blocked. When 'on', `requireVerifiedEmail()` in `server/src/index.js` refuses `submit_signup_request`, `submit_addon_request` and `POST /payments/create-order` with a 403 whose message contains "confirm your email address" (`site/cart.html` watches for that text and offers a resend button). Turn it on only after Resend sends from the verified `auzslab.in` domain: with the test sender, real people never receive the link and would be locked out. Tests flip it with SQL and set it back.
- **Pre-hijack guard** in `findOrCreateIdentityUser`: linking Google/Apple to an account whose email was never proven drops that account's password and sessions (someone else may have registered the address first).
- **CAPTCHA** is Cloudflare Turnstile (`server/src/captcha.js`), dormant until `TURNSTILE_SECRET_KEY` is set; it fails closed if Cloudflare cannot be reached. Only `/auth/signup` requires it (the apps' login and forgot-password screens do not carry a widget, so those endpoints are deliberately not gated). The public site key goes in `window.CFG.turnstileSiteKey` in `site/signup.html`.
- **Links in emails** use `PUBLIC_SITE_URL` or `https://$DOMAIN`, never a client-supplied base. (`/auth/forgot` still takes `reset_link_base` from the request: a known weakness, an attacker can request a reset email whose link points at their own site. Fix it the same way when touched.)
- **`GET /health`** (also HEAD) for uptime monitors: `{ok, db, uptime_s}`, 503 if the database cannot be reached. Uptime Kuma already runs at `status.auzslab.in`.
- **`server/src/maintenance.js`** runs a minute after boot and daily: deletes sessions older than 30 days, phone codes older than 2 days, expired reset and confirmation links older than 7 days. `DISABLE_MAINTENANCE=1` turns it off.
- **`tools/restore-test.sh`** restores the newest backup into a scratch database, compares row counts with the live one, prints PASS/FAIL, drops the scratch copy, and shows the newest off-site (Backblaze) file. It never touches live data. Run it weekly. `PSQL_CMD`/`BACKUP_DIR`/`LIVE_DB` let it run away from the server (that is how it was tested).
- **Tests:** `node tests/run-local.mjs signup` (12 checks). The load test `loadmob` (see `docs/MOBILE.md`, "Scale") runs only when named.
- **Deploy:** `git pull`, `psql ... < db/092_email_verification.sql`, `docker compose up -d --build api` (server changed). Static pages need nothing.

## Renewals + plan in every app (db/098)
See `docs/RENEWALS.md`: `my_subscription()`, daily `renewal_notify_run()` (in-app notices + owner email), `ds/plan.js` (reminder pill, Plan & account sheet, sign-in links to `cart.html?add=<product>&from=<app>`).
Also merged from old branches (release-1): staff username+PIN login (db/095-096), Payroll grants fix (db/094), email verification/CAPTCHA/health/cleanup job (db/092, dormant until keys), API pool 35.

## Google sign-in: one central page (site/signin.html)
Google OAuth cannot list every `<shop>.auzslab.in`, so it only knows `https://auzslab.in` and `https://www.auzslab.in` (Google Cloud project `auzslab`, OAuth client "AUZslab web", external, published; client ID in `app/public/config.js`, `site/signup.html`, `site/signin.html`).
Apps show "Continue with Google" via `ds/gsignin.js` (`auzGoogleLink`), which links to `https://auzslab.in/signin.html?app=<app>&return=<app page>`. That page runs Google Identity Services, calls `POST /auth/google`, and returns the session to the app in the URL fragment `#auz_gt=<base64url {t,u}>` (never sent to servers); `sb-client.js` (`takeHandoff`) saves it and clears the fragment. The return address must be `https://*.auzslab.in` (or localhost when the page itself runs on localhost): anything else is refused.
The server needs `GOOGLE_CLIENT_ID` in `.env` (same ID) to verify tokens, then `docker compose up -d api` (restart is enough, no rebuild).
- **Update (redirect flow):** the popup widget (Google Identity Services) failed on iPhone browsers, so `site/signin.html` now does a full-page redirect: app/signup -> `signin.html?app=..&return=..` -> `accounts.google.com/o/oauth2/v2/auth?response_type=id_token` -> back to `signin.html#id_token=..&state=..` (nonce checked against sessionStorage) -> `POST /auth/google` -> app with `#auz_gt=`. **Google Cloud > Clients > "AUZslab web" must list `https://auzslab.in/signin.html` under Authorized redirect URIs.** `site/sb-client.js` also consumes `#auz_gt`. `www.auzslab.in/signin.html` hops to the apex first (sessionStorage is per origin).

## Standing rule: a change is not done until everything linked to it is changed too (owner instruction)
When a behaviour changes (a login method, a field, a price, a URL), search the whole repo for every other place that mentions or depends on the old way and change those in the same piece of work: marketing and demo pages (`site/*.html`), demo accounts and seed data (`db/`, `server/src/salon-seed.js`), tests, docs, CLAUDE.md, the service-worker file list. Example that was missed once: the salon console moved to username + PIN but the live-demo, demo and salons pages still told people to use a phone number and password. Grep for the old wording before finishing, and say in the summary what else was updated.

## Sign-up is Google only (db/100)
`site/signup.html`: the Sign up tab offers only "Continue with Google" (Google proves the email, so no confirmation mail); Log in keeps Google plus email + password with Forgot password. The Phone tab is gone from the site and from the POS, Payroll, Accounting and AUZsMob logins (staff username + PIN stays). The server also refuses direct `POST /auth/signup` while `platform_flags.password_signup = 'off'` (the db/100 default; tests switch it on in `tests/lib/db.mjs`). `require_email_verification` stays off. Re-enable email sign-up: `update platform_flags set value = 'on' where key = 'password_signup';`.

## Launch prep notes
- `docs/LAUNCH_CHECKLIST.md` is the owner's go-live list; `docs/DEVELOPER_GUIDE.md` is the hand-over guide; `README.md` was rewritten (it used to describe a never-built Next.js stack).
- Password-reset links: `/auth/forgot` no longer trusts the caller's `reset_link_base`; `safeResetBase()` in `server/src/index.js` only allows our own domain (or localhost when running locally), else falls back to `/signup.html`.
- Salon staff signing in with username + PIN are linked to a payroll employee automatically on first sign-in when the Payroll add-on is on (`salon.js`, `salon_hr_ensure` with no phone); if Payroll was off at the time, the owner's existing "Link to payroll" button still works.

## AUZsMob pricing + pay by UPI QR (db/101)
- AUZsMob: Rs 199 a month, no GST, no setup fee; yearly Rs 1,999 (first year), Rs 1,599 a year from year two (renewal is followed up by hand, `product_prices.renewal_yearly_price`). The rules are data on `product_prices` (`gst_exempt`, `setup_fee_exempt`, `yearly_price`, `renewal_yearly_price`; `public_product_prices()` returns them). `server/src/payments.js` (`priceInfo`, `billFor`, `createOrder({period})`) and `site/cart.html` (`billFor`, `yearlyEligible`, the Monthly/Yearly switch) must stay in step; yearly is offered only when every product in the cart has a yearly price and no bundle applies. In a mixed cart only the non-exempt part carries GST and the setup fee still applies. Verified against the real `createOrder()` (199 / 1,999 / 3,556.82 for POS + AUZsMob; yearly refused for the mix).
- Pay by UPI QR (manual route while Razorpay is off): `site/cart.html` shows a QR with the exact amount for `CFG.upiId` / `CFG.upiName` (set in the inline `window.CFG`, currently the owner's personal PhonePe id: replace with the business id), plus a UTR field; the claim travels in the request notes (`[UPI payment of ... claimed, reference ...]`, `[Billing: YEARLY plan]`) and the admin approves after matching it in the bank app. It hides itself when Razorpay is on. `site/vendor/qrcode.js` is a copy of the app's vendored library.
- Deploy: `psql ... < db/101_mobile_pricing_yearly.sql`, `docker compose up -d --build api`, `git pull`.

## Salon home-screen icon + look presets (per-salon identity)
- Every salon page links `/api/manifest.json` (admin: `?app=admin`) and `/api/icon/{32,180,192,512}.png` instead of Showoff's static files. `server/src/salon.js` builds them per tenant: the uploaded logo (`settings.logoLight` else `logo`, uploads only) centred on a tile in `theme.plum` (light tile if the logo would vanish), or the salon's initials when there is no logo. Cached in memory; `showoffsalon` redirects to its original static icons; any failure falls back to the static icons. Uses `sharp` (added to `server/package.json`, so the API needs `docker compose up -d --build api`).
- Looks: Settings -> Branding -> Style sets `theme.shape` (square/pill; default soft) and `theme.font` (classic/friendly; default Hanken Grotesk), applied by `applyBrand()` in `salon/assets/dom.js` (system fonts only, no CSP change). Anything beyond colours/logo/photo/shape/font is a paid custom design, not the template.
- Test: salon suite checks the manifest and that the icon changes when a logo is uploaded.
- Still static per-tenant limits: social-share image (og) and the apple-touch icon on pages that never load this API.

## Included modules + salon share preview
- **CRM, Billing & Invoicing and Inventory are not sold separately** (owner decision). They stay on `products.html` and their own pages, but the button reads "Included with AUZsPOS" and `AUZcart` (all three `site.js` copies: `site/`, `site/kept/`, `site/tool/`) never stores or returns `crm`/`billing`/`inventory` (`INCLUDED` list). Their `product_prices` stay at 0; admin Pricing shows them as "Included" with no price box. Entitlement is unchanged (the niche presets still switch the features on).
- **Link previews for salons:** Caddy sends WhatsApp/Facebook/Twitter/Telegram/LinkedIn/Slack/Discord crawlers asking for `/` or `/salon/` to `/salon-api/share` (server/src/salon.js), which returns the salon's own og title/description and `/api/og.png` (brand card with logo or name). Normal visitors are unaffected. Needs `docker compose restart caddy` and an API rebuild (fonts package added to `server/Dockerfile` so the text renders). Showoff keeps its original og image.

## AUZsGSM removed
The standalone AUZsGSM listing is gone (owner decision): no `gsm` feature in the admin client editor, account page or cart, and the `gsm.<domain>` Caddy block and the caddy `extra_hosts` entry that served it were removed. AUZsMob is the only mobile-shop product. If the old standalone stack is still running on the VPS, stop it there by hand (`docker compose down` in its own folder). `gsm.auzslab.in` now falls through to the wildcard (no tenant).

## UPI QR removed from the cart
The owner's personal UPI id was taken out of `site/cart.html` (`CFG.upiId`/`upiName` are blank, so the QR card stays hidden). Until Razorpay is on, the cart only sends a request and the owner contacts the customer. Put a business UPI id back in the same two fields to re-enable the manual QR route.

## Store apps (Android), WhatsApp share, online-order tagging
- **Android wrapper** (`mobile/`, `.github/workflows/android.yml`): Capacitor shell that opens the live apps (`apps.json`: hub, pos, mob, payroll, accounts; URL goes through `site/open.html`, the shop picker). Run "Android build" from the Actions tab with app = all. It always makes a test APK; with the four `ANDROID_*` secrets set (`docs/ANDROID_RELEASE.md`) it also makes the signed `.aab` for Play. Store assets are in `store/`, listing text in `docs/STORE_LISTING.md`. No Android SDK exists in the sandbox, so only the cloud build proves it builds; nothing has been run on a real phone yet. Google sign-in is hidden inside the app (`AUZslabApp` user agent, `ds/gsignin.js`).
- **Push on Android:** the browser Web Push used by the POS (`pos/staff.js`, `server/src/push.js`) does not work inside an Android WebView. Native push needs a Firebase project (`google-services.json` in the wrapper, a server key and a send path in `push.js`): an owner decision, not built.
- **WhatsApp bill sharing** is free `wa.me` links, no API: POS (`pos/print.js`), Accounting, the salon console, and now AUZsMob sale receipts (`p-sell.js` `waShareSale`). Automatic sending (WhatsApp Business API) is a paid add-on that needs Meta verification: not built.
- **Online orders (Zomato/Swiggy):** manual route only. POS Delivery orders choose the source (`DELIVERY_SOURCES`) and now also record the platform order number (`order.extRef`); Takeaway orders get the same through `pickupSourceSheet`. The console's platform pages count `order.src` for commission and payout. Automatic arrival needs a connector or partner approval: see `docs/ZOMATO_SWIGGY_PARTNER.md`.
- `tests/suites/local/journeys.mjs`: the buying-journey sign-up checks now match the Google-only sign-up (no email boxes on the Sign up tab).

## Customer profile + cart in the account dashboard (db/103)
- `account.html` now works for a signed-in person with **no business yet** (a new customer): `my_dashboard` answers "authentication required" for them (no staff record), so `boot()` probes `my_profile` (needs only the login) and, if it works, runs `bootProspect()`: a light dashboard with **My profile** and **My cart** only (tenant-only tabs carry the `tenant-only` class and are hidden). Business owners see the same Profile tab and cart link plus their usual tabs.
- **Profile** = `user_profiles` (db/103; RLS on, no policies, only `my_profile()` / `save_my_profile(p)` / `admin_list_profiles()` touch it, all registered in `server/src/index.js`): name, phone, contact email, business name, business type, niche, city, optional address, outlets, staff count, products wanted (keys incl. `whatsapp`, `aggregators`, `custom`), current software, when to start, notes. The admin panel's Leads section lists them under "Customer profiles". `cart.html` pre-fills its form from the profile.
- **Cart layout:** `cart.html` is two columns on desktop (items and bill left, details form right, sticky), one column on phones (`.cart-cols`). The cart is also reachable from the account menu ("My cart").
- Deploy: `psql ... < db/103_user_profiles.sql`, `docker compose up -d --build api`, `git pull`. Test: journeys suite (profile save/read, admin list, non-admin refused, account page for a customer without a business).

## Footer + sitemap
The marketing footer (every `site/*.html` with `<footer class="footer-dark">`, 22 pages) now has six link columns (Products, Who it's for, Explore, Connect, Legal + the brand column with a one-line description). The brand column's address line is filled from `site/company.js` (`address`) and hidden while empty, so those pages also load `company.js`. A human sitemap page is `site/sitemap.html` (linked from the footer, listed in `sitemap.xml`). When a new public page is added: add it to the footer if it matters, to `sitemap.html` and to `sitemap.xml`. The footer block is repeated per page (no include), so change it with a script across all 22 files.

## CRM / Billing / Inventory pages: no demo, any-business copy
`crm.html`, `billing.html`, `inventory.html` no longer have a "Try it yourself" demo block (the demo opened the cafe POS, wrong for bookstores, salons etc.). In its place each has an "Any business" card listing how the module fits a cafe, salon, bookstore/retail, clothing and mobile shop (only claims features that exist), plus "included with AUZsPOS (and the Salon app), nothing separate to buy". The AUZsPOS page keeps its demo. Don't add a demo back to these three.

## Product names (owner wording) and the menu
Products are written **AUZsPOS, AUZsPOS QR, AUZsPay, AUZsLedger, AUZsMob** (capital AUZ, lower-case s), plus Website Builder and Custom build. The site menu (Products submenu on every page) lists exactly those seven; CRM, Billing & Invoicing and Inventory are parts of AUZsPOS (and Salon) and are no longer menu items (their pages still exist and are linked from the sitemap and "Pairs well with"). The names were renamed repo-wide (word-boundary regex, careful: `Auzslab@Demo` is a password, not a product), in `db/104_product_names.sql` (product_prices and bundle labels), cart/account labels, manifests, store banners and docs. Use the same spelling in anything new.

## Admin panel loads sections on demand
`site/admin.html` no longer fires every loader at sign-in (about 11 database requests at once). Only Leads (and customer profiles) load, plus the client list the access check already fetched; every other section loads when opened and again if its data is older than 20 s (`SECTION_LOADERS` / `ensureSectionLoaded`). When adding an admin section, register its loader there. The API's connection pool is 35 (`PG_POOL_MAX`, `server/src/db.js`); the "DB connections" card in System resources compares against that same number (`APP_POOL_MAX` in admin.html: keep them equal). Test: journeys suite (sign-in request count, Pricing loads on open).
