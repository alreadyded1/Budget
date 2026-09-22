# Progress

**Current phase:** Phase 1 — Auth, users, settings (not started)
**Next step:** Plan Phase 1 per docs/BUILD_PLAN.md — users and sessions tables, argon2id hashing,
`/auth/login` `/auth/logout` `/auth/me`, the auth dependency, the `X-PB-Request` check, login rate
limiting, the settings singleton, the `pb` user commands, and the login page with its route guard.

## Phase status
| # | Phase | Status | Finished |
|---|---|---|---|
| 0 | Scaffold and tooling | ✅ done | 2026-09-22 |
| 1 | Auth, users, settings | ⬜ | |
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

## Session log
<!-- Newest first. Copy this block for each session.
### YYYY-MM-DD — Phase N (short title)
- **Done:**
- **Deviations from plan:**
- **Known issues:**
- **Next step:**
-->

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
- Choose the runtime HTTP client for ntfy — Phase 9.
- Dark mode currently follows Tailwind's `dark:` classes only; the per-browser theme with a household
  default from settings arrives with Settings (Phase 1) / polish (Phase 16).

## Known issues
<!-- Open bugs and limitations that aren't tied to the current phase. -->
- None outside the Phase 0 notes above.
