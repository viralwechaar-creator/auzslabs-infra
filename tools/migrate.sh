#!/usr/bin/env bash
# Applies the database updates in db/ that this server has not run yet, in order, and remembers which ones ran.
#
# On the server (from the project folder):
#     bash tools/migrate.sh status               show what is applied and what is waiting
#     bash tools/migrate.sh baseline 241         FIRST TIME ONLY: mark every file up to number 241 as already applied
#     bash tools/migrate.sh apply                run every waiting file, in order, stopping at the first error
#
# Files 000-0xx (first-boot schema) and 999 are not managed here: 000-0xx only run on a brand-new database and 999 is the
# blanket grants file, re-run by hand when needed. Settings for testing away from the server: PSQL_CMD, DB_DIR.
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PSQL_CMD:-}" ]; then
  if [ ! -f .env ]; then echo "No .env here. Run this from the project folder on the server."; exit 1; fi
  set -a; . ./.env; set +a
  PSQL_CMD="docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB"
fi
DB_DIR="${DB_DIR:-db}"
# </dev/null: the database command must never read the file list the loops below are walking (that bug ended the loops after the first file)
psqlq() { $PSQL_CMD -v ON_ERROR_STOP=1 -q -At "$@" </dev/null; }
psqlq -c "set client_min_messages = warning; create table if not exists schema_migrations (file text primary key, applied_at timestamptz not null default now(), note text)" >/dev/null || { echo "Cannot reach the database."; exit 1; }
managed() { ls "$DB_DIR"/*.sql | sort -V | while read -r f; do b=$(basename "$f"); n=${b%%_*}; [[ "$n" =~ ^[0-9]+$ ]] || continue; n=$((10#$n)); [ "$n" -ge 1 ] && [ "$n" -lt 999 ] && echo "$b"; done; }
applied() { psqlq -c "select file from schema_migrations"; }
case "${1:-status}" in
  status)
    done_list=$(applied)
    total=0; waiting=0
    while read -r -u 3 b; do total=$((total+1)); if grep -qxF "$b" <<<"$done_list"; then :; else waiting=$((waiting+1)); echo "WAITING  $b"; fi; done 3< <(managed)
    echo "$((total-waiting)) applied, $waiting waiting (of $total files)";;
  baseline)
    upto="${2:?Give the highest number that is already applied, for example: bash tools/migrate.sh baseline 241}"
    n=0
    while read -r -u 3 b; do num=$((10#${b%%_*})); if [ "$num" -le "$upto" ]; then psqlq -c "insert into schema_migrations(file, note) values ('$b', 'baseline') on conflict do nothing" >/dev/null; n=$((n+1)); fi; done 3< <(managed)
    echo "Marked $n files (up to $upto) as already applied.";;
  apply)
    done_list=$(applied); ran=0
    if [ -z "$done_list" ]; then echo "Nothing is marked as applied yet. Run the baseline step first (bash tools/migrate.sh baseline <number>), or apply would start from the very first file."; exit 1; fi
    if [ "$(grep -c . <<<"$done_list")" -lt 20 ] && [ "${FORCE:-}" != "1" ]; then echo "Only $(grep -c . <<<"$done_list") files are marked as applied: that looks like an unfinished baseline. Run the baseline step again, or set FORCE=1 if this really is a small database."; exit 1; fi
    while read -r -u 3 b; do
      grep -qxF "$b" <<<"$done_list" && continue
      echo "Applying $b ..."
      if $PSQL_CMD -v ON_ERROR_STOP=1 -q < "$DB_DIR/$b"; then psqlq -c "insert into schema_migrations(file) values ('$b')" >/dev/null; ran=$((ran+1)); else echo "STOPPED at $b. Fix it, then run apply again."; exit 1; fi
    done 3< <(managed)
    echo "Done. $ran file(s) applied.";;
  *) echo "Use: status | baseline <number> | apply"; exit 1;;
esac
