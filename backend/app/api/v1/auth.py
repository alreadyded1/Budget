"""Login, logout, and who-am-I. The only routes that skip the auth dependency."""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session as DbSession

from app.auth import clear_session_cookie, current_user, require_csrf_header, set_session_cookie
from app.config import Settings, get_settings
from app.db import get_db
from app.domain.rate_limit import FailureTracker
from app.errors import AppError
from app.models import User
from app.schemas.auth import LoginRequest, LoginResponse, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

# One process, one worker: in-memory is the whole story. See ARCHITECTURE.md.
login_failures = FailureTracker()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(require_csrf_header)])
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    username_key = f"user:{payload.username.lower()}"
    ip_key = f"ip:{_client_ip(request)}"

    if login_failures.any_locked(username_key, ip_key):
        retry_after = max(
            login_failures.retry_after_seconds(username_key),
            login_failures.retry_after_seconds(ip_key),
        )
        raise AppError(
            429,
            f"Too many failed attempts. Try again in {retry_after // 60 + 1} minutes.",
            "too_many_attempts",
        )

    user = auth_service.authenticate(db, payload.username, payload.password)
    if user is None:
        login_failures.record_failure(username_key, ip_key)
        raise AppError(401, "Incorrect username or password.", "invalid_credentials")

    login_failures.reset(username_key, ip_key)
    raw_token = auth_service.start_session(db, user, request.headers.get("user-agent"))
    set_session_cookie(response, raw_token, settings)
    return LoginResponse(user=UserOut.model_validate(user))


@router.post("/logout", status_code=204, dependencies=[Depends(require_csrf_header)])
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)) -> Response:
    raw_token = request.cookies.get(auth_service.SESSION_COOKIE)
    if raw_token:
        auth_service.end_session(db, raw_token)
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)
