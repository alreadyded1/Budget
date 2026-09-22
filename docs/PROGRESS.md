# Progress

**Current phase:** Phase 2 — Pay schedule engine (not started)
**Next step:** Plan Phase 2 per docs/BUILD_PLAN.md — the `pay_schedules` and `pay_periods` tables, the pure
functions in `app/domain/pay_periods.py` (pay dates per frequency, month-end clamp, weekend rules,
contiguous period building, `period_for_date`), the schedule-change service, the preview/commit endpoints,
and Settings → Pay schedule with its live 6-period preview.

## Phase status
| # | Phase | Status | Finished |
|---|---|---|---|
| 0 | Scaffold and tooling | ✅ done | 2026-09-22 |
| 1 | Auth, users, settings | ✅ done * | 2026-09-22 |
| 2 | Pay schedule engine | ⬜ | |
| 3 | Accounts, categories, payees | ⬜ | |
| 4 | Transactions backend | ⬜ | |
| 5 | Ledger UI and fast entry | ⬜ | |
| 6 | Budget planner and dashboard | ⬜ | |
| 7 | Deploy MVP to LXC | ⬜ | |
| 8 | Subscriptions and bill calendar | ⬜ | |
| 9 | Daily job and ntfy | ⬜ | |
| 10 | Import and rules | ⬜ | |
| 11 | Reconciliation | ⬜ | |
| 12 | Reports | ⬜ | |
| 13 | Goals and sinking funds | ⬜ | |
| 14 | Net worth and debt payoff | ⬜ | |
| 15 | Receipt attachments | ⬜ | |
| 16 | Polish and hardening | ⬜ | |

Status key: ⬜ not started · 🟨 in progress · ✅ done

\* Phase 1 is built and its automated tests pass, but one "Done when" box is still open: the
browser click-through of CLI user → login form → signed in. The browser tooling disconnected before that
check could run. The server side of it is verified (see the session log below).

## Session log
<!-- Newest first. Copy this block for each session.
### YYYY-MM-DD — Phase N (short title)
- **Done:**
- **Deviations from plan:**
- **Known issues:**
- **Next step:**
-->

### 2026-09-22 — Phase 1 (Auth, users, settings)
- **Done:**
  - Migration `0002` adds `users`, `sessions`, and `settings`, and seeds the settings singleton (id = 1).
  - argon2id hashing via argon2-cffi, with transparent rehash when parameters change (D-018).
  - Sessions: random token in an HttpOnly / SameSite=Lax cookie (Secure in production only), sha256 of the
    token stored, 30-day sliding expiry refreshed on each request, expired rows deleted on use.
  - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`; `GET|POST /users`, `PATCH /users/{id}`,
    `POST /users/{id}/password`; `GET|PATCH /settings`.
  - Everything except health and auth sits behind one router-level dependency that checks the session and
    the `X-PB-Request` header together, so new routers are protected by default (D-021).
  - Login rate limiting: 5 failures per 15 minutes per username and per IP, in-memory with an injected
    clock (D-023). A successful login clears the count.
  - Guard rails: no disabling yourself, no disabling the last active user (D-020). Disabling someone or
    resetting their password ends their sessions (D-022).
  - CLI: `pb create-user`, `pb reset-password`, `pb list-users`, plus `pb enable-user` for recovering from
    a disable without the UI. Passwords are prompted, never passed as arguments.
  - Frontend: login page (no native submit), route guard remembering the attempted path, user menu with
    sign-out, Settings split into General and Users tabs, toast component, and a query client that never
    retries a 401.
  - Tests: 49 backend (login success/failure, lockout, 401, CSRF rejection, session expiry and sliding,
    logout, user guards, session revocation, settings validation, password policy, rate limiter) and
    9 frontend.
- **Deviations from plan:**
  - Password policy and the disable guard rails were confirmed with the user mid-plan: 12-character
    minimum, no composition rules; both guard rails on (D-019, D-020).
  - Added `pb enable-user`, which the phase did not list, because the CLI was otherwise a one-way door
    out of a disabled account.
  - `starlette.status.HTTP_422_UNPROCESSABLE_ENTITY` is deprecated in starlette 1.6; `errors.py` now uses
    `HTTP_422_UNPROCESSABLE_CONTENT`.
- **Known issues:**
  - The browser click-through of the login form has not been run: the Chrome extension disconnected
    partway through the session. Verified instead with curl against the built SPA on :8000 — a
    CLI-created user logs in, the cookie comes back HttpOnly/SameSite=Lax with no Secure flag in
    development, an authenticated `GET /settings` succeeds, a mutation without `X-PB-Request` is refused
    with 403, logout returns 204, and the session row is gone afterwards.
  - Sessions are only cleaned up when a caller presents an expired cookie. A sweep belongs with the daily
    job in Phase 9; `purge_expired_sessions()` already exists for it.
  - The theme setting is stored but not yet applied to the UI; wiring it up belongs with polish (Phase 16).
- **Next step:** Plan Phase 2 (pay schedule engine).

### 2026-09-22 — Phase 0 (Scaffold and tooling)
- **Done:**
  - Repo initialised and pushed to https://github.com/alreadyded1/Budget (`main`).
  - Dev machine prepared: Python 3.13.13 via uv, Node 24.21.0 LTS unpacked to `~/.local/node` (D-012).
  - Backend: uv project with pinned deps; app factory in `app/main.py`; `GET /api/v1/health` returning
    version, env and DB status; `app/config.py` reading `PB_*` with dev defaults under `backend/var/`;
    `app/db.py` applying the four SQLite pragmas on every connection; shared JSON error shape in
    `app/errors.py`; empty `models/schemas/services/domain/jobs` packages; Typer `pb` CLI with
    `version` and `info`.
  - Alembic configured in batch mode with the empty `0001_initial_empty` revision; `make migrate` works.
  - Frontend: Vite + React 19 + TS, Tailwind v4, React Router, TanStack Query; app shell with the nine
    sidebar routes and placeholder pages; live health badge in the sidebar footer; `/api` proxied to :8000.
  - FastAPI serves `frontend/dist` with an SPA fallback; verified in a browser that `/reports` deep-links
    on :8000 with the badge reading "API online".
  - Makefile: dev, test, lint, fmt, migrate, build, plus install/clean and per-side variants.
  - Sample tests both sides: 3 pytest (health, JSON 404 shape, pragmas), 5 vitest (health state helpers).
- **Deviations from plan:**
  - The Vite template now ships oxlint; replaced with ESLint + Prettier to match ARCHITECTURE.md (D-013).
  - `httpx2` instead of `httpx` as the test-client dependency, required by starlette 1.6 (D-014).
  - Error handlers bind Starlette's `HTTPException` so unmatched routes also return `{"detail","code"}`
    (D-015).
  - `strict: true` added to both tsconfigs; the template omitted it.
- **Known issues:**
  - `make` targets need Node on PATH. New shells get it from `~/.zshrc`; an existing shell needs a reload.
  - Vite binds to `localhost` (IPv6 `::1`), so `http://127.0.0.1:5173` is refused while
    `http://localhost:5173` works. The backend on :8000 listens on IPv4.
  - `pytest` ignores one upstream DeprecationWarning from starlette's use of `anyio.abc.BlockingPortal`;
    remove the filter in `backend/pyproject.toml` once starlette fixes it.
- **Next step:** Plan Phase 1 (auth, users, settings).

## Parking lot
<!-- Ideas or work found mid-phase that belongs to a later phase. -->
- Playwright E2E setup (native install, no containers) — Phase 5 per BUILD_PLAN.
- Testing Library component tests for tab order and the entry row — Phase 5.
- `deploy/` scripts and systemd units — Phase 7.
- Expired-session sweep inside `pb run-daily` — Phase 9.
- ntfy settings UI and the runtime HTTP client choice — Phase 9.
- Apply `theme_default` (and a per-browser override) to the UI — Phase 16.
- First-run onboarding wizard (pay schedule → accounts → categories) — SPEC §17, after Phase 3.
- A "session list / sign out everywhere" screen was not asked for; note it if it ever comes up.

## Known issues
<!-- Open bugs and limitations that aren't tied to the current phase. -->
- None outside the per-phase notes above.
