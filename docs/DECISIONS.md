# Decisions

Short, dated entries. Newest last. Format: context → decision → consequence.

## D-001 No Docker
Deployment is a Proxmox LXC with systemd, native from day one. Containers add a layer this app doesn't need.
→ No Dockerfiles, compose files, or devcontainers. Deploy scripts target Debian 13 directly.

## D-002 SQLite instead of PostgreSQL
One household, a couple of concurrent users, and writes are small and infrequent.
→ SQLite in WAL mode with a single uvicorn worker. Backup is one file. Everything goes through SQLAlchemy,
so moving to Postgres later means changing settings and migrating the data, not rewriting code.

## D-003 Integer cents
Floats can't represent money exactly.
→ Every amount is an integer number of cents end to end. Parsing and formatting happen only at the UI edge.

## D-004 All categorization lives in splits
Keeps reporting to a single query path.
→ A normal transaction has one split and a split transaction has many. Transfers between on-budget accounts
have none. Reports read only from `transaction_splits`.

## D-005 Planned vs. actual, reset each period
The household chose planned-vs-actual budgeting per pay period, and unspent planned money does not
roll over.
→ Actuals are computed and never stored. **Exception:** categories flagged as sinking funds accumulate a
balance across periods, because that is what a sinking fund is.

## D-006 One shared pay schedule; periods by date only
The household has one pay schedule. A transaction belongs to the period containing its date, with no
manual reassignment. Periods are contiguous with no gaps.
→ Schedule changes create a new schedule row with an effective date. Past periods are never rewritten.

## D-007 FastAPI serves the SPA
→ One process, one systemd unit, one port. NPM handles TLS.

## D-008 Scheduled work via systemd timers
In-process schedulers misbehave with reloads and multiple workers, and hide failures.
→ Idempotent `pb` CLI commands run from systemd timers. Output goes to journald. Notifications are
deduplicated through `notification_log`.

## D-009 Sync SQLAlchemy sessions
Async buys nothing with SQLite and complicates tests.
→ `def` endpoints with sync sessions; FastAPI runs them in its threadpool.

## D-010 Bank data: manual entry plus file import
Auto-sync services are out of scope for v1.
→ CSV, OFX, and QFX import with rules, duplicate detection, and matching to manual entries.

## D-011 Pinned dependency versions (Phase 0, 2026-09-22)
Reproducible builds matter more than automatic upgrades on a self-hosted box.
→ Exact versions in `backend/pyproject.toml` and `frontend/package.json`, with `uv.lock` and
`package-lock.json` committed. Runtimes: Python 3.13.13 (uv-managed), Node 24.21.0 LTS / npm 11.19.0.

Backend: fastapi 0.141.1 · uvicorn[standard] 0.53.0 · sqlalchemy 2.0.54 · alembic 1.20.0 ·
pydantic 2.13.5 · pydantic-settings 2.15.0 · typer 0.27.2 · dev: pytest 9.1.1, ruff 0.16.8, httpx2 2.13.0.

Frontend: react 19.3.0 · react-dom 19.3.0 · react-router-dom 7.18.4 · @tanstack/react-query 5.103.2 ·
dev: vite 8.3.0, @vitejs/plugin-react 6.1.1, typescript 6.0.3, tailwindcss 4.3.3, @tailwindcss/vite 4.3.3,
eslint 10.11.0, typescript-eslint 8.70.1, prettier 3.9.8, vitest 5.0.1.

## D-012 Node installed from the official tarball, not Homebrew
The dev Mac had no Node and no package manager, and Homebrew is a large dependency to take on for one runtime.
→ Node 24 LTS unpacked to `~/.local/node` with `~/.zshrc` extending PATH. No sudo, removable by deleting
the folder. The LXC will use Debian's own Node for builds.

## D-013 ESLint and Prettier, not the Vite template's oxlint
The Vite react-ts template now scaffolds oxlint, but ARCHITECTURE.md specifies ESLint + Prettier and
`make lint` is defined as ruff + eslint + tsc.
→ oxlint removed; flat ESLint config with typescript-eslint and the React Hooks plugin.

## D-014 httpx2 for the test client
starlette 1.6 deprecates httpx in `TestClient` and asks for httpx2.
→ httpx2 2.13.0 is the dev dependency. The runtime HTTP client for ntfy (Phase 9) is chosen separately.

## D-015 Error handler bound to Starlette's HTTPException
FastAPI's `HTTPException` subclasses Starlette's, and unmatched routes raise the Starlette one directly.
→ `register_error_handlers` binds the base class, so every error, including 404s, returns
`{"detail", "code"}`.

## D-016 Tailwind v4 through its Vite plugin
Tailwind v4 needs neither `tailwind.config.js` nor a PostCSS pipeline.
→ `@tailwindcss/vite` in `vite.config.ts` plus `@import 'tailwindcss'` in `src/index.css`.

## D-017 Placeholder routes exist from Phase 0
All nine sidebar pages render a "Arrives in Phase N" placeholder.
→ Navigation, the SPA fallback, and deep links are verifiable before any feature exists.
