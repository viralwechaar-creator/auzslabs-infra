#!/usr/bin/env bash
# Keeps dated copies of the server's .env (every key and password lives there; losing it once cost a day). Run daily by cron.
# Copies go to /root/env-backups, readable only by root, the newest 14 are kept. ALSO keep a copy in your password manager.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=/root/env-backups; mkdir -p "$dir"; chmod 700 "$dir"
[ -f .env ] || { echo "no .env"; exit 1; }
cp .env "$dir/env-$(date +%F)"; chmod 600 "$dir"/env-*
ls -t "$dir"/env-* | tail -n +15 | xargs -r rm -f
echo "env saved: $(ls "$dir" | wc -l) copies"
