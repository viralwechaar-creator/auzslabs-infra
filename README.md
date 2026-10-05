# AUZslab

Self-hosted, multi-tenant software for shops, salons and cafes: POS, Payroll, Accounting, AUZsMob (mobile shops), a salon suite, QR ordering, a website builder, and the marketing site at auzslab.in. One codebase, one VPS, every customer is a row in the `tenants` table.

No Vercel, no Supabase, no build step. Plain static HTML/CSS/JS, a small Node API and Postgres, run with Docker Compose behind Caddy.

New here? Read `docs/DEVELOPER_GUIDE.md` first, then `CLAUDE.md` (the detailed project brief, history and gotchas). Launching? See `docs/LAUNCH_CHECKLIST.md`.

## Folders

| Folder | What it is |
|---|---|
| `site/` | Marketing site (auzslab.in), plus the sign-in, cart, account and platform-admin pages |
| `app/public/` | The apps customers use, served on each customer's own subdomain (`<slug>.auzslab.in`): POS, Payroll, Accounting, AUZsMob, Back Office, admin console, Website Builder, salon suite (`salon/`) |
| `server/` | The API (Node): sign-in, generic data API, RPC endpoints, uploads, realtime, payments, email |
| `db/` | Numbered SQL migrations. Applied by hand, in order, on the live database |
| `db_data/` | One-off data scripts (never run automatically) |
| `tests/` | Browser + API test suites (`node tests/run-local.mjs <suite>`) |
| `tools/` | Helper scripts (icon generator, backup restore test) |
| `docs/` | Per-area write-ups (launch, payroll, POS audit, renewals, mobile, data wipe) |
| `Caddyfile`, `caddy/`, `docker-compose.yml`, `.env.example`, `setup-vps.sh` | Server setup |

## Run the checks

```bash
service postgresql start        # tests need a local Postgres
cd server && npm ci && cd ..
node tests/run-local.mjs signup # or: marketing, salon, pos, payroll, accounts, mobile, apps, journeys, responsive, design, security
```

Each suite builds a scratch database, starts the API and a static server, and drives Chromium. Run suites one at a time.

## Deploy (on the server, over SSH)

```bash
cd ~/auzslabs-infra
git pull origin main && git log -1 --oneline    # check the commit you expect
```
- Changes only in `site/` or `app/public/` need nothing else (Caddy serves those folders directly).
- Changes in `db/`: run each new file in filename order:
  ```bash
  set -a; source .env; set +a
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db/0NN_name.sql
  ```
  Use `<` (shell redirect), not `-f`.
- Changes in `server/`: `docker compose up -d --build api`.

## Day-to-day commands

```bash
docker compose ps                         # what is running
docker compose logs -f api                # API log
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"   # database shell
ls backups/                               # nightly backups
bash tools/restore-test.sh                # prove the newest backup restores (run weekly)
```

## First-time server setup

1. Point the domain's DNS (A record, plus `*` wildcard) at the VPS.
2. SSH in as root and run `bash setup-vps.sh`.
3. Copy `.env.example` to `.env` and fill it in (database password, domain, GoDaddy DNS key for the wildcard certificate, and the optional keys for Google sign-in, Resend email, Razorpay, Sentry).
4. `docker compose up -d --build`, then apply every file in `db/` in order.
5. Check `https://api.<domain>/health` returns `{"ok":true,...}`.

## Adding a customer

Customers normally arrive through the website (sign up with Google, choose products, pay) and are provisioned automatically. A platform admin can also create one in `site/admin.html`. Nothing needs deploying per customer.
