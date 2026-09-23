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

## D-018 argon2-cffi for password hashing (Phase 1, 2026-09-22)
ARCHITECTURE.md calls for argon2id and argon2-cffi is its reference implementation.
→ `argon2-cffi==25.1.0`, library defaults (argon2id), with `check_needs_rehash` on every successful login
so parameter upgrades land transparently.

## D-019 Password policy is length only: 12 characters
Composition rules push people toward `Password1!`; length is what actually helps, and current NIST guidance
agrees.
→ 12-character minimum, 256-character maximum, no character-class rules, a short list of obvious strings
rejected, and leading/trailing whitespace refused. Enforced in `app/domain/passwords.py`, so the API,
the CLI, and the UI all get the same answer.

## D-020 Two guard rails on disabling users
SPEC §17 gives every user full access, which makes it possible to disable every account and lock the
household out of its own app.
→ You cannot disable your own account (`cannot_disable_self`), and the last active account cannot be
disabled (`cannot_disable_last_user`). Both return 409. Recovery without these would mean shell access
to the LXC.

## D-021 Routes are protected by default
Forgetting an auth dependency on a new router is a silent hole, and there will be a dozen more routers.
→ `api/v1/__init__.py` mounts health and auth publicly, then mounts everything else under a router
carrying `Depends(authenticated)`, which checks the session and the `X-PB-Request` header together.
A new router is protected by being added to the protected group.

## D-022 Losing access ends existing sessions
A disable or a password reset that leaves live cookies working is not really a disable or a reset.
→ Disabling a user and resetting someone else's password both delete that user's session rows. Resetting
your own password keeps you signed in, since you just proved who you are.

## D-023 Login failures are tracked in memory
Per D-002 and the single-worker rule there is exactly one process, so a dict outlives any request.
→ `app/domain/rate_limit.py` holds a pure `FailureTracker` with an injected clock (tests never sleep),
counting failures per username *and* per IP, 5 per 15 minutes. A restart forgives everyone, which is an
acceptable trade for a household app with no extra services.

## D-024 The ntfy token is write-only over the API
It is a credential, and the settings endpoint is read far more often than it is written.
→ `SettingsUpdate` accepts `ntfy_token`; `SettingsOut` does not return it. The UI shows whether one is
set, never its value (Phase 9).

## D-025 A business day is Monday to Friday (Phase 2, 2026-09-22)
SPEC §2 asks for previous/next business day but names no holiday calendar, and a real one means a new
dependency plus a country choice the spec never makes.
→ Weekends only. A pay date on a public holiday is left alone. If holidays ever matter, they go in as a
table of dates, not a library.

## D-026 The weekend rule is skipped when it would reorder pay dates
Semimonthly days that sit next to each other (the 1st and 2nd, say) can both shift onto the same Friday,
which would make a zero-length or backwards period.
→ A shifted date that lands on or before the previous pay date keeps its configured date instead. The
preview reports every date where this happened, so the schedule is never silently different from what
was asked for.

## D-027 Two configured days clamping onto one date make one pay date
Semimonthly on the 30th and 31st produces two identical dates every February.
→ The duplicate is dropped, so that month has a single pay date and a single period. Periods stay
contiguous and are never zero days long.

## D-028 Pay dates are computed from the schedule, never from the previous date
Stepping month by month from the last clamped date would drag the 31st down to the 28th and leave it
there for good.
→ Each date is derived from the configuration and its own month, so Feb 28 is followed by Mar 31
(SPEC §2: dates never drift). Generation always starts from the schedule's own effective date, which
makes the sequence identical no matter how many dates are requested.

## D-029 A schedule change may reach back into the period in progress
SPEC §2 describes exactly this: the period in progress ends the day before the new first pay date and is
flagged as a transition.
→ An effective date on or before the current period's *start* is refused with 409
`effective_from_too_early`, since that would rewrite a period that has already begun. Anything later is
accepted. Periods from the new first pay date onwards are deleted and rebuilt; transactions reference
periods by date, not by foreign key, so nothing is orphaned.

## D-030 The timeline is extended lazily on read
SPEC §2 wants roughly 13 months of periods, kept topped up, and Phase 9 adds the daily job.
→ `ensure_horizon()` runs when periods are listed and extends them when the timeline comes within
120 days of running out. The daily job will call the same function, so there is one code path.

## D-031 A registry for things that reference a payee or category (Phase 3, 2026-09-23)
Merging payees and deleting a category both have to move rows in tables that do not exist yet:
transactions (Phase 4), subscriptions (Phase 8), import rules (Phase 10).
→ `app/services/references.py` holds handlers each later phase registers. Merge and delete iterate the
registry, so those phases add one function instead of rewriting either operation. The mechanism is tested
now with stub handlers.

## D-032 Payee usage stats are wired up before they can be real
The Payees page wants a transaction count, last-used date and total spent, all of which need Phase 4.
→ `set_usage_provider()` takes the real query in Phase 4; until then every payee reports zero and never.
The endpoint and the page are finished, so Phase 4 changes one function rather than the screen.

## D-033 A rename onto an existing name is refused, not silently merged
SPEC §5 asks for a merge *offer*, and merging destroys a row.
→ `PATCH /payees/{id}` returns 409 `payee_name_taken` with both names in the message. The UI turns that
into the offer and calls `POST /payees/{id}/merge` only if the person says yes.

## D-034 APR is stored in basis points
24.99% has two decimal places and money rules forbid floats.
→ `apr_bps` is an integer: 2499 is 24.99%. The debt payoff math in Phase 14 divides by 10,000 at the
very end.

## D-035 Reordering renumbers the whole list
Sparse sort orders drift and eventually collide.
→ `app/domain/ordering.py` moves an id one place and the service rewrites every `sort_order` in the group
as 0, 1, 2… Moving the first item up or the last down is a no-op rather than an error, so holding Alt+Up
at the top of a list does nothing surprising.

## D-036 Categories live under Settings, not in the sidebar
SPEC §17 lists categories among the settings pages, and Phase 0 fixed the sidebar at nine items.
→ The manager is a Settings tab at `/settings/categories`, alongside Pay schedule and Pay periods.

## D-037 Money parsing reads the digits, not a float
`parseAmountToCents('1.005')` through `Math.round(1.005 * 100)` gives 100, because 1.005 * 100 is
100.49999999999999 in binary floating point. A cent going missing on a rounding edge is exactly what the
integer-cents rule exists to prevent.
→ `frontend/src/lib/money.ts` parses the digit string itself and rounds on the third decimal place.
`roundToCents()` re-reads its product at 15 significant digits before rounding, for callers that already
hold a number. `app/domain/money.py` gets the mirrored version and the same test cases in Phase 4.
