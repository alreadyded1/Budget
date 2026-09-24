"""Duplicate keys (SPEC §11): the FITID for OFX/QFX; for CSV, a hash of what the row says.

The CSV key includes the row's position among identical same-day rows, so two real
$5.00 coffees on one day stay two rows, while the same file imported twice produces
the same keys both times.
"""

import hashlib
from collections import Counter

from app.domain.imports import ParsedRow


def keys_for(rows: list[ParsedRow], account_id: int) -> list[str]:
    seen: Counter[tuple] = Counter()
    keys: list[str] = []
    for row in rows:
        if row.fitid:
            keys.append(f"fitid:{row.fitid}"[:64])
            continue
        identity = (row.date.isoformat(), row.amount_cents, row.description.strip().lower())
        ordinal = seen[identity]
        seen[identity] += 1
        raw = f"{account_id}|{identity[0]}|{identity[1]}|{identity[2]}|{ordinal}"
        keys.append("csv:" + hashlib.sha256(raw.encode()).hexdigest()[:40])
    return keys
