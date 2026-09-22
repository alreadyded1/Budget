"""Household members. Any signed-in user can manage the others (SPEC §17)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.models import User
from app.schemas.auth import UserOut
from app.schemas.user import PasswordReset, UserCreate, UserListResponse, UserUpdate
from app.services import users as users_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UserListResponse)
def list_users(db: DbSession = Depends(get_db)) -> UserListResponse:
    return UserListResponse(items=[UserOut.model_validate(u) for u in users_service.list_users(db)])


@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: DbSession = Depends(get_db)) -> UserOut:
    user = users_service.create_user(db, payload.username, payload.display_name, payload.password)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: DbSession = Depends(get_db),
    actor: User = Depends(current_user),
) -> UserOut:
    user = users_service.get_user(db, user_id)
    if payload.display_name is not None:
        user = users_service.rename(db, user_id, payload.display_name)
    if payload.is_active is not None:
        user = users_service.set_active(db, user_id, payload.is_active, acting_user_id=actor.id)
    return UserOut.model_validate(user)


@router.post("/{user_id}/password", response_model=UserOut)
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: DbSession = Depends(get_db),
    actor: User = Depends(current_user),
) -> UserOut:
    # Resetting someone else's password drops their sessions;
    # resetting your own keeps you signed in.
    user = users_service.set_password(
        db, user_id, payload.password, revoke_sessions=user_id != actor.id
    )
    return UserOut.model_validate(user)
