# Progress

**Current phase:** Phase 3 — Accounts, categories, payees (not started)
**Next step:** Plan Phase 3 per docs/BUILD_PLAN.md — account CRUD with close/reopen, debt fields and
valuation mode; category groups and categories with keyboard reorder, hide, sinking-fund flag and delete
with reassignment; payees with nocase-unique names, inline rename, merge, pinned default category and
usage stats; plus `pb seed-categories` and the first-run starter set.

## Phase status
| # | Phase | Status | Finished |
|---|---|---|---|
| 0 | Scaffold and tooling | ✅ done | 2026-09-22 |
| 1 | Auth, users, settings | ✅ done * | 2026-09-22 |
| 2 | Pay schedule engine | ✅ done | 2026-09-22 |
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

### 2026-09-22 — Phase 2 (Pay schedule engine)
- **Done:**
  - Migration `0003` adds `pay_schedules` and `pay_periods`, with CHECK constraints on the frequency and
    weekend-rule enums, a unique `effective_from`, a unique `start_date`, and the `(start_date, end_date)`
    index.
  - `app/domain/pay_periods.py` is pure: no database, no clock. Pay dates per frequency, the month-end
    clamp, the weekend rules, contiguous period building, `period_for_date`, and `pay_dates_through`.
    Dates are computed from the configuration rather than from the previous date, so nothing drifts
    (D-028).
  - Service: generates ~13 months ahead, extends lazily once the timeline comes within 120 days of its
    end (D-030), and applies a change by keeping past periods, ending the period in progress the day
    before the new first pay date, flagging it as a transition, and rebuilding everything after it.
  - Endpoints: `GET /pay-schedule` (current + history), `POST /pay-schedule/preview` (writes nothing),
    `POST /pay-schedule`, `GET /pay-periods?from=&to=`, `GET /pay-periods/current`.
  - UI: Settings gains Pay schedule (form with a live six-period preview, transition warning, and
    schedule history) and Pay periods (the full timeline with transition and current markers).
  - Tests: 38 domain, 15 API, 10 frontend. All five "Done when" cases are covered, including the property
    test that walks three years a day at a time for seven different schedules.
- **Deviations from plan:**
  - Two rules the spec left open were decided with the user: skip a weekend shift that would reorder pay
    dates (D-026), and allow a change to reach back into the period in progress but no further (D-029).
  - Found while testing: semimonthly on the 30th and 31st produces two identical dates every February.
    The duplicate is now dropped so the month has one pay date (D-027). Nothing in the spec covers it.
  - "Business day" is Monday to Friday with no holiday calendar (D-025).
  - The Pay period history lives as a Settings tab rather than a sidebar entry, so the nine sidebar items
    from Phase 0 stay as specified.
- **Known issues:**
  - The browser click-through is still unverified — the Chrome extension stayed disconnected for this
    session too. Verified over HTTP instead against the built SPA: preview, commit, current period, and a
    mid-period change from biweekly to monthly-on-the-1st, which produced a 6-day transition period and a
    contiguous timeline, with 2026-11-01 (a Sunday) correctly paid on 2026-10-30.
  - `ensure_horizon()` only runs when periods are listed. Until the Phase 9 daily job calls it, a household
    that never opens the pay-periods screen could let the timeline age.
- **Next step:** Plan Phase 3 (accounts, categories, payees).

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
- `ensure_horizon()` should also run from the daily job so the timeline never ages — Phase 9.
- Prorating planned amounts across a transition period — Phase 6 (budget planner).
- ntfy settings UI and the runtime HTTP client choice — Phase 9.
- Apply `theme_default` (and a per-browser override) to the UI — Phase 16.
- First-run onboarding wizard (pay schedule → accounts → categories) — SPEC §17, after Phase 3.
- A "session list / sign out everywhere" screen was not asked for; note it if it ever comes up.

## Known issues
<!-- Open bugs and limitations that aren't tied to the current phase. -->
- None outside the per-phase notes above.
