#!/usr/bin/env bash
# Proves that last night's backup really restores. A backup nobody has restored is only a hope.
#
# Safe: it never touches live data. It restores the newest backup into a scratch database called
# "restore_check", compares row counts with the live database, prints PASS or FAIL, then deletes the scratch copy.
#
# On the server (from the project folder):
#     bash tools/restore-test.sh
#
# Settings you normally never need (they exist so the script can be tested away from the server):
#     BACKUP_DIR  folder with daily/*.sql.gz   (default ./backups)
#     PSQL_CMD    how to run psql              (default: through the postgres container)
#     LIVE_DB     the live database name       (default $POSTGRES_DB from .env)
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -z "${PSQL_CMD:-}" ]; then
  if [ ! -f .env ]; then echo "FAIL: no .env here. Run this from the project folder on the server."; exit 1; fi
  set -a; . ./.env; set +a
  PSQL_CMD="docker compose exec -T postgres psql -U $POSTGRES_USER"
  LIVE_DB="${LIVE_DB:-$POSTGRES_DB}"
fi
: "${LIVE_DB:?LIVE_DB must be set when PSQL_CMD is set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
SCRATCH="restore_check"
TABLES="tenants auth_users profiles records bookings salon_store pay_employees acc_documents mob_sales"

psqlq() { $PSQL_CMD -v ON_ERROR_STOP=1 -q -At "$@"; }

file=$(ls -t "$BACKUP_DIR"/daily/*.sql.gz 2>/dev/null | head -1)
if [ -z "$file" ]; then echo "FAIL: no backup file found in $BACKUP_DIR/daily"; exit 1; fi
age_h=$(( ( $(date +%s) - $(stat -c %Y "$file") ) / 3600 ))
size=$(du -h "$file" | cut -f1)
echo "Newest backup : $file ($size, about $age_h hours old)"
status=0
if [ "$age_h" -gt 36 ]; then echo "WARNING: the newest backup is older than 36 hours. Is the nightly backup running?"; status=1; fi

echo "Restoring into a scratch database (this can take a minute)..."
psqlq -d postgres -c "drop database if exists $SCRATCH" -c "create database $SCRATCH" >/dev/null || { echo "FAIL: could not create the scratch database"; exit 1; }
if ! gunzip -c "$file" | $PSQL_CMD -v ON_ERROR_STOP=1 -q -d "$SCRATCH" >/tmp/restore-test.log 2>&1; then
  echo "FAIL: the backup did not restore cleanly. First error:"; grep -m3 -i "error" /tmp/restore-test.log || head -5 /tmp/restore-test.log
  psqlq -d postgres -c "drop database if exists $SCRATCH" >/dev/null 2>&1; exit 1
fi

printf "\n%-20s %12s %12s\n" "table" "live now" "in backup"
for t in $TABLES; do
  live=$(psqlq -d "$LIVE_DB" -c "select count(*) from $t" 2>/dev/null || echo "-")
  back=$(psqlq -d "$SCRATCH" -c "select count(*) from $t" 2>/dev/null || echo "-")
  note=""
  if [ "$back" = "-" ] && [ "$live" != "-" ]; then note="  <-- MISSING in backup"; status=1; fi
  if [ "$back" = "0" ] && [ "$live" != "-" ] && [ "$live" != "0" ]; then note="  <-- EMPTY in backup"; status=1; fi
  printf "%-20s %12s %12s%s\n" "$t" "$live" "$back" "$note"
done

# a restored database must actually work: run a real query through a join
if ! psqlq -d "$SCRATCH" -c "select count(*) from tenants t left join profiles p on p.tenant_id = t.id" >/dev/null 2>&1; then echo "FAIL: restored data cannot be queried"; status=1; fi

psqlq -d postgres -c "drop database if exists $SCRATCH" >/dev/null 2>&1

# best effort: is there an off-site copy, and how fresh is it?
if [ -z "${SKIP_OFFSITE:-}" ] && [ "${PSQL_CMD#docker}" != "$PSQL_CMD" ]; then
  off=$(docker compose exec -T offsite-backup sh -c 'rclone lsf -R --format "tp" B2:$B2_BUCKET/backups 2>/dev/null | sort | tail -1' 2>/dev/null)
  if [ -n "$off" ]; then echo; echo "Newest off-site copy: $off"; else echo; echo "WARNING: could not read the off-site (Backblaze) copy. Check the offsite-backup container: docker compose logs --tail 30 offsite-backup"; fi
fi

echo
if [ "$status" -eq 0 ]; then echo "PASS: the newest backup restores and its data is there."; else echo "FAIL: see the lines above."; fi
exit "$status"
