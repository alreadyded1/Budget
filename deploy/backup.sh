#!/usr/bin/env bash
#
# Take a backup now: the database (via SQLite's online backup API, safe while the app
# runs) plus a receipts archive, in /var/lib/payday-budget/backups. Old backups past
# PB_BACKUP_KEEP_DAYS are pruned; the newest is always kept.
#
# The nightly payday-budget-backup.timer does the same thing at 02:30.
#
#   bash backup.sh
#
set -euo pipefail
exec /usr/local/bin/pb backup
