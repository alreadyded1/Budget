"""Request-level auth: the session cookie dependency and the CSRF header check."""

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session as DbSession

from app.config import Settings, get_settings
from app.db import get_db
from app.errors import AppError
from app.models import User
from app.services import auth as auth_service

CSRF_HEADER = "X-PB-Request"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def set_session_cookie(response: Response, raw_token: str, settings: Settings) -> None:
    response.set_cookie(
        auth_service.SESSION_COOKIE,
        raw_token,
        max_age=int(auth_service.SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(auth_service.SESSION_COOKIE, path="/")


def require_csrf_header(request: Request) -> None:
    """A cross-site form post cannot set a custom header, so this stands in for CSRF tokens."""
    if request.method in SAFE_METHODS:
        return
    if request.headers.get(CSRF_HEADER) != "1":
        raise AppError(403, f"Missing {CSRF_HEADER} header.", "missing_request_header")


def current_user(
    request: Request,
    db: DbSession = Depends(get_db),
) -> User:
    raw_token = request.cookies.get(auth_service.SESSION_COOKIE)
    if not raw_token:
        raise AppError(401, "Not signed in.", "unauthenticated")

    session = auth_service.resolve_session(db, raw_token)
    if session is None:
        raise AppError(401, "Your session has expired.", "session_expired")

    request.state.session_id = session.id
    return session.user


def authenticated(
    _csrf: None = Depends(require_csrf_header),
    user: User = Depends(current_user),
) -> User:
    """Router-level dependency: every route is protected unless it opts out."""
    return user


def settings_dependency(settings: Settings = Depends(get_settings)) -> Settings:
    return settings
