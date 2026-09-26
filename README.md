# AUZlabs Infra

Self-hosted platform stack: reverse proxy, database, app, backups, monitoring.
No dependency on Vercel/Supabase — everything runs on a VPS you control.

## Folder structure

- `docker-compose.yml` — every service that runs
- `Caddyfile` — reverse proxy + automatic HTTPS
- `.env.example` — copy to `.env`, fill in real values (never commit `.env`)
- `setup-vps.sh` — one-time script to prep a fresh VPS
- `app/` — your Next.js source goes here
  - `Dockerfile` — build recipe
  - `middleware.ts` — reads which client a request is for, from the subdomain
  - `lib/tenant-db.ts` — scopes every DB query to that one client
- `db/` — the generic POS/CRM data model, auto-applied the first time the database starts
  - `001_tenants_and_settings.sql` — tenants, tenant_settings, niche_presets (who each client is + how they're configured)
  - `002_core_engine.sql` — profiles, the generic `records` table (menu/categories/tables/expenses/shifts/inventory/waste, all via a `kind` column), guest self-order, push notifications, invoice numbering — the proven engine from OG Book Cafe production, made multi-tenant
  - `003_bookings.sql` — real appointment/slot scheduling, for niches that need it (salon, gym)
- `supabase/functions/send-push/` — Web Push delivery, secrets read from environment (never hardcoded)

## First-time setup on a fresh VPS

1. Point your domain's DNS A record at the VPS's IP address.
2. SSH in as root, run: `bash setup-vps.sh` (it'll ask for this repo's git URL).
3. Edit `/opt/auzlabs-infra/.env` with real values (domain, email, DB password).
4. Re-run `bash setup-vps.sh` (or `docker compose up -d --build` directly).
5. Visit `https://status.yourdomain.com` to confirm Uptime Kuma is live.
6. Add your first tenant (see below).

## Adding a new client

No deployment, no code change — pick a niche, copy its preset, insert one row
each in `tenants` and `tenant_settings`, point their subdomain's DNS at the
same server:

```sql
insert into tenants (slug, name, niche) values ('ogbookcafe', 'OG Book Cafe', 'cafe');

insert into tenant_settings (tenant_id, branding, features, labels, business_rules)
select
  (select id from tenants where slug = 'ogbookcafe'),
  '{"primary_color": "#1f3d2e", "logo_url": "/logo.png"}',
  default_features,
  default_labels,
  default_business_rules
from niche_presets where niche = 'cafe';
```

## Adding a database change later

The auto-run in `db/` only fires once, against a brand-new empty database.
For any change after go-live, add a new numbered file (`004_...sql`) and apply
it by hand:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/004_your_change.sql
```

## Day-to-day commands

```bash
docker compose ps              # what's running
docker compose logs -f app     # tail app logs
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"  # DB shell
ls backups/                    # nightly backups land here
```
