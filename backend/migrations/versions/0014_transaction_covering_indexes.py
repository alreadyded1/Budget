"""transaction covering indexes

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-25 03:10:00.000000

Two single-column indexes become covering ones that start with the same column (D-112):
account balances sum by status without reading the table, and payee usage finds each
payee's newest transaction with one index seek.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Plain CREATE/DROP INDEX: SQLite needs no table rebuild for these.
    op.create_index(
        "ix_transactions_account_status",
        "transactions",
        ["account_id", "status", "amount_cents"],
        unique=False,
    )
    op.create_index(
        "ix_transactions_payee_date",
        "transactions",
        ["payee_id", "date", "amount_cents"],
        unique=False,
    )
    op.drop_index("ix_transactions_account_id", table_name="transactions")
    op.drop_index("ix_transactions_payee_id", table_name="transactions")
    op.execute("ANALYZE")


def downgrade() -> None:
    op.create_index("ix_transactions_payee_id", "transactions", ["payee_id"], unique=False)
    op.create_index("ix_transactions_account_id", "transactions", ["account_id"], unique=False)
    op.drop_index("ix_transactions_payee_date", table_name="transactions")
    op.drop_index("ix_transactions_account_status", table_name="transactions")
