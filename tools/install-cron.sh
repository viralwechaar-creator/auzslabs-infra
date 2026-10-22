#!/usr/bin/env bash
# Installs the routine jobs (safe to run again): daily .env copy at 02:10 and a weekly backup restore test on Sunday 03:00.
# Results are written to /var/log/auzslab-jobs.log. Check it, or look for FAIL, now and then.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=$(pwd)
tmp=$(mktemp); crontab -l 2>/dev/null | grep -v "auzslab-job" > "$tmp" || true
echo "10 2 * * * cd $dir && bash tools/backup-env.sh >> /var/log/auzslab-jobs.log 2>&1 # auzslab-job" >> "$tmp"
echo "0 3 * * 0 cd $dir && bash tools/restore-test.sh >> /var/log/auzslab-jobs.log 2>&1 # auzslab-job" >> "$tmp"
crontab "$tmp"; rm -f "$tmp"; echo "Installed:"; crontab -l | grep auzslab-job
