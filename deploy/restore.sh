#!/usr/bin/env bash
#
# Restore Payday Budget from a backup made by `pb backup`.
#
#   bash restore.sh [--yes] budget-YYYYmmdd-HHMMSS.db [receipts-YYYYmmdd-HHMMSS.tar.gz]
#
# The backup is checked before anything is touched. The current database and receipts
# are kept beside the live ones as budget.db.pre-restore and receipts.pre-restore, and
# if any later step fails they are put back and the service is started again.
# `pb list-backups` shows what is available.
#
# Options for testing on a scratch copy (not needed on the LXC):
#   --data-dir DIR   --env-file FILE   --app-dir DIR   --user NAME   --no-service
#
set -Eeuo pipefail  # -E: the ERR trap also fires inside functions

APP_USER="payday"
APP_DIR="/opt/payday-budget"
ENV_FILE="/etc/payday-budget/payday-budget.env"
DATA_DIR=""
MANAGE_SERVICE=1
ASSUME_YES=0
DB_BACKUP=""
RECEIPTS_BACKUP=""

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { printf '%s==>%s %s\n' "${BOLD}" "${OFF}" "$*"; }
ok()   { printf '  %s✓%s %s\n' "${GREEN}" "${OFF}" "$*"; }
warn() { printf '  %s!%s %s\n' "${YELLOW}" "${OFF}" "$*"; }
die()  { printf '%sError:%s %s\n' "${RED}" "${OFF}" "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)     ASSUME_YES=1; shift ;;
    --data-dir)   DATA_DIR="$2"; shift 2 ;;
    --env-file)   ENV_FILE="$2"; shift 2 ;;
    --app-dir)    APP_DIR="$2"; shift 2 ;;
    --user)       APP_USER="$2"; shift 2 ;;
    --no-service) MANAGE_SERVICE=0; shift ;;
    -h|--help)    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           die "Unknown option: $1" ;;
    *)
      if [[ -z "${DB_BACKUP}" ]]; then DB_BACKUP="$1"
      elif [[ -z "${RECEIPTS_BACKUP}" ]]; then RECEIPTS_BACKUP="$1"
      else die "Too many arguments."; fi
      shift ;;
  esac
done

[[ -n "${DB_BACKUP}" ]] || die "Name the database backup to restore. See: pb list-backups"
[[ ${EUID} -eq 0 ]] || die "Run this as root inside the LXC."
[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} is missing."

# The env file only exists on the LXC.
set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
set +a
DATA_DIR="${DATA_DIR:-${PB_DATA_DIR:-/var/lib/payday-budget}}"
export PB_DATA_DIR="${DATA_DIR}"
DB_PATH="${PB_DATABASE_PATH:-${DATA_DIR}/budget.db}"
[[ "${DB_PATH}" == "${DATA_DIR}"/* ]] || DB_PATH="${DATA_DIR}/budget.db"
export PB_DATABASE_PATH="${DB_PATH}"
RECEIPTS_DIR="${DATA_DIR}/receipts"
PYTHON="${APP_DIR}/backend/.venv/bin/python"
PORT="$(sed -n 's/.*--port \([0-9]*\).*/\1/p' /etc/systemd/system/payday-budget.service 2>/dev/null | head -1 || true)"
PORT="${PORT:-8000}"

[[ -x "${PYTHON}" ]] || die "${PYTHON} is missing. Is ${APP_DIR} installed?"

# A bare file name is looked up in the backups folder.
[[ -f "${DB_BACKUP}" ]] || DB_BACKUP="${DATA_DIR}/backups/${DB_BACKUP}"
[[ -f "${DB_BACKUP}" ]] || die "No such backup: ${DB_BACKUP}"
if [[ -n "${RECEIPTS_BACKUP}" ]]; then
  [[ -f "${RECEIPTS_BACKUP}" ]] || RECEIPTS_BACKUP="${DATA_DIR}/backups/${RECEIPTS_BACKUP}"
  [[ -f "${RECEIPTS_BACKUP}" ]] || die "No such receipts archive: ${RECEIPTS_BACKUP}"
fi

as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then "$@"; else runuser -u "${APP_USER}" -- "$@"; fi
}

# --------------------------------------------------------------- 1. check first
step "Checking the backup"
"${PYTHON}" - "${DB_BACKUP}" <<'PY' || die "That file is not a sound SQLite database. Nothing was changed."
import sqlite3, sys
connection = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
row = connection.execute("PRAGMA integrity_check").fetchone()
tables = {name for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
sys.exit(0 if row and row[0] == "ok" and "alembic_version" in tables else 1)
PY
ok "$(basename "${DB_BACKUP}") passes its integrity check"
if [[ -n "${RECEIPTS_BACKUP}" ]]; then
  "${PYTHON}" - "${RECEIPTS_BACKUP}" <<'PY' || die "The receipts archive is unreadable or unsafe. Nothing was changed."
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        name = member.name
        if name.startswith("/") or ".." in name.split("/") or not (member.isfile() or member.isdir()):
            sys.exit(1)
PY
  ok "$(basename "${RECEIPTS_BACKUP}") is readable"
else
  warn "no receipts archive given; receipts are left as they are"
fi

if [[ "${ASSUME_YES}" -ne 1 ]]; then
  printf '\nThis replaces %s with %s.\n' "${DB_PATH}" "$(basename "${DB_BACKUP}")"
  read -r -p "Type 'restore' to continue: " answer
  [[ "${answer}" == "restore" ]] || die "Cancelled. Nothing was changed."
fi

# ------------------------------------------------------------------ 2. stop it
if [[ "${MANAGE_SERVICE}" -eq 1 ]]; then
  step "Stopping the service"
  systemctl stop payday-budget.service
  ok "stopped"
fi

# ------------------------------------------------ 3. keep what is there today
step "Keeping the current data"
PRE_DB="${DB_PATH}.pre-restore"
PRE_RECEIPTS="${RECEIPTS_DIR}.pre-restore"
HAD_DB=0
if [[ -f "${DB_PATH}" ]]; then
  HAD_DB=1
  rm -f "${PRE_DB}"
  # The backup API folds in any WAL, so the kept copy is complete on its own.
  as_app_user "${PYTHON}" -c '
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dest = sqlite3.connect(sys.argv[2])
src.backup(dest); dest.execute("PRAGMA journal_mode=DELETE"); dest.close(); src.close()
' "${DB_PATH}" "${PRE_DB}"
  ok "${PRE_DB}"
fi
MOVED_RECEIPTS=0
if [[ -n "${RECEIPTS_BACKUP}" && -d "${RECEIPTS_DIR}" ]]; then
  rm -rf "${PRE_RECEIPTS}"
  mv "${RECEIPTS_DIR}" "${PRE_RECEIPTS}"
  MOVED_RECEIPTS=1
  ok "${PRE_RECEIPTS}"
fi

# Called from the ERR trap below.
# shellcheck disable=SC2329
put_back() {
  warn "putting the previous data back"
  if [[ "${HAD_DB}" -eq 1 ]]; then
    rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"
    cp "${PRE_DB}" "${DB_PATH}"
    chown "${APP_USER}:${APP_USER}" "${DB_PATH}"
  fi
  if [[ "${MOVED_RECEIPTS}" -eq 1 ]]; then
    rm -rf "${RECEIPTS_DIR}"
    mv "${PRE_RECEIPTS}" "${RECEIPTS_DIR}"
  fi
  if [[ "${MANAGE_SERVICE}" -eq 1 ]]; then systemctl start payday-budget.service || true; fi
}
trap 'put_back; die "The restore failed. The previous data is back in place."' ERR

# --------------------------------------------------------------- 4. swap it in
step "Restoring"
rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"
install -o "${APP_USER}" -g "${APP_USER}" -m 0640 "${DB_BACKUP}" "${DB_PATH}"
ok "database from $(basename "${DB_BACKUP}")"
if [[ -n "${RECEIPTS_BACKUP}" ]]; then
  install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${RECEIPTS_DIR}"
  as_app_user "${PYTHON}" -c '
import sys, tarfile
with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2], filter="data")
' "${RECEIPTS_BACKUP}" "${RECEIPTS_DIR}"
  ok "receipts from $(basename "${RECEIPTS_BACKUP}")"
fi

# ------------------------------------------ 5. bring an older schema up to date
step "Applying database migrations"
as_app_user env PATH="${APP_DIR}/backend/.venv/bin:${PATH}" \
  sh -c "cd '${APP_DIR}/backend' && alembic upgrade head" >/dev/null
ok "schema at $(as_app_user "${PYTHON}" -c '
import sqlite3, sys
print(sqlite3.connect(sys.argv[1]).execute("select version_num from alembic_version").fetchone()[0])
' "${DB_PATH}")"

# ---------------------------------------------------------------- 6. start it
if [[ "${MANAGE_SERVICE}" -eq 1 ]]; then
  step "Starting the service"
  systemctl start payday-budget.service
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 && break
    sleep 1
  done
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null || true)"
  [[ -n "${HEALTH}" ]] || false  # trips the ERR trap: put the old data back
  ok "health: ${HEALTH}"
fi
trap - ERR

printf '\n%sRestored from %s.%s\n' "${BOLD}" "$(basename "${DB_BACKUP}")" "${OFF}"
[[ "${HAD_DB}" -eq 1 ]] && printf 'The previous database is kept as %s.\n' "${PRE_DB}"
[[ "${MOVED_RECEIPTS}" -eq 1 ]] && printf 'The previous receipts are kept in %s.\n' "${PRE_RECEIPTS}"
exit 0
