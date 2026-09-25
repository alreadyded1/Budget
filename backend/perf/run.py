"""`make perf`: timings against the heavy demo household (D-110).

Builds a scratch database with `pb seed-demo`, starts the real server (one uvicorn worker,
as in production) and times the API over one keep-alive HTTP connection, the way the
browser talks to it. Then runs the Playwright ledger-scroll check against the same server.

Hard limits (the run fails past them):
  * saves (create and edit), p95 under 150 ms — SPEC §7, BUILD_PLAN Phase 16;
  * the payee list download, p95 under 150 ms like a save; typeahead itself filters that
    list in the browser, and its 50 ms limit (SPEC §7) is checked there;
  * the browser checks in frontend/perf/ledger.perf.ts: frame times while scrolling
    5,000 ledger rows, and keystroke-to-suggestions time in the payee typeahead.
Everything else is printed for the record.

Run from backend/: `uv run python perf/run.py [--transactions N] [--keep] [--no-scroll]`.
Native processes only — no containers (CLAUDE.md).
"""

import argparse
import http.client
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND = BACKEND.parent / "frontend"
PORT = int(os.environ.get("PB_PERF_PORT", "8766"))
PASSWORD = "perf-password-123"
SAVE_P95_MS = 150.0
PAYEE_LIST_P95_MS = 150.0


class Client:
    def __init__(self) -> None:
        self.conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
        self.cookie = ""

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[float, dict]:
        headers = {"X-PB-Request": "1", "Accept": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        payload = None
        if body is not None:
            payload = json.dumps(body)
            headers["Content-Type"] = "application/json"
        began = time.perf_counter()
        self.conn.request(method, path, body=payload, headers=headers)
        response = self.conn.getresponse()
        data = response.read()
        elapsed = (time.perf_counter() - began) * 1000
        if response.status >= 400:
            raise RuntimeError(f"{method} {path} -> {response.status}: {data[:300]!r}")
        cookie = response.getheader("Set-Cookie")
        if cookie:
            self.cookie = cookie.split(";", 1)[0]
        return elapsed, (json.loads(data) if data else {})


def p(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(pct / 100 * len(ordered)) - 1))]


def run(cmd: list[str], env: dict, cwd: Path = BACKEND) -> None:
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def wait_for_server(proc: subprocess.Popen) -> None:
    for _ in range(200):
        if proc.poll() is not None:
            raise SystemExit("The server exited while starting.")
        try:
            conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=1)
            conn.request("GET", "/api/v1/health")
            if conn.getresponse().status == 200:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise SystemExit("The server did not start.")


def measure(client: Client, rounds: int) -> tuple[list[tuple[str, list[float]]], list[str]]:
    results: list[tuple[str, list[float]]] = []
    failures: list[str] = []

    def timed(label: str, method: str, path: str, body=None, n: int = rounds) -> dict:
        times = []
        out: dict = {}
        client.call(method, path, body)  # warm-up, not counted
        for _ in range(n):
            elapsed, out = client.call(method, path, body)
            times.append(elapsed)
        results.append((label, times))
        return out

    accounts = {a["name"]: a for a in client.call("GET", "/api/v1/accounts")[1]["items"]}
    checking = accounts["Checking"]["id"]
    groups = client.call("GET", "/api/v1/category-groups")[1]["items"]
    groceries = next(c["id"] for g in groups for c in g["categories"] if c["name"] == "Groceries")
    payees = client.call("GET", "/api/v1/payees")[1]["items"]
    payee = payees[0]["id"]
    today = date.today()

    # --- saves: the hard limit --------------------------------------------------------------
    save_times: list[float] = []
    edit_times: list[float] = []
    created: list[int] = []
    for i in range(rounds * 2):
        body = {
            "account_id": checking,
            "date": (today - timedelta(days=i % 20)).isoformat(),
            "amount_cents": -(1000 + i),
            "payee_id": payee,
            "splits": [{"amount_cents": -(1000 + i), "category_id": groceries}],
        }
        elapsed, out = client.call("POST", "/api/v1/transactions", body)
        save_times.append(elapsed)
        created.append(out["transactions"][0]["id"])
    for i, tx_id in enumerate(created):
        body = {
            "amount_cents": -(2000 + i),
            "memo": f"perf {i}",
            "splits": [{"amount_cents": -(2000 + i), "category_id": groceries}],
        }
        elapsed, _ = client.call("PATCH", f"/api/v1/transactions/{tx_id}", body)
        edit_times.append(elapsed)
    results.append(("save: create transaction", save_times))
    results.append(("save: edit transaction", edit_times))
    toggle_times = []
    for tx_id in created[:rounds]:
        elapsed, _ = client.call("PATCH", f"/api/v1/transactions/{tx_id}", {"status": "cleared"})
        toggle_times.append(elapsed)
    results.append(("save: toggle cleared", toggle_times))
    for label in ("save: create transaction", "save: edit transaction", "save: toggle cleared"):
        times = dict(results)[label]
        if p(times, 95) >= SAVE_P95_MS:
            failures.append(f"{label}: p95 {p(times, 95):.1f} ms is over {SAVE_P95_MS:.0f} ms")

    # --- typeahead source: the other hard limit ----------------------------------------------
    timed("payee list (typeahead source)", "GET", "/api/v1/payees")
    if p(results[-1][1], 95) >= PAYEE_LIST_P95_MS:
        failures.append(
            f"payee list: p95 {p(results[-1][1], 95):.1f} ms is over {PAYEE_LIST_P95_MS:.0f} ms"
        )

    # --- reads, for the record -----------------------------------------------------------------
    page = timed("ledger: first page, all accounts", "GET", "/api/v1/transactions?limit=100")
    cursor = page["next_cursor"]
    for _ in range(50):
        cursor = client.call("GET", f"/api/v1/transactions?limit=100&cursor={cursor}")[1][
            "next_cursor"
        ]
    timed("ledger: page 50, all accounts", "GET", f"/api/v1/transactions?limit=100&cursor={cursor}")
    timed(
        "ledger: one account (running balance)",
        "GET",
        f"/api/v1/transactions?limit=100&account_id={checking}",
    )
    page = client.call("GET", f"/api/v1/transactions?limit=100&account_id={checking}")[1]
    cursor = page["next_cursor"]
    for _ in range(30):
        cursor = client.call(
            "GET", f"/api/v1/transactions?limit=100&account_id={checking}&cursor={cursor}"
        )[1]["next_cursor"]
    timed(
        "ledger: one account, page 30",
        "GET",
        f"/api/v1/transactions?limit=100&account_id={checking}&cursor={cursor}",
    )
    timed(
        "ledger: text search",
        "GET",
        "/api/v1/transactions?limit=100&" + urlencode({"text": "birthday"}),
    )
    timed(
        "ledger: category filter", "GET", f"/api/v1/transactions?limit=100&category_id={groceries}"
    )
    timed("ledger: status uncleared", "GET", "/api/v1/transactions?limit=100&status=uncleared")
    timed("balances", "GET", "/api/v1/balances")
    timed("dashboard", "GET", "/api/v1/dashboard")
    timed("planner: current period", "GET", "/api/v1/budget/current")
    year = urlencode({"from": (today - timedelta(days=365)).isoformat(), "to": today.isoformat()})
    everything = urlencode(
        {"from": (today - timedelta(days=365 * 6)).isoformat(), "to": today.isoformat()}
    )
    timed(
        "report: spending by category, 1 year",
        "GET",
        f"/api/v1/reports/spending-by-category?{year}",
    )
    timed(
        "report: spending by category, all",
        "GET",
        f"/api/v1/reports/spending-by-category?{everything}",
    )
    timed("report: spending by payee, 1 year", "GET", f"/api/v1/reports/spending-by-payee?{year}")
    timed(
        "report: income vs expense, all", "GET", f"/api/v1/reports/income-vs-expense?{everything}"
    )
    timed("report: planned vs actual, 1 year", "GET", f"/api/v1/reports/planned-vs-actual?{year}")
    timed("net worth", "GET", "/api/v1/net-worth")
    timed("debt plan", "GET", "/api/v1/debt-plan")
    timed("goals", "GET", "/api/v1/goals")
    return results, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--transactions", type=int, default=100_000)
    parser.add_argument("--rounds", type=int, default=100, help="Timed calls per measurement")
    parser.add_argument("--keep", action="store_true", help="Keep the scratch database")
    parser.add_argument("--no-scroll", action="store_true", help="Skip the browser scroll check")
    args = parser.parse_args()

    data = Path(tempfile.mkdtemp(prefix="pb-perf-"))
    env = {**os.environ, "PB_ENV": "test", "PB_DATA_DIR": str(data)}
    env.pop("PB_DATABASE_PATH", None)
    server = None
    try:
        run(["uv", "run", "alembic", "upgrade", "head"], env)
        run(["uv", "run", "pb", "seed-demo", "--transactions", str(args.transactions)], env)
        run(["uv", "run", "pb", "reset-password", "demo", "--password", PASSWORD], env)
        if not args.no_scroll and os.environ.get("PB_PERF_SKIP_BUILD") != "1":
            run(["npm", "run", "build"], env, cwd=FRONTEND)
        server = subprocess.Popen(
            [
                "uv",
                "run",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(PORT),
                "--workers",
                "1",
                "--log-level",
                "warning",
            ],
            cwd=BACKEND,
            env=env,
        )
        wait_for_server(server)

        client = Client()
        client.call("POST", "/api/v1/auth/login", {"username": "demo", "password": PASSWORD})
        results, failures = measure(client, args.rounds)

        print(f"\n{'measurement':42} {'p50 ms':>8} {'p95 ms':>8} {'max ms':>8}  n")
        for label, times in results:
            print(
                f"{label:42} {statistics.median(times):8.1f} {p(times, 95):8.1f} "
                f"{max(times):8.1f}  {len(times)}"
            )

        if not args.no_scroll:
            scroll = subprocess.run(
                ["npx", "playwright", "test", "--config", "perf/playwright.config.ts"],
                cwd=FRONTEND,
                env={
                    **env,
                    "PB_PERF_URL": f"http://127.0.0.1:{PORT}",
                    "PB_PERF_PASSWORD": PASSWORD,
                },
            )
            if scroll.returncode != 0:
                failures.append("ledger scroll check failed (see above)")

        if failures:
            print("\nFAILED:")
            for failure in failures:
                print(f"  {failure}")
            return 1
        print(
            f"\nAll limits met: saves p95 < {SAVE_P95_MS:.0f} ms, payee list p95 < "
            f"{PAYEE_LIST_P95_MS:.0f} ms"
            + ("" if args.no_scroll else ", ledger scroll and typeahead.")
        )
        return 0
    finally:
        if server is not None:
            server.terminate()
            server.wait(timeout=10)
        if args.keep:
            print(f"Scratch database kept in {data}")
        else:
            shutil.rmtree(data, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
