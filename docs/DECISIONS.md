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

## D-038 A running balance is only shown for one account in date order (Phase 4, 2026-09-23)
A running balance answers "what was in the account after this row", which needs every earlier row in that
account. Across several accounts, or with a text filter applied, any number printed in that column would
be wrong in a way that looks authoritative.
→ `GET /transactions` returns `running_balance_cents` when the query names a single account, and null
otherwise. When it is returned, it counts every earlier transaction in the account, not just the ones the
other filters let through.

## D-039 Reconciled protection covers amount, date, account and delete
SPEC §6 protects "the amount, date, or account"; BUILD_PLAN says editing a reconciled transaction needs
`confirm=true`. The narrow list is the useful one: those three are what the bank agreed with.
→ Changing any of the three, or deleting the transaction, returns 409
`reconciled_edit_requires_confirm`. Fixing a memo, payee or category goes through untouched, so tidying
old records stays friction-free. Bulk delete applies the same rule to the whole selection.

## D-040 A manual-valuation account's typed balance is the whole truth
An account can have both a typed dated balance and transactions, and the two will disagree.
→ The latest valuation on or before the date wins, and transactions on that account do not move it.
Before the first valuation the opening balance applies. Cleared and reconciled equal current, because a
typed balance has nothing outstanding. Such an account gets no running balance either.

## D-041 Transfers are one call and two rows
Two separate transactions that happen to match would drift the moment either was edited.
→ `POST /transfers` writes both legs with a shared `transfer_id`, signed opposite. Editing either leg
moves amount, date, memo and status on both; deleting either deletes both, and bulk delete handles a
selection containing both legs without double-counting.

## D-042 The on-budget rule decides which transfer leg carries a split
SPEC §6 wants a category when money leaves the budget for a tracking account, and none between two
on-budget accounts.
→ on-budget ↔ on-budget: no splits, and sending a category is a 422. on-budget → tracking (and the
reverse): a category is required and the split sits on the on-budget leg only. tracking ↔ tracking: no
splits, since nothing there touches the budget.

## D-043 Registering with the Phase 3 registries happens once, on import
The API, the CLI and the tests all need the same answer about what a payee merge moves.
→ `app/services/__init__.py` calls `wire_registries()` at import, which registers the transaction
handlers and the real payee usage query. The test suite snapshots and restores the registries around
every test, so a stub registered under a real name cannot leak — which it did, silently removing the
transactions handler for every test that ran afterwards.

## D-044 Columns for tables that do not exist yet are left out
DATA_MODEL lists `subscription_occurrence_id`, `import_batch_id`, `reconciliation_id`, `import_key` and
`imported_description` on transactions; all five point at tables Phases 8, 10 and 11 create.
→ They arrive with those phases, each as a one-column migration. Carrying FK-less integer columns for
several phases buys nothing, and SQLite's batch-mode ALTER rebuilds the table either way.

## D-045 install.sh and update.sh were pulled forward from Phase 7 (2026-09-23)
The household asked for them now, before the ledger UI exists, so the LXC can be stood up and kept
current while the remaining phases land.
→ `deploy/install.sh`, `deploy/update.sh`, the systemd units and the env example follow DEPLOYMENT.md
exactly. The rest of Phase 7 — `restore.sh`, the firewall and NPM steps, and the first real deployment —
stays in Phase 7. Both scripts use `runuser` rather than `sudo`, which a minimal Debian LXC may not have.

## D-046 The nightly timers install disabled until their commands exist
`pb run-daily` and `pb backup` arrive in Phase 9, but the timer units are part of the deploy layout now.
→ install.sh writes both timers and enables one only if the matching `pb` command answers `--help`.
update.sh enables any timer whose command has since appeared, so Phase 9 needs no extra deploy step.
Until then update.sh backs the database up with SQLite's online `.backup`, which is safe while the app
is running.

## D-047 update.sh rolls the checkout back if a migration fails
DEPLOYMENT.md says to stop and leave the old version running, which leaves new code on disk beside an
old process — confusing, and the next restart would run untested code against an unmigrated database.
→ On any failure after the fetch, the checkout is reset to the commit that was running and the service
is never restarted. The database is untouched and a backup was taken first. A dirty working tree stops
the update before anything is fetched.

## D-048 Phase 5 dependencies
- `@tanstack/react-virtual` — virtualizes the ledger so thousands of rows scroll smoothly (SPEC §7);
  same family as TanStack Query, headless, no styling to fight.
- `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `jsdom` (dev) — the
  component tests ARCHITECTURE asks for (tab order, entry-row keys). jsdom is set per file with a
  `@vitest-environment jsdom` docblock so the pure tests stay on the faster node environment.
- `@playwright/test` (dev) — the keyboard E2E. Browsers install natively with
  `npx playwright install chromium`; `PB_CHROMIUM_PATH` points at an existing Chromium instead.

## D-049 The payee list carries the autofill values
SPEC §7 fills the category (pinned default, else last used) and optionally the last amount when a payee
is picked. → `PayeeOut` gains `last_category_id` and `last_amount_cents`, taken from the payee's newest
transaction (`date desc, id desc`). A newest transaction that is split autofills no category, since
there is no single one to repeat. Typeahead then needs nothing beyond the cached payee list.

## D-050 Transactions name their transfer partner's account
A single-account ledger shows only one leg of a transfer but must read "Transfer: Savings".
→ `TransactionOut.transfer_account_id` is filled with one grouped query per response (ledger page or
mutation). Nothing is stored; the partner is still found through `transfer_id`.

## D-051 A new payee is created by a second call just before the transaction
SPEC §7 says a new payee is "created when the row is saved". → The create mutation posts the payee,
then the transaction, inside one mutation, so the optimistic row and its rollback cover both. If the
transaction is then refused, the payee stays: it is harmless, it is what was typed, and the refilled
row will reuse it on the next Enter. A 409 on the payee (someone else just made it) is resolved by
looking it up instead of failing.

## D-052 Running balances are recomputed from the account's current balance
After an optimistic change the ledger's running balances are rewritten as "current balance minus
everything above this row". The ledger is loaded newest first from the top, so this is exact for an
unfiltered single-account view and needs no server round trip. Filtered views and All accounts keep
the server's values (null for All accounts), and a filtered view is refetched after each mutation
because only the server knows what the filter now includes.

## D-053 Keyboard details the spec left open
- `t` always means today in a date field, and every date shortcut leaves the date selected so the next
  keystroke replaces it. `-` only steps a day when the field already reads as a date, so typing an ISO
  date still works.
- "Split…" and other pinned combobox options are filtered like any other option. Otherwise a typo in
  Category left "Split…" as the only, highlighted choice, and Tab silently split the row.
- Fields that exist are focused synchronously (a leading `+` in Outflow jumps to Inflow before the next
  keystroke arrives); only a split line that has just been added waits for React to render it.
- Esc on an empty entry row steps out of it, so the row shortcuts (`j`, `k`, `c`, …) are two Esc
  presses away from anywhere. `u` undoes the last delete, alongside the toast's Undo button.
- Amount filters are signed, like the ledger: outflows are negative.
- Changing a transfer into a plain transaction (or the reverse), or moving a transfer to a different
  partner account, is refused inline with a message to delete and re-enter it. The backend has no
  operation for either, and faking one as delete-plus-create would lose the row's history.
