#!/usr/bin/env bash
#
# Payday Budget installer for a Debian 13 LXC on Proxmox.
#
# Native install under systemd: no containers anywhere. Running it again is safe —
# it never overwrites an existing env file or database, and it only restarts the
# service once everything else has succeeded.
#
#   bash install.sh [--repo URL] [--ref BRANCH] [--source /local/path]
#                   [--base-url https://budget.example.com] [--trusted-proxy 10.0.0.5]
#                   [--port 8000] [--no-start]
#
set -euo pipefail

REPO_URL="https://github.com/alreadyded1/Budget.git"
REPO_REF="main"
SOURCE_PATH=""
BASE_URL=""
TRUSTED_PROXY=""
PORT="8000"
START_SERVICE=1

APP_USER="payday"
APP_DIR="/opt/payday-budget"
ETC_DIR="/etc/payday-budget"
ENV_FILE="${ETC_DIR}/payday-budget.env"
DATA_DIR="/var/lib/payday-budget"
UV_BIN="/usr/local/bin/uv"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { printf '%s==>%s %s\n' "${BOLD}" "${OFF}" "$*"; }
ok()   { printf '  %s✓%s %s\n' "${GREEN}" "${OFF}" "$*"; }
warn() { printf '  %s!%s %s\n' "${YELLOW}" "${OFF}" "$*"; }
die()  { printf '%sError:%s %s\n' "${RED}" "${OFF}" "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)          REPO_URL="$2"; shift 2 ;;
    --ref)           REPO_REF="$2"; shift 2 ;;
    --source)        SOURCE_PATH="$2"; shift 2 ;;
    --base-url)      BASE_URL="$2"; shift 2 ;;
    --trusted-proxy) TRUSTED_PROXY="$2"; shift 2 ;;
    --port)          PORT="$2"; shift 2 ;;
    --no-start)      START_SERVICE=0; shift ;;
    -h|--help)       sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "Unknown option: $1" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "Run this as root inside the LXC."
[[ -d /run/systemd/system ]] || die "This machine is not running systemd."
command -v apt-get >/dev/null || die "This installer targets Debian. apt-get was not found."

# ---------------------------------------------------------------- 1. apt packages
step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates sqlite3 python3 rsync >/dev/null
ok "git curl ca-certificates sqlite3 python3 rsync"

# Node is only needed to build the frontend. Debian 13 ships 20.x, which is enough.
if ! command -v node >/dev/null; then
  apt-get install -y -qq nodejs npm >/dev/null || true
fi
if ! command -v node >/dev/null; then
  warn "Debian's nodejs was unavailable; installing Node 22 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[[ "${NODE_MAJOR}" -ge 20 ]] || die "Node 20 or newer is required; found $(node -v)."
ok "node $(node -v), npm $(npm -v)"

# ------------------------------------------------------------------------ 2. uv
step "Installing uv"
if [[ ! -x "${UV_BIN}" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null
fi
[[ -x "${UV_BIN}" ]] || die "uv did not install to ${UV_BIN}."
ok "$(${UV_BIN} --version)"

# ------------------------------------------------------- 3. user and directories
step "Creating the ${APP_USER} user and directories"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi
install -d -o root -g root -m 0755 "${APP_DIR}"
install -d -o root -g "${APP_USER}" -m 0750 "${ETC_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${DATA_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${DATA_DIR}/receipts"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${DATA_DIR}/backups"
ok "${APP_DIR}, ${ETC_DIR}, ${DATA_DIR}"

# ------------------------------------------------------------------- 4. the code
step "Fetching the code"
if [[ -n "${SOURCE_PATH}" ]]; then
  [[ -d "${SOURCE_PATH}" ]] || die "--source ${SOURCE_PATH} is not a directory."
  rsync -a --delete \
    --exclude .git --exclude node_modules --exclude .venv \
    --exclude 'frontend/dist' --exclude 'backend/var' \
    "${SOURCE_PATH}/" "${APP_DIR}/"
  ok "copied from ${SOURCE_PATH}"
elif [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --quiet origin
  git -C "${APP_DIR}" checkout --quiet "${REPO_REF}"
  git -C "${APP_DIR}" reset --hard --quiet "origin/${REPO_REF}"
  ok "updated to $(git -C "${APP_DIR}" rev-parse --short HEAD)"
else
  git clone --quiet --branch "${REPO_REF}" "${REPO_URL}" "${APP_DIR}"
  ok "cloned ${REPO_URL} at $(git -C "${APP_DIR}" rev-parse --short HEAD)"
fi
[[ -f "${APP_DIR}/backend/pyproject.toml" ]] || die "${APP_DIR} does not look like the project."

# ------------------------------------------------------------------- 5. the build
step "Installing Python dependencies"
(cd "${APP_DIR}/backend" && "${UV_BIN}" sync --frozen --no-dev >/dev/null)
ok "backend/.venv"

step "Building the frontend"
(cd "${APP_DIR}/frontend" && npm ci --silent >/dev/null && npm run build --silent >/dev/null)
[[ -f "${APP_DIR}/frontend/dist/index.html" ]] || die "The frontend build produced no dist/index.html."
ok "frontend/dist"

# --------------------------------------------------------------- 6. the env file
step "Writing ${ENV_FILE}"
if [[ -f "${ENV_FILE}" ]]; then
  ok "kept the existing file (secret and settings untouched)"
else
  SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  [[ -n "${BASE_URL}" ]] || BASE_URL="http://$(hostname -I | awk '{print $1}'):${PORT}"
  [[ -n "${TRUSTED_PROXY}" ]] || { TRUSTED_PROXY="127.0.0.1"; warn "no --trusted-proxy given; using 127.0.0.1"; }
  umask 027
  cat > "${ENV_FILE}" <<ENV
PB_ENV=production
PB_DATA_DIR=${DATA_DIR}
PB_DATABASE_PATH=${DATA_DIR}/budget.db
PB_SECRET_KEY=${SECRET}
PB_BASE_URL=${BASE_URL}
PB_TRUSTED_PROXY=${TRUSTED_PROXY}
PB_MAX_UPLOAD_MB=10
PB_BACKUP_KEEP_DAYS=14
ENV
  chown root:"${APP_USER}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
  ok "generated a new secret key"
fi

# -------------------------------------------------------------- 7. the migrations
step "Applying database migrations"
set -a; . "${ENV_FILE}"; set +a
runuser -u "${APP_USER}" -- \
  env PATH="${APP_DIR}/backend/.venv/bin:${PATH}" \
  sh -c "cd '${APP_DIR}/backend' && alembic upgrade head" >/dev/null
ok "schema at $(runuser -u "${APP_USER}" -- sqlite3 "${PB_DATABASE_PATH}" 'select version_num from alembic_version' 2>/dev/null || echo '?')"

# ------------------------------------------------------------------ 8. the units
step "Installing systemd units"
install -m 0644 "${APP_DIR}/deploy/systemd/payday-budget.service" /etc/systemd/system/
if [[ "${PORT}" != "8000" ]]; then
  sed -i "s/--port 8000/--port ${PORT}/" /etc/systemd/system/payday-budget.service
fi

# The timers drive `pb run-daily` and `pb backup`, which arrive in Phase 9. Install
# them now but leave them disabled until the commands exist, so nothing fails nightly.
PB_BIN="${APP_DIR}/backend/.venv/bin/pb"
for job in daily backup; do
  install -m 0644 "${APP_DIR}/deploy/systemd/payday-budget-${job}.service" /etc/systemd/system/
  install -m 0644 "${APP_DIR}/deploy/systemd/payday-budget-${job}.timer" /etc/systemd/system/
done
systemctl daemon-reload

systemctl enable --quiet payday-budget.service
for job in daily:run-daily backup:backup; do
  name="${job%%:*}"; cmd="${job##*:}"
  if "${PB_BIN}" "${cmd}" --help >/dev/null 2>&1; then
    systemctl enable --quiet --now "payday-budget-${name}.timer"
    ok "payday-budget-${name}.timer enabled"
  else
    systemctl disable --quiet "payday-budget-${name}.timer" 2>/dev/null || true
    warn "pb ${cmd} does not exist yet (Phase 9); ${name} timer installed but left off"
  fi
done

# ------------------------------------------------------------------ 9. start it
if [[ "${START_SERVICE}" -eq 1 ]]; then
  step "Starting the service"
  systemctl restart payday-budget.service

  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null || true)"
  if [[ -z "${HEALTH}" ]]; then
    printf '%sThe service did not answer on :%s.%s\n' "${RED}" "${PORT}" "${OFF}" >&2
    journalctl -u payday-budget.service -n 30 --no-pager >&2
    exit 1
  fi
  ok "health: ${HEALTH}"
else
  warn "--no-start given; the service was not started"
fi

# ------------------------------------------------------------------- what next
VERSION="$(printf '%s' "${HEALTH:-}" | python3 -c 'import json,sys; raw=sys.stdin.read(); print(json.loads(raw)["version"] if raw.strip() else "?")' 2>/dev/null || echo "?")"
cat <<NEXT

${BOLD}Payday Budget ${VERSION} is installed.${OFF}

  Create the first household member:
      runuser -u ${APP_USER} -- ${PB_BIN} create-user <username>

  Point NGINX Proxy Manager at  http://$(hostname -I | awk '{print $1}'):${PORT}
  (scheme http, Block Common Exploits on, Force SSL on the SSL tab)

  Allow port ${PORT} only from the proxy's IP, in the Proxmox firewall or nftables.

  Logs:     journalctl -u payday-budget -f
  Settings: ${ENV_FILE}   (edit, then: systemctl restart payday-budget)
  Update:   bash ${APP_DIR}/deploy/update.sh
NEXT
