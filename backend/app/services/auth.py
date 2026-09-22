"""Password hashing and session lifecycle."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Session, User, utcnow

SESSION_TTL = timedelta(days=30)
SESSION_COOKIE = "pb_session"
TOKEN_BYTES = 32

# argon2id is the library default; parameters are argon2-cffi's recommended profile.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def get_user_by_username(db: DbSession, username: str) -> User | None:
    return db.scalars(select(User).where(User.username == username)).first()


def authenticate(db: DbSession, username: str, password: str) -> User | None:
    """Return the user when the credentials are good and the account is active."""
    user = get_user_by_username(db, username)
    if user is None:
        # Spend the same time as a real verification so timing doesn't leak usernames.
        _hasher.hash(password)
        return None
    if not verify_password(user.password_hash, password):
        return None
    if not user.is_active:
        return None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def start_session(db: DbSession, user: User, user_agent: str | None = None) -> str:
    """Create a session row and return the raw token for the cookie."""
    raw_token = secrets.token_urlsafe(TOKEN_BYTES)
    now = utcnow()
    db.add(
        Session(
            token_hash=token_hash(raw_token),
            user_id=user.id,
            expires_at=now + SESSION_TTL,
            last_seen_at=now,
            user_agent=user_agent[:255] if user_agent else None,
        )
    )
    user.last_login_at = now
    db.commit()
    return raw_token


def resolve_session(db: DbSession, raw_token: str) -> Session | None:
    """Look up a live session by cookie token and slide its expiry."""
    session = db.scalars(select(Session).where(Session.token_hash == token_hash(raw_token))).first()
    if session is None:
        return None

    now = utcnow()
    if _as_utc(session.expires_at) <= now:
        db.delete(session)
        db.commit()
        return None
    if not session.user.is_active:
        return None

    session.last_seen_at = now
    session.expires_at = now + SESSION_TTL
    db.commit()
    return session


def end_session(db: DbSession, raw_token: str) -> bool:
    """Delete the session server-side. True when something was actually removed."""
    session = db.scalars(select(Session).where(Session.token_hash == token_hash(raw_token))).first()
    if session is None:
        return False
    db.delete(session)
    db.commit()
    return True


def end_all_sessions_for_user(db: DbSession, user_id: int) -> int:
    sessions = list(db.scalars(select(Session).where(Session.user_id == user_id)))
    for session in sessions:
        db.delete(session)
    db.commit()
    return len(sessions)


def purge_expired_sessions(db: DbSession) -> int:
    now = utcnow()
    expired = [s for s in db.scalars(select(Session)) if _as_utc(s.expires_at) <= now]
    for session in expired:
        db.delete(session)
    db.commit()
    return len(expired)


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; treat them as the UTC they were stored as."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
