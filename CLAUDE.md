# Payday Budget — Instructions for Claude Code

Self-hosted household budgeting app built around **pay periods** (weekly, biweekly, semimonthly, monthly).
Runs natively on a Debian 13 LXC in Proxmox under systemd, behind NGINX Proxy Manager.

## Start of every session
1. Read `docs/PROGRESS.md` for what is done, known issues, and the exact next step.
2. Read the current phase in `docs/BUILD_PLAN.md`. Work on **that phase only**.
3. Read the sections of `docs/SPEC.md`, `docs/DATA_MODEL.md`, and `docs/ARCHITECTURE.md` the phase touches.
4. Propose a short plan (files to create/change, migrations, tests) and wait for approval before writing code.

## End of every session
1. Run `make lint` and `make test`. Everything passes before you stop.
2. Tick the phase's "Done when" boxes in `docs/BUILD_PLAN.md` that are truly done.
3. Update `docs/PROGRESS.md`: what was done, deviations from plan, known issues, and the exact next step.
4. Record non-obvious decisions in `docs/DECISIONS.md` (one short entry each).
5. Commit with a conventional commit message, e.g. `feat(ledger): keyboard entry row`.

## Hard rules
- **No Docker. Ever.** No Dockerfile, docker-compose, devcontainer, Podman, or "run it in a container" advice.
  The deploy target is a Proxmox LXC with systemd. If a tool only documents a Docker install, find the
  native install or choose a different tool.
- **SQLite only**, through SQLAlchemy. Do not add PostgreSQL, Redis, Celery, RabbitMQ, or any other service.
- **Money is integer cents everywhere**: database, API, and frontend state. Never use floats for money.
  Parse and format only at the UI edge.
- **Dates are plain calendar dates** (`YYYY-MM-DD`) for transactions, pay periods, and due dates.
  Audit timestamps (`created_at`, etc.) are UTC.
- **No full page reloads.** Every data change goes through the JSON API via TanStack Query mutations.
  Forms never do native submits.
- **Keyboard first.** Every form must work with Tab / Shift+Tab / Enter / Esc alone.
- Never edit an Alembic migration that has been committed. Add a new one.
- Never add a dependency without a one-line reason in `docs/DECISIONS.md`.
- Never commit secrets, `.env` files, `*.db` files, or uploaded receipts.
- Stay in the current phase. Anything that belongs to a later phase goes in the "Parking lot" section of
  `docs/PROGRESS.md` instead of being built.
- If the spec is ambiguous, ask. Don't guess on money math or pay-period rules.

## Stack (details and rationale in docs/ARCHITECTURE.md)
- Backend: Python 3.12+, FastAPI, SQLAlchemy 2.x (sync sessions), Alembic, Pydantic v2, Typer CLI, uv, pytest, ruff
- Frontend: React + TypeScript + Vite, TanStack Query, React Router, Tailwind CSS, Vitest, ESLint, Prettier
- Serving: one uvicorn process (1 worker); FastAPI serves the built SPA from `frontend/dist`

## Commands (Phase 0 creates these; keep this list accurate)
- `make dev` — backend with reload on :8000 and Vite dev server on :5173 (proxies `/api`)
- `make test` — pytest + vitest
- `make e2e` — Playwright E2E against a throwaway server and database (needs Chromium: `npx playwright install chromium`, or `PB_CHROMIUM_PATH`)
- `make lint` — ruff + eslint + `tsc --noEmit`
- `make fmt` — ruff format + prettier
- `make migrate` — `alembic upgrade head`
- `make build` — production frontend build into `frontend/dist`
- `uv run pb --help` — admin CLI (create-user, run-daily, backup, ...)

## Code conventions
- Backend layers: `app/api/` (thin routers) → `app/services/` (business logic) → `app/models/` (SQLAlchemy),
  with `app/schemas/` (Pydantic). Routers never hold business logic.
- Pay-period math, subscription occurrence math, date-range presets, and debt payoff math are **pure functions**
  in `app/domain/` with thorough unit tests.
- All routes under `/api/v1`. Errors are JSON: `{"detail": "...", "code": "..."}`.
- Mutation responses include the aggregates they change (e.g. account balances) so the UI never needs a refetch.
- Frontend: feature folders (`src/features/ledger/`, `src/features/budget/`, ...), shared UI in `src/components/`,
  API client and query keys in `src/api/`.
- Optimistic updates for every mutation with a predictable result; roll back and show a toast on error.
- Sign convention: transaction amounts are signed from the account's point of view
  (outflow negative, inflow positive). Liability balances are negative.
