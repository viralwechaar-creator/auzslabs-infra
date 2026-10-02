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
  demos) and a staff login `9000000001` / `Auzslab@Demo`. `makeDemo()` adds a
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

Back Office, Payroll and Website Builder link `/hig.css` right after their own inline `<style>` (the POS did too until its rebuild; it now has its own HIG system, see "Restaurant POS rebuild" below). It is a restyle only
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
- Not yet redesigned per device: Back Office, Payroll, Builder and console have separate phone/desktop files but still share today's layout; their desktop-specific design is the next step (screenshot-driven). The POS has its own phone and desktop layouts since its rebuild (`pos.mobile.css` / `pos.desktop.css`).

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
  in dark mode). Console: `retoken`ed (no hex colours left in `console/*.css|js` except the logo). Back Office, Payroll,
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
  - Payroll: People / Pay / Settings (`PNAV`).
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
- **Staff apps that load hig.css (Back Office, Payroll, Builder) behave differently from POS/Accounting.** Anything global you put in `ds/legacy.css` hits all three; scope with `html.ax-bo` (Back Office) or `html:not(.ax-bo)`.
  `ds/lock.js` selectors: the console has a permanent `#ov` element, so it is matched as `#ov.show` only.
- **Two staff apps still locked to light appearance** (`data-theme=light`): Back Office, Payroll, Builder, until their inline colours are retokened (listed in `docs/UI_REDESIGN.md`, "Known gaps").
- **Never claim an iPhone fix works from a desktop screenshot alone.** State what the tests assert and what only the owner can confirm on the device.
- **Git:** work on a branch from `origin/main`, commit with the attribution lines the session reminder gives, push, open a PR with the GitHub MCP tools, then squash-merge. The "squash-merge SHA divergence" note above applies to long-lived branches only; fresh
  branches from `origin/main` merge cleanly. A stop-hook asks for committed + pushed work at the end of every turn.
- **Owner preferences (standing):** build a lot, talk little; one summary at the end; plain language (the owner is not a developer); give copy-paste deploy commands; ask before inventing features; reference screenshots are references, not specs.

### Open items (nothing blocked on code, all need the owner or a decision)
- Retoken Back Office / Payroll / Builder inline colours so they can follow dark mode and drop `ds/legacy.css` overrides.
- Console has no automatic icon rail at 900-1199px; no hinge-aware foldable layouts; no saved views / pinned modules in POS or Accounting.
- Real-device confirmation of the iPhone fixes above (blank strip, scroll lock, menus). Ask for a new screenshot if anything still looks wrong.
- From earlier in the project and still open: historical Showoff Salon data import (needs an export from the owner), Zomato/Swiggy API integration, server-side stock ledger and posting POS sales into Accounting (POS_AUDIT backlog), renumber the duplicate db/049 / db/050 files.
