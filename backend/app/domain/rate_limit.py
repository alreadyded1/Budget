"""In-memory failure tracking for logins.

One uvicorn worker means one process, so a dict is enough; see ARCHITECTURE.md.
Time is injected so the tests never sleep.
"""

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60


@dataclass
class FailureTracker:
    """Counts recent failures per key and reports when a key is locked out."""

    max_failures: int = MAX_FAILURES
    window_seconds: float = WINDOW_SECONDS
    clock: Callable[[], float] = field(default_factory=lambda: _default_clock)
    _failures: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))

    def _recent(self, key: str) -> list[float]:
        cutoff = self.clock() - self.window_seconds
        recent = [at for at in self._failures[key] if at > cutoff]
        self._failures[key] = recent
        return recent

    def is_locked(self, key: str) -> bool:
        return len(self._recent(key)) >= self.max_failures

    def any_locked(self, *keys: str) -> bool:
        return any(self.is_locked(key) for key in keys)

    def record_failure(self, *keys: str) -> None:
        now = self.clock()
        for key in keys:
            self._failures[key].append(now)

    def reset(self, *keys: str) -> None:
        for key in keys:
            self._failures.pop(key, None)

    def retry_after_seconds(self, key: str) -> int:
        """Seconds until the oldest failure in the window ages out."""
        recent = self._recent(key)
        if len(recent) < self.max_failures:
            return 0
        oldest = min(recent)
        return max(1, int(oldest + self.window_seconds - self.clock()) + 1)

    def clear(self) -> None:
        self._failures.clear()


def _default_clock() -> float:
    import time

    return time.monotonic()
