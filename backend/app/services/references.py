"""Where else a payee or category id is referenced.

Merging payees and deleting a category both have to move rows in tables that later
phases add: transactions (Phase 4), subscriptions (Phase 8), and import rules
(Phase 10). Each of those phases registers a handler here, so merge and delete never
have to be rewritten.
"""

from collections.abc import Callable

from sqlalchemy.orm import Session as DbSession

#: (name, handler) where handler(db, source_id, target_id) -> rows moved.
Reassign = Callable[[DbSession, int, int], int]
#: (name, handler) where handler(db, id) -> rows referencing it.
CountRefs = Callable[[DbSession, int], int]

_payee_reassigners: dict[str, Reassign] = {}
_category_reassigners: dict[str, Reassign] = {}
_category_counters: dict[str, CountRefs] = {}


def register_payee_reassigner(name: str, handler: Reassign) -> None:
    _payee_reassigners[name] = handler


def register_category_reassigner(name: str, handler: Reassign) -> None:
    _category_reassigners[name] = handler


def register_category_counter(name: str, handler: CountRefs) -> None:
    _category_counters[name] = handler


def reassign_payee(db: DbSession, source_id: int, target_id: int) -> dict[str, int]:
    """Point every reference at the target payee. Returns rows moved per table."""
    return {name: handler(db, source_id, target_id) for name, handler in _payee_reassigners.items()}


def reassign_category(db: DbSession, source_id: int, target_id: int) -> dict[str, int]:
    return {
        name: handler(db, source_id, target_id) for name, handler in _category_reassigners.items()
    }


def count_category_references(db: DbSession, category_id: int) -> dict[str, int]:
    """How many rows would need reassigning before this category can be deleted."""
    return {name: handler(db, category_id) for name, handler in _category_counters.items()}


def registered_payee_tables() -> list[str]:
    return sorted(_payee_reassigners)


def registered_category_tables() -> list[str]:
    return sorted(_category_reassigners)
