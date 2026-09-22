"""Household member management. Every user has full access; see SPEC §17."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.domain.passwords import password_problem
from app.errors import AppError
from app.models import User
from app.services import auth


def list_users(db: DbSession) -> list[User]:
    return list(db.scalars(select(User).order_by(func.lower(User.username))))


def get_user(db: DbSession, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise AppError(404, "User not found", "user_not_found")
    return user


def _validate_password(password: str) -> None:
    problem = password_problem(password)
    if problem is not None:
        raise AppError(422, problem, "password_too_weak")


def create_user(db: DbSession, username: str, display_name: str, password: str) -> User:
    username = username.strip()
    if not username:
        raise AppError(422, "Username is required.", "username_required")
    _validate_password(password)

    user = User(
        username=username,
        display_name=display_name.strip() or username,
        password_hash=auth.hash_password(password),
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "That username is already taken.", "username_taken") from exc
    db.refresh(user)
    return user


def count_active_users(db: DbSession) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.is_active)) or 0


def set_active(db: DbSession, user_id: int, is_active: bool, *, acting_user_id: int) -> User:
    user = get_user(db, user_id)
    if user.is_active == is_active:
        return user

    if not is_active:
        # Guard rails so the household can never lock itself out of the app.
        if user.id == acting_user_id:
            raise AppError(409, "You cannot disable your own account.", "cannot_disable_self")
        if count_active_users(db) <= 1:
            raise AppError(
                409, "The last active user cannot be disabled.", "cannot_disable_last_user"
            )

    user.is_active = is_active
    if not is_active:
        auth.end_all_sessions_for_user(db, user.id)
    db.commit()
    db.refresh(user)
    return user


def rename(db: DbSession, user_id: int, display_name: str) -> User:
    user = get_user(db, user_id)
    display_name = display_name.strip()
    if not display_name:
        raise AppError(422, "Display name is required.", "display_name_required")
    user.display_name = display_name
    db.commit()
    db.refresh(user)
    return user


def set_password(db: DbSession, user_id: int, password: str, *, revoke_sessions: bool) -> User:
    """Reset a password. Other sessions are dropped so a reset really locks someone out."""
    user = get_user(db, user_id)
    _validate_password(password)
    user.password_hash = auth.hash_password(password)
    db.commit()
    if revoke_sessions:
        auth.end_all_sessions_for_user(db, user.id)
    db.refresh(user)
    return user
