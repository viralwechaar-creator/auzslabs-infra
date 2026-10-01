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

`app/public/index.html` is offline-first: writes go to IndexedDB first
(`save()`), then an outbox syncs to the server via the `push_record` RPC
(optimistic concurrency, conflict-resolves by re-pushing with `force:true`
on a version mismatch) — see `doSync()`. `sync()` is fire-and-forget, not
awaited by the UI, so a "Saved" alert firing does **not** mean the server
write actually succeeded; check `push_record`'s error handling / the
`syncErr` counter, not just what the button said.

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
Color-coding (veg/non-veg, order type, table status) uses `swatch(color)`
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

Do this for every file touched (`index.html`, `backoffice.html`,
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
- **Stack panels:** `fx-stack.js` (on every fx page) wraps `main.content`'s blocks in `div.stack.fx-stack > section.stack-panel.fx-panel`
  (the original sticky overlapping panels with the big tab word, WORK/BUILD/VIEW/...; short blocks are merged until a panel is
  about a screen tall; `.closer` becomes the dark panel). `layout()` sets each panel's `top` to `min(base, innerHeight - panelHeight)`
  so a panel taller than the viewport can still be read to its bottom. The homepage hero is the minimal editorial layout (`.hero2`: grey desk illustration + Business list, tagline, quick-link nav, giant AUZslab wordmark bottom-right), then the panels written by hand (`hp-*`). Panels are min-height 92svh and `layout()` only writes `top`/`z-index` when they change (writing them every frame made the scroll feel like it vibrated).
  On phones: no `mix-blend-mode`, no SVG filters, no fixed full-screen overlays (they cost frames on iOS). The fx suite scrolls
  every page at phone/tablet/desktop and checks overlapping text blocks (ignoring `.stack-panel`; scroll with `behavior:'instant'`
  because theme.css sets smooth scrolling).
- **Intro retired:** the cube loader/blast no longer runs (`SHOW_INTRO = false` in `sketch.js`); the page just opens. The homepage hero ends in the big pixel `logo.png` (`.h2-word`).
- **Panels are split to fit a screen:** `fx-stack.js` splits any panel taller than a screen into continuation panels (`.fx-cont`; short first parts get `.fx-compact`) so each one pins, pauses and gets covered. `top` is only recomputed on width changes (phone toolbar resizes must not move sticky panels); a panel that still can't fit is left `position:relative` so it scrolls through. Reveal animations are fade + 14px rise only (sideways/rotating blocks inside sticky panels made scrolling shaky on iOS).
- **Intro blast (old):** `sketch.js` flies particles to elements marked `[data-blast]` (falls back to headings/buttons).

## Staff apps: Apple HIG layer (`app/public/hig.css`)

POS (`index.html`), Back Office, Payroll and Website Builder link `/hig.css` right after their own inline `<style>`. It is a restyle only
(no markup or behaviour): system typeface and a real type scale (body 16, nothing under 12), 44pt minimum hit targets on buttons/inputs/tabs,
segmented-control tabs, grouped rounded cards with hairline separators, a bottom-sheet for `.md` modals on phones, soft spring motion,
visible focus rings, reduced-motion support. It was built from Apple's Human Interface Guidelines (repo `NutshellEngineering/apple-design-skill`,
`references/foundations/typography.md`, `components/menus-and-actions/buttons.md`). Tenant colours (`--accent`/`--g`) are untouched. The
marketing site (`site/`) deliberately does NOT use it.

**Standing rule: every staff-facing app, current or future (POS, Back Office, Payroll, Website Builder, and any new software the owner adds), links `/hig.css`
after its own `<style>` and is built to the HIG from the start: 44pt hit targets, body 16+, sentence-case labels in the system font (no tiny mono
uppercase), segmented controls for tabs, bottom sheets for modals on phones, no light/heavy weights. When starting a new app, copy the link tag from
`index.html`, then check it on a phone-width screenshot. Exceptions: the marketing site and the Showoff-style salon console (`app/public/salon/`, a client's own design). Customer-facing pages (`site.html`, `booking.html`, `order.html`, `i.html`) don't either.

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
