# Runbook: deploy and backup (INTERNAL)

The owner deploys from an iPhone over SSH. Always give exact copy-paste commands and a way to verify.

## Normal deploy
```
cd /root/auzslabs-infra && git pull origin main && git log -1 --oneline
```
That is enough for website and app files. Compare the last commit shown with the expected one.

## When the change includes a database file
```
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db/NNN_name.sql
```
Use `<`, never `-f` (the container cannot see the repo). Forgetting `source .env` gives `role "root" does not exist`. Run migration files in number order.

## When the API code changed
```
docker compose up -d --build api
```
Caddy configuration changes need `docker compose restart caddy`.

## Verify
- `git log -1 --oneline` matches what was expected.
- `curl -s https://api.<domain>/health` answers ok.
- Open the changed screen on a real phone.

## Backups
- TODO: owner to confirm schedule, where copies go (local and off-site), and the date of the last successful restore test.
- A restore test script exists in the repo (tools/restore-test.sh): it restores the newest backup into a scratch database and compares row counts, never touching live data. Run it weekly.
- Never restore over live data without taking a fresh copy first.

## Rollback
- Code: go back to the previous commit (`git log` to find it), then rebuild the API if it changed.
- Database: migrations are not automatically reversible; restore from backup into a scratch copy first and compare.
