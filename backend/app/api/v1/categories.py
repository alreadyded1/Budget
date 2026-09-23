"""Category groups and categories, including keyboard reordering."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.category import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    GroupCreate,
    GroupListOut,
    GroupOut,
    GroupUpdate,
    MoveRequest,
)
from app.services import categories as service

router = APIRouter(tags=["categories"])


def _group_out(db: DbSession, group) -> GroupOut:
    return GroupOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        sort_order=group.sort_order,
        is_hidden=group.is_hidden,
        categories=[CategoryOut.model_validate(row) for row in service.categories_in(db, group.id)],
    )


@router.get("/category-groups", response_model=GroupListOut)
def list_groups(
    db: DbSession = Depends(get_db), include_hidden: bool = Query(default=True)
) -> GroupListOut:
    groups = service.list_groups(db, include_hidden=include_hidden)
    return GroupListOut(items=[_group_out(db, group) for group in groups])


@router.post("/category-groups", response_model=GroupOut, status_code=201)
def create_group(payload: GroupCreate, db: DbSession = Depends(get_db)) -> GroupOut:
    return _group_out(db, service.create_group(db, payload.name, payload.kind))


@router.patch("/category-groups/{group_id}", response_model=GroupOut)
def update_group(group_id: int, payload: GroupUpdate, db: DbSession = Depends(get_db)) -> GroupOut:
    changes = payload.model_dump(exclude_unset=True)
    return _group_out(db, service.update_group(db, group_id, changes))


@router.post("/category-groups/{group_id}/move", response_model=GroupListOut)
def move_group(
    group_id: int, payload: MoveRequest, db: DbSession = Depends(get_db)
) -> GroupListOut:
    service.move_group(db, group_id, payload.offset)
    return GroupListOut(items=[_group_out(db, group) for group in service.list_groups(db)])


@router.delete("/category-groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.delete_group(db, group_id)
    return Response(status_code=204)


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: DbSession = Depends(get_db)) -> CategoryOut:
    category = service.create_category(
        db,
        payload.group_id,
        payload.name,
        is_sinking_fund=payload.is_sinking_fund,
        default_planned_cents=payload.default_planned_cents,
    )
    return CategoryOut.model_validate(category)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, db: DbSession = Depends(get_db)
) -> CategoryOut:
    changes = payload.model_dump(exclude_unset=True)
    return CategoryOut.model_validate(service.update_category(db, category_id, changes))


@router.post("/categories/{category_id}/move", response_model=GroupListOut)
def move_category(
    category_id: int, payload: MoveRequest, db: DbSession = Depends(get_db)
) -> GroupListOut:
    """Alt+Up / Alt+Down. Returns every group so the UI can replace its state wholesale."""
    service.move_category(db, category_id, payload.offset)
    return GroupListOut(items=[_group_out(db, group) for group in service.list_groups(db)])


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    db: DbSession = Depends(get_db),
    reassign_to: int | None = Query(default=None),
) -> Response:
    service.delete_category(db, category_id, reassign_to)
    return Response(status_code=204)


@router.post("/categories/seed-starter", response_model=GroupListOut, status_code=201)
def seed_starter_categories(db: DbSession = Depends(get_db)) -> GroupListOut:
    """The first-run offer: create the starter set, leaving anything existing alone."""
    from app.services.seed import seed_categories

    seed_categories(db)
    return GroupListOut(items=[_group_out(db, group) for group in service.list_groups(db)])
