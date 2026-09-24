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
*Amended by D-080: each leg now keeps its own status.*
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

## D-054 What counts as Actual in the planner (confirmed with the user, 2026-09-24)
Actual is the sum of split amounts in the category for transactions dated inside the period, **in
on-budget accounts only**. A transfer between two on-budget accounts has no splits, so it drops out; the
on-budget leg of a payment to a tracking account (the car loan) carries a split, so it counts. Spending
in a tracking account is ignored even if categorized. Signs: expense actual = −(sum of splits), so a
refund lowers it and can take it below zero, shown as-is; income actual = +(sum of splits). Remaining is
always planned − actual, and only an expense can be overspent.

## D-055 Prorating a transition period (confirmed with the user, 2026-09-24)
Prorate sets each category to template × (days in the transition period ÷ days in the last normal period
before it), rounded half away from zero in integer arithmetic. $500.00 over 6 of 14 days is $214.29. If
the transition period has no normal period before it, prorate is refused.

## D-056 A period is prefilled the first time it is opened (confirmed with the user, 2026-09-24)
Opening a period with no plan rows writes one row per visible category at its template amount. From then
on the rows stay: Clear sets them to $0 rather than deleting them, so the template does not come back,
and a later change to the template does not touch periods already opened. A category added later has no
row in older periods and reads as $0 planned. Subscription bills join the prefill in Phase 8.

## D-057 Copy, template, clear and prorate overwrite the whole plan (confirmed with the user, 2026-09-24)
Each writes every category's planned amount in one commit; the toast's Undo puts the previous amounts
back through `PUT /budget/{period}/plan`, the bulk form of the single-category edit. Hidden categories
are only written where the period already has a row for them.

## D-058 Planner details
- Plan rows are removed with their category (FK cascade). Deleting a category with reassignment folds
  its planned amounts into the target's, period by period.
- Every planner response is the whole period view (lines, group subtotals, summary), which keeps the
  "mutations return the aggregates they change" rule without a second shape. The page recomputes the same
  numbers locally first (`budgetMath.ts`, mirroring `app/domain/budget.py`), and with several edits in
  flight only the last server answer is applied, so an earlier one cannot briefly undo a later edit.
- Keyboard: Tab or Enter commits a planned amount and moves down (Shift+Enter moves up), Esc restores
  it, `[` / `]` change period and `t` returns to the current one.
- The uncategorized alert links to `/transactions?from=&to=&uncategorized=1&on_budget=1`. The ledger
  reads those parameters once, shows the scope as a removable chip, and the API gained `on_budget` so
  the ledger count matches the alert's.

## D-059 `pb backup` arrives in Phase 7, not Phase 9
Phase 7's "Done when" needs a working nightly backup, and `update.sh` backs up first. → `pb backup`
(`app/services/backup.py`) and `pb list-backups` are built now. The copy is verified with
`PRAGMA integrity_check`, both files are written under a `.partial` name and renamed into place, and
pruning reads the date from the file name (not the mtime) and always keeps the newest pair. The
existing `install.sh` / `update.sh` logic (D-046) enables the backup timer as soon as the command
exists. The ntfy alert on failure waits for the ntfy client in Phase 9.

## D-060 The firewall is the Proxmox firewall on the CT (chosen by the user, 2026-09-24)
An unprivileged LXC often cannot load nftables rules, and a host-side rule survives anything done
inside the container. → `deploy/README.md` lists the rules (8000 from the NPM LXC only, SSH from the
LAN, input policy DROP); nothing inside the CT manages a firewall.

## D-061 restore.sh checks first and can always go back
It refuses a backup that fails `PRAGMA integrity_check` or has no `alembic_version`, and a receipts
archive with absolute paths, `..` or links, before stopping anything. The live data is kept as
`budget.db.pre-restore` (via the backup API, so any WAL is folded in) and `receipts.pre-restore`, and
an ERR trap puts both back and restarts the service if any later step fails. `set -E` is required for
that trap to fire inside helper functions; the test suite caught its absence. The script takes
`--data-dir`/`--env-file`/`--user`/`--no-service` so it runs for real in the tests and in the go-live
scratch check.

## D-062 Phase 7's boxes are ticked on the LXC, not in the cloud session
The build session has no Proxmox, no systemd and no NPM. → Everything that can be proven off the box
is (restore round trips in pytest, shellcheck, `systemd-analyze verify`, a `runuser` scratch restore),
and `deploy/GO-LIVE.md` walks the household through the four boxes on the real CT. They stay open
until that walk is reported back.

## D-063 Monthly and annual equivalents (confirmed with the user, 2026-09-24)
The annual cost is exact — weekly × 52, biweekly × 26, monthly × 12, quarterly × 4, semiannual × 2,
annual × 1, every N days × 365 ÷ N, every N weeks × 52 ÷ N, every N months × 12 ÷ N — and monthly is
that ÷ 12. Both are exact fractions rounded once, half away from zero. Totals count active
subscriptions only.

## D-064 Payment matching (confirmed with the user, 2026-09-24)
A saved transaction matches an unpaid bill when the payee is the same, the date is within ±3 days of
the due date, and the amount is within 10% or $1.00, whichever is larger. It is a suggestion only:
the create response carries the closest match and a toast offers "Link". Nothing links unasked, and
one transaction pays at most one bill.

## D-065 Bills in the planner: template plus bills (confirmed with the user, 2026-09-24)
A new period is prefilled with each category's template amount **plus** the bills due in it (SPEC §8
literally). Apply template uses the same numbers; Prorate scales the template and adds bills whole,
because bills fall on real dates. Every line shows its committed bills (skipped ones excluded) in any
period; periods already opened keep their planned amounts (D-056), so set template amounts to exclude
bills that subscriptions already cover.

## D-066 Pausing, cancelling and editing a subscription (confirmed with the user, 2026-09-24)
Occurrences are materialized from today to ~13 months ahead. An edit to anything that shapes the
schedule, the amount or the status deletes the **future upcoming** occurrences and rebuilds them;
paid, skipped and overdue (past, unpaid) rows are never touched. Pause and cancel delete future
upcoming ones; resuming rebuilds them. A price change adds a price-history row dated today, so the
old amount stays on record and a rise shows a badge. Deleting a subscription deletes its occurrences
but never its payments.

## D-067 The payment link lives on the occurrence only
DATA_MODEL has `subscription_occurrences.transaction_id`, and D-044 deferred a
`transactions.subscription_occurrence_id` to this phase. One link is enough: the occurrence points at
its payment, and deleting that transaction (single, transfer or bulk) sends the bill back to upcoming
through a new "transaction deleting" hook in `app/services/references.py`. "Mark paid" passes
`subscription_occurrence_id` on the create request so the transaction and the link are written in one
call, and an unknown bill is refused before anything is written.

## D-068 The daily job runs hourly and messages wait for the reminder hour (confirmed with the user, 2026-09-24)
With a fixed 07:00 timer the `reminder_hour` setting could never take effect. → `payday-budget-daily.timer`
runs `pb run-daily` every hour. Each run extends pay periods and bill occurrences and auto-posts due
bills; notifications go out only once the local hour reaches `reminder_hour`, and the log keeps them to
once each, so the hourly runs cost nothing.

## D-069 One low-balance alert per dip (confirmed with the user, 2026-09-24)
An alert goes out when an account first drops below its threshold; nothing more until the balance has
recovered to the threshold or above and dropped again. `accounts.low_balance_since` remembers the dip
(set on the first low run, cleared on recovery), and the log key is `acct:<id>:low:<that date>`.

## D-070 ntfy through the standard library
ARCHITECTURE named httpx for ntfy; the only use is one JSON POST, so `urllib.request` does it with no new
runtime dependency. Messages are published as JSON to the server root (topic in the body), which avoids
the latin-1 limit on HTTP header titles. The sender is a plain callable, resolved at call time, so tests
pass a recorder instead.

## D-071 Auto-post links a hand-entered payment instead of doubling it (confirmed with the user, 2026-09-24)
Before posting a due auto-post bill, the job looks for an unlinked outflow to the same payee within ±3
days and 10% or $1 (D-064). If there is one it is linked; otherwise a transaction is created on the
bill's account for the due date, uncleared, with its payee and category, and the bill is marked paid.
A bill with no account is never posted; the household gets one "pay it by hand" notice.

## D-072 One-off notifications are queued, state notifications are rebuilt
"Posted Netflix" happens once; "Netflix due tomorrow" is true on every run until it is paid. → One-off
kinds (auto_post) are written to the log as queued before the reminder hour and sent, or retried after a
failure, from their stored payload; state kinds (bill_due, bill_overdue, low_balance) are simply rebuilt
each run and deduplicated by key. `payload` holds priority, tags and the click link as JSON.

## D-073 Every systemd unit is reinstalled on update
`update.sh` used to reinstall only the app's unit, so a changed timer or a new unit in `deploy/systemd`
never reached an existing install. → Both scripts install every `*.service` and `*.timer` there, and
`update.sh` restarts enabled timers so a new schedule applies at once. The backup unit's `OnFailure=`
starts the `payday-budget-notify-failure@` template, which runs `pb notify-failure <unit>` (once a day
per unit, priority urgent).

## D-074 The first matching rule wins (confirmed with the user, 2026-09-24)
Rules are checked in the order shown under Settings → Rules and only the first match applies; later
rules are not merged in. New rules go to the end, so an existing rule keeps winning until the new one is
moved up (Alt+↑/↓). Matching ignores case; a regex rule uses `re.search`.

## D-075 Without a rule, a payee is filled only on an exact name (confirmed with the user, 2026-09-24)
With no rule, an imported row gets a payee only when its description equals an existing payee's name
(ignoring case), plus that payee's default category. Otherwise the payee stays blank, and "Create rule
from this" teaches it. No fuzzy guessing: a wrong payee is worse than none.

## D-076 A row that pays a bill links it, ticked by default (confirmed with the user, 2026-09-24)
When a row's payee has an unpaid bill within the D-064 window, the review screen shows "Pays <bill>"
ticked. At commit the new transaction is linked and the bill is marked paid; unticking leaves the bill
alone. Changing the row's payee looks for a bill again.

## D-077 Match and undo semantics
A match is an entry with the exact amount on the same account within ±3 days that was not itself
imported and is not reconciled; the closest date wins. Committing a match changes uncleared to cleared
and records the import key, and your payee, category and memo stay. Imported rows are created cleared.
Undo deletes the batch's created transactions and puts matched entries back to their previous status
(`import_staged_rows.previous_status`). It is refused once anything in the batch is reconciled.
Nothing is written to the ledger before commit.

## D-078 Statements are uploaded as JSON text, parsed by our own code
The browser reads the file (UTF-8, else Windows-1252) and sends its text in JSON, capped at 5 MB, so no
python-multipart dependency is needed. OFX/QFX (SGML 1.x and XML 2.x) is parsed with a small regex
reader of `<STMTTRN>` blocks rather than ofxparse/ofxtools, which are unmaintained or heavy for the
five fields used. Duplicates are keyed by FITID when the file has one, otherwise by a hash of account,
date, amount, description and the row's position among identical rows, so two same-day $5 coffees stay
two rows.

## D-079 Ticking a row on the reconcile screen saves it as cleared (confirmed with the user, 2026-09-24)
There is no draft reconciliation. A tick is the ordinary status change to cleared and an untick sets
uncleared, so leaving halfway keeps the work. The worksheet is the uncleared and cleared rows up to the
statement date; the typed statement date and balance are remembered per browser (localStorage).
Difference = statement − (opening + every reconciled row + the ticked rows); Finish needs it to be zero.
A statement date before the account's last reconciliation, or before it was opened, is refused.

## D-080 Reconciled is reachable only through a reconciliation; transfer legs have their own status
Creating, editing or bulk-setting a status of reconciled returns 422 `reconcile_through_flow`. Taking a
row out of reconciled needs `confirm=true` (409 `reconciled_edit_requires_confirm`, as in D-039) and
unlinks it from its reconciliation; moving a reconciled row to another account makes it cleared there.
This amends D-041: a transfer's two legs are on two statements, so each keeps its own status. Amount and
date still move on both legs, so an edit that would change a reconciled other leg, or deleting it,
needs the same confirmation.

## D-081 Statements are typed as printed; adjustments are filed under one payee
(Confirmed with the user, 2026-09-24.) A liability's statement is typed as the amount owed ($512.30 →
512.30); the UI turns it into the account's sign (-51230) and the API only ever sees the account's
sign. An adjustment is one reconciled transaction dated the statement date, payee "Reconciliation
adjustment" (created on first use), for the whole difference, with an optional category.
`reconciliations.adjustment_transaction_id` has no foreign key (transactions already reference
reconciliations, and a cycle breaks table ordering); a delete listener clears it instead.

## D-082 Only an account's latest reconciliation can be undone (confirmed with the user, 2026-09-24)
Undo deletes the record and its adjustment and puts its rows back to cleared. Undoing an older one would
leave later reconciliations resting on a balance that no longer exists, so it is refused
(409 `reconcile_not_latest`); undo them newest first.

## D-083 Report date presets (confirmed with the user, 2026-09-24)
"This pay period" and "Last pay period" are whole periods, start to end, as the planner shows them
(future-dated entries included); a transition period is simply the period that covers the day.
"Month to date" and "Year to date" end today; "Last month" and "Last year" are calendar spans. The
resolver is a pure function (`app/domain/date_ranges.py`); custom ranges must not run backwards.

## D-084 What reports count as spending and income (confirmed with the user, 2026-09-24)
The planner's rule: on-budget accounts only, expense categories are spending net of refunds, income
categories are income, transfers between on-budget accounts drop out (they have no splits), and the
on-budget leg of a payment to a tracking account counts in its category. Uncategorized splits count by
sign: an outflow is spending (an "Uncategorized" row), an inflow is income. So income − spending equals
the on-budget ledger's net for any range. Shares and savings rates are integer basis points, rounded
half away from zero; the savings rate is (income − spending) ÷ income, blank without income.

## D-085 Planned vs. actual takes whole pay periods (confirmed with the user, 2026-09-24)
Plans are per period, so every period that touches the range is shown whole, using the planner's own
numbers (`budget.build_view`, which does not prefill unopened periods). The planner counts every
on-budget account, so account and payee filters do not apply to this report; a category filter does.
Income vs. expense by pay period uses the same periods but only the days inside the range.

## D-086 The transaction list is the drill-down
Clicking a category or payee opens the Transactions report for the exact dates shown (a custom range,
so "this pay period" cannot shift underneath), on-budget accounts only. With a category filter each
row counts only its matching splits, so a split purchase contributes just its grocery part and the list
adds up to the category's total; the Uncategorized row drills to uncategorized outflows. Without
filters the list covers every account. It returns up to 10,000 rows, unpaged, and says when it stops.

## D-087 Recharts, loaded with the Reports section only; CSV built in the browser
Recharts (the charting library BUILD_PLAN names) is a dependency of the frontend: React components for
bar and line charts with tooltips and legends, no server side. The Reports route is lazy-loaded, so the
ledger's bundle does not carry it. CSV is built from the rows on screen: UTF-8, a header row, amounts
as plain signed decimals (-45.20), dates as YYYY-MM-DD, files named `<report>_<from>_<to>.csv`. Chart
colours are the dataviz reference palette's categorical slots, fixed order, stepped for dark mode, with
every chart paired with its table.

## D-088 A sinking fund counts from its start period (confirmed with the user, 2026-09-24)
Each goal has a `start_date`, rounded back to the start of its pay period (the current one by default);
the starting balance is what was set aside by then. The fund's balance through a period is the starting
balance + every plan for its category from the start period through that period − the category's net
on-budget spending over the same days. A period's plan counts in full from its first day (money set
aside on payday). Spending before the start does not count. The planner shows the balance through the
period being viewed, so a future period shows where the plans lead.

## D-089 A sinking fund is overspent only below zero (confirmed with the user, 2026-09-24)
Saving for months and spending in one period is the point, so a fund's row is not flagged when one
period's spending beats that period's plan; it is flagged when the fund balance is negative. The balance
may go negative and refunds add back. Categories without a fund goal keep the per-period rule.

## D-090 Needed per period rounds up and replaces this period's plan (confirmed with the user, 2026-09-24)
Needed = (target − progress) ÷ pay periods from the current one through the one holding the target
date, rounded up to the cent so the target is met. For a sinking fund this period's own plan is left out
of the progress, so "Use suggested contribution" writes the figure into this period's plan instead of
adding to it; pressing it again changes nothing. No target date, no figure; a past target date asks for
the whole remainder now.

## D-091 On track means projected by the target date (confirmed with the user, 2026-09-24)
Projection at the current rate: a sinking fund's rate is this period's plan; a savings goal's is its
account's average change over the last 3 completed pay periods (fewer if the schedule is younger). The
projected date is the end of the period in which the rate reaches the target, extending the schedule by
its average period length past the last generated period. On track = projected on or before the target
date; a rate of zero or less shows "Not at this rate".

## D-092 Savings goals: asset accounts, optional plan category (confirmed with the user, 2026-09-24)
Progress is the account's current balance minus the goal's starting amount. Liability accounts are
refused (paying down debt is Phase 14). A transfer between on-budget accounts has no category, so a
savings goal may name an optional expense "plan category"; "Use suggested contribution" appears only
when it has one.

## D-093 One fund goal per category, and creating it flags the category
A sinking-fund goal needs an expense category that no other fund goal uses (409 `sinking_fund_taken`).
Creating it sets the category's `is_sinking_fund`; archiving or deleting the goal leaves the flag. The
planner shows a fund balance only for categories with a fund goal. Deleting a goal's category asks for a
reassignment first (goals register as a category reference).

## D-094 Accounts remember the day they were closed (confirmed with the user, 2026-09-24)
`accounts.closed_on` is set when an account is closed and cleared when it is reopened. Net worth history
counts an account from its opening date through its closed-on date; the current total counts open
accounts only (SPEC §14). Accounts closed before the column existed took their last update's date.

## D-095 Net worth history is month-ends, today last (confirmed with the user, 2026-09-24)
One point per month-end over 12 or 24 months (24 by default) or since the first account opened, with
today as the current month's point. Balances are signed, so net worth is a plain sum; manual-valuation
accounts use their latest value on or before each date. Breakdowns and tables show liabilities as
amounts owed. The dashboard's account card shows today's total and links to the report.

## D-096 The payoff simulator's month (confirmed with the user, 2026-09-24)
Month 1 is next month, from today's balances. Each month: interest = balance × APR ÷ 12, rounded to the
cent half away from zero, is added; every debt gets its minimum (or what it owes); the rest of the
budget goes to the first debt in the strategy's order, and any overflow to the next in the same month.
The budget is every included debt's minimum plus the extra, so a paid-off debt's minimum rolls on.
Minimums stay fixed as entered; the page says these are estimates.

## D-097 Payoff order and which debts are included (confirmed with the user, 2026-09-24)
Open liability accounts that owe money. A debt without an APR or minimum payment is left out and listed
with the reason and a link to the Accounts page, which now edits both inline. The order is fixed at the
start: snowball by smallest balance (ties: higher APR), avalanche by highest APR (ties: smaller
balance), custom as saved with any unlisted debt appended. The page previews an extra payment,
strategy or custom order without saving; Save plan stores them in the single `debt_plan` row.

## D-098 A plan that cannot finish stops at 50 years (confirmed with the user, 2026-09-24)
If minimums never cover the interest the simulation stops after 600 months and reports "Not within
50 years" instead of a debt-free date.
