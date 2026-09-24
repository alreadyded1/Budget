"""Application settings, read from PB_* environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
DEFAULT_DATA_DIR = BACKEND_DIR / "var"


class Settings(BaseSettings):
    """Runtime configuration. Dev defaults live under backend/var/."""

    model_config = SettingsConfigDict(env_prefix="PB_", extra="ignore")

    env: str = "development"
    data_dir: Path = DEFAULT_DATA_DIR
    database_path: Path | None = None
    secret_key: str = "dev-insecure-secret-key-change-me"
    base_url: str = "http://localhost:8000"
    #: Nightly backups older than this many days are deleted (the newest is always kept).
    backup_keep_days: int = 14

    @field_validator("env")
    @classmethod
    def _known_env(cls, value: str) -> str:
        allowed = {"development", "test", "production"}
        if value not in allowed:
            raise ValueError(f"PB_ENV must be one of {sorted(allowed)}")
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def db_path(self) -> Path:
        """Database file location; defaults to <data_dir>/budget.db."""
        return self.database_path or self.data_dir / "budget.db"

    @property
    def database_url(self) -> str:
        return f"sqlite+pysqlite:///{self.db_path}"

    @property
    def receipts_dir(self) -> Path:
        return self.data_dir / "receipts"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def frontend_dist(self) -> Path:
        return REPO_DIR / "frontend" / "dist"

    def ensure_dirs(self) -> None:
        """Create the data directories the app writes to."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
