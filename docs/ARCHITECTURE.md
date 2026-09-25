# Architecture

## Runtime picture
```
Browser (React SPA)
   │ HTTPS
   ▼
NGINX Proxy Manager LXC ──HTTP :8000──▶ payday-budget LXC (Debian 13, systemd)
                                         uvicorn → FastAPI (1 worker)
                                           ├─ /api/v1/*   JSON API
                                           └─ /*          built SPA (frontend/dist, SPA fallback)
                                         SQLite (WAL)   /var/lib/payday-budget/budget.db
                                         Receipts       /var/lib/payday-budget/receipts/
                                         Backups        /var/lib/payday-budget/backups/
                                         systemd timers → `pb run-daily`  → ntfy (HTTP POST)
                                                        → `pb backup`
```
No containers. There is one app process and one database file. Proxmox vzdump backs up the whole LXC,
and the app's own nightly backup gives point-in-time copies of the database and receipts.

## Stack and why
| Piece | Choice | Why |
|---|---|---|
| API | FastAPI | Typed, fast, auto OpenAPI docs at `/api/docs` (dev only) |
| ORM / migrations | SQLAlchemy 2.x (sync) + Alembic | Sync sessions + `def` endpoints are simpler with SQLite; FastAPI runs them in a threadpool |
| Database | SQLite (WAL) | One household, low write concurrency; backup = one file; nothing to administer. SQLAlchemy keeps a Postgres move possible later |
| Validation | Pydantic v2 + pydantic-settings | Request/response schemas and env config |
| CLI | Typer (`pb`) | create-user, reset-password, run-daily, backup, restore, seed |
| Python tooling | uv, ruff, pytest | Fast installs, lockfile, lint + format in one tool |
| Frontend | React + TypeScript + Vite | Best fit for a spreadsheet-like keyboard ledger |
| Server state | TanStack Query | Caching, optimistic updates, rollback |
| Tables / lists | TanStack Table + TanStack Virtual | Ledger columns, large ledgers |
| Routing | React Router | Client-side navigation, no reloads |
| Styling | Tailwind CSS | Fast iteration; dark mode via class |
| Combobox | Headless accessible combobox (e.g. Downshift) | Full keyboard control for Payee / Category |
| Charts | Recharts | Reports |
| Dates (FE) | date-fns | Parsing shortcuts, formatting |
| Passwords | argon2-cffi | argon2id |
| HTTP client | httpx | ntfy |
| OFX/QFX | ofxtools (evaluate in Phase 10) | Parse bank files |
| Images | Pillow + pillow-heif | Receipt thumbnails, iPhone HEIC |
| E2E tests | Playwright (native install) | Verifies keyboard flow and no-reload behavior |

Pin exact versions at scaffold time (current stable releases) and record them in `docs/DECISIONS.md`.

## Repo layout
```
payday-budget/
├── CLAUDE.md
├── README.md
├── Makefile
├── docs/
├── backend/
│   ├── pyproject.toml, uv.lock
│   ├── alembic.ini, migrations/
│   ├── app/
│   │   ├── main.py            # app factory, routers, static SPA mount
│   │   ├── config.py          # pydantic-settings (PB_* env vars)
│   │   ├── db.py              # engine, SQLite pragmas, session dependency
│   │   ├── auth.py            # session cookie dependency, CSRF header check
│   │   ├── api/v1/            # routers: auth, accounts, categories, payees, transactions,
│   │   │                      #   periods, budget, subscriptions, imports, rules, reports,
│   │   │                      #   goals, networth, attachments, settings, users
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/          # business logic (DB-aware)
│   │   ├── domain/            # PURE functions: pay_periods, occurrences, date_ranges,
│   │   │                      #   money parsing, debt_payoff, csv/ofx parsing helpers
│   │   ├── jobs/              # daily job, backup, ntfy client
│   │   └── cli.py             # Typer `pb` entry point
│   └── tests/
│       ├── domain/            # pure-function tests (the most important ones)
│       ├── api/               # endpoint tests against a temp SQLite file
│       └── fixtures/          # sample OFX, QFX, CSV files
├── frontend/
│   ├── package.json, vite.config.ts, tailwind config
│   └── src/
│       ├── api/               # fetch client, query keys, typed endpoints
│       ├── components/        # DateInput, AmountInput, Combobox, Toast, Modal, Money, ...
│       ├── features/          # ledger/, budget/, accounts/, payees/, categories/,
│       │                      #   subscriptions/, calendar/, imports/, reconcile/,
│       │                      #   reports/, goals/, networth/, settings/, auth/
│       ├── lib/               # parsers (date shortcuts, amount math), formatters, keyboard helpers
│       └── routes.tsx
└── deploy/
    ├── install.sh, update.sh, backup.sh, restore.sh
    ├── systemd/               # .service and .timer units
    └── payday-budget.env.example
```

## Backend details
**SQLite pragmas**, run on every new connection via an SQLAlchemy `connect` event:
- `journal_mode=WAL`
- `foreign_keys=ON`
- `busy_timeout=5000`
- `synchronous=NORMAL`

**Single worker.** Run uvicorn with one worker. SQLite has one writer, and in-memory state such as the login
rate limiter assumes a single process. That is plenty for a household.

**Auth**
- Login sets an HttpOnly, Secure (in production), SameSite=Lax cookie holding a random token.
  Only the token's hash is stored in the DB.
- Sliding expiry of 30 days.
- Every non-GET request must carry the header `X-PB-Request: 1`. A cross-site form post can't set that
  header, so this serves as the CSRF defense.
- Login is rate limited per username and IP (5 failures per 15 minutes).

**API conventions**
- Resources are plural nouns. PATCH is used for partial updates.
- List endpoints return `{items, next_cursor}`.
- Mutations return the changed resource **plus affected aggregates**. For example,
  `POST /transactions` returns the transaction and the new balances of the affected accounts, so the UI
  reconciles its optimistic state without a refetch.
- Validation errors return 422 with field paths. Business-rule conflicts return 409 with a `code`,
  e.g. `reconciled_edit_requires_confirm`.

**Money parsing and formatting** lives in two mirrored places:
- `app/domain/money.py` — server-side CSV parsing
- `frontend/src/lib/money.ts` — typed input

Both round half away from zero to cents. Both have tests with the same cases.

**Static SPA.** In production FastAPI mounts `frontend/dist`. Any non-`/api` path that isn't a file returns
`index.html`, so deep links work.

**Jobs.** `pb run-daily` and `pb backup` are idempotent CLI commands, triggered by systemd timers.
There is no in-process scheduler. Each job logs to journald and records notifications in `notification_log`.

**Files.** Receipts are stored at `PB_DATA_DIR/receipts/YYYY/MM/<uuid>.<ext>`, with thumbnails beside them.
They are served only through `GET /api/v1/attachments/{id}` after the auth check.

## Frontend details
**Data flow.** TanStack Query owns all server state. Local UI state (entry row fields, selection) stays in
component state. Add a small store only if a real need shows up; record it in DECISIONS.

**Query keys** follow the pattern `['transactions', {accountId, filters}]`, `['balances']`,
`['budget', periodId]`, `['payees']`, and so on, defined in `src/api/keys.ts`.

**Optimistic pattern** (ledger):
1. `onMutate`: cancel queries, snapshot, insert a temporary row with a negative id, and recompute running
   balances locally.
2. `onError`: restore the snapshot, refill the entry row, and show a toast.
3. `onSuccess`: replace the temporary row with the server row and apply the returned balances.

**Keyboard primitives** in `src/components/`:
- `DateInput` — shortcuts `t`, `+`, `-`, `15`, `3/15`
- `AmountInput` — accepts math expressions
- `Combobox` — typeahead with Tab/Enter accept and a "Create" option
- `useRowNavigation` — arrows/j/k, Enter to edit, Esc

Every feature form is built from these.

**Caching.** Payees, categories, and accounts are fetched once and kept fresh with `staleTime`. Typeahead
filters them in memory.

**Theming.** Tailwind `dark:` classes. The theme is stored per browser, with the household default from
settings.

## Testing strategy
- **Domain tests** (pytest) cover edge-case dates: leap years, month ends, year boundaries, weekend rules,
  schedule changes. Add property-style tests where useful, e.g. "every date maps to exactly one period."
- **API tests** use a fresh temporary SQLite file per test module with migrations applied.
- **Frontend unit tests** (Vitest) cover parsers and formatters. Component tests (Testing Library) cover
  tab order and entry-row behavior.
- **E2E** (Playwright) covers the full keyboard entry flow and asserts that no document navigation happens.
  Added in Phase 5 and extended in Phase 16.
- **Performance** (`make perf`, Phase 16): `pb seed-demo` builds a 100k-transaction household in a scratch
  database, `backend/perf/run.py` times the API against the real server, and `frontend/perf/` scrolls
  5,000 ledger rows and types into the payee typeahead. Saves over 150 ms p95, a payee list over 150 ms,
  a scroll frame over 50 ms p95 or a keystroke over 50 ms p95 fail the run (D-110).
