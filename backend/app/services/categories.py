"""Category groups and categories, including keyboard reordering and safe deletes."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.domain.ordering import moved
from app.errors import AppError
from app.models import GROUP_KINDS, Category, CategoryGroup
from app.services import references


def list_groups(db: DbSession, *, include_hidden: bool = True) -> list[CategoryGroup]:
    query = select(CategoryGroup).order_by(CategoryGroup.sort_order, func.lower(CategoryGroup.name))
    if not include_hidden:
        query = query.where(CategoryGroup.is_hidden.is_(False))
    return list(db.scalars(query))


def get_group(db: DbSession, group_id: int) -> CategoryGroup:
    group = db.get(CategoryGroup, group_id)
    if group is None:
        raise AppError(404, "Category group not found", "category_group_not_found")
    return group


def get_category(db: DbSession, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise AppError(404, "Category not found", "category_not_found")
    return category


def categories_in(db: DbSession, group_id: int) -> list[Category]:
    return list(
        db.scalars(
            select(Category).where(Category.group_id == group_id).order_by(Category.sort_order)
        )
    )


def create_group(db: DbSession, name: str, kind: str = "expense") -> CategoryGroup:
    name = (name or "").strip()
    if not name:
        raise AppError(422, "Group name is required.", "name_required")
    if kind not in GROUP_KINDS:
        raise AppError(422, f"Unknown group kind: {kind}", "invalid_group_kind")

    highest = db.scalar(select(func.max(CategoryGroup.sort_order)))
    group = CategoryGroup(name=name, kind=kind, sort_order=0 if highest is None else highest + 1)
    db.add(group)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "A group with that name already exists.", "group_name_taken") from exc
    db.refresh(group)
    return group


def update_group(db: DbSession, group_id: int, changes: dict) -> CategoryGroup:
    group = get_group(db, group_id)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise AppError(422, "Group name is required.", "name_required")
        changes["name"] = name
    if changes.get("kind") is not None and changes["kind"] not in GROUP_KINDS:
        raise AppError(422, f"Unknown group kind: {changes['kind']}", "invalid_group_kind")

    for field, value in changes.items():
        setattr(group, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "A group with that name already exists.", "group_name_taken") from exc
    db.refresh(group)
    return group


def delete_group(db: DbSession, group_id: int) -> None:
    group = get_group(db, group_id)
    if categories_in(db, group_id):
        raise AppError(
            409,
            "Move or delete this group's categories first.",
            "group_not_empty",
        )
    db.delete(group)
    db.commit()


def create_category(
    db: DbSession,
    group_id: int,
    name: str,
    *,
    is_sinking_fund: bool = False,
    default_planned_cents: int = 0,
) -> Category:
    get_group(db, group_id)
    name = (name or "").strip()
    if not name:
        raise AppError(422, "Category name is required.", "name_required")

    highest = db.scalar(select(func.max(Category.sort_order)).where(Category.group_id == group_id))
    category = Category(
        group_id=group_id,
        name=name,
        sort_order=0 if highest is None else highest + 1,
        is_sinking_fund=is_sinking_fund,
        default_planned_cents=default_planned_cents,
    )
    db.add(category)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            409, "That group already has a category with that name.", "category_name_taken"
        ) from exc
    db.refresh(category)
    return category


def update_category(db: DbSession, category_id: int, changes: dict) -> Category:
    category = get_category(db, category_id)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise AppError(422, "Category name is required.", "name_required")
        changes["name"] = name
    if "group_id" in changes and changes["group_id"] is not None:
        get_group(db, changes["group_id"])

    for field, value in changes.items():
        setattr(category, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            409, "That group already has a category with that name.", "category_name_taken"
        ) from exc
    db.refresh(category)
    return category


def move_category(db: DbSession, category_id: int, offset: int) -> list[Category]:
    """Move a category up or down inside its group. This is what Alt+Up/Down calls."""
    category = get_category(db, category_id)
    ordered = [row.id for row in categories_in(db, category.group_id)]
    reordered = moved(ordered, category_id, offset)

    rows = {row.id: row for row in categories_in(db, category.group_id)}
    for position, row_id in enumerate(reordered):
        rows[row_id].sort_order = position
    db.commit()
    return categories_in(db, category.group_id)


def move_group(db: DbSession, group_id: int, offset: int) -> list[CategoryGroup]:
    get_group(db, group_id)
    ordered = [row.id for row in list_groups(db)]
    reordered = moved(ordered, group_id, offset)

    rows = {row.id: row for row in list_groups(db)}
    for position, row_id in enumerate(reordered):
        rows[row_id].sort_order = position
    db.commit()
    return list_groups(db)


def delete_category(db: DbSession, category_id: int, reassign_to: int | None = None) -> None:
    """Delete a category, moving anything that references it to `reassign_to` first.

    Which tables those are grows with the phases; see app/services/references.py.
    """
    category = get_category(db, category_id)

    counts = references.count_category_references(db, category_id)
    total = sum(counts.values())
    if total and reassign_to is None:
        raise AppError(
            409,
            f"{total} entries still use this category. Choose a category to move them to.",
            "category_in_use",
        )

    if reassign_to is not None:
        if reassign_to == category_id:
            raise AppError(422, "Pick a different category to move entries to.", "same_category")
        get_category(db, reassign_to)
        references.reassign_category(db, category_id, reassign_to)

    db.delete(category)
    db.commit()
