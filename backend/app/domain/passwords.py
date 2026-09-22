"""Password policy. Length is the requirement; composition rules are not."""

MIN_LENGTH = 12
MAX_LENGTH = 256

# Rejected outright regardless of length.
_OBVIOUS = frozenset(
    {
        "123456789012",
        "passwordpassword",
        "password1234",
        "qwertyuiop12",
        "111111111111",
        "aaaaaaaaaaaa",
    }
)


def password_problem(password: str) -> str | None:
    """Return a human-readable problem with the password, or None if it is fine."""
    if len(password) < MIN_LENGTH:
        return f"Password must be at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Password must be at most {MAX_LENGTH} characters."
    if password.strip() != password:
        return "Password cannot start or end with whitespace."
    if password.lower() in _OBVIOUS:
        return "That password is too easy to guess."
    return None


def is_acceptable(password: str) -> bool:
    return password_problem(password) is None
