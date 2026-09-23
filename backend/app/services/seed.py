"""The starter category set offered on first run (SPEC §4).

Everything here is a starting point the household edits: names, order, the sinking-fund
flags and the planned amounts are all editable afterwards.
"""

from sqlalchemy.orm import Session as DbSession

from app.models import Category, CategoryGroup
from app.services import categories as service

#: (group name, kind, [(category name, is_sinking_fund)])
STARTER_CATEGORIES: list[tuple[str, str, list[tuple[str, bool]]]] = [
    ("Income", "income", [("Paycheck", False), ("Other income", False)]),
    (
        "Housing",
        "expense",
        [("Rent or mortgage", False), ("Home insurance", False), ("Repairs", True)],
    ),
    (
        "Utilities",
        "expense",
        [
            ("Electric", False),
            ("Gas", False),
            ("Water", False),
            ("Internet", False),
            ("Phone", False),
        ],
    ),
    ("Food", "expense", [("Groceries", False), ("Dining out", False)]),
    (
        "Transport",
        "expense",
        [
            ("Fuel", False),
            ("Car insurance", False),
            ("Maintenance", True),
            ("Parking and tolls", False),
        ],
    ),
    (
        "Health",
        "expense",
        [("Insurance", False), ("Doctor and dentist", False), ("Pharmacy", False)],
    ),
    (
        "Personal",
        "expense",
        [
            ("Clothing", False),
            ("Subscriptions", False),
            ("Gifts", True),
            ("Fun money", False),
        ],
    ),
    (
        "Savings",
        "expense",
        [("Emergency fund", True), ("Car replacement", True), ("Christmas", True)],
    ),
]


def starter_category_count() -> int:
    return sum(len(categories) for _, _, categories in STARTER_CATEGORIES)


def has_any_categories(db: DbSession) -> bool:
    return bool(service.list_groups(db))


def seed_categories(db: DbSession, *, skip_existing: bool = True) -> dict[str, int]:
    """Create the starter set. Existing groups and categories are left alone."""
    groups_added = 0
    categories_added = 0

    for group_order, (group_name, kind, category_names) in enumerate(STARTER_CATEGORIES):
        group = db.query(CategoryGroup).filter(CategoryGroup.name == group_name).one_or_none()
        if group is None:
            group = CategoryGroup(name=group_name, kind=kind, sort_order=group_order)
            db.add(group)
            db.flush()
            groups_added += 1
        elif not skip_existing:
            group.kind = kind

        for order, (category_name, is_sinking_fund) in enumerate(category_names):
            exists = (
                db.query(Category)
                .filter(Category.group_id == group.id, Category.name == category_name)
                .one_or_none()
            )
            if exists is not None:
                continue
            db.add(
                Category(
                    group_id=group.id,
                    name=category_name,
                    sort_order=order,
                    is_sinking_fund=is_sinking_fund,
                )
            )
            categories_added += 1

    db.commit()
    return {"groups": groups_added, "categories": categories_added}
