"""Business logic that touches the database.

Importing this package wires up the cross-table registries (see references.py), so the
API, the CLI and the tests all agree about what a payee merge or a category delete moves.
"""


def wire_registries() -> None:
    from app.services import (
        attachments,
        budget,
        goals,
        reconcile,
        rules,
        subscriptions,
        transaction_refs,
    )

    transaction_refs.register()
    budget.register()
    subscriptions.register()
    rules.register()
    reconcile.register()
    goals.register()
    attachments.register()


wire_registries()
