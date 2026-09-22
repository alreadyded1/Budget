"""Login failure tracking. Time is injected, so nothing sleeps."""

from app.domain.rate_limit import FailureTracker


def tracker(now: list[float]) -> FailureTracker:
    return FailureTracker(clock=lambda: now[0])


def test_locks_out_after_five_failures():
    now = [0.0]
    limiter = tracker(now)

    for _ in range(4):
        limiter.record_failure("user:sam")
    assert not limiter.is_locked("user:sam")

    limiter.record_failure("user:sam")
    assert limiter.is_locked("user:sam")


def test_failures_age_out_of_the_window():
    now = [0.0]
    limiter = tracker(now)

    for _ in range(5):
        limiter.record_failure("user:sam")
    assert limiter.is_locked("user:sam")

    now[0] = 15 * 60 + 1
    assert not limiter.is_locked("user:sam")


def test_keys_are_independent():
    now = [0.0]
    limiter = tracker(now)

    for _ in range(5):
        limiter.record_failure("user:sam", "ip:10.0.0.1")

    assert limiter.any_locked("user:alex", "ip:10.0.0.1")
    assert not limiter.is_locked("user:alex")


def test_reset_clears_a_key():
    now = [0.0]
    limiter = tracker(now)

    for _ in range(5):
        limiter.record_failure("user:sam")
    limiter.reset("user:sam")

    assert not limiter.is_locked("user:sam")


def test_retry_after_counts_down_within_the_window():
    now = [0.0]
    limiter = tracker(now)

    for _ in range(5):
        limiter.record_failure("user:sam")
    assert limiter.retry_after_seconds("user:sam") == 15 * 60 + 1

    now[0] = 14 * 60
    assert limiter.retry_after_seconds("user:sam") == 61


def test_retry_after_is_zero_when_not_locked():
    now = [0.0]
    limiter = tracker(now)

    limiter.record_failure("user:sam")
    assert limiter.retry_after_seconds("user:sam") == 0
