#!/usr/bin/env bash
# Starts a throwaway Payday Budget for the Playwright tests: a fresh SQLite file in a
# temp directory, one user, the starter categories, and the built SPA on :8765.
# Native processes only — no containers (CLAUDE.md).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
data="$(mktemp -d -t pb-e2e-XXXXXX)"
trap 'rm -rf "$data"' EXIT

export PB_ENV=test
export PB_DATA_DIR="$data"

if [ "${PB_E2E_SKIP_BUILD:-0}" != "1" ]; then
  npm --prefix "$repo/frontend" run build >/dev/null
fi

cd "$repo/backend"
uv run alembic upgrade head >/dev/null
uv run pb create-user e2e --display-name "E2E" --password "e2e-password-123" >/dev/null
uv run pb seed-categories >/dev/null
uv run uvicorn app.main:app --host 127.0.0.1 --port "${PB_E2E_PORT:-8765}" --log-level warning
