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
  is the public invoice/receipt view. Served on every tenant's own
  subdomain (`<slug>.auzslab.in`) — same files for every tenant, the
  active one is resolved client-side from the subdomain (`tenant.js`) or
  server-side from the logged-in staff member's own profile.
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
