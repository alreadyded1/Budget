# Progress

**Current phase:** Phase 5 — Ledger UI and fast entry (not started)
**Next step:** Plan Phase 5 per docs/BUILD_PLAN.md — the ledger screen: columns per SPEC §7, the pinned
new-entry row, the tab order and Enter/Esc behaviour, DateInput / AmountInput / Combobox keyboard
primitives, optimistic insert with running-balance recalculation and rollback on error, and the Playwright
setup that proves no document navigation happens.

## Phase status
| # | Phase | Status | Finished |
|---|---|---|---|
| 0 | Scaffold and tooling | ✅ done | 2026-09-22 |
| 1 | Auth, users, settings | ✅ done * | 2026-09-22 |
| 2 | Pay schedule engine | ✅ done | 2026-09-22 |
| 3 | Accounts, categories, payees | ✅ done † | 2026-09-23 |
| 4 | Transactions backend | ✅ done | 2026-09-23 |
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

† Phase 3 is built, but one "Done when" box cannot be closed from inside Phase 3: "merging moves
transactions, subscriptions, and rules" needs tables that Phases 4, 8 and 10 add. Phase 4 has since
registered transactions and proved that part; the box closes when subscriptions (Phase 8) and rules
(Phase 10) register theirs.

## Session log
<!-- Newest first. Copy this block for each session.
### YYYY-MM-DD — Phase N (short title)
- **Done:**
- **Deviations from plan:**
- **Known issues:**
- **Next step:**
-->

### 2026-09-23 — Phase 4 (Transactions backend)
- **Done:**
  - Migration `0005` adds `transactions` and `transaction_splits`, with the status CHECK, the
    `(account_id, date)`, `(date)` and `(transfer_id)` indexes, and cascade delete from a transaction to
    its splits.
  - `app/domain/money.py` mirrors `frontend/src/lib/money.ts`: same round-half-away-from-zero rule, same
    test cases, plus accounting parentheses for the CSV import in Phase 10.
  - Transactions and splits: one split for a plain transaction, several for a split one, and
    `SUM(splits) == amount_cents` enforced on every write. A zero split is refused. Changing the amount of
    a single-split transaction carries its split with it.
  - Transfers: one call writes both legs with a shared `transfer_id` (D-041). Editing either leg moves
    both; deleting either deletes both. The on-budget rule decides which leg carries a split (D-042).
  - Balances: current, cleared, reconciled and as-of a date, straight from the sign convention, so
    liability balances come out negative without a special case. Manual-valuation accounts use their
    typed balance instead (D-040).
  - Ledger: cursor pagination on `(date, id)`, filters for account, date range, payee, category, status,
    amount range, free text and uncategorized, a running balance for single-account views (D-038), and a
    filtered total.
  - Bulk set-status, set-category (collapsing splits) and delete, the last handling a selection that
    contains both legs of a transfer without double-counting.
  - Every mutation response carries the balances it changed, so the UI will not need a refetch.
  - The Phase 3 registries have real implementations now: payee merge moves transactions, category delete
    moves splits, and payee usage stats are a real query (D-043).
  - Endpoints: `GET|POST /transactions`, `GET|PATCH|DELETE /transactions/{id}`, `POST /transfers`,
    `POST /transactions/bulk/{status,category,delete}`, `GET /balances`,
    `GET /accounts/{id}/balance?as_of=`.
  - Tests: 234 backend (25 transactions, 19 ledger, 7 reassignment, 25 money), 30 frontend.
- **Deviations from plan:**
  - Reconciled protection covers amount, date, account and delete, not every field — SPEC §6's narrow
    list, confirmed with the user (D-039). A memo or category fix needs no confirmation.
  - Five columns DATA_MODEL lists on `transactions` are deferred to the phases that create the tables
    they point at (D-044).
  - `net_worth()` was written into the balances service and then removed: it belongs to Phase 14.
  - Found while running the full suite: `tests/api/test_payees.py` registered stub handlers under the
    real names "transactions", "subscriptions" and "rules", then popped them on the way out — removing
    the genuine transactions handler for every test that ran afterwards. Two tests passed alone and
    failed together. The conftest now snapshots and restores the registries around every test (D-043).
  - Pydantic would not accept `date: date` inside a model whose field is also called `date`; the
    schemas use `datetime.date` explicitly.
- **Known issues:**
  - The Phase 3 box "merging moves transactions, subscriptions, and rules" is now two-thirds open:
    transactions are proven, subscriptions and rules wait for Phases 8 and 10.
  - No UI this phase — the ledger screen is Phase 5. The Accounts page still shows opening balances
    rather than the real ones, which Phase 5 wires up.
  - `GET /balances` walks every account one at a time. Fine for a household; worth a single grouped
    query if an account list ever gets long.
- **Next step:** Plan Phase 5 (ledger UI and fast entry) — the core screen.

### 2026-09-23 — Phase 3 (Accounts, categories, payees)
- **Done:**
  - Migration `0004` adds `accounts`, `account_valuations`, `category_groups`, `categories` and `payees`,
    with nocase-unique names, the nine-type and valuation-mode CHECKs, and `(group_id, name)` unique per
    group.
  - Accounts: CRUD, close and reopen (history is kept, the account just leaves the entry lists), reorder,
    debt fields with APR in basis points (D-034), and dated manual valuations, one per account per day.
    `on_budget` defaults from the type per SPEC §3 and can be overridden.
  - Categories: groups and categories, hide, sinking-fund flag, default planned amount, and keyboard
    reorder through `app/domain/ordering.py` (pure). Delete refuses while a category is in use and takes
    a reassignment target.
  - Payees: alphabetical nocase list with search, rename, merge, pinned default category, hide, and
    usage-stat plumbing that Phase 4 fills in (D-032). A rename onto an existing name returns 409 with
    both names so the UI can offer the merge (D-033).
  - `app/services/references.py` is the registry that later phases plug into for merge and
    delete-with-reassignment (D-031).
  - CLI: `pb seed-categories` and `pb list-categories`. The same starter set is offered in the UI on an
    empty Categories page — 8 groups, 26 categories, with Repairs, Maintenance, Gifts and the three
    Savings categories pre-flagged as sinking funds.
  - UI: Accounts page (opening balances only; real balances are Phase 4), Categories manager under
    Settings with Alt+↑/↓ reorder, and the Payees page with search, inline rename on Enter/Esc, and the
    merge offer.
  - `frontend/src/lib/money.ts` formats and parses integer cents at the UI edge.
  - Tests: 158 backend (13 accounts, 16 categories, 17 payees, 10 ordering), 30 frontend.
- **Deviations from plan:**
  - Categories sit under Settings rather than in the sidebar, matching SPEC §17 and leaving the nine
    sidebar items from Phase 0 alone (D-036).
  - Found while writing the money tests: parsing `1.005` through `Math.round(value * 100)` returns 100
    cents, not 101, because the product is 100.49999999999999. Parsing now reads the digit string
    directly (D-037). This is the bug the integer-cents rule exists to prevent, and it would have been
    invisible until a real amount landed on the edge.
  - Added `pb list-categories`, which the phase did not list, to check a seed without opening the UI.
- **Known issues:**
  - "Merging moves transactions, subscriptions, and rules" stays unticked until Phases 4, 8 and 10
    register their handlers. The merge itself, and the registry it iterates, are tested with stubs.
  - Payee usage columns show zero and "never" for every payee until Phase 4.
  - Account balances are not shown; the page lists opening balances only, as the phase intends.
  - The browser click-through is still unverified across all three phases: the Chrome extension has
    stayed disconnected since Phase 0. Verified over HTTP instead — seeding produced 8 groups and 26
    categories, four Alt+Up presses walked Phone to the top of Utilities and a fifth correctly did
    nothing, and renaming "Kroger Fuel Center" to "KROGER" returned the merge offer, which then collapsed
    the two payees into one.
- **Next step:** Plan Phase 4 (transactions backend).

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
- Register subscriptions and rules with `app/services/references.py` — Phases 8 and 10 (transactions done).
- Group `GET /balances` into one query if the account list ever grows — Phase 16.
- Transaction columns deferred to their own phases: subscription_occurrence_id (8), import_batch_id and
  import_key (10), reconciliation_id (11).
- ntfy settings UI and the runtime HTTP client choice — Phase 9.
- Apply `theme_default` (and a per-browser override) to the UI — Phase 16.
- First-run onboarding wizard (pay schedule → accounts → categories) — SPEC §17, after Phase 3.
- A "session list / sign out everywhere" screen was not asked for; note it if it ever comes up.

## Known issues
<!-- Open bugs and limitations that aren't tied to the current phase. -->
- None outside the per-phase notes above.
