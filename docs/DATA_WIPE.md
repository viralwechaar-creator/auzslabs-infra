# Clean-up and data tools (db/097, db_data/wipe_all_but_demo.sql)

## One-time wipe of old clients (owner request: keep only Showoff Salon, demo-salon and demo)
`db_data/wipe_all_but_demo.sql` deletes every business except the slugs in `keep_slugs` (`showoffsalon`, `demo-salon`, `demo`),
all their data in every app, their logins, sessions, sign-in links and pending requests. Platform admins are kept.
It refuses to run if a kept slug does not exist. **Default is a dry run (prints, then rolls back).** Add `-v confirm=yes` to really delete.
It turns the append-only guards and FK checks off for its own transaction (`session_replication_role = replica`, needs the
superuser `POSTGRES_USER`), then sweeps rows left pointing at deleted parents. Uploaded files on the volume are not touched.

```bash
cd auzslabs-infra && git pull origin main && git log -1 --oneline
set -a; source .env; set +a
# 1. backup (keep this file)
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > ~/backup-before-wipe.sql && ls -lh ~/backup-before-wipe.sql
# 2. dry run: read the "DELETING these businesses" list
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/wipe_all_but_demo.sql
# 3. only if the list is right: really delete
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v confirm=yes < db_data/wipe_all_but_demo.sql
```
Restore if needed: `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ~/backup-before-wipe.sql` (into an emptied database).

## Backup / Export / Clear for every business (db/097)
`my_data_export()` and `my_data_clear(p_confirm)` (registered in `server/src/index.js` `RPC`). Owner-only (`my_data_owner()`), own tenant only.
- Export returns every tenant-scoped table as JSON (secrets, PINs, password hashes and salon console hashes are excluded). The UI saves it as a
  `.json` Backup, or as a sectioned `.csv` for Excel. Logged in `tenant_data_actions`.
- Clear deletes all business data except logins, roles, plan/add-on records, setup (settings, chart of accounts, tax codes, pay structures, menu settings
  record, salon site settings) and audit tables. Needs the business slug typed as confirmation; the UI forces a backup download first. Demo tenants refuse.
- UI: `app/public/ds/mydata.js` (`auzMyData(sb)`, copy at `site/tool/mydata.js`) opened from POS (Staff & settings), Payroll/Accounting/AUZsMob (More),
  Back Office (menu), Console (side nav, "Data"), Builder (My data button) and `site/account.html` ("Your data" card). The salon console keeps its own
  Download backup / Clear history / Reset buttons.
- Deploy: `psql ... -v ON_ERROR_STOP=1 < db/097_my_data_tools.sql`, `docker compose up -d --build api`.
