#!/usr/bin/env bash
#
# Update an installed Payday Budget to the latest code.
#
# Backs the database up first, builds the new version, and only restarts once the
# migration has succeeded. If the migration fails, the checkout is rolled back to
# the commit that was running and the old service is left untouched.
#
#   bash update.sh [--ref BRANCH_OR_TAG] [--source /local/path] [--skip-backup]
#
set -euo pipefail

REPO_REF=""
SOURCE_PATH=""
SKIP_BACKUP=0

APP_USER="payday"
APP_DIR="/opt/payday-budget"
ENV_FILE="/etc/payday-budget/payday-budget.env"
DATA_DIR="/var/lib/payday-budget"
UV_BIN="/usr/local/bin/uv"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { printf '%s==>%s %s\n' "${BOLD}" "${OFF}" "$*"; }
ok()   { printf '  %s✓%s %s\n' "${GREEN}" "${OFF}" "$*"; }
warn() { printf '  %s!%s %s\n' "${YELLOW}" "${OFF}" "$*"; }
die()  { printf '%sError:%s %s\n' "${RED}" "${OFF}" "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)         REPO_REF="$2"; shift 2 ;;
    --source)      SOURCE_PATH="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help)     sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "Unknown option: $1" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "Run this as root inside the LXC."
[[ -d "${APP_DIR}" ]] || die "${APP_DIR} does not exist. Run install.sh first."
[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} is missing. Run install.sh first."

# The env file only exists on the LXC.
set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
set +a
PORT="$(sed -n 's/.*--port \([0-9]*\).*/\1/p' /etc/systemd/system/payday-budget.service | head -1)"
PORT="${PORT:-8000}"
PB_BIN="${APP_DIR}/backend/.venv/bin/pb"

version_now() {
  curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo "?"
}
BEFORE_VERSION="$(version_now)"

# ------------------------------------------------------------------- 1. backup
if [[ "${SKIP_BACKUP}" -eq 1 ]]; then
  warn "--skip-backup given; no backup was taken"
else
  step "Backing up the database"
  if "${PB_BIN}" backup --help >/dev/null 2>&1; then
    runuser -u "${APP_USER}" -- "${PB_BIN}" backup
    ok "pb backup"
  else
    # pb backup arrives in Phase 9. SQLite's .backup is safe while the app is running.
    STAMP="$(date +%Y%m%d-%H%M%S)"
    TARGET="${DATA_DIR}/backups/budget-${STAMP}.db"
    install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${DATA_DIR}/backups"
    runuser -u "${APP_USER}" -- sqlite3 "${PB_DATABASE_PATH}" ".backup '${TARGET}'"
    ok "${TARGET}"
  fi
fi

# --------------------------------------------------------------- 2. the new code
step "Fetching the code"
ROLLBACK_REF=""
if [[ -n "${SOURCE_PATH}" ]]; then
  [[ -d "${SOURCE_PATH}" ]] || die "--source ${SOURCE_PATH} is not a directory."
  rsync -a --delete \
    --exclude .git --exclude node_modules --exclude .venv \
    --exclude 'frontend/dist' --exclude 'backend/var' \
    "${SOURCE_PATH}/" "${APP_DIR}/"
  ok "copied from ${SOURCE_PATH}"
else
  [[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout. Use --source instead."
  if [[ -n "$(git -C "${APP_DIR}" status --porcelain)" ]]; then
    die "${APP_DIR} has local changes. Commit, stash or discard them first."
  fi
  ROLLBACK_REF="$(git -C "${APP_DIR}" rev-parse HEAD)"
  BRANCH="${REPO_REF:-$(git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD)}"
  git -C "${APP_DIR}" fetch --quiet origin
  git -C "${APP_DIR}" checkout --quiet "${BRANCH}"
  git -C "${APP_DIR}" reset --hard --quiet "origin/${BRANCH}" 2>/dev/null ||
    git -C "${APP_DIR}" reset --hard --quiet "${BRANCH}"
  NOW_REF="$(git -C "${APP_DIR}" rev-parse HEAD)"
  if [[ "${ROLLBACK_REF}" == "${NOW_REF}" ]]; then
    ok "already at $(git -C "${APP_DIR}" rev-parse --short HEAD); rebuilding anyway"
  else
    ok "$(git -C "${APP_DIR}" rev-parse --short "${ROLLBACK_REF}") -> $(git -C "${APP_DIR}" rev-parse --short HEAD)"
  fi
fi

roll_back() {
  if [[ -n "${ROLLBACK_REF}" ]]; then
    warn "rolling the checkout back to $(git -C "${APP_DIR}" rev-parse --short "${ROLLBACK_REF}")"
    git -C "${APP_DIR}" reset --hard --quiet "${ROLLBACK_REF}"
  fi
}

# -------------------------------------------------------------------- 3. build
step "Installing Python dependencies"
(cd "${APP_DIR}/backend" && "${UV_BIN}" sync --frozen --no-dev >/dev/null) || { roll_back; die "uv sync failed. The old version is still running."; }
ok "backend/.venv"

step "Building the frontend"
if ! (cd "${APP_DIR}/frontend" && npm ci --silent >/dev/null && npm run build --silent >/dev/null); then
  roll_back
  die "The frontend build failed. The old version is still running."
fi
ok "frontend/dist"

# ---------------------------------------------------------------- 4. migrations
step "Applying database migrations"
if ! runuser -u "${APP_USER}" -- \
     env PATH="${APP_DIR}/backend/.venv/bin:${PATH}" \
     sh -c "cd '${APP_DIR}/backend' && alembic upgrade head" >/dev/null; then
  roll_back
  die "The migration failed. Nothing was restarted and the old version is still running.
     The database is untouched, and a backup is in ${DATA_DIR}/backups."
fi
ok "schema at $(runuser -u "${APP_USER}" -- sqlite3 "${PB_DATABASE_PATH}" 'select version_num from alembic_version' 2>/dev/null || echo '?')"

# ------------------------------------------------------------------- 5. restart
step "Restarting"
install -m 0644 "${APP_DIR}/deploy/systemd/payday-budget.service" /etc/systemd/system/
if [[ "${PORT}" != "8000" ]]; then
  sed -i "s/--port 8000/--port ${PORT}/" /etc/systemd/system/payday-budget.service
fi
install -m 0755 "${APP_DIR}/deploy/pb" /usr/local/bin/pb
systemctl daemon-reload
systemctl restart payday-budget.service

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done
HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null || true)"
if [[ -z "${HEALTH}" ]]; then
  printf '%sThe service did not come back on :%s.%s\n' "${RED}" "${PORT}" "${OFF}" >&2
  journalctl -u payday-budget.service -n 40 --no-pager >&2
  exit 1
fi
ok "health: ${HEALTH}"

# Turn on any timer whose command now exists (pb run-daily / pb backup, Phase 9).
for job in daily:run-daily backup:backup; do
  name="${job%%:*}"; cmd="${job##*:}"
  if "${PB_BIN}" "${cmd}" --help >/dev/null 2>&1 &&
     ! systemctl is-enabled --quiet "payday-budget-${name}.timer" 2>/dev/null; then
    systemctl enable --quiet --now "payday-budget-${name}.timer"
    ok "payday-budget-${name}.timer is available now and has been enabled"
  fi
done

printf '\n%sUpdated %s -> %s.%s  Logs: journalctl -u payday-budget -f\n' \
  "${BOLD}" "${BEFORE_VERSION}" "$(version_now)" "${OFF}"
